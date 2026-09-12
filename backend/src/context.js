import fsp from 'node:fs/promises';
import { createLoginLimiter, createSessionStore, parsePasswordHash } from './auth.js';
import { createRepo, openDatabase } from './db.js';
import { createScanner } from './scanner.js';
import { createThumbnailer } from './thumbnails.js';

/** Everything the app needs at runtime: directories, DB, and services. */
export async function createContext(config, { log = console } = {}) {
  const passwordHash = parsePasswordHash(config.passwordHash);

  for (const dir of [config.dataDir, config.storageDir, config.thumbDir]) {
    await fsp.mkdir(dir, { recursive: true });
  }
  await fsp.rm(config.tmpDir, { recursive: true, force: true }); // leftovers from interrupted uploads
  await fsp.mkdir(config.tmpDir, { recursive: true });

  const db = openDatabase(config.dbPath);
  const repo = createRepo(db);
  const sessions = createSessionStore(db, config.sessionTtlMs);
  sessions.resetIfPasswordChanged(config.passwordHash);
  sessions.prune();
  const thumbs = createThumbnailer(config);

  return {
    config,
    passwordHash,
    db,
    repo,
    sessions,
    thumbs,
    scanner: createScanner({ config, repo, thumbs, log }),
    limiter: createLoginLimiter({ maxAttempts: config.loginMaxAttempts, windowMs: config.loginWindowMs }),
    close: () => db.close(),
  };
}
