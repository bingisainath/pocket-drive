// Firebase Cloud Messaging via the HTTP v1 API, called directly — no firebase-admin. We mint a
// short-lived OAuth2 access token from the service account (a JWT signed with node:crypto), cache
// it, and POST one message per device token. Push is disabled cleanly when no service account is set.
import crypto from 'node:crypto';
import fs from 'node:fs';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const JWT_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Read and validate the service-account JSON. Returns null (with a warning) if missing/malformed. */
function loadServiceAccount(file, log) {
  if (!file) return null;
  let sa;
  try {
    sa = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    log.warn(`FCM disabled: cannot read service account at ${file} (${err.message})`);
    return null;
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id || !sa.token_uri) {
    log.warn('FCM disabled: service account is missing client_email/private_key/project_id/token_uri');
    return null;
  }
  return sa;
}

/** FCM data payloads must be string-valued; coerce and drop nullish entries. */
function stringifyData(data) {
  const out = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value != null) out[key] = String(value);
  }
  return out;
}

export function createFcmSender(config, { fetchImpl = globalThis.fetch, log = console, devices } = {}) {
  const sa = loadServiceAccount(config.fcm.serviceAccountFile, log);
  const enabled = Boolean(sa);
  const sendUrl = sa ? `${config.fcm.sendBaseUrl}/v1/projects/${sa.project_id}/messages:send` : null;
  let cachedToken = null; // { value, expires }

  async function accessToken() {
    if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 };
    const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const assertion = `${signingInput}.${signer.sign(sa.private_key).toString('base64url')}`;

    const res = await fetchImpl(sa.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_GRANT, assertion }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`token exchange failed (HTTP ${res.status})`);
    // Refresh a minute early to avoid racing expiry.
    cachedToken = { value: body.access_token, expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
    return cachedToken.value;
  }

  function buildMessage(token, { title, body, data, channelId }) {
    return {
      token,
      notification: { title, body },
      data: stringifyData(data),
      android: {
        priority: 'high',
        notification: channelId ? { channel_id: channelId } : undefined,
      },
    };
  }

  /** POST one message. Returns 'ok', 'invalid' (dead token, should be removed), or 'error'. */
  async function sendOne(bearer, token, message) {
    let res;
    try {
      res = await fetchImpl(sendUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: buildMessage(token, message) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      log.warn(`FCM send failed: ${err.message}`);
      return 'error';
    }
    if (res.ok) return 'ok';
    const err = await res.json().catch(() => ({}));
    const status = err?.error?.status;
    // A token that no longer exists: drop it so we stop trying.
    if (res.status === 404 || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') return 'invalid';
    log.warn(`FCM send rejected (HTTP ${res.status} ${status ?? ''})`);
    return 'error';
  }

  return {
    enabled,

    /** Send one notification to specific device tokens. Prunes tokens FCM reports dead. */
    async sendToTokens(tokens, message) {
      const unique = [...new Set(tokens)];
      if (!enabled || unique.length === 0) return { sent: 0, removed: 0 };
      let bearer;
      try {
        bearer = await accessToken();
      } catch (err) {
        log.warn(`FCM: ${err.message}`);
        return { sent: 0, removed: 0, error: true };
      }
      const results = await Promise.all(unique.map(async (t) => [t, await sendOne(bearer, t, message)]));
      const dead = results.filter(([, r]) => r === 'invalid').map(([t]) => t);
      for (const t of dead) devices?.removeToken(t);
      return { sent: results.filter(([, r]) => r === 'ok').length, removed: dead.length };
    },

    /** Send one notification to every device of the given users. */
    async sendToUsers(userIds, message) {
      if (!enabled) return { sent: 0, removed: 0 };
      const tokens = devices.forUsers([...new Set(userIds)]).map((d) => d.token);
      return this.sendToTokens(tokens, message);
    },
  };
}
