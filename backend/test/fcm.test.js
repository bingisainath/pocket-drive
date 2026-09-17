// The FCM sender: mint an OAuth2 token from a service-account JWT (verified for real here), send
// via the HTTP v1 API, cache the token, and prune tokens FCM reports dead. Firebase is stood in for.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { buildConfig } from '../src/config.js';
import { createFcmSender } from '../src/fcm.js';

const silent = { warn() {}, log() {}, error() {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// A real key pair, so the stand-in token endpoint can verify the assertion signature for real.
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PROJECT = 'test-project';

let tmp, saPath, server, config, tokenHits, sentMessages;

before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cloud-drive-fcm-'));
  tokenHits = 0;
  sentMessages = [];

  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;

    if (req.url === '/token') {
      tokenHits++;
      const assertion = new URLSearchParams(body).get('assertion') ?? '';
      const [header, payload, signature] = assertion.split('.');
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${header}.${payload}`);
      verifier.end();
      const signed = signature && verifier.verify(keys.publicKey, Buffer.from(signature, 'base64url'));
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!signed || claims.iss !== 'fcm@test.iam.gserviceaccount.com') {
        res.writeHead(400).end('{"error":"invalid_grant"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }));
    }

    if (req.url === `/v1/projects/${PROJECT}/messages:send`) {
      if (req.headers.authorization !== 'Bearer fake-access-token') return res.writeHead(401).end('{}');
      const { message } = JSON.parse(body);
      if (message.token === 'bad-token') {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { status: 'UNREGISTERED' } }));
      }
      sentMessages.push(message);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ name: `projects/${PROJECT}/messages/1` }));
    }
    res.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  saPath = path.join(tmp, 'service-account.json');
  fs.writeFileSync(
    saPath,
    JSON.stringify({
      type: 'service_account',
      project_id: PROJECT,
      client_email: 'fcm@test.iam.gserviceaccount.com',
      private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: `${base}/token`,
    }),
  );
  config = buildConfig({ FCM_SERVICE_ACCOUNT_FILE: saPath, FCM_SEND_BASE_URL: base });
});

after(async () => {
  server.close();
  await fsp.rm(tmp, { recursive: true, force: true });
});

const stubDevices = () => {
  const removed = [];
  return {
    removed,
    removeToken: (t) => removed.push(t),
    forUsers: (ids) => (ids.includes(1) ? [{ userId: 1, token: 'good-a' }, { userId: 1, token: 'good-b' }] : []),
  };
};

test('sends notifications to device tokens with a signed access token', async () => {
  const sender = createFcmSender(config, { fetchImpl: fetch, log: silent, devices: stubDevices() });
  assert.equal(sender.enabled, true);
  const before = sentMessages.length;
  const result = await sender.sendToTokens(['tok-1', 'tok-2'], { title: 'Hi', body: 'New file', data: { path: 'Trip', n: 3 } });
  assert.deepEqual(result, { sent: 2, removed: 0 });
  const msg = sentMessages[before];
  assert.equal(msg.notification.title, 'Hi');
  assert.deepEqual(msg.data, { path: 'Trip', n: '3' }); // data values coerced to strings
});

test('prunes tokens FCM reports dead', async () => {
  const devices = stubDevices();
  const sender = createFcmSender(config, { fetchImpl: fetch, log: silent, devices });
  const result = await sender.sendToTokens(['good', 'bad-token'], { title: 'x', body: 'y' });
  assert.deepEqual(result, { sent: 1, removed: 1 });
  assert.deepEqual(devices.removed, ['bad-token']);
});

test('caches the OAuth2 access token across sends', async () => {
  const sender = createFcmSender(config, { fetchImpl: fetch, log: silent, devices: stubDevices() });
  const start = tokenHits;
  await sender.sendToTokens(['a'], { title: 't', body: 'b' });
  await sender.sendToTokens(['b'], { title: 't', body: 'b' });
  assert.equal(tokenHits - start, 1); // token minted once, reused for the second send
});

test('sendToUsers fans out to every device of the users', async () => {
  const sender = createFcmSender(config, { fetchImpl: fetch, log: silent, devices: stubDevices() });
  const result = await sender.sendToUsers([1], { title: 'Shared', body: 'A folder was shared' });
  assert.deepEqual(result, { sent: 2, removed: 0 });
});

test('is disabled cleanly when no service account is configured', async () => {
  const sender = createFcmSender(buildConfig({}), { fetchImpl: fetch, log: silent, devices: stubDevices() });
  assert.equal(sender.enabled, false);
  assert.deepEqual(await sender.sendToTokens(['x'], { title: 'a', body: 'b' }), { sent: 0, removed: 0 });
});
