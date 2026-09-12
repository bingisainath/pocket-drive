import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http-error.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'cd_session';
const KEY_LEN = 32;
const DEFAULT_COST = { N: 32768, r: 8, p: 1 }; // ~32 MB, ~100 ms per attempt on a phone
const maxmem = (N, r) => 256 * N * r; // scrypt needs 128*N*r bytes; leave headroom

// --- Password hashing (format: scrypt:N:r:p:salt:key, base64url) ---

export function hashPassword(password, cost = DEFAULT_COST) {
  const { N, r, p } = cost;
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize('NFC'), salt, KEY_LEN, { N, r, p, maxmem: maxmem(N, r) });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

export function parsePasswordHash(str) {
  const [algo, N, r, p, salt, key] = String(str).split(':');
  const parsed = {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt ?? '', 'base64url'),
    key: Buffer.from(key ?? '', 'base64url'),
  };
  const valid =
    algo === 'scrypt' &&
    [parsed.N, parsed.r, parsed.p].every((n) => Number.isInteger(n) && n > 0) &&
    parsed.salt.length >= 8 &&
    parsed.key.length >= 16;
  if (!valid) throw new Error('PASSWORD_HASH is malformed. Regenerate it with `npm run hash-password`.');
  return parsed;
}

export async function verifyPassword(password, parsed) {
  const { N, r, p, salt, key } = parsed;
  const candidate = await scrypt(password.normalize('NFC'), salt, key.length, { N, r, p, maxmem: maxmem(N, r) });
  return crypto.timingSafeEqual(candidate, key);
}

// --- Login throttling (in memory, per client IP) ---

export function createLoginLimiter({ maxAttempts, windowMs }) {
  const failures = new Map(); // ip -> { count, resetAt }
  return {
    /** Seconds until this IP may try again, or 0 if allowed now. */
    retryAfter(ip) {
      const f = failures.get(ip);
      if (!maxAttempts || !f) return 0;
      const now = Date.now();
      if (f.resetAt <= now) {
        failures.delete(ip);
        return 0;
      }
      return f.count >= maxAttempts ? Math.ceil((f.resetAt - now) / 1000) : 0;
    },
    fail(ip) {
      const now = Date.now();
      const f = failures.get(ip);
      if (f && f.resetAt > now) f.count++;
      else failures.set(ip, { count: 1, resetAt: now + windowMs });
      if (failures.size > 10_000) {
        for (const [key, v] of failures) if (v.resetAt <= now) failures.delete(key);
      }
    },
    reset(ip) {
      failures.delete(ip);
    },
  };
}

// --- Sessions (random token in cookie, SHA-256 of it in SQLite) ---

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSessionStore(db, ttlMs) {
  const q = {
    insert: db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)'),
    get: db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?'),
    extend: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    delete: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteAll: db.prepare('DELETE FROM sessions'),
    prune: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  return {
    create() {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      q.insert.run(sha256(token), now, now + ttlMs);
      return token;
    },
    /** Returns null if invalid, otherwise { renewed } — sessions slide forward once half their TTL is used. */
    validate(token) {
      if (typeof token !== 'string' || token.length > 128) return null;
      const hash = sha256(token);
      const row = q.get.get(hash);
      const now = Date.now();
      if (!row || row.expires_at <= now) return null;
      if (row.expires_at - now < ttlMs / 2) {
        q.extend.run(now + ttlMs, hash);
        return { renewed: true };
      }
      return { renewed: false };
    },
    destroy(token) {
      if (typeof token === 'string') q.delete.run(sha256(token));
    },
    prune() {
      q.prune.run(Date.now());
    },
    /** Sign everyone out if PASSWORD_HASH changed since the last start. */
    resetIfPasswordChanged(passwordHash) {
      const fingerprint = sha256(passwordHash);
      const previous = q.getMeta.get('password_fingerprint')?.value;
      if (previous !== fingerprint) {
        q.deleteAll.run();
        q.setMeta.run('password_fingerprint', fingerprint);
      }
    },
  };
}

// --- Cookie + middleware ---

export function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const cookieOptions = (req) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });

export function setSessionCookie(req, res, token, ttlMs) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: ttlMs });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

export function requireAuth(ctx) {
  return (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token && ctx.sessions.validate(token);
    if (!session) return next(new HttpError(401, 'Not signed in'));
    if (session.renewed) setSessionCookie(req, res, token, ctx.config.sessionTtlMs);
    next();
  };
}
