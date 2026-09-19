package com.bingisainath.pocketdrive.uploader

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.ConcurrentHashMap

/**
 * The native uploader. JS enqueues a picked file (content URI) with the drive's base URL and the
 * Bearer token; each upload runs on its own worker thread via [ResumableUpload] and reports back
 * through the "PocketDriveUpload" device event. This slice runs while the app is alive; a later
 * slice moves it onto user-initiated jobs / WorkManager for background + reboot resume.
 */
class PocketDriveUploaderModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  private val uploads = ConcurrentHashMap<String, ResumableUpload>()

  @ReactMethod
  fun enqueue(id: String, uri: String, name: String, size: Double, lastModified: Double, folder: String, baseUrl: String, token: String) {
    val upload = ResumableUpload(
      resolver = reactContext.contentResolver,
      baseUrl = baseUrl.trimEnd('/'),
      token = token,
      uri = Uri.parse(uri),
      name = name,
      size = size.toLong(),
      lastModified = lastModified.toLong(),
      folder = folder,
    )
    uploads[id] = upload
    Thread({ runUpload(id, upload) }, "pd-upload-$id").start()
  }

  @ReactMethod
  fun cancel(id: String) {
    uploads[id]?.cancel()
  }

  /** Download a file to the public Downloads folder via Android's DownloadManager (no permission
   *  needed), sending the Bearer token. Shows a system download notification. */
  @ReactMethod
  fun download(url: String, filename: String, mimeType: String, token: String, promise: Promise) {
    try {
      val request = DownloadManager.Request(Uri.parse(url))
        .addRequestHeader("Authorization", "Bearer $token")
        .setTitle(filename)
        .setDescription("Pocket Drive")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
      if (mimeType.isNotEmpty()) request.setMimeType(mimeType)
      val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      dm.enqueue(request)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("download_failed", e.message ?: "Download failed", e)
    }
  }

  // Required so JS NativeEventEmitter is happy on both architectures.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}

  private fun runUpload(id: String, upload: ResumableUpload) {
    val callbacks = object : ResumableUpload.Callbacks {
      override fun onProgress(uploaded: Long, total: Long) = emit(event(id, "progress").apply {
        putDouble("uploaded", uploaded.toDouble())
        putDouble("total", total.toDouble())
      })

      override fun onReconnecting(reconnecting: Boolean) = emit(event(id, "reconnecting").apply {
        putBoolean("reconnecting", reconnecting)
      })
    }
    try {
      val file = upload.run(callbacks)
      emit(event(id, "done").apply { putString("file", file.toString()) })
    } catch (e: ResumableUpload.CancelledException) {
      upload.discard()
      emit(event(id, "cancelled"))
    } catch (e: Exception) {
      emit(event(id, "error").apply { putString("message", e.message ?: "Upload failed") })
    } finally {
      uploads.remove(id)
    }
  }

  private fun event(id: String, type: String): WritableMap =
    Arguments.createMap().apply {
      putString("id", id)
      putString("type", type)
    }

  private fun emit(params: WritableMap) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT, params)
  }

  companion object {
    const val NAME = "PocketDriveUploader"
    const val EVENT = "PocketDriveUpload"
  }
}
