import { Router } from 'express';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readBearer,
  readCookie,
  readSessionToken,
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

/** Throttle + verify the owner's password, note the login, and return the owner row (shared by the web cookie and app token flows). */
async function signInOwnerByPassword(ctx, req, res) {
  const { limiter, passwordHash, users } = ctx;
  const wait = limiter.retryAfter(req.ip);
  if (wait) {
    res.set('Retry-After', String(wait));
    throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`);
  }
  const password = req.body?.password;
  const ok =
    typeof password === 'string' && password.length > 0 && password.length <= 1024 && (await verifyPassword(password, passwordHash));
  if (!ok) {
    limiter.fail(req.ip);
    throw new HttpError(401, 'Wrong password');
  }
  limiter.reset(req.ip);
  const owner = users.owner();
  users.touchLogin(owner.id);
  return owner;
}

/** Apply the same invite rules as the web callback to a verified Google identity; returns the user or throws. */
function signInByGoogleIdentity(ctx, req, identity) {
  const { config, users, activity } = ctx;
  const user = identity.email === config.ownerEmail ? users.owner() : users.byEmail(identity.email);
  if (!user) {
    activity.log({ user: null, ip: req.ip }, 'login_denied', { email: identity.email, detail: { reason: 'not invited' } });
    throw new HttpError(403, 'This Google account has not been invited to the drive');
  }
  // An email stays tied to the first Google account that used it.
  if (user.google_sub && user.google_sub !== identity.sub) {
    activity.log({ user, ip: req.ip }, 'login_denied', { detail: { reason: 'different Google account' } });
    throw new HttpError(403, 'This email is linked to a different Google account');
  }
  try {
    users.recordLogin(user.id, identity);
  } catch {
    throw new HttpError(403, 'This email is linked to a different Google account');
  }
  return user;
}

export function authRoutes(ctx) {
  const { config, sessions, users, google, activity, log } = ctx;
  const router = Router();
  const oauthCookieOptions = (req) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: OAUTH_COOKIE_PATH });

  router.get('/me', (req, res) => {
    const token = readSessionToken(req);
    const session = token && sessions.validate(token);
    if (session?.renewed && !readBearer(req)) setSessionCookie(req, res, token, config.sessionTtlMs);
    res.json({
      authenticated: Boolean(session),
      user: session ? publicUser(session.user) : null,
      google: { enabled: google.enabled, origins: google.origins },
    });
  });

  // The owner's password: a backup for when Google sign-in isn't available. Sets a web session cookie.
  router.post('/login', async (req, res) => {
    const owner = await signInOwnerByPassword(ctx, req, res);
    setSessionCookie(req, res, sessions.create(owner.id), config.sessionTtlMs);
    activity.log({ user: owner, ip: req.ip }, 'login', { detail: { method: 'password' } });
    res.status(204).end();
  });

  // The mobile app signs in for a Bearer token instead of a cookie (background native uploads can't
  // use the JS cookie jar). Same session store, expiry and revocation as the cookie.
  router.post('/token/password', async (req, res) => {
    const owner = await signInOwnerByPassword(ctx, req, res);
    const token = sessions.create(owner.id);
    activity.log({ user: owner, ip: req.ip }, 'login', { detail: { method: 'password', client: 'app' } });
    res.json({ token, user: publicUser(owner) });
  });

  // Native Google sign-in: the app sends the Google ID token, we verify it (signature + claims) and issue a token.
  router.post('/token/google', async (req, res) => {
    const idToken = req.body?.idToken;
    if (typeof idToken !== 'string' || !idToken) throw new HttpError(400, 'Missing idToken');
    let identity;
    try {
      identity = await google.verifyIdToken(idToken);
    } catch (err) {
      if (err instanceof HttpError) throw err; // "Google sign-in is not set up"
      log.warn(`App Google sign-in failed: ${err.message}`);
      throw new HttpError(401, err.reason === 'unverified' ? 'Your Google email is not verified' : 'Google sign-in failed');
    }
    const user = signInByGoogleIdentity(ctx, req, identity);
    const token = sessions.create(user.id);
    activity.log({ user, ip: req.ip }, 'login', { detail: { method: 'google', client: 'app' } });
    res.json({ token, user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    sessions.destroy(readSessionToken(req)); // revokes the cookie session or the app's Bearer token
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  // Account deletion (a Google Play requirement). A member removes their own account; the owner
  // account can't be deleted this way (it belongs to whoever runs the server).
  router.delete('/account', (req, res) => {
    const token = readSessionToken(req);
    const session = token && sessions.validate(token);
    if (!session) throw new HttpError(401, 'Not signed in');
    if (session.user.is_owner === 1) throw new HttpError(403, 'The owner account can’t be deleted here');
    const { id, email } = session.user;
    users.remove(id); // FK cascades their shares, sessions and devices; their files' owner_id -> NULL (stay with the owner)
    clearSessionCookie(req, res);
    activity.log({ user: null, ip: req.ip }, 'delete_account', { email });
    res.json({
      deleted: true,
      message: 'Your account, folder access, sign-ins and notification devices have been removed. Files you uploaded remain on the owner’s drive.',
    });
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
