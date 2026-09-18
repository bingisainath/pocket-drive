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

  private companion object {
    val RETRYABLE = setOf(0, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524)
    const val MAX_ATTEMPTS = 10
    const val TIMEOUT_MS = 30_000
  }

  @Volatile private var cancelled = false
  private var sessionId: String? = null

  fun cancel() {
    cancelled = true
  }

  /** Uploads the file, returning the created entry's JSON. Throws on failure or cancellation. */
  fun run(cb: Callbacks): JSONObject {
    var session = openSession()
    sessionId = session.getString("id")
    var offset = session.getLong("offset")
    var chunkSize = session.getLong("chunkSize")
    cb.onProgress(offset, size)

    var failures = 0
    while (true) {
      if (cancelled) throw CancelledException()
      try {
        val end = minOf(offset + chunkSize, size)
        val reply = putChunk(session.getString("id"), offset, end - offset, cb)
        if (reply.has("file")) return reply.getJSONObject("file")
        offset = reply.getLong("offset")
        cb.onProgress(offset, size)
        if (failures > 0) cb.onReconnecting(false)
        failures = 0
      } catch (e: CancelledException) {
        throw e
      } catch (e: HttpError) {
        if (cancelled) throw CancelledException()
        if (e.status == 401) throw e // stop; the app must sign in again
        if (e.status == 409 && e.offset >= 0) {
          offset = e.offset
          if (++failures < MAX_ATTEMPTS) continue
        }
        if (e.status == 404) {
          session = openSession()
          sessionId = session.getString("id")
          offset = session.getLong("offset")
          chunkSize = session.getLong("chunkSize")
          if (++failures < MAX_ATTEMPTS) continue
        }
        if (e.status !in RETRYABLE || ++failures >= MAX_ATTEMPTS) {
          if (failures > 0) cb.onReconnecting(false)
          throw e
        }
        cb.onReconnecting(true)
        sleep(minOf(30_000L, 1000L shl (failures - 1)))
        runCatching { offset = getOffset(session.getString("id")); cb.onProgress(offset, size) }
      }
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

  private fun openSession(): JSONObject {
    val body = JSONObject()
      .put("path", folder)
      .put("name", name)
      .put("size", size)
      .put("lastModified", lastModified)
      .toString()
    val conn = open("POST", "$baseUrl/api/uploads")
    conn.setRequestProperty("Content-Type", "application/json")
    conn.doOutput = true
    conn.outputStream.use { it.write(body.toByteArray()) }
    return readJson(conn)
  }

  private fun getOffset(id: String): Long {
    val conn = open("GET", "$baseUrl/api/uploads/$id")
    return readJson(conn).getLong("offset")
  }

  private fun putChunk(id: String, start: Long, length: Long, cb: Callbacks): JSONObject {
    val conn = open("PUT", "$baseUrl/api/uploads/$id")
    conn.setRequestProperty("Content-Type", "application/octet-stream")
    conn.setRequestProperty("Upload-Offset", start.toString())
    conn.doOutput = true
    conn.setFixedLengthStreamingMode(length)

    openStreamAt(start).use { input ->
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
          cb.onProgress(start + sent, size)
        }
      }
    }
    return readJson(conn)
  }

  /** Open the content URI positioned at [start] bytes (re-opened per chunk; skip handles resync jumps). */
  private fun openStreamAt(start: Long): InputStream {
    val input = resolver.openInputStream(uri) ?: throw HttpError(0, "Can't read the file", -1)
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
    conn.connectTimeout = TIMEOUT_MS
    conn.readTimeout = TIMEOUT_MS
    conn.setRequestProperty("Authorization", "Bearer $token")
    conn.setRequestProperty("Accept", "application/json")
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
