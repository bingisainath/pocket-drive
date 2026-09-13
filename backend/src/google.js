// "Sign in with Google": the OpenID Connect authorization-code flow, with PKCE, a state value tied
// to the browser that started the sign-in, and a nonce tied to the ID token.
import crypto from 'node:crypto';
import { HttpError } from './http-error.js';

const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 1000;
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const GOOGLE_PICTURE = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//;
const random = (bytes) => crypto.randomBytes(bytes).toString('base64url');

/** A failed sign-in; `reason` becomes ?login_error=<reason> for the sign-in page. */
export class SignInError extends Error {
  constructor(message, reason = 'failed') {
    super(message);
    this.reason = reason;
  }
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt).split('.');
  if (parts.length !== 3) throw new SignInError('malformed ID token');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new SignInError('malformed ID token');
  }
}

export function createGoogleAuth(config, { fetchImpl = globalThis.fetch } = {}) {
  const { clientId, clientSecret, authUrl, tokenUrl } = config.google;
  const enabled = Boolean(clientId && clientSecret && config.ownerEmail && config.publicOrigins.length);
  const pending = new Map(); // state -> { nonce, verifier, redirectUri, returnTo, expires }

  function prune() {
    const now = Date.now();
    for (const [state, p] of pending) if (p.expires <= now) pending.delete(state);
  }

  return {
    enabled,
    /** Addresses where Google sign-in works (each must be an authorized redirect origin in Google Cloud). */
    origins: enabled ? config.publicOrigins : [],

    /** Start a sign-in from `origin`. Returns the Google URL to send the browser to, and its state. */
    begin({ origin, returnTo }) {
      if (!enabled) throw new HttpError(404, 'Google sign-in is not set up');
      if (!config.publicOrigins.includes(origin)) throw new HttpError(400, 'Google sign-in is not available on this address');
      prune();
      if (pending.size >= MAX_PENDING) throw new HttpError(429, 'Too many sign-ins in progress. Try again shortly.');
      const state = random(24);
      const nonce = random(24);
      const verifier = random(32);
      const redirectUri = `${origin}/api/auth/google/callback`;
      pending.set(state, { nonce, verifier, redirectUri, returnTo, expires: Date.now() + PENDING_TTL_MS });

      const url = new URL(authUrl);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return { state, url: url.toString() };
    },

    /** Claim a pending sign-in by its state (each can be used once). */
    take(state) {
      prune();
      const p = pending.get(state);
      pending.delete(state);
      return p ?? null;
    },

    /** Exchange the authorization code for the person's verified Google identity. */
    async identify(p, code) {
      let res;
      try {
        res = await fetchImpl(tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: p.redirectUri,
            grant_type: 'authorization_code',
            code_verifier: p.verifier,
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new SignInError(`could not reach Google: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.id_token !== 'string') {
        throw new SignInError(`token exchange failed (HTTP ${res.status} ${body.error ?? ''})`);
      }

      // The ID token came straight from Google's token endpoint over TLS, so (per Google's OpenID
      // Connect docs) its signature needn't be re-checked; its claims still must be.
      const claims = decodeJwtPayload(body.id_token);
      if (!ISSUERS.has(claims.iss)) throw new SignInError('unexpected ID token issuer');
      if (claims.aud !== clientId) throw new SignInError('ID token is for a different app');
      if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) throw new SignInError('ID token expired');
      if (claims.nonce !== p.nonce) throw new SignInError('ID token nonce mismatch');
      if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw new SignInError('ID token lacks an email');
      if (claims.email_verified !== true && claims.email_verified !== 'true') {
        throw new SignInError('Google email not verified', 'unverified');
      }
      return {
        sub: claims.sub,
        email: claims.email.toLowerCase(),
        name: typeof claims.name === 'string' ? claims.name.slice(0, 200) : null,
        picture: GOOGLE_PICTURE.test(claims.picture ?? '') ? claims.picture : null,
      };
    },
  };
}
