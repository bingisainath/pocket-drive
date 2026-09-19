package com.bingisainath.pocketdrive.uploader

import android.content.Context

/**
 * User preferences for background uploads, in app-private SharedPreferences so both JS and the
 * background schedulers read the same value. Currently just the network policy.
 */
object UploadSettings {
  private const val PREFS = "pocketdrive-upload-settings"
  private const val KEY_WIFI_ONLY = "wifiOnly"
  private const val KEY_CAMERA_ENABLED = "cameraBackupEnabled"
  private const val KEY_CAMERA_FOLDER = "cameraBackupFolder"
  private const val KEY_CAMERA_SINCE = "cameraBackupSince"

  /** When true (the default), background uploads wait for an unmetered (Wi-Fi) connection. */
  fun wifiOnly(context: Context): Boolean =
    prefs(context).getBoolean(KEY_WIFI_ONLY, true)

  fun setWifiOnly(context: Context, value: Boolean) {
    prefs(context).edit().putBoolean(KEY_WIFI_ONLY, value).apply()
  }

  /** Whether new photos/videos are auto-uploaded (off by default). */
  fun cameraBackupEnabled(context: Context): Boolean =
    prefs(context).getBoolean(KEY_CAMERA_ENABLED, false)

  /** The drive folder path new camera items are backed up to. */
  fun cameraBackupFolder(context: Context): String =
    prefs(context).getString(KEY_CAMERA_FOLDER, "") ?: ""

  /** Watermark: only media with DATE_ADDED (seconds) greater than this is backed up. */
  fun cameraBackupSince(context: Context): Long =
    prefs(context).getLong(KEY_CAMERA_SINCE, 0)

  fun setCameraBackup(context: Context, enabled: Boolean, folder: String, since: Long) {
    prefs(context).edit()
      .putBoolean(KEY_CAMERA_ENABLED, enabled)
      .putString(KEY_CAMERA_FOLDER, folder)
      .putLong(KEY_CAMERA_SINCE, since)
      .apply()
  }

  fun setCameraBackupSince(context: Context, since: Long) {
    prefs(context).edit().putLong(KEY_CAMERA_SINCE, since).apply()
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
