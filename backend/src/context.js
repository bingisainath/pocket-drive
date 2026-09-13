import fsp from 'node:fs/promises';
import { createShareStore } from './access.js';
import { createActivityLog } from './activity.js';
import { createLoginLimiter, createSessionStore, parsePasswordHash } from './auth.js';
import { createRepo, openDatabase } from './db.js';
import { createGoogleAuth } from './google.js';
import { createScanner } from './scanner.js';
import { createThumbnailer } from './thumbnails.js';
import { createUserStore } from './users.js';

/** Everything the app needs at runtime: directories, DB, and services. */
export async function createContext(config, { log = console, fetchImpl } = {}) {
  const passwordHash = parsePasswordHash(config.passwordHash);

  for (const dir of [config.dataDir, config.storageDir, config.thumbDir]) {
    await fsp.mkdir(dir, { recursive: true });
  }
  await fsp.rm(config.tmpDir, { recursive: true, force: true }); // leftovers from interrupted uploads
  await fsp.mkdir(config.tmpDir, { recursive: true });

  const db = openDatabase(config.dbPath);
  const repo = createRepo(db);
  const users = createUserStore(db);
  users.ensureOwner(config.ownerEmail);
  const shares = createShareStore(db);
  const activity = createActivityLog(db, { retentionDays: config.activityRetentionDays });
  activity.prune();
  const sessions = createSessionStore(db, config.sessionTtlMs);
  sessions.resetIfPasswordChanged(config.passwordHash);
  sessions.prune();
  const thumbs = createThumbnailer(config);

  return {
    config,
    log,
    passwordHash,
    db,
    repo,
    users,
    shares,
    activity,
    sessions,
    thumbs,
    google: createGoogleAuth(config, { fetchImpl }),
    scanner: createScanner({ config, repo, shares, thumbs, log }),
    limiter: createLoginLimiter({ maxAttempts: config.loginMaxAttempts, windowMs: config.loginWindowMs }),
    close: () => db.close(),
  };
}
