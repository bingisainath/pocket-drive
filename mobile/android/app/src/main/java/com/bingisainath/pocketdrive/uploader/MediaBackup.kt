package com.bingisainath.pocketdrive.uploader

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore

/**
 * Camera backup: finds photos and videos newer than the stored watermark and enqueues them into the
 * durable [UploadQueue], so the existing background drainer uploads them (respecting the Wi-Fi-only
 * setting). The watermark is DATE_ADDED (seconds); a scan advances it past everything it enqueues so
 * nothing is uploaded twice. Enabling backup sets the watermark to "now", so only new media is sent.
 */
object MediaBackup {
  private data class Collection(val uri: Uri, val idPrefix: String)

  private val COLLECTIONS = listOf(
    Collection(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "cam-img"),
    Collection(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "cam-vid"),
  )

  /** Scan for new media and enqueue it. Returns how many items were queued. */
  fun scan(context: Context, baseUrl: String, token: String): Int {
    if (!UploadSettings.cameraBackupEnabled(context)) return 0
    val folder = UploadSettings.cameraBackupFolder(context)
    val since = UploadSettings.cameraBackupSince(context)
    val queue = UploadQueue.get(context)
    val trimmedBase = baseUrl.trimEnd('/')

    val projection = arrayOf(
      MediaStore.MediaColumns._ID,
      MediaStore.MediaColumns.DISPLAY_NAME,
      MediaStore.MediaColumns.SIZE,
      MediaStore.MediaColumns.DATE_ADDED,
      MediaStore.MediaColumns.DATE_MODIFIED,
    )
    val selection = "${MediaStore.MediaColumns.DATE_ADDED} > ?"
    val sort = "${MediaStore.MediaColumns.DATE_ADDED} ASC"

    var maxAdded = since
    var count = 0
    for (collection in COLLECTIONS) {
      context.contentResolver.query(collection.uri, projection, selection, arrayOf(since.toString()), sort)?.use { c ->
        val idI = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
        val nameI = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
        val sizeI = c.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
        val addedI = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
        val modifiedI = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
        while (c.moveToNext()) {
          val id = c.getLong(idI)
          val size = c.getLong(sizeI)
          if (size <= 0) continue // skip placeholders / pending media
          val name = if (c.isNull(nameI)) "media-$id" else c.getString(nameI)
          val dateAdded = c.getLong(addedI)
          val dateModified = c.getLong(modifiedI)
          val itemUri = ContentUris.withAppendedId(collection.uri, id)
          queue.insert(
            UploadJob(
              id = "${collection.idPrefix}-$id",
              uri = itemUri.toString(),
              name = name,
              size = size,
              lastModified = dateModified * 1000, // MediaStore is seconds; the drive expects ms
              folder = folder,
              baseUrl = trimmedBase,
              token = token,
              status = UploadQueue.PENDING,
              uploaded = 0,
              sessionId = null,
              error = null,
              createdAt = System.currentTimeMillis(),
            ),
          )
          if (dateAdded > maxAdded) maxAdded = dateAdded
          count++
        }
      }
    }

    if (count > 0) {
      UploadSettings.setCameraBackupSince(context, maxAdded)
      queue.refreshAuth(trimmedBase, token)
      UploadScheduler.schedule(context)
    }
    return count
  }
}
