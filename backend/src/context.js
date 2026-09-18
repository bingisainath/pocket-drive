import fsp from 'node:fs/promises';
import path from 'node:path';
import { createShareStore } from './access.js';
import { createActivityLog } from './activity.js';
import { createLoginLimiter, createSessionStore, parsePasswordHash } from './auth.js';
import { RESUMABLE_DIR_NAME } from './config.js';
import { createRepo, openDatabase } from './db.js';
import { createDeviceStore } from './devices.js';
import { createFcmSender } from './fcm.js';
import { createNotifier } from './notifications.js';
import { createGoogleAuth } from './google.js';
import { createResumableUploads } from './resumable.js';
import { createScanner } from './scanner.js';
import { createStreamer } from './streams.js';
import { createThumbnailer } from './thumbnails.js';
import { createUserStore } from './users.js';

/** Everything the app needs at runtime: directories, DB, and services. */
export async function createContext(config, { log = console, fetchImpl } = {}) {
  const passwordHash = parsePasswordHash(config.passwordHash);

  for (const dir of [config.dataDir, config.storageDir, config.thumbDir, config.streamDir]) {
    await fsp.mkdir(dir, { recursive: true });
  }
  // Leftovers from interrupted single-request uploads. Chunked uploads are kept so they can resume.
  await fsp.mkdir(config.resumableDir, { recursive: true });
  for (const name of await fsp.readdir(config.tmpDir)) {
    if (name !== RESUMABLE_DIR_NAME) await fsp.rm(path.join(config.tmpDir, name), { recursive: true, force: true });
  }

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
  const devices = createDeviceStore(db);
  const fcm = createFcmSender(config, { fetchImpl, log, devices });
  const notifier = createNotifier({ fcm, shares, log });
  const thumbs = createThumbnailer(config);
  const streams = createStreamer({ ...config, log });
  const resumable = createResumableUploads({ dir: config.resumableDir, chunkBytes: config.uploadChunkBytes });
  await resumable.prune();

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
    devices,
    fcm,
    notifier,
    thumbs,
    streams,
    resumable,
    google: createGoogleAuth(config, { fetchImpl }),
    scanner: createScanner({ config, repo, shares, thumbs, streams, log }),
    limiter: createLoginLimiter({ maxAttempts: config.loginMaxAttempts, windowMs: config.loginWindowMs }),
    close: () => db.close(),
  };
}
