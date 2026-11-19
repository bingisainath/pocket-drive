package com.bingisainath.pocketdrive.uploader

import android.content.ContentResolver
import android.net.Uri
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Runs the drive's resumable chunked-upload protocol for one file, using only java.net (no extra
 * deps). Mirrors frontend/src/api.ts uploadFile:
 *   POST /api/uploads               -> { id, offset, chunkSize }
 *   PUT  /api/uploads/:id           (Upload-Offset header + chunk bytes) -> { offset } | { offset, file }
 *   409 -> jump to returned offset; 404 -> restart session; retryable -> back off then GET offset; 401 -> stop.
 * Network errors anywhere (including opening the session) count as retryable, and a watchdog aborts
 * a request that stops moving, since a dead socket can otherwise block a write indefinitely.
 *
 * Bytes are streamed straight from the MediaStore/SAF content URI via ContentResolver, so large
 * files never sit in memory. Cancellation is cooperative via [isCancelled].
 */
class ResumableUpload(
  private val resolver: ContentResolver,
  private val baseUrl: String,
  private val token: String,
  private val uri: Uri,
  private val name: String,
  private val size: Long,
  private val lastModified: Long,
  private val folder: String,
) {
  interface Callbacks {
    fun onProgress(uploaded: Long, total: Long)
    fun onReconnecting(reconnecting: Boolean)
  }

  class CancelledException : Exception("Cancelled")

  /** The source file can no longer be read (e.g. the user deleted it) — the job should be dropped. */
  class SourceMissingException : Exception("Source file is missing")

  private companion object {
    val RETRYABLE = setOf(0, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524)
    /** About 8 minutes of backing off before a file is marked failed (and offered a retry). */
    const val MAX_ATTEMPTS = 20
    const val CONNECT_TIMEOUT_MS = 30_000
    /** Waiting for the reply to a chunk: the proxy forwards the whole chunk before the server answers. */
    const val READ_TIMEOUT_MS = 90_000
    /** A chunk that sends nothing for this long is treated as a dead connection and retried. */
    const val STALL_MS = 45_000L
    /** Progress is reported at most this often while bytes stream (it goes to SQLite and over the JS bridge). */
    const val PROGRESS_INTERVAL_MS = 250L
  }

  @Volatile private var cancelled = false
  private var sessionId: String? = null

  /** The request in flight and when it last made progress, for the stall watchdog and cancel. */
  @Volatile private var activeConn: HttpURLConnection? = null
  @Volatile private var lastActivity = 0L
  /** True while bytes are being written; waiting for a reply is bounded by the read timeout instead. */
  @Volatile private var sending = false
  private var lastProgressAt = 0L

  fun cancel() {
    cancelled = true
    activeConn?.disconnect() // unblock a write/read in progress so cancel is immediate
  }

  /** Uploads the file, returning the created entry's JSON. Throws on failure or cancellation. */
  fun run(cb: Callbacks): JSONObject {
    val watchdog = Thread({ watch() }, "pd-upload-watchdog").apply {
      isDaemon = true
      start()
    }
    try {
      return upload(cb)
    } finally {
      watchdog.interrupt()
    }
  }

  private fun upload(cb: Callbacks): JSONObject {
    var session: JSONObject? = null
    var offset = 0L
    var chunkSize = 0L
    var failures = 0
    while (true) {
      if (cancelled) throw CancelledException()
      try {
        val current = session ?: openSession().also {
          session = it
          sessionId = it.getString("id")
          offset = it.getLong("offset")
          chunkSize = it.getLong("chunkSize")
          report(cb, offset, force = true)
        }
        val end = minOf(offset + chunkSize, size)
        val reply = putChunk(current.getString("id"), offset, end - offset, cb)
        if (reply.has("file")) return reply.getJSONObject("file")
        offset = reply.getLong("offset")
        report(cb, offset, force = true)
        if (failures > 0) cb.onReconnecting(false)
        failures = 0
      } catch (e: CancelledException) {
        throw e
      } catch (e: SourceMissingException) {
        throw e
      } catch (e: HttpError) {
        if (cancelled) throw CancelledException()
        if (e.status == 401) throw e // stop; the app must sign in again
        if (e.status == 409 && e.offset >= 0) {
          offset = e.offset
          if (++failures < MAX_ATTEMPTS) continue
        }
        if (e.status == 404 && session != null) {
          session = null // the server forgot the session: open it again (it resumes by file identity)
          if (++failures < MAX_ATTEMPTS) continue
        }
        if (e.status !in RETRYABLE || ++failures >= MAX_ATTEMPTS) {
          if (failures > 0) cb.onReconnecting(false)
          throw e
        }
        cb.onReconnecting(true)
        sleep(minOf(30_000L, 1000L shl minOf(failures - 1, 5)))
        session?.let { s -> runCatching { offset = getOffset(s.getString("id")); report(cb, offset, force = true) } }
      }
    }
  }

  /** Report progress, throttled unless [force]d (chunk boundaries and resyncs always go through). */
  private fun report(cb: Callbacks, uploaded: Long, force: Boolean) {
    val now = System.currentTimeMillis()
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
    lastProgressAt = now
    cb.onProgress(uploaded, size)
  }

  /** Abort the request in flight if it has made no progress for [STALL_MS]; the retry loop takes over. */
  private fun watch() {
    try {
      while (!cancelled) {
        Thread.sleep(5_000)
        val conn = activeConn ?: continue
        if (sending && System.currentTimeMillis() - lastActivity > STALL_MS) conn.disconnect()
      }
    } catch (_: InterruptedException) {
      // upload finished
    }
  }

  /** DELETE the in-flight session (best effort) — used on cancel. */
  fun discard() {
    val id = sessionId ?: return
    runCatching {
      val conn = open("DELETE", "$baseUrl/api/uploads/$id")
      conn.connect()
      conn.responseCode
      conn.disconnect()
    }
  }

  /** Run one request, turning any network failure into a retryable [HttpError] (status 0). */
  private inline fun <T> network(block: () -> T): T =
    try {
      block()
    } catch (e: HttpError) {
      throw e
    } catch (e: CancelledException) {
      throw e
    } catch (e: SourceMissingException) {
      throw e
    } catch (e: java.io.IOException) {
      if (cancelled) throw CancelledException()
      throw HttpError(0, "Connection lost", -1)
    } finally {
      activeConn = null
      sending = false
    }

  private fun openSession(): JSONObject {
    val body = JSONObject()
      .put("path", folder)
      .put("name", name)
      .put("size", size)
      .put("lastModified", lastModified)
      .toString()
    return network {
      val conn = track(open("POST", "$baseUrl/api/uploads"))
      conn.setRequestProperty("Content-Type", "application/json")
      conn.doOutput = true
      conn.outputStream.use { it.write(body.toByteArray()) }
      readJson(conn)
    }
  }

  private fun getOffset(id: String): Long = network {
    readJson(track(open("GET", "$baseUrl/api/uploads/$id"))).getLong("offset")
  }

  private fun putChunk(id: String, start: Long, length: Long, cb: Callbacks): JSONObject {
    // Open the source first: a missing file must not be mistaken for a network error.
    val input = openStreamAt(start)
    return input.use {
      network {
        val conn = track(open("PUT", "$baseUrl/api/uploads/$id"))
        conn.setRequestProperty("Content-Type", "application/octet-stream")
        conn.setRequestProperty("Upload-Offset", start.toString())
        conn.doOutput = true
        conn.setFixedLengthStreamingMode(length)
        sending = true
        conn.outputStream.use { out ->
          val buf = ByteArray(64 * 1024)
          var sent = 0L
          while (sent < length) {
            if (cancelled) throw CancelledException()
            val want = minOf(buf.size.toLong(), length - sent).toInt()
            val read = input.read(buf, 0, want)
            if (read <= 0) break
            out.write(buf, 0, read)
            sent += read
            lastActivity = System.currentTimeMillis()
            report(cb, start + sent, force = false)
          }
        }
        sending = false
        readJson(conn)
      }
    }
  }

  /** Mark [conn] as the request in flight, so the watchdog and [cancel] can abort it. */
  private fun track(conn: HttpURLConnection): HttpURLConnection {
    lastActivity = System.currentTimeMillis()
    activeConn = conn
    if (cancelled) throw CancelledException()
    return conn
  }

  /** Open the content URI positioned at [start] bytes (re-opened per chunk; skip handles resync jumps). */
  private fun openStreamAt(start: Long): InputStream {
    val input = try {
      resolver.openInputStream(uri)
    } catch (e: Exception) {
      // FileNotFoundException etc. — the underlying file is gone.
      throw SourceMissingException()
    } ?: throw SourceMissingException()
    var remaining = start
    while (remaining > 0) {
      val skipped = input.skip(remaining)
      if (skipped <= 0) break
      remaining -= skipped
    }
    return input
  }

  private fun open(method: String, url: String): HttpURLConnection {
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.requestMethod = method
    conn.connectTimeout = CONNECT_TIMEOUT_MS
    conn.readTimeout = READ_TIMEOUT_MS
    conn.setRequestProperty("Authorization", "Bearer $token")
    conn.setRequestProperty("Accept", "application/json")
    // Don't reuse pooled sockets: across many sequential chunk requests, a keep-alive connection
    // that Cloudflare has already closed gets reused and fails with "unexpected end of stream".
    // A fresh socket per request avoids that; the handshake cost is negligible beside a chunk upload.
    conn.setRequestProperty("Connection", "close")
    return conn
  }

  private fun readJson(conn: HttpURLConnection): JSONObject {
    val status = try {
      conn.responseCode
    } catch (e: Exception) {
      throw HttpError(0, e.message ?: "Connection lost", -1)
    }
    val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
    conn.disconnect()
    if (status in 200..299) return if (text.isEmpty()) JSONObject() else JSONObject(text)
    val json = runCatching { JSONObject(text) }.getOrNull()
    throw HttpError(status, json?.optString("error") ?: "Upload failed (HTTP $status)", json?.optLong("offset", -1) ?: -1)
  }

  private class HttpError(val status: Int, message: String, val offset: Long) : Exception(message)

  private fun sleep(ms: Long) {
    val until = System.currentTimeMillis() + ms
    while (System.currentTimeMillis() < until) {
      if (cancelled) throw CancelledException()
      Thread.sleep(minOf(200L, until - System.currentTimeMillis()).coerceAtLeast(0))
    }
  }
}
