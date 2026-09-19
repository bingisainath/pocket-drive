package com.bingisainath.pocketdrive.uploader

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.ForegroundInfo
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * The Android 13-and-below execution path: a WorkManager foreground worker. It promotes itself to a
 * foreground service (so long uploads aren't killed) and drains the queue on WorkManager's own
 * background thread.
 */
class UploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

  override fun doWork(): Result {
    runCatching { setForegroundAsync(foregroundInfo()).get() }
    UploadRunner.drain(applicationContext)
    // If anything is still unfinished (e.g. network dropped), let WorkManager retry with backoff.
    return if (UploadRunner.hasWork(applicationContext)) Result.retry() else Result.success()
  }

  private fun foregroundInfo(): ForegroundInfo {
    val notification = UploadNotifier.build(applicationContext)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(
        UploadNotifier.NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      ForegroundInfo(UploadNotifier.NOTIFICATION_ID, notification)
    }
  }
}
