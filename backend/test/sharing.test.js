// Accounts, Google sign-in and folder sharing. Google's token endpoint is replaced by a local
// stand-in that enforces the same things Google does (PKCE, client credentials, redirect URI).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { buildConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { openDatabase } from '../src/db.js';

const OWNER = 'owner@example.com';
const VIEWER = 'viewer@example.com';
const FRIEND = 'friend@example.com'; // contributor
const EDITOR = 'editor@example.com';
const PASSWORD = 'owner backup password';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-secret';
const silent = { warn() {}, log() {}, error() {} };

// A real RSA key so the mobile app's ID tokens can be signed here and verified for real against
// the stand-in JWKS below (the web flow uses an unsigned token because it trusts Google's TLS).
const KID = 'test-key-1';
const idKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...idKeys.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

/** Build a signed Google ID token for the native-app sign-in tests. `claims` overrides the defaults. */
function makeIdToken(claims = {}, { key = idKeys.privateKey, kid = KID } = {}) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const payload = b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email_verified: true,
    ...claims,
  });
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
}

// --- Stand-in for Google's token endpoint (and, for the app flow, its JWKS) ---
const grants = new Map(); // one-time code -> what Google would know about the sign-in
const fakeGoogle = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/certs')) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=3600' });
    return res.end(JSON.stringify({ keys: [publicJwk] }));
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const form = new URLSearchParams(body);
  const grant = grants.get(form.get('code'));
  grants.delete(form.get('code'));
  const pkceOk =
    grant && crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === grant.challenge;
  const valid =
    req.url === '/token' &&
    pkceOk &&
    form.get('client_id') === CLIENT_ID &&
    form.get('client_secret') === CLIENT_SECRET &&
    form.get('redirect_uri') === grant.redirectUri;
  if (!valid) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end('{"error":"invalid_grant"}');
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claims = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: grant.nonce,
    sub: grant.sub,
    email: grant.email,
    email_verified: grant.verified,
    name: grant.name,
    picture: 'https://lh3.googleusercontent.com/a/photo',
    ...grant.override,
  };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.signature`, access_token: 'unused' }));
});

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

let tmp, ctx, server, base;

before(async () => {
  fakeGoogle.listen(0, '127.0.0.1');
  await once(fakeGoogle, 'listening');
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cloud-drive-sharing-'));
  const config = buildConfig({
    DATA_DIR: tmp,
    FRONTEND_DIST: path.join(tmp, 'no-frontend'),
    PASSWORD_HASH: hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 }),
    OWNER_EMAIL: OWNER,
    PUBLIC_ORIGINS: base,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_TOKEN_URL: `http://127.0.0.1:${fakeGoogle.address().port}/token`,
    GOOGLE_JWKS_URL: `http://127.0.0.1:${fakeGoogle.address().port}/certs`,
  });
  ctx = await createContext(config, { log: silent });
  server = createApp(ctx).listen(port, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  server.close();
  fakeGoogle.close();
  ctx.close();
  await fsp.rm(tmp, { recursive: true, force: true });
});

/** An HTTP client carrying one person's session cookie. */
function as(cookie) {
  const call = (method, url, { json, body } = {}) => {
    const headers = { cookie: cookie ?? '' };
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    }
    return fetch(base + url, { method, headers, body, redirect: 'manual' });
  };
  return {
    call,
    async json(url) {
      const res = await call('GET', url);
      assert.equal(res.status, 200, `GET ${url} -> ${res.status}`);
      return res.json();
    },
    status: async (method, url, json) => (await call(method, url, { json })).status,
    list: (folder) => call('GET', `/api/list?path=${encodeURIComponent(folder)}`),
    mkdir: (parentPath, name) => call('POST', '/api/folders', { json: { parentPath, name } }),
    upload(folder, name, content = `contents of ${name}`) {
      const form = new FormData();
      form.append('file', new Blob([content]), name);
      return call('POST', `/api/upload?path=${encodeURIComponent(folder)}`, { body: form });
    },
    share: (folder, email, role) => call('POST', '/api/admin/shares', { json: { path: folder, email, role } }),
  };
}

/** Run the whole Google sign-in: start → (Google) → callback. */
async function googleSignIn(email, { sub = `google-${email}`, verified = true, override, withStateCookie = true } = {}) {
  const start = await fetch(
    `${base}/api/auth/google/start?origin=${encodeURIComponent(base)}&returnTo=${encodeURIComponent('/?p=Trip')}`,
    { redirect: 'manual' },
  );
  assert.equal(start.status, 302);
  const google = new URL(start.headers.get('location'));
  const stateCookie = start.headers.getSetCookie().find((c) => c.startsWith('cd_oauth='));
  const code = crypto.randomUUID();
  grants.set(code, {
    email,
    sub,
    verified,
    override,
    name: email.split('@')[0],
    nonce: google.searchParams.get('nonce'),
    challenge: google.searchParams.get('code_challenge'),
    redirectUri: google.searchParams.get('redirect_uri'),
  });
  const callbackUrl = `${base}/api/auth/google/callback?code=${code}&state=${google.searchParams.get('state')}`;
  const res = await fetch(callbackUrl, {
    redirect: 'manual',
    headers: { cookie: withStateCookie ? stateCookie.split(';')[0] : '' },
  });
  const session = res.headers.getSetCookie().find((c) => c.startsWith('cd_session='));
  return { status: res.status, location: res.headers.get('location'), cookie: session?.split(';')[0] ?? null, google, callbackUrl, stateCookie };
}

// ---------------------------------------------------------------- Google sign-in

let owner, viewer, friend, editor; // clients
const ids = {}; // entry ids by path

test('Google sign-in redirects with PKCE, state and nonce', async () => {
  const { google, stateCookie } = await googleSignIn(OWNER);
  assert.equal(google.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(google.searchParams.get('redirect_uri'), `${base}/api/auth/google/callback`);
  assert.equal(google.searchParams.get('response_type'), 'code');
  assert.equal(google.searchParams.get('scope'), 'openid email profile');
  assert.equal(google.searchParams.get('code_challenge_method'), 'S256');
  assert.match(google.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  assert.match(stateCookie, /HttpOnly/);
  assert.match(stateCookie, /Path=\/api\/auth\/google/);
});

test('Google sign-in is refused for addresses not in PUBLIC_ORIGINS', async () => {
  const res = await fetch(`${base}/api/auth/google/start?origin=${encodeURIComponent('https://evil.example')}`, { redirect: 'manual' });
  assert.equal(res.status, 400);
});

test('the owner signs in with Google and lands where they started', async () => {
  const r = await googleSignIn(OWNER);
  assert.equal(r.status, 302);
  assert.equal(r.location, '/?p=Trip');
  assert.ok(r.cookie);
  owner = as(r.cookie);
  const me = await owner.json('/api/auth/me');
  assert.equal(me.user.email, OWNER);
  assert.equal(me.user.isOwner, true);
  assert.equal(me.user.picture, 'https://lh3.googleusercontent.com/a/photo');
  assert.deepEqual(me.google, { enabled: true, origins: [base] });
});

test('people nobody shared anything with are turned away', async () => {
  const r = await googleSignIn('stranger@example.com');
  assert.equal(r.location, '/?login_error=not_invited');
  assert.equal(r.cookie, null);
});

test('a callback without the browser’s state cookie is rejected (login CSRF), and codes are single-use', async () => {
  let r = await googleSignIn(OWNER, { withStateCookie: false });
  assert.equal(r.location, '/?login_error=expired');
  assert.equal(r.cookie, null);
  r = await googleSignIn(OWNER);
  const replay = await fetch(r.callbackUrl, { redirect: 'manual', headers: { cookie: r.stateCookie.split(';')[0] } });
  assert.equal(replay.headers.get('location'), '/?login_error=expired');
});

test('ID tokens with a wrong audience or an unverified email are rejected', async () => {
  let r = await googleSignIn(OWNER, { override: { aud: 'someone-elses-app' } });
  assert.equal(r.location, '/?login_error=failed');
  r = await googleSignIn(OWNER, { verified: false });
  assert.equal(r.location, '/?login_error=unverified');
});

test('the owner’s password still works as a backup sign-in', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(res.status, 204);
  const me = await as(res.headers.get('set-cookie').split(';')[0]).json('/api/auth/me');
  assert.equal(me.user.isOwner, true);
});

// ---------------------------------------------------------------- app Bearer tokens

const postJson = (url, json, headers = {}) =>
  fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(json) });
const withBearer = (token, method, url) => fetch(base + url, { method, headers: { authorization: `Bearer ${token}` } });

test('token/password issues a Bearer token that authorizes API calls', async () => {
  const res = await postJson('/api/auth/token/password', { password: PASSWORD });
  assert.equal(res.status, 200);
  const { token, user } = await res.json();
  assert.equal(typeof token, 'string');
  assert.equal(user.isOwner, true);
  assert.equal(user.email, OWNER);

  const me = await (await withBearer(token, 'GET', '/api/auth/me')).json();
  assert.equal(me.authenticated, true);
  assert.equal(me.user.email, OWNER);
  assert.equal((await withBearer(token, 'GET', '/api/list?path=')).status, 200);
});

test('token/password rejects a wrong password', async () => {
  assert.equal((await postJson('/api/auth/token/password', { password: 'nope' })).status, 401);
});

test('logout revokes a Bearer token', async () => {
  const { token } = await (await postJson('/api/auth/token/password', { password: PASSWORD })).json();
  const before = await (await withBearer(token, 'GET', '/api/auth/me')).json();
  assert.equal(before.authenticated, true);
  assert.equal((await withBearer(token, 'POST', '/api/auth/logout')).status, 204);
  const me = await (await withBearer(token, 'GET', '/api/auth/me')).json();
  assert.equal(me.authenticated, false);
  assert.equal((await withBearer(token, 'GET', '/api/list?path=')).status, 401);
});

test('token/google verifies a signed ID token and issues a Bearer token', async () => {
  // Same Google sub the earlier web sign-in pinned to the owner, or the account-mismatch guard trips.
  const idToken = makeIdToken({ sub: `google-${OWNER}`, email: OWNER, name: 'Owner' });
  const res = await postJson('/api/auth/token/google', { idToken });
  assert.equal(res.status, 200);
  const { token, user } = await res.json();
  assert.equal(user.isOwner, true);
  assert.equal(user.email, OWNER);
  const me = await (await withBearer(token, 'GET', '/api/auth/me')).json();
  assert.equal(me.user.email, OWNER);
});

test('token/google rejects a bad signature, wrong audience, unverified email, and uninvited user', async () => {
  const valid = makeIdToken({ sub: 'google-owner', email: OWNER });
  const tampered = `${valid.slice(0, -4)}AAAA`;
  assert.equal((await postJson('/api/auth/token/google', { idToken: tampered })).status, 401);
  assert.equal((await postJson('/api/auth/token/google', { idToken: makeIdToken({ email: OWNER, aud: 'other-app' }) })).status, 401);
  assert.equal(
    (await postJson('/api/auth/token/google', { idToken: makeIdToken({ email: OWNER, email_verified: false }) })).status,
    401,
  );
  assert.equal(
    (await postJson('/api/auth/token/google', { idToken: makeIdToken({ sub: 'g-x', email: 'stranger@example.com' }) })).status,
    403,
  );
  assert.equal((await postJson('/api/auth/token/google', {})).status, 400);
});

// ---------------------------------------------------------------- setting up shares

test('the owner builds folders and shares them by email and role', async () => {
  for (const [parent, name] of [['', 'Personal'], ['', 'Trip'], ['Trip', 'Day 1'], ['', 'Family']]) {
    const res = await owner.mkdir(parent, name);
    assert.equal(res.status, 201);
    ids[(await res.json()).path] = null;
  }
  for (const [folder, name] of [['Personal', 'secret.txt'], ['Trip', 'beach.txt'], ['Trip/Day 1', 'sunset.txt'], ['Family', 'mom.txt']]) {
    const { files } = await (await owner.upload(folder, name)).json();
    ids[files[0].path] = files[0].id;
  }
  for (const folder of ['Personal', 'Trip', 'Trip/Day 1', 'Family']) {
    const entries = (await owner.json(`/api/list?path=${encodeURIComponent(folder.split('/').slice(0, -1).join('/'))}`)).entries;
    ids[folder] = entries.find((e) => e.path === folder).id;
  }

  for (const [folder, email, role] of [
    ['Trip', VIEWER, 'viewer'],
    ['Trip', FRIEND, 'contributor'],
    ['Trip', EDITOR, 'editor'],
    ['Family', VIEWER, 'viewer'],
  ]) {
    const res = await owner.share(folder, email, role);
    assert.equal(res.status, 201);
    const share = await res.json();
    assert.equal(share.user.email, email);
    assert.equal(share.role, role);
  }

  viewer = as((await googleSignIn(VIEWER)).cookie);
  friend = as((await googleSignIn(FRIEND)).cookie);
  editor = as((await googleSignIn(EDITOR)).cookie);
  assert.ok(viewer && friend && editor);
  assert.equal((await viewer.json('/api/auth/me')).user.isOwner, false);
});

test('sharing validates its input', async () => {
  assert.equal((await owner.share('Trip', 'not-an-email', 'viewer')).status, 400);
  assert.equal((await owner.share('Trip', 'x@example.com', 'admin')).status, 400);
  assert.equal((await owner.share('', 'x@example.com', 'viewer')).status, 400); // the whole drive
  assert.equal((await owner.share('Nope', 'x@example.com', 'viewer')).status, 404);
  assert.equal((await owner.share('Trip', OWNER.toUpperCase(), 'viewer')).status, 400); // the owner
  assert.equal((await owner.share('Trip/../Personal', 'x@example.com', 'viewer')).status, 400);
});

// ---------------------------------------------------------------- what members can see

test('members start at "Shared with me" and see only folders shared with them', async () => {
  let res = await viewer.json('/api/list?path=');
  assert.equal(res.access.sharedRoot, true);
  assert.deepEqual(res.entries.map((e) => e.path), ['Family', 'Trip']);
  res = await friend.json('/api/list?path=');
  assert.deepEqual(res.entries.map((e) => e.path), ['Trip']);
  assert.ok(res.entries.every((e) => !('sharedWith' in e)), 'members don’t learn who else has access');
  // The owner still sees the real root, with sharing badges.
  res = await owner.json('/api/list?path=');
  assert.deepEqual(res.entries.map((e) => e.name).sort(), ['Family', 'Personal', 'Trip']);
  assert.equal(res.access.isOwner, true);
  const shared = Object.fromEntries(res.entries.map((e) => [e.name, e.sharedWith]));
  assert.deepEqual(shared, { Family: 1, Personal: 0, Trip: 3 });
});

test('shared folders include their subfolders', async () => {
  let res = await viewer.json('/api/list?path=Trip');
  assert.deepEqual(res.entries.map((e) => e.name).sort(), ['Day 1', 'beach.txt']);
  assert.equal(res.access.role, 'viewer');
  assert.equal(res.access.accessRoot, 'Trip');
  res = await viewer.json(`/api/list?path=${encodeURIComponent('Trip/Day 1')}`);
  assert.deepEqual(res.entries.map((e) => e.name), ['sunset.txt']);
  assert.equal(res.entries[0].uploadedBy, OWNER);
});

test('private folders and files answer 404 — the same as if they didn’t exist', async () => {
  assert.equal((await viewer.list('Personal')).status, 404);
  assert.equal((await viewer.list('Personal/Inner')).status, 404);
  const secret = ids['Personal/secret.txt'];
  for (const url of [`/api/files/${secret}/raw`, `/api/files/${secret}/download`, `/api/files/${secret}/thumb`]) {
    assert.equal(await friend.status('GET', url), 404, url);
  }
  assert.equal(await editor.status('DELETE', `/api/entries/${secret}`), 404);
  assert.equal(await editor.status('DELETE', `/api/entries/${ids.Personal}`), 404);
  // …while shared files work.
  const res = await viewer.call('GET', `/api/files/${ids['Trip/beach.txt']}/download`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'contents of beach.txt');
});

test('search only covers shared folders', async () => {
  const names = async (client, q) => (await client.json(`/api/search?q=${q}`)).entries.map((e) => e.path).sort();
  assert.deepEqual(await names(viewer, 'secret'), []);
  assert.deepEqual(await names(viewer, 'txt'), ['Family/mom.txt', 'Trip/Day 1/sunset.txt', 'Trip/beach.txt']);
  assert.deepEqual(await names(friend, 'txt'), ['Trip/Day 1/sunset.txt', 'Trip/beach.txt']);
  assert.deepEqual(await names(viewer, 'trip'), ['Trip']); // the shared folder itself is findable
  assert.ok((await names(owner, 'txt')).includes('Personal/secret.txt'));
});

// ---------------------------------------------------------------- what members can change

test('viewers can’t add or delete anything', async () => {
  assert.equal((await viewer.upload('Trip', 'nope.txt')).status, 403);
  assert.equal((await viewer.mkdir('Trip', 'Nope')).status, 403);
  assert.equal(await viewer.status('DELETE', `/api/entries/${ids['Trip/beach.txt']}`), 403);
  const { entries } = await viewer.json('/api/list?path=Trip');
  assert.ok(entries.every((e) => e.canDelete === false));
  assert.equal((await viewer.json('/api/list?path=Trip')).access.canWrite, false);
  assert.equal((await viewer.upload('', 'root.txt')).status, 404); // no root for members
});

test('contributors add files and delete only their own', async () => {
  let res = await friend.upload('Trip', 'friend.jpg');
  assert.equal(res.status, 201);
  const mine = (await res.json()).files[0];
  assert.equal(mine.uploadedBy, FRIEND);
  assert.equal(mine.canDelete, true);

  const { entries } = await friend.json('/api/list?path=Trip');
  assert.equal(entries.find((e) => e.name === 'beach.txt').canDelete, false);
  assert.equal(entries.find((e) => e.name === 'friend.jpg').canDelete, true);
  assert.equal(await friend.status('DELETE', `/api/entries/${ids['Trip/beach.txt']}`), 403);
  assert.equal(await friend.status('DELETE', `/api/entries/${mine.id}`), 200);

  // A folder they made, holding only their files, is theirs to delete…
  const own = await (await friend.mkdir('Trip', 'Friend pics')).json();
  await friend.upload('Trip/Friend pics', 'a.jpg');
  assert.equal(await friend.status('DELETE', `/api/entries/${own.id}`), 200);
  // …but not once someone else has added to it.
  const shared = await (await friend.mkdir('Trip', 'Group pics')).json();
  await owner.upload('Trip/Group pics', 'owners.jpg');
  assert.equal(await friend.status('DELETE', `/api/entries/${shared.id}`), 403);
});

test('editors can delete anything inside, but not the shared folder itself', async () => {
  assert.equal(await editor.status('DELETE', `/api/entries/${ids['Trip/Day 1/sunset.txt']}`), 200);
  assert.equal(await editor.status('DELETE', `/api/entries/${ids.Trip}`), 403);
  const { entries } = await editor.json('/api/list?path=');
  assert.equal(entries.find((e) => e.path === 'Trip').canDelete, false);
});

test('members can’t use owner features', async () => {
  assert.deepEqual(Object.keys(await viewer.json('/api/storage')), ['maxUploadBytes']);
  assert.equal(await editor.status('POST', '/api/rescan'), 403);
  for (const url of ['/api/admin/users', '/api/admin/activity', '/api/admin/shares?path=Trip']) {
    assert.equal(await editor.status('GET', url), 403, url);
  }
  assert.equal((await editor.share('Trip', 'x@example.com', 'editor')).status, 403);
});

// ---------------------------------------------------------------- managing access

test('the owner sees direct and inherited shares on a folder', async () => {
  const res = await owner.json(`/api/admin/shares?path=${encodeURIComponent('Trip/Day 1')}`);
  assert.deepEqual(res.direct, []);
  assert.deepEqual(
    res.inherited.map((s) => `${s.path}:${s.user.email}:${s.role}`).sort(),
    [`Trip:${EDITOR}:editor`, `Trip:${FRIEND}:contributor`, `Trip:${VIEWER}:viewer`],
  );
});

test('a stronger share deeper down upgrades access there only', async () => {
  const res = await owner.share('Trip/Day 1', VIEWER, 'contributor');
  assert.equal(res.status, 201);
  assert.equal((await viewer.upload('Trip/Day 1', 'upgrade.txt')).status, 201);
  assert.equal((await viewer.upload('Trip', 'still-no.txt')).status, 403);
  // Still reached through Trip, so "Shared with me" doesn't list Day 1 separately.
  assert.deepEqual((await viewer.json('/api/list?path=')).entries.map((e) => e.path), ['Family', 'Trip']);
});

test('unsharing takes effect on the very next request', async () => {
  const shares = (await owner.json('/api/admin/shares?path=Trip')).direct;
  const viewerShare = shares.find((s) => s.user.email === VIEWER);
  assert.equal(await owner.status('DELETE', `/api/admin/shares/${viewerShare.id}`), 200);
  assert.equal((await viewer.list('Trip')).status, 404);
  // Their deeper share on Day 1 still stands on its own.
  assert.deepEqual((await viewer.json('/api/list?path=')).entries.map((e) => e.path), ['Family', 'Trip/Day 1']);
  assert.equal((await viewer.json('/api/list?path=Trip%2FDay%201')).access.accessRoot, 'Trip/Day 1');
});

test('deleting a shared folder removes its shares', async () => {
  assert.equal(await owner.status('DELETE', `/api/entries/${ids['Trip/Day 1']}`), 200);
  assert.deepEqual((await viewer.json('/api/list?path=')).entries.map((e) => e.path), ['Family']);
  // Recreating a folder with the same name must not silently re-share it.
  await owner.mkdir('Trip', 'Day 1');
  assert.deepEqual((await viewer.json('/api/list?path=')).entries.map((e) => e.path), ['Family']);
});

test('removing a person signs them out at once; files they added stay', async () => {
  const people = (await owner.json('/api/admin/users')).users;
  assert.deepEqual(people.map((p) => p.email), [OWNER, EDITOR, FRIEND, VIEWER]); // owner first
  const friendRow = people.find((p) => p.email === FRIEND);
  assert.deepEqual(friendRow.shares.map((s) => `${s.path}:${s.role}`), ['Trip:contributor']);
  assert.ok(friendRow.lastLoginAt);

  assert.equal(await owner.status('DELETE', `/api/admin/users/${friendRow.id}`), 200);
  assert.equal((await friend.list('Trip')).status, 401);
  assert.equal((await googleSignIn(FRIEND)).location, '/?login_error=not_invited');
  const groupPics = (await owner.json('/api/list?path=Trip')).entries.find((e) => e.name === 'Group pics');
  assert.ok(groupPics, 'their folder is still there');
  assert.equal(groupPics.uploadedBy, null); // now counts as the owner's

  const ownerRow = people.find((p) => p.isOwner);
  assert.equal(await owner.status('DELETE', `/api/admin/users/${ownerRow.id}`), 404);
});

test('an email stays tied to the first Google account that used it', async () => {
  const r = await googleSignIn(EDITOR, { sub: 'a-different-google-account' });
  assert.equal(r.location, '/?login_error=account_mismatch');
  assert.equal(r.cookie, null);
});

test('the activity log records sign-ins, uploads, sharing and deletes', async () => {
  const { items } = await owner.json('/api/admin/activity?limit=200');
  const has = (action, pred = () => true) => items.some((i) => i.action === action && pred(i));
  assert.ok(has('login', (i) => i.email === OWNER && i.detail.method === 'google'));
  assert.ok(has('login', (i) => i.detail.method === 'password'));
  assert.ok(has('login_denied', (i) => i.email === 'stranger@example.com'));
  assert.ok(has('upload', (i) => i.email === FRIEND && i.path === 'Trip/friend.jpg' && i.detail.size > 0));
  assert.ok(has('mkdir', (i) => i.path === 'Trip/Group pics'));
  assert.ok(has('share', (i) => i.path === 'Trip' && i.detail.email === VIEWER && i.detail.role === 'viewer'));
  assert.ok(has('unshare', (i) => i.detail.email === VIEWER));
  assert.ok(has('delete', (i) => i.email === EDITOR && i.path === 'Trip/Day 1/sunset.txt'));
  assert.ok(has('remove_user', (i) => i.detail.email === FRIEND));
  // Newest first, and pageable.
  assert.ok(items[0].id > items.at(-1).id);
  const page = await owner.json(`/api/admin/activity?limit=2&before=${items[1].id}`);
  assert.deepEqual(page.items.map((i) => i.id), [items[2].id, items[3].id]);
});

// ---------------------------------------------------------------- upgrading an existing drive

test('an existing single-user database upgrades in place', async () => {
  const file = path.join(tmp, 'old.db');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_path TEXT NOT NULL, name TEXT NOT NULL,
      is_dir INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, mime TEXT, created_at INTEGER NOT NULL,
      UNIQUE (parent_path, name));
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO entries (parent_path, name, is_dir, size, mime, created_at) VALUES ('', 'Photos', 1, 0, NULL, 1), ('Photos', 'a.jpg', 0, 5, 'image/jpeg', 2);
    INSERT INTO sessions VALUES ('abc', 1, 9999999999999);`);
  old.close();

  const db = openDatabase(file);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  assert.deepEqual(db.prepare('SELECT name, owner_id FROM entries ORDER BY id').all(), [
    { name: 'Photos', owner_id: null },
    { name: 'a.jpg', owner_id: null },
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0); // old sessions signed out
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'user_id'").get());
  db.close();
  assert.equal(openDatabase(file).pragma('user_version', { simple: true }), 1); // re-opening is a no-op
});
