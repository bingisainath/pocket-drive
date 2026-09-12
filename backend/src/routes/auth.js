import { Router } from 'express';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readCookie,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { HttpError } from '../http-error.js';

export function authRoutes(ctx) {
  const { config, sessions, limiter, passwordHash } = ctx;
  const router = Router();

  router.post('/login', async (req, res) => {
    const wait = limiter.retryAfter(req.ip);
    if (wait) {
      res.set('Retry-After', String(wait));
      throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`);
    }
    const password = req.body?.password;
    const ok =
      typeof password === 'string' &&
      password.length > 0 &&
      password.length <= 1024 &&
      (await verifyPassword(password, passwordHash));
    if (!ok) {
      limiter.fail(req.ip);
      throw new HttpError(401, 'Wrong password');
    }
    limiter.reset(req.ip);
    setSessionCookie(req, res, sessions.create(), config.sessionTtlMs);
    res.status(204).end();
  });

  router.post('/logout', (req, res) => {
    sessions.destroy(readCookie(req, SESSION_COOKIE));
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token && sessions.validate(token);
    if (session?.renewed) setSessionCookie(req, res, token, config.sessionTtlMs);
    res.json({ authenticated: Boolean(session) });
  });

  return router;
}
