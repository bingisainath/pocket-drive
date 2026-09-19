package com.bingisainath.pocketdrive.uploader

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** One queued upload. Mirrors JS UploadTask; persisted so uploads survive app death and reboot. */
data class UploadJob(
  val id: String,
  val uri: String,
  val name: String,
  val size: Long,
  val lastModified: Long,
  val folder: String,
  val baseUrl: String,
  val token: String,
  val status: String,
  val uploaded: Long,
  val sessionId: String?,
  val error: String?,
  val createdAt: Long,
)

/**
 * The durable upload queue, backed by app-private SQLite (no Room — same dependency-light spirit as
 * [ResumableUpload]). It is the single source of truth: JS, the foreground UI, the JobScheduler job
 * and the WorkManager worker all read and write here, so an upload continues correctly no matter
 * which component is alive. A single shared instance keeps one connection pool.
 */
class UploadQueue private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE $TABLE (
        id TEXT PRIMARY KEY,
        uri TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        lastModified INTEGER NOT NULL,
        folder TEXT NOT NULL,
        baseUrl TEXT NOT NULL,
        token TEXT NOT NULL,
        status TEXT NOT NULL,
        uploaded INTEGER NOT NULL DEFAULT 0,
        sessionId TEXT,
        error TEXT,
        createdAt INTEGER NOT NULL
      )
      """.trimIndent(),
    )
    db.execSQL("CREATE INDEX idx_${TABLE}_status ON $TABLE(status, createdAt)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // The queue is transient work, not user data: on a schema change, drop and recreate.
    db.execSQL("DROP TABLE IF EXISTS $TABLE")
    onCreate(db)
  }

  fun insert(job: UploadJob) {
    writableDatabase.insertWithOnConflict(TABLE, null, job.toValues(), SQLiteDatabase.CONFLICT_REPLACE)
  }

  /** Every job, oldest first — what JS hydrates its panel from. */
  fun all(): List<UploadJob> = query("1=1 ORDER BY createdAt ASC")

  fun get(id: String): UploadJob? = query("id = ? LIMIT 1", id).firstOrNull()

  /** True while any job still needs work — used to decide whether to (re)schedule. */
  fun hasUnfinished(): Boolean =
    readableDatabase.rawQuery(
      "SELECT 1 FROM $TABLE WHERE status IN ('$PENDING','$RUNNING') LIMIT 1",
      null,
    ).use { it.moveToFirst() }

  /**
   * Atomically move the oldest PENDING job to RUNNING and return it, so multiple drainer threads
   * never pick the same file. Returns null when nothing is left to start.
   */
  @Synchronized
  fun claimNext(): UploadJob? {
    val db = writableDatabase
    db.beginTransaction()
    try {
      val next = query(db, "status = '$PENDING' ORDER BY createdAt ASC LIMIT 1").firstOrNull()
        ?: return null
      db.update(TABLE, ContentValues().apply { put("status", RUNNING) }, "id = ?", arrayOf(next.id))
      db.setTransactionSuccessful()
      return next.copy(status = RUNNING)
    } finally {
      db.endTransaction()
    }
  }

  fun setStatus(id: String, status: String, error: String? = null) {
    writableDatabase.update(
      TABLE,
      ContentValues().apply {
        put("status", status)
        put("error", error)
      },
      "id = ?",
      arrayOf(id),
    )
  }

  fun setProgress(id: String, uploaded: Long, sessionId: String?) {
    writableDatabase.update(
      TABLE,
      ContentValues().apply {
        put("uploaded", uploaded)
        if (sessionId != null) put("sessionId", sessionId)
      },
      "id = ?",
      arrayOf(id),
    )
  }

  /** Requeue a job (retry): back to PENDING, progress reset, error cleared. */
  fun requeue(id: String) {
    writableDatabase.update(
      TABLE,
      ContentValues().apply {
        put("status", PENDING)
        put("uploaded", 0)
        putNull("error")
        putNull("sessionId")
      },
      "id = ?",
      arrayOf(id),
    )
  }

  /**
   * Any job left RUNNING belongs to a process that died mid-upload; move it back to PENDING so it
   * resumes. Call before (re)scheduling and on boot.
   */
  fun resetRunning() {
    writableDatabase.update(
      TABLE,
      ContentValues().apply { put("status", PENDING) },
      "status = ?",
      arrayOf(RUNNING),
    )
  }

  /** Freshen the auth on every unfinished job (tokens expire; JS pushes the current one on enqueue). */
  fun refreshAuth(baseUrl: String, token: String) {
    writableDatabase.update(
      TABLE,
      ContentValues().apply {
        put("baseUrl", baseUrl)
        put("token", token)
      },
      "status IN (?, ?)",
      arrayOf(PENDING, RUNNING),
    )
  }

  fun remove(id: String) {
    writableDatabase.delete(TABLE, "id = ?", arrayOf(id))
  }

  /** Drop everything that isn't actively in flight — done, cancelled and failed. */
  fun clearFinished() {
    writableDatabase.delete(TABLE, "status IN (?, ?, ?)", arrayOf(DONE, CANCELLED, ERROR))
  }

  private fun query(where: String, vararg args: String): List<UploadJob> =
    query(readableDatabase, where, *args)

  private fun query(db: SQLiteDatabase, where: String, vararg args: String): List<UploadJob> {
    val out = ArrayList<UploadJob>()
    db.rawQuery("SELECT * FROM $TABLE WHERE $where", args).use { c ->
      val idI = c.getColumnIndexOrThrow("id")
      val uriI = c.getColumnIndexOrThrow("uri")
      val nameI = c.getColumnIndexOrThrow("name")
      val sizeI = c.getColumnIndexOrThrow("size")
      val lastI = c.getColumnIndexOrThrow("lastModified")
      val folderI = c.getColumnIndexOrThrow("folder")
      val baseI = c.getColumnIndexOrThrow("baseUrl")
      val tokenI = c.getColumnIndexOrThrow("token")
      val statusI = c.getColumnIndexOrThrow("status")
      val uploadedI = c.getColumnIndexOrThrow("uploaded")
      val sessionI = c.getColumnIndexOrThrow("sessionId")
      val errorI = c.getColumnIndexOrThrow("error")
      val createdI = c.getColumnIndexOrThrow("createdAt")
      while (c.moveToNext()) {
        out.add(
          UploadJob(
            id = c.getString(idI),
            uri = c.getString(uriI),
            name = c.getString(nameI),
            size = c.getLong(sizeI),
            lastModified = c.getLong(lastI),
            folder = c.getString(folderI),
            baseUrl = c.getString(baseI),
            token = c.getString(tokenI),
            status = c.getString(statusI),
            uploaded = c.getLong(uploadedI),
            sessionId = if (c.isNull(sessionI)) null else c.getString(sessionI),
            error = if (c.isNull(errorI)) null else c.getString(errorI),
            createdAt = c.getLong(createdI),
          ),
        )
      }
    }
    return out
  }

  private fun UploadJob.toValues() = ContentValues().apply {
    put("id", id)
    put("uri", uri)
    put("name", name)
    put("size", size)
    put("lastModified", lastModified)
    put("folder", folder)
    put("baseUrl", baseUrl)
    put("token", token)
    put("status", status)
    put("uploaded", uploaded)
    put("sessionId", sessionId)
    put("error", error)
    put("createdAt", createdAt)
  }

  companion object {
    const val PENDING = "pending"
    const val RUNNING = "running"
    const val DONE = "done"
    const val ERROR = "error"
    const val CANCELLED = "cancelled"

    private const val DB_NAME = "pocketdrive-uploads.db"
    private const val DB_VERSION = 1
    private const val TABLE = "uploads"

    @Volatile private var instance: UploadQueue? = null

    fun get(context: Context): UploadQueue =
      instance ?: synchronized(this) {
        instance ?: UploadQueue(context).also { instance = it }
      }
  }
}
