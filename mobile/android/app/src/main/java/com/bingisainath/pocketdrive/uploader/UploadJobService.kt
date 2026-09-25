package com.bingisainath.pocketdrive.uploader

import android.app.job.JobParameters
import android.app.job.JobService
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * The Android 14+ execution path: a user-initiated data-transfer job. It must show a progress
 * notification promptly, then drain the queue on a worker thread and call [jobFinished] when done.
 * Instantiated only on API 34+ (see [UploadScheduler]).
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class UploadJobService : JobService() {

  override fun onStartJob(params: JobParameters): Boolean {
    setNotification(
      params,
      UploadNotifier.NOTIFICATION_ID,
      UploadNotifier.build(this),
      JOB_END_NOTIFICATION_POLICY_REMOVE,
    )
    Thread({
      try {
        UploadRunner.drain(this)
      } finally {
        // Reschedule ourselves if more work slipped in (or was preempted) so nothing is stranded.
        jobFinished(params, UploadQueue.get(this).hasUnfinished())
      }
    }, "pd-upload-job").start()
    return true // work continues on the thread above
  }

  override fun onStopJob(params: JobParameters): Boolean {
    UploadRunner.requestStop()
    return true // reschedule so the remaining files resume
  }
}
