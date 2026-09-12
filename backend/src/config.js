import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = path.join(BACKEND_ROOT, '.env');
export const ENV_EXAMPLE_PATH = path.join(BACKEND_ROOT, '.env.example');

/** Hidden dir inside the storage root for in-flight uploads (same filesystem => atomic rename into place). */
export const TMP_DIR_NAME = '.cloud-drive-tmp';

const MB = 1024 * 1024;

export function loadEnvFile(file = ENV_PATH) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function expandHome(p) {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

function number(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number (got "${raw}")`);
  return n;
}

function trustProxy(raw) {
  if (!raw) return 'loopback'; // tailscale serve/funnel proxies from localhost
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export function buildConfig(env = process.env) {
  const dataDir = path.resolve(expandHome(env.DATA_DIR || '~/cloud-storage'));
  const storageDir = path.resolve(expandHome(env.STORAGE_DIR || path.join(dataDir, 'files')));
  return {
    port: number(env, 'PORT', 3000),
    host: env.HOST || '127.0.0.1',
    dataDir,
    storageDir,
    tmpDir: path.join(storageDir, TMP_DIR_NAME),
    thumbDir: path.join(dataDir, 'thumbs'),
    dbPath: path.join(dataDir, 'cloud-drive.db'),
    frontendDist: path.resolve(expandHome(env.FRONTEND_DIST || path.join(BACKEND_ROOT, '..', 'frontend', 'dist'))),
    passwordHash: (env.PASSWORD_HASH || '').trim(),
    maxUploadBytes: Math.floor(number(env, 'MAX_UPLOAD_MB', 4096) * MB),
    minFreeBytes: Math.floor(number(env, 'MIN_FREE_MB', 500) * MB),
    sessionTtlMs: number(env, 'SESSION_DAYS', 30) * 24 * 60 * 60 * 1000,
    loginMaxAttempts: number(env, 'LOGIN_MAX_ATTEMPTS', 10),
    loginWindowMs: number(env, 'LOGIN_WINDOW_MINUTES', 15) * 60 * 1000,
    trustProxy: trustProxy(env.TRUST_PROXY),
  };
}
