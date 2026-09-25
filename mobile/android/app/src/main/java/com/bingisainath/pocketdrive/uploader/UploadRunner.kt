package com.bingisainath.pocketdrive.uploader

import android.content.Context
import android.net.Uri
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock

/** A change to one upload, reported to JS while the app is alive. */
sealed class UploadEvent(val id: String, val type: String) {
  class Progress(id: String, val uploaded: Long, val total: Long) : UploadEvent(id, "progress")
  class Reconnecting(id: String, val reconnecting: Boolean) : UploadEvent(id, "reconnecting")
  class Done(id: String, val file: String) : UploadEvent(id, "done")
  class Failed(id: String, val message: String) : UploadEvent(id, "error")
  class Cancelled(id: String) : UploadEvent(id, "cancelled")

  /** The source file was deleted, so the job was dropped without uploading — remove it from the UI. */
  class Removed(id: String) : UploadEvent(id, "removed")
}

/**
 * Drains the [UploadQueue] by running each pending job through [ResumableUpload], up to
 * [MAX_ACTIVE] at once. It is the one place uploads actually execute — the JobScheduler job and
 * the WorkManager worker both call [drain], and a lock guarantees a single drain loop, so a file
 * is never uploaded twice.
 *
 * [drain] blocks its caller until the queue is empty, which is exactly what a JobService /
 * ListenableWorker needs so Android keeps the process alive until the work is done.
 */
object UploadRunner {
  private const val MAX_ACTIVE = 4
  private const val NOTIFY_THROTTLE_MS = 700L

  private val runLock = ReentrantLock()
  private val active = ConcurrentHashMap<String, ResumableUpload>()
  private val userCancelled = ConcurrentHashMap.newKeySet<String>()
  private val lastNotify = AtomicLong(0)

  /** Set true when Android preempts the job/worker: stop claiming, leave rows resumable. */
  @Volatile private var stopRequested = false

  /** Set by the native module while JS is alive, so the UI sees live progress. */
  @Volatile var listener: ((UploadEvent) -> Unit)? = null

  fun hasWork(context: Context): Boolean = UploadQueue.get(context).hasUnfinished()

  /** Run until no pending jobs remain (or a stop is requested). Blocks the caller. */
  fun drain(context: Context) {
    val app = context.applicationContext
    runLock.lock()
    try {
      stopRequested = false
      val queue = UploadQueue.get(app)
      // Any RUNNING row is from a process that died mid-upload; reclaim it. Safe here: the lock
      // means no other drain loop in this process is touching those rows.
      queue.resetRunning()
      UploadNotifier.ensureChannel(app)
      while (!stopRequested && queue.hasUnfinished()) {
        val workers = (0 until MAX_ACTIVE).map { i ->
          Thread({ workerLoop(app, queue) }, "pd-upload-$i").apply { start() }
        }
        workers.forEach { it.join() }
      }
    } finally {
      UploadNotifier.clear(app)
      runLock.unlock()
    }
  }

  /** Ask the current drain loop to wind down (Android is reclaiming the job). Rows stay resumable. */
  fun requestStop() {
    stopRequested = true
    active.values.forEach { it.cancel() }
  }

  /** Cancel a job: signal the running upload if it's in flight, else mark it cancelled directly. */
  fun cancel(context: Context, id: String) {
    val upload = active[id]
    if (upload != null) {
      userCancelled.add(id)
      upload.cancel() // the worker loop observes it, discards the session and emits 'cancelled'
    } else {
      UploadQueue.get(context).setStatus(id, UploadQueue.CANCELLED)
      emit(UploadEvent.Cancelled(id))
    }
  }

  private fun workerLoop(app: Context, queue: UploadQueue) {
    while (!stopRequested) {
      val job = queue.claimNext() ?: break
      runOne(app, queue, job)
      pushNotification(app, force = true)
    }
  }

  private fun runOne(app: Context, queue: UploadQueue, job: UploadJob) {
    // The source may have been deleted since it was queued (common with camera backup). Drop it
    // quietly rather than uploading a phantom or leaving a failed row behind.
    if (!sourceReadable(app, job.uri)) {
      queue.remove(job.id)
      emit(UploadEvent.Removed(job.id))
      return
    }

    val upload = ResumableUpload(
      resolver = app.contentResolver,
      baseUrl = job.baseUrl,
      token = job.token,
      uri = Uri.parse(job.uri),
      name = job.name,
      size = job.size,
      lastModified = job.lastModified,
      folder = job.folder,
    )
    active[job.id] = upload
    val callbacks = object : ResumableUpload.Callbacks {
      override fun onProgress(uploaded: Long, total: Long) {
        queue.setProgress(job.id, uploaded, null)
        emit(UploadEvent.Progress(job.id, uploaded, total))
        pushNotification(app, force = false)
      }

      override fun onReconnecting(reconnecting: Boolean) {
        emit(UploadEvent.Reconnecting(job.id, reconnecting))
      }
    }
    try {
      val file = upload.run(callbacks)
      queue.setStatus(job.id, UploadQueue.DONE)
      emit(UploadEvent.Done(job.id, file.toString()))
    } catch (e: ResumableUpload.CancelledException) {
      if (userCancelled.remove(job.id)) {
        upload.discard()
        queue.setStatus(job.id, UploadQueue.CANCELLED)
        emit(UploadEvent.Cancelled(job.id))
      } else {
        // A preemption, not a user cancel: keep the partial upload and let it resume next run.
        queue.setStatus(job.id, UploadQueue.PENDING)
      }
    } catch (e: ResumableUpload.SourceMissingException) {
      // Deleted mid-upload: abandon the server session and drop the job silently.
      upload.discard()
      queue.remove(job.id)
      emit(UploadEvent.Removed(job.id))
    } catch (e: Exception) {
      queue.setStatus(job.id, UploadQueue.ERROR, e.message ?: "Upload failed")
      emit(UploadEvent.Failed(job.id, e.message ?: "Upload failed"))
    } finally {
      active.remove(job.id)
    }
  }

  /** Can we still open the job's source? False once the underlying file has been deleted. */
  private fun sourceReadable(app: Context, uri: String): Boolean =
    runCatching { app.contentResolver.openInputStream(Uri.parse(uri))?.use { true } ?: false }
      .getOrDefault(false)

  private fun emit(event: UploadEvent) {
    listener?.invoke(event)
  }

  /** Refresh the progress notification, throttled unless [force]d (e.g. a file just finished). */
  private fun pushNotification(app: Context, force: Boolean) {
    val now = System.currentTimeMillis()
    if (!force) {
      val prev = lastNotify.get()
      if (now - prev < NOTIFY_THROTTLE_MS || !lastNotify.compareAndSet(prev, now)) return
    } else {
      lastNotify.set(now)
    }
    UploadNotifier.update(app)
  }
}
