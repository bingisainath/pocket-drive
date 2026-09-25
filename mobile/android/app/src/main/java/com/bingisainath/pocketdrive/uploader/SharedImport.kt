package com.bingisainath.pocketdrive.uploader

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File

/** A file shared into the app, already copied to app-private cache and ready to enqueue. */
data class SharedFile(val uri: String, val name: String, val size: Long, val lastModified: Long)

/**
 * Handles files shared into the app via ACTION_SEND / ACTION_SEND_MULTIPLE. The sender only grants
 * temporary read access to the receiving activity, but our uploads run later in a background job —
 * so we copy the bytes into app cache now, while the grant is valid, and enqueue those copies.
 */
object SharedImport {
  private val pending = ArrayList<Uri>()

  /** Remember the URIs from a share intent (call from the activity). */
  @Synchronized
  fun capture(intent: Intent?) {
    intent ?: return
    val uris = when (intent.action) {
      Intent.ACTION_SEND -> listOfNotNull(streamExtra(intent))
      Intent.ACTION_SEND_MULTIPLE ->
        @Suppress("DEPRECATION")
        (intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList())
      else -> emptyList()
    }
    pending.addAll(uris)
  }

  @Synchronized
  fun hasPending(): Boolean = pending.isNotEmpty()

  /** Copy every pending share into cache and return the descriptors; clears the buffer. */
  @Synchronized
  fun drain(context: Context): List<SharedFile> {
    if (pending.isEmpty()) return emptyList()
    val resolver = context.contentResolver
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    val out = ArrayList<SharedFile>()
    for (uri in pending) {
      runCatching {
        val name = displayName(resolver, uri)
        val dest = File(dir, "${System.currentTimeMillis()}-$name")
        resolver.openInputStream(uri)?.use { input ->
          dest.outputStream().use { output -> input.copyTo(output) }
        } ?: return@runCatching
        out.add(SharedFile(Uri.fromFile(dest).toString(), name, dest.length(), dest.lastModified()))
      }
    }
    pending.clear()
    return out
  }

  @Suppress("DEPRECATION")
  private fun streamExtra(intent: Intent): Uri? = intent.getParcelableExtra(Intent.EXTRA_STREAM)

  private fun displayName(resolver: ContentResolver, uri: Uri): String {
    val fromProvider = runCatching {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0)?.takeIf { it.isNotBlank() } else null
      }
    }.getOrNull()
    val name = fromProvider ?: uri.lastPathSegment ?: "shared-${System.currentTimeMillis()}"
    // Strip any path separators a provider might sneak into the display name.
    return name.substringAfterLast('/').substringAfterLast('\\')
  }
}
