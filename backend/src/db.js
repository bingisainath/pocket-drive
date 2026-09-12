import Database from 'better-sqlite3';
import { joinRel } from './paths.js';

const SCHEMA = `
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

// Full relative path of the row aliased `e`.
const FULL_PATH = `CASE WHEN e.parent_path = '' THEN e.name ELSE e.parent_path || '/' || e.name END`;

export function openDatabase(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
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
  };
}

export function createRepo(db) {
  const q = {
    get: db.prepare('SELECT * FROM entries WHERE id = ?'),
    getByPath: db.prepare('SELECT * FROM entries WHERE parent_path = ? AND name = ?'),
    list: db.prepare(`
      SELECT e.*,
        CASE WHEN e.is_dir = 1 THEN (SELECT COUNT(*) FROM entries c WHERE c.parent_path = ${FULL_PATH}) END AS child_count
      FROM entries e
      WHERE e.parent_path = ?
      ORDER BY e.is_dir DESC, e.created_at DESC, e.id DESC`),
    search: db.prepare(`
      SELECT * FROM entries WHERE name LIKE ? ESCAPE '\\'
      ORDER BY is_dir DESC, created_at DESC, id DESC LIMIT ?`),
    insert: db.prepare(`
      INSERT INTO entries (parent_path, name, is_dir, size, mime, created_at)
      VALUES (@parentPath, @name, @isDir, @size, @mime, @createdAt) RETURNING *`),
    deleteByPath: db.prepare('DELETE FROM entries WHERE parent_path = ? AND name = ? RETURNING id'),
    deleteById: db.prepare('DELETE FROM entries WHERE id = ?'),
    deleteTree: db.prepare(`
      DELETE FROM entries
      WHERE id = @id OR parent_path = @full OR substr(parent_path, 1, length(@prefix)) = @prefix
      RETURNING id`),
    all: db.prepare('SELECT id, parent_path, name, is_dir, size FROM entries'),
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
  });

  return {
    get: (id) => q.get.get(id),
    getByPath: (parentPath, name) => q.getByPath.get(parentPath, name),
    list: (parentPath) => q.list.all(parentPath),
    search: (text, limit) => q.search.all(`%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, limit),
    stats: () => q.stats.get(),
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
