package com.bingisainath.pocketdrive.uploader

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager

/**
 * Kicks off background upload work so the queue drains even when the app is backgrounded or dead.
 *
 * On Android 14+ (API 34) it uses a JobScheduler *user-initiated data-transfer* job — the modern,
 * network-aware path with a system progress notification. On older releases it falls back to a
 * WorkManager foreground worker. Either way execution lands in [UploadRunner.drain].
 */
object UploadScheduler {
  const val JOB_ID = 4210
  const val WORK_NAME = "pocketdrive-uploads"

  /** Ensure the drainer is (or will be) running while there is work to do. Idempotent. */
  fun schedule(context: Context) {
    val app = context.applicationContext
    if (!UploadQueue.get(app).hasUnfinished()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      scheduleJob(app)
    } else {
      scheduleWorker(app)
    }
  }

  private fun scheduleJob(app: Context) {
    val scheduler = app.getSystemService(JobScheduler::class.java)
    if (scheduler.getPendingJob(JOB_ID) != null) return // already scheduled or running

    val remaining = UploadQueue.get(app).all()
      .filter { it.status == UploadQueue.PENDING || it.status == UploadQueue.RUNNING }
      .sumOf { (it.size - it.uploaded).coerceAtLeast(0) }

    val network =
      if (UploadSettings.wifiOnly(app)) JobInfo.NETWORK_TYPE_UNMETERED else JobInfo.NETWORK_TYPE_ANY
    val info = JobInfo.Builder(JOB_ID, ComponentName(app, UploadJobService::class.java))
      .setRequiredNetworkType(network)
      .setUserInitiated(true)
      .setEstimatedNetworkBytes(JobInfo.NETWORK_BYTES_UNKNOWN.toLong(), remaining)
      .build()
    scheduler.schedule(info)
  }

  private fun scheduleWorker(app: Context) {
    val network = if (UploadSettings.wifiOnly(app)) NetworkType.UNMETERED else NetworkType.CONNECTED
    val request = OneTimeWorkRequest.Builder(UploadWorker::class.java)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(network).build())
      .build()
    // KEEP: if a worker is already draining, let it pick up the new rows instead of starting a second.
    WorkManager.getInstance(app).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
  }
}
