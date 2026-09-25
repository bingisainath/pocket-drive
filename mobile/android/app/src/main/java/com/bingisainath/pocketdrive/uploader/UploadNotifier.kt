package com.bingisainath.pocketdrive.uploader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * The ongoing progress notification the background upload job/worker must show. It aggregates all
 * unfinished jobs into one line ("Uploading 3 files — 45%") with a progress bar.
 */
object UploadNotifier {
  const val NOTIFICATION_ID = 4210
  private const val CHANNEL_ID = "uploads"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Uploads", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Progress of files uploading to your drive"
          setShowBadge(false)
        },
      )
    }
  }

  /** A snapshot of what to show: how many files remain and the overall percentage. */
  fun build(context: Context): Notification {
    val unfinished = UploadQueue.get(context).all()
      .filter { it.status == UploadQueue.PENDING || it.status == UploadQueue.RUNNING }
    val count = unfinished.size
    val totalBytes = unfinished.sumOf { it.size }.coerceAtLeast(1)
    val doneBytes = unfinished.sumOf { it.uploaded }
    val percent = ((doneBytes * 100) / totalBytes).toInt().coerceIn(0, 100)

    val text = when {
      count <= 0 -> "Finishing…"
      count == 1 -> "Uploading 1 file — $percent%"
      else -> "Uploading $count files — $percent%"
    }

    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ensureChannel(context)
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
    return builder
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Pocket Drive")
      .setContentText(text)
      .setProgress(100, percent, count <= 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  fun update(context: Context) {
    context.getSystemService(NotificationManager::class.java)
      .notify(NOTIFICATION_ID, build(context))
  }

  fun clear(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
  }
}
