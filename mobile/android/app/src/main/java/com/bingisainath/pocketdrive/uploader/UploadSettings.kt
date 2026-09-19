package com.bingisainath.pocketdrive.uploader

import android.content.Context

/**
 * User preferences for background uploads, in app-private SharedPreferences so both JS and the
 * background schedulers read the same value. Currently just the network policy.
 */
object UploadSettings {
  private const val PREFS = "pocketdrive-upload-settings"
  private const val KEY_WIFI_ONLY = "wifiOnly"

  /** When true (the default), background uploads wait for an unmetered (Wi-Fi) connection. */
  fun wifiOnly(context: Context): Boolean =
    prefs(context).getBoolean(KEY_WIFI_ONLY, true)

  fun setWifiOnly(context: Context, value: Boolean) {
    prefs(context).edit().putBoolean(KEY_WIFI_ONLY, value).apply()
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
