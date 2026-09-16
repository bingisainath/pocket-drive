import fsp from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';
import { TMP_DIR_NAME } from './config.js';
import { joinRel } from './paths.js';

/**
 * Reconciles the SQLite index with what's actually on disk (the source of truth), so files added,
 * changed or removed outside the app (e.g. from Termux) show up correctly.
 */
export function createScanner({ config, repo, shares, thumbs, streams, log }) {
  let running = null;

  async function scan() {
    const snapshot = repo.snapshot();
    const seen = new Set();
    const unreadable = []; // dirs we couldn't list; keep their index rows rather than dropping them
    const upserts = [];

    async function walk(rel) {
      const dirAbs = rel ? path.join(config.storageDir, rel) : config.storageDir;
      let names;
      try {
        names = await fsp.readdir(dirAbs);
      } catch (err) {
        log.warn(`scan: cannot read ${dirAbs}: ${err.message}`);
        unreadable.push(`${rel}/`);
        return;
      }
      for (const name of names) {
        if (!rel && name === TMP_DIR_NAME) continue;
        let st;
        try {
          st = await fsp.lstat(path.join(dirAbs, name));
        } catch {
          continue; // vanished mid-scan
        }
        if (!st.isFile() && !st.isDirectory()) continue; // skip symlinks, sockets, etc.
        const childRel = joinRel(rel, name);
        const isDir = st.isDirectory() ? 1 : 0;
        const size = isDir ? 0 : st.size;
        const known = snapshot.get(childRel);
        seen.add(childRel);
        if (!known || known.is_dir !== isDir || known.size !== size) {
          upserts.push({
            parentPath: rel,
            name,
            isDir,
            size,
            mime: isDir ? null : mime.lookup(name) || 'application/octet-stream',
            createdAt: Math.round(st.mtimeMs),
          });
        }
        if (isDir) await walk(childRel);
      }
    }

    await walk('');
    const staleIds = [];
    for (const [rel, row] of snapshot) {
      if (!seen.has(rel) && !unreadable.some((dir) => `/${rel}`.startsWith(dir))) staleIds.push(row.id);
    }
    const { inserted, replacedIds } = repo.applyScan(upserts, staleIds, snapshot);
    if (staleIds.length) shares.pruneOrphans(); // folders deleted outside the app lose their shares
    const gone = [...staleIds, ...replacedIds];
    await Promise.all([thumbs.remove(gone), streams.remove(gone)]);
    return { added: inserted - replacedIds.length, updated: replacedIds.length, removed: staleIds.length };
  }

  return {
    /** Run a scan, or join the one already in progress. */
    run() {
      running ??= scan().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
