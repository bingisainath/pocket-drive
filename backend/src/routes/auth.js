import { Router } from 'express';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readCookie,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { HttpError } from '../http-error.js';

const OAUTH_COOKIE = 'cd_oauth';
const OAUTH_COOKIE_PATH = '/api/auth/google';
const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000;

/** Only same-site relative paths, so the sign-in flow can't be turned into an open redirect. */
const safeReturnTo = (raw) => (typeof raw === 'string' && /^\/(?![/\\])/.test(raw) && raw.length <= 2000 ? raw : '/');

export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name ?? null,
  picture: u.picture ?? null,
  isOwner: u.is_owner === 1,
});

export function authRoutes(ctx) {
  const { config, sessions, limiter, passwordHash, users, google, activity, log } = ctx;
  const router = Router();
  const oauthCookieOptions = (req) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: OAUTH_COOKIE_PATH });

  router.get('/me', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token && sessions.validate(token);
    if (session?.renewed) setSessionCookie(req, res, token, config.sessionTtlMs);
    res.json({
      authenticated: Boolean(session),
      user: session ? publicUser(session.user) : null,
      google: { enabled: google.enabled, origins: google.origins },
    });
  });

  // The owner's password: a backup for when Google sign-in isn't available.
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
    const owner = users.owner();
    users.touchLogin(owner.id);
    setSessionCookie(req, res, sessions.create(owner.id), config.sessionTtlMs);
    activity.log({ user: owner, ip: req.ip }, 'login', { detail: { method: 'password' } });
    res.status(204).end();
  });

  router.post('/logout', (req, res) => {
    sessions.destroy(readCookie(req, SESSION_COOKIE));
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  // Step 1: send the browser to Google. The state is also stored in a cookie so step 2 can check
  // that it's the same browser (prevents "login CSRF": signing someone into an attacker's account).
  router.get('/google/start', (req, res) => {
    const { state, url } = google.begin({
      origin: String(req.query.origin ?? ''),
      returnTo: safeReturnTo(req.query.returnTo),
    });
    res.cookie(OAUTH_COOKIE, state, { ...oauthCookieOptions(req), maxAge: OAUTH_COOKIE_TTL_MS });
    res.redirect(302, url);
  });

  // Step 2: Google sends the browser back here with a one-time code.
  router.get('/google/callback', async (req, res) => {
    const fail = (reason) => res.redirect(302, `/?login_error=${reason}`);
    const expected = readCookie(req, OAUTH_COOKIE);
    res.clearCookie(OAUTH_COOKIE, oauthCookieOptions(req));

    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const pending = state && state === expected ? google.take(state) : null;
    if (!pending) return fail('expired');
    if (req.query.error) return fail('cancelled');
    if (typeof req.query.code !== 'string' || !req.query.code) return fail('failed');

    let identity;
    try {
      identity = await google.identify(pending, req.query.code);
    } catch (err) {
      log.warn(`Google sign-in failed: ${err.message}`);
      return fail(err.reason ?? 'failed');
    }

    // Only the owner and people the owner has shared something with may sign in.
    const user = identity.email === config.ownerEmail ? users.owner() : users.byEmail(identity.email);
    if (!user) {
      activity.log({ user: null, ip: req.ip }, 'login_denied', { email: identity.email, detail: { reason: 'not invited' } });
      return fail('not_invited');
    }
    // An email stays tied to the first Google account that used it.
    if (user.google_sub && user.google_sub !== identity.sub) {
      activity.log({ user, ip: req.ip }, 'login_denied', { detail: { reason: 'different Google account' } });
      return fail('account_mismatch');
    }
    try {
      users.recordLogin(user.id, identity);
    } catch (err) {
      log.warn(`Google sign-in for ${identity.email} refused: ${err.message}`);
      return fail('account_mismatch'); // this Google account is already tied to another email
    }
    setSessionCookie(req, res, sessions.create(user.id), config.sessionTtlMs);
    activity.log({ user, ip: req.ip }, 'login', { detail: { method: 'google' } });
    res.redirect(302, pending.returnTo);
  });

  return router;
}
