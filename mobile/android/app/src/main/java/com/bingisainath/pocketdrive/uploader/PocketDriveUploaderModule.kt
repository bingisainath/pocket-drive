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
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * The bridge between JS and the durable, background-capable uploader. JS enqueues picked files;
 * they are persisted to [UploadQueue] and drained by [UploadRunner] via a JobScheduler job
 * (API 34+) or WorkManager worker, so uploads continue in the background and across reboots. While
 * the app is alive this module relays live progress to JS through the "PocketDriveUpload" event.
 */
class PocketDriveUploaderModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  init {
    // Relay drainer events to JS whenever a React instance is around to receive them.
    UploadRunner.listener = { event -> emit(event.toMap()) }
  }

  override fun invalidate() {
    UploadRunner.listener = null
    super.invalidate()
  }

  @ReactMethod
  fun enqueue(id: String, uri: String, name: String, size: Double, lastModified: Double, folder: String, baseUrl: String, token: String) {
    val queue = UploadQueue.get(reactContext)
    val trimmedBase = baseUrl.trimEnd('/')
    queue.insert(
      UploadJob(
        id = id,
        uri = uri,
        name = name,
        size = size.toLong(),
        lastModified = lastModified.toLong(),
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
    // A fresh token was just supplied; apply it to any older jobs whose token may have expired.
    queue.refreshAuth(trimmedBase, token)
    UploadScheduler.schedule(reactContext)
  }

  @ReactMethod
  fun cancel(id: String) {
    UploadRunner.cancel(reactContext, id)
  }

  @ReactMethod
  fun retry(id: String) {
    UploadQueue.get(reactContext).requeue(id)
    UploadScheduler.schedule(reactContext)
  }

  @ReactMethod
  fun remove(id: String) {
    UploadQueue.get(reactContext).remove(id)
  }

  @ReactMethod
  fun clearFinished() {
    UploadQueue.get(reactContext).clearFinished()
  }

  /** Hydrate the JS panel from the persisted queue on app start. */
  @ReactMethod
  fun getQueue(promise: Promise) {
    val array: WritableArray = Arguments.createArray()
    UploadQueue.get(reactContext).all().forEach { array.pushMap(it.toMap()) }
    promise.resolve(array)
  }

  /** Return (and clear) files shared into the app, copied to cache and ready to enqueue. */
  @ReactMethod
  fun getSharedFiles(promise: Promise) {
    val array: WritableArray = Arguments.createArray()
    SharedImport.drain(reactContext).forEach { shared ->
      array.pushMap(
        Arguments.createMap().apply {
          putString("uri", shared.uri)
          putString("name", shared.name)
          putDouble("size", shared.size.toDouble())
          putDouble("lastModified", shared.lastModified.toDouble())
        },
      )
    }
    promise.resolve(array)
  }

  @ReactMethod
  fun getWifiOnly(promise: Promise) {
    promise.resolve(UploadSettings.wifiOnly(reactContext))
  }

  @ReactMethod
  fun setWifiOnly(value: Boolean) {
    UploadSettings.setWifiOnly(reactContext, value)
  }

  @ReactMethod
  fun getCameraBackup(promise: Promise) {
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("enabled", UploadSettings.cameraBackupEnabled(reactContext))
        putString("folder", UploadSettings.cameraBackupFolder(reactContext))
      },
    )
  }

  /** Enable/disable camera backup. Enabling sets the watermark to "now" so only new media is sent. */
  @ReactMethod
  fun setCameraBackup(enabled: Boolean, folder: String) {
    val since = if (enabled) System.currentTimeMillis() / 1000 else 0
    UploadSettings.setCameraBackup(reactContext, enabled, folder, since)
  }

  /** Scan for new photos/videos and enqueue them; resolves with the number queued. */
  @ReactMethod
  fun scanCameraBackup(baseUrl: String, token: String, promise: Promise) {
    try {
      promise.resolve(MediaBackup.scan(reactContext, baseUrl, token))
    } catch (e: Exception) {
      promise.reject("scan_failed", e.message ?: "Camera backup scan failed", e)
    }
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

  private fun UploadJob.toMap(): WritableMap = Arguments.createMap().apply {
    putString("id", id)
    putString("uri", uri)
    putString("name", name)
    putDouble("size", size.toDouble())
    putDouble("lastModified", lastModified.toDouble())
    putString("folder", folder)
    putString("status", status)
    putDouble("uploaded", uploaded.toDouble())
    if (error != null) putString("error", error)
  }

  private fun UploadEvent.toMap(): WritableMap = Arguments.createMap().apply {
    putString("id", id)
    putString("type", type)
    when (this@toMap) {
      is UploadEvent.Progress -> {
        putDouble("uploaded", uploaded.toDouble())
        putDouble("total", total.toDouble())
      }
      is UploadEvent.Reconnecting -> putBoolean("reconnecting", reconnecting)
      is UploadEvent.Done -> putString("file", file)
      is UploadEvent.Failed -> putString("message", message)
      is UploadEvent.Cancelled -> {}
    }
  }

  private fun emit(params: WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT, params)
  }

  companion object {
    const val NAME = "PocketDriveUploader"
    const val EVENT = "PocketDriveUpload"
  }
}
