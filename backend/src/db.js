import Database from 'better-sqlite3';
import { joinRel } from './paths.js';

// Version 0: the original single-user schema.
const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT, -- never reused, so id-keyed thumbnails can't go stale
  parent_path TEXT    NOT NULL,                  -- '' for the root, otherwise e.g. 'Photos/2024'
  name        TEXT    NOT NULL,
  is_dir      INTEGER NOT NULL DEFAULT 0,
  size        INTEGER NOT NULL DEFAULT 0,
  mime        TEXT,
  created_at  INTEGER NOT NULL,                  -- upload time in ms (file mtime for files found by a scan)
  UNIQUE (parent_path, name)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Numbered upgrades, applied in order; PRAGMA user_version records how many have run.
const MIGRATIONS = [
  // 1: accounts, folder sharing and the activity log.
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT,
    picture       TEXT,
    is_owner      INTEGER NOT NULL DEFAULT 0,
    google_sub    TEXT    UNIQUE,                -- Google account id, pinned at first sign-in
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE TABLE shares (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_path TEXT    NOT NULL,                -- access covers this folder and everything beneath it
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        TEXT    NOT NULL CHECK (role IN ('viewer', 'contributor', 'editor')),
    created_at  INTEGER NOT NULL,
    UNIQUE (folder_path, user_id)
  );
  CREATE INDEX shares_by_user ON shares (user_id);
  CREATE TABLE activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
    user_email TEXT,                             -- kept even after the user is removed
    action     TEXT    NOT NULL,
    path       TEXT,
    detail     TEXT,                             -- JSON
    ip         TEXT
  );
  CREATE INDEX activity_by_time ON activity (at);
  -- Who added each entry. NULL means the owner: files from before accounts existed, or found on disk.
  ALTER TABLE entries ADD COLUMN owner_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
  -- Sessions now belong to a user. Old (owner-only) sessions are dropped, so the owner signs in once more.
  DROP TABLE sessions;
  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_by_user ON sessions (user_id);
  `,
  // 2: push notification device tokens (Firebase Cloud Messaging), one row per device.
  `
  CREATE TABLE devices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token      TEXT    NOT NULL UNIQUE,          -- the FCM registration token
    platform   TEXT    NOT NULL,                 -- 'android' | 'ios'
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX devices_by_user ON devices (user_id);
  `,
];

// Full relative path of the row aliased `e`.
const FULL_PATH = `CASE WHEN e.parent_path = '' THEN e.name ELSE e.parent_path || '/' || e.name END`;
const ENTRY_COLUMNS = `e.*, u.email AS uploaded_by`;
const FROM_ENTRIES = `FROM entries e LEFT JOIN users u ON u.id = e.owner_id`;
const CHILD_COUNT = `CASE WHEN e.is_dir = 1 THEN (SELECT COUNT(*) FROM entries c WHERE c.parent_path = ${FULL_PATH}) END AS child_count`;
const NEWEST_FIRST = `ORDER BY e.is_dir DESC, e.created_at DESC, e.id DESC`;

export function openDatabase(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(BASE_SCHEMA);
  migrate(db);
  return db;
}

function migrate(db) {
  const from = db.pragma('user_version', { simple: true });
  for (let version = from; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

export function toDto(row) {
  return {
    id: row.id,
    name: row.name,
    parentPath: row.parent_path,
    path: joinRel(row.parent_path, row.name),
    isDir: row.is_dir === 1,
    size: row.size,
    mime: row.mime,
    createdAt: row.created_at,
    childCount: row.child_count ?? null,
    uploadedBy: row.uploaded_by ?? null,
  };
}

const likePattern = (text) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createRepo(db) {
  const q = {
    get: db.prepare('SELECT * FROM entries WHERE id = ?'),
    getByPath: db.prepare('SELECT * FROM entries WHERE parent_path = ? AND name = ?'),
    getDir: db.prepare(`SELECT ${ENTRY_COLUMNS}, ${CHILD_COUNT} ${FROM_ENTRIES} WHERE e.parent_path = ? AND e.name = ? AND e.is_dir = 1`),
    list: db.prepare(`SELECT ${ENTRY_COLUMNS}, ${CHILD_COUNT} ${FROM_ENTRIES} WHERE e.parent_path = ? ${NEWEST_FIRST}`),
    search: db.prepare(`SELECT ${ENTRY_COLUMNS} ${FROM_ENTRIES} WHERE e.name LIKE ? ESCAPE '\\' ${NEWEST_FIRST} LIMIT ?`),
    insert: db.prepare(`
      INSERT INTO entries (parent_path, name, is_dir, size, mime, created_at, owner_id)
      VALUES (@parentPath, @name, @isDir, @size, @mime, @createdAt, @ownerId) RETURNING *`),
    deleteByPath: db.prepare('DELETE FROM entries WHERE parent_path = ? AND name = ? RETURNING id'),
    deleteById: db.prepare('DELETE FROM entries WHERE id = ?'),
    deleteTree: db.prepare(`
      DELETE FROM entries
      WHERE id = @id OR parent_path = @full OR substr(parent_path, 1, length(@prefix)) = @prefix
      RETURNING id`),
    // Entries beneath a folder that someone other than `uid` added (NULL owner = the drive owner).
    foreignInTree: db.prepare(`
      SELECT COUNT(*) AS n FROM entries
      WHERE (parent_path = @full OR substr(parent_path, 1, length(@prefix)) = @prefix)
        AND (owner_id IS NULL OR owner_id != @uid)`),
    all: db.prepare('SELECT id, parent_path, name, is_dir, size FROM entries'),
    images: db.prepare(`SELECT id, parent_path, name, mime, size FROM entries WHERE is_dir = 0 AND mime LIKE 'image/%' ORDER BY created_at DESC`),
    videos: db.prepare(`SELECT id, parent_path, name, mime, size FROM entries WHERE is_dir = 0 AND mime LIKE 'video/%' ORDER BY created_at DESC`),
    stats: db.prepare(`
      SELECT COALESCE(SUM(size), 0) AS bytes,
             COALESCE(SUM(is_dir = 0), 0) AS files,
             COALESCE(SUM(is_dir = 1), 0) AS folders
      FROM entries`),
  };

  const entryParams = (e) => ({
    parentPath: e.parentPath,
    name: e.name,
    isDir: e.isDir ? 1 : 0,
    size: e.size,
    mime: e.mime ?? null,
    createdAt: e.createdAt,
    ownerId: e.ownerId ?? null,
  });

  return {
    get: (id) => q.get.get(id),
    getByPath: (parentPath, name) => q.getByPath.get(parentPath, name),
    /** A folder row with its child count (for "Shared with me"). */
    getDir: (parentPath, name) => q.getDir.get(parentPath, name),
    list: (parentPath) => q.list.all(parentPath),
    search: (text, limit) => q.search.all(likePattern(text), limit),

    /** Search limited to the given folders (and everything beneath them). */
    searchWithin(text, roots, limit) {
      if (!roots.length) return [];
      const within = roots
        .map(() => `(e.parent_path = ? OR substr(e.parent_path, 1, length(?)) = ? OR ${FULL_PATH} = ?)`)
        .join(' OR ');
      const params = roots.flatMap((root) => [root, `${root}/`, `${root}/`, root]);
      return db
        .prepare(`SELECT ${ENTRY_COLUMNS} ${FROM_ENTRIES} WHERE e.name LIKE ? ESCAPE '\\' AND (${within}) ${NEWEST_FIRST} LIMIT ?`)
        .all(likePattern(text), ...params, limit);
    },

    /** How many entries inside a folder were added by someone other than `userId`. */
    foreignCountInTree(row, userId) {
      const full = joinRel(row.parent_path, row.name);
      return q.foreignInTree.get({ full, prefix: `${full}/`, uid: userId }).n;
    },

    stats: () => q.stats.get(),
    /** Every image, newest first (for filling in missing thumbnails and previews). */
    images: () => q.images.all(),
    /** Every video, newest first (for making missing streaming versions). */
    videos: () => q.videos.all(),
    /** Map of relative path -> row, used by the disk scanner. */
    snapshot: () => new Map(q.all.all().map((r) => [joinRel(r.parent_path, r.name), r])),

    /** Insert an entry, replacing (with a fresh id) any stale row at the same path. */
    replace: db.transaction((entry) => {
      const replacedIds = q.deleteByPath.all(entry.parentPath, entry.name).map((r) => r.id);
      return { row: q.insert.get(entryParams(entry)), replacedIds };
    }),

    /** Delete a row and, for folders, everything beneath it. Returns the deleted ids. */
    deleteTree(row) {
      const full = joinRel(row.parent_path, row.name);
      return q.deleteTree.all({ id: row.id, full, prefix: `${full}/` }).map((r) => r.id);
    },

    /**
     * Apply a disk scan. Rows changed by requests since `snapshot` was taken (e.g. an upload that
     * finished mid-scan) are left alone.
     */
    applyScan: db.transaction((upserts, staleIds, snapshot) => {
      const replacedIds = [];
      let inserted = 0;
      for (const entry of upserts) {
        const current = q.getByPath.get(entry.parentPath, entry.name);
        const seen = snapshot.get(joinRel(entry.parentPath, entry.name));
        if (current && current.id !== seen?.id) continue;
        if (current) {
          q.deleteById.run(current.id);
          replacedIds.push(current.id);
        }
        q.insert.run(entryParams(entry));
        inserted++;
      }
      for (const id of staleIds) q.deleteById.run(id);
      return { inserted, replacedIds };
    }),
  };
}
