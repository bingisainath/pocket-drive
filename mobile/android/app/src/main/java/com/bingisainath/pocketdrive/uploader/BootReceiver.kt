package com.bingisainath.pocketdrive.uploader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * After a reboot, resume any uploads that were still in flight. The queue survives in SQLite; this
 * just re-arms the scheduler so the drainer picks up where it left off.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    val app = context.applicationContext
    if (UploadQueue.get(app).hasUnfinished()) {
      UploadScheduler.schedule(app)
    }
  }
}
