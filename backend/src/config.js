import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = path.join(BACKEND_ROOT, '.env');
export const ENV_EXAMPLE_PATH = path.join(BACKEND_ROOT, '.env.example');

/** Hidden dir inside the storage root for in-flight uploads (same filesystem => atomic rename into place). */
export const TMP_DIR_NAME = '.cloud-drive-tmp';
export const RESUMABLE_DIR_NAME = 'resumable';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function email(env, key) {
  const value = (env[key] || '').trim().toLowerCase();
  if (value && !EMAIL_RE.test(value)) throw new Error(`${key} must be an email address (got "${env[key]}")`);
  return value;
}

/** Comma-separated list of bare origins, e.g. "https://phone.tailnet.ts.net:8443,http://localhost:3000". */
function origins(env, key) {
  return (env[key] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      let url;
      try {
        url = new URL(raw);
      } catch {
        throw new Error(`${key} contains an invalid URL: "${raw}"`);
      }
      if (!/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
        throw new Error(`${key} entries must look like https://host:port (got "${raw}")`);
      }
      return url.origin;
    });
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
    // Unfinished chunked uploads; kept across restarts so they can resume.
    resumableDir: path.join(storageDir, TMP_DIR_NAME, RESUMABLE_DIR_NAME),
    thumbDir: path.join(dataDir, 'thumbs'),
    // External tools, looked up on PATH unless given as absolute paths.
    heifDecoder: env.HEIF_DECODER || 'heif-dec',
    dbPath: path.join(dataDir, 'cloud-drive.db'),
    frontendDist: path.resolve(expandHome(env.FRONTEND_DIST || path.join(BACKEND_ROOT, '..', 'frontend', 'dist'))),
    passwordHash: (env.PASSWORD_HASH || '').trim(),
    maxUploadBytes: Math.floor(number(env, 'MAX_UPLOAD_MB', 4096) * MB),
    // Each chunk is one request, so this must stay under Cloudflare's 100 MB request limit.
    uploadChunkBytes: Math.max(64 * 1024, Math.floor(number(env, 'UPLOAD_CHUNK_MB', 16) * MB)),
    minFreeBytes: Math.floor(number(env, 'MIN_FREE_MB', 500) * MB),
    sessionTtlMs: number(env, 'SESSION_DAYS', 30) * 24 * 60 * 60 * 1000,
    loginMaxAttempts: number(env, 'LOGIN_MAX_ATTEMPTS', 10),
    loginWindowMs: number(env, 'LOGIN_WINDOW_MINUTES', 15) * 60 * 1000,
    trustProxy: trustProxy(env.TRUST_PROXY),
    // Accounts and sharing
    ownerEmail: email(env, 'OWNER_EMAIL'),
    publicOrigins: origins(env, 'PUBLIC_ORIGINS'),
    google: {
      clientId: (env.GOOGLE_CLIENT_ID || '').trim(),
      clientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
      authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    },
    activityRetentionDays: number(env, 'ACTIVITY_RETENTION_DAYS', 180),
  };
}
