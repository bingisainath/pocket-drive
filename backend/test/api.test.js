import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { buildConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { sanitizeName } from '../src/paths.js';
import { RESUMABLE_TTL_MS } from '../src/resumable.js';
import { planRenditions } from '../src/streams.js';
import { wantsPreview } from '../src/thumbnails.js';

const PASSWORD = 'correct horse battery';
const silent = { warn() {}, log() {}, error() {} };
let tmp, config, ctx, server, base, cookie;

before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cloud-drive-test-'));
  // Stand-in for libheif's heif-dec (`heif-dec --quality 95 <in> <out>`): copies a known JPEG, so
  // the HEIC fallback is tested without needing an HEVC encoder to build a real iPhone photo.
  const fakeHeifDec = path.join(tmp, 'fake-heif-dec');
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c84' } }).jpeg().toFile(path.join(tmp, 'heif-fixture.jpg'));
  fs.writeFileSync(fakeHeifDec, '#!/bin/sh\nexec cp "$(dirname "$0")/heif-fixture.jpg" "$4"\n', { mode: 0o755 });
  config = buildConfig({
    DATA_DIR: tmp,
    HEIF_DECODER: fakeHeifDec,
    PASSWORD_HASH: hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 }), // cheap cost for fast tests
    MAX_UPLOAD_MB: '1',
    UPLOAD_CHUNK_MB: '0.1',
    LOGIN_MAX_ATTEMPTS: '3',
    FRONTEND_DIST: path.join(tmp, 'no-frontend'),
  });
  ctx = await createContext(config, { log: silent });
  server = createApp(ctx).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  ctx.close();
  await fsp.rm(tmp, { recursive: true, force: true });
});

function api(method, url, { json, body, auth = true, headers = {} } = {}) {
  if (auth && cookie) headers.cookie = cookie;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  }
  return fetch(base + url, { method, headers, body });
}

async function upload(folder, files) {
  const form = new FormData();
  for (const [name, content, type] of files) form.append('file', new Blob([content], { type }), name);
  return api('POST', `/api/upload?path=${encodeURIComponent(folder)}`, { body: form });
}

async function list(folder = '') {
  const res = await api('GET', `/api/list?path=${encodeURIComponent(folder)}`);
  assert.equal(res.status, 200);
  return (await res.json()).entries;
}

const onDisk = (rel) => fs.existsSync(path.join(config.storageDir, rel));
const tmpLeftovers = () => fs.readdirSync(config.tmpDir).filter((name) => name !== 'resumable');

const startUpload = (json) => api('POST', '/api/uploads', { json });
const putChunk = (id, offset, body, type = 'application/octet-stream') =>
  api('PUT', `/api/uploads/${id}`, { body, headers: { 'content-type': type, 'upload-offset': String(offset) } });

// --- auth ---

test('API requires a session', async () => {
  for (const url of ['/api/list', '/api/storage', '/api/files/1/raw', '/api/files/1/thumb']) {
    assert.equal((await api('GET', url)).status, 401, url);
  }
  const me = await (await api('GET', '/api/auth/me')).json();
  assert.equal(me.authenticated, false);
  assert.equal(me.user, null);
  assert.deepEqual(me.google, { enabled: false, origins: [] }); // no Google client configured here
});

test('health check is public and reveals nothing but the status', async () => {
  const res = await api('GET', '/api/health', { auth: false });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('wrong password is rejected', async () => {
  const res = await api('POST', '/api/auth/login', { json: { password: 'nope' } });
  assert.equal(res.status, 401);
  assert.equal((await api('POST', '/api/auth/login', { json: {} })).status, 401);
});

test('correct password sets an HttpOnly session cookie', async () => {
  const res = await api('POST', '/api/auth/login', { json: { password: PASSWORD } });
  assert.equal(res.status, 204);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /^cd_session=[\w-]{43};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  cookie = setCookie.split(';')[0];
  const me = await (await api('GET', '/api/auth/me')).json();
  assert.equal(me.authenticated, true);
  assert.equal(me.user.isOwner, true); // the password is the owner's backup sign-in
});

// --- folders ---

test('create folders, list them, and reject duplicates', async () => {
  let res = await api('POST', '/api/folders', { json: { parentPath: '', name: 'Photos' } });
  assert.equal(res.status, 201);
  const photos = await res.json();
  assert.equal(photos.path, 'Photos');
  assert.equal(photos.isDir, true);
  assert.ok(onDisk('Photos'));

  res = await api('POST', '/api/folders', { json: { parentPath: 'Photos', name: '2024' } });
  assert.equal(res.status, 201);
  assert.ok(onDisk('Photos/2024'));

  res = await api('POST', '/api/folders', { json: { parentPath: '', name: 'Photos' } });
  assert.equal(res.status, 409);

  const root = await list();
  assert.equal(root.length, 1);
  assert.equal(root[0].childCount, 1);
});

test('folder names are sanitized and traversal is rejected', async () => {
  let res = await api('POST', '/api/folders', { json: { name: '../../evil' } });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).name, '.._.._evil');
  assert.ok(onDisk('.._.._evil'));
  assert.ok(!fs.existsSync(path.join(tmp, 'evil')));

  for (const name of ['..', '.', '', '   ', '.cloud-drive-tmp']) {
    res = await api('POST', '/api/folders', { json: { name } });
    assert.equal(res.status, 400, JSON.stringify(name));
  }
  res = await api('POST', '/api/folders', { json: { parentPath: '../x', name: 'a' } });
  assert.equal(res.status, 400);
  res = await api('POST', '/api/folders', { json: { parentPath: 'Nope', name: 'a' } });
  assert.equal(res.status, 404);

  for (const p of ['..', '../..', 'Photos/../..', '.cloud-drive-tmp']) {
    res = await api('GET', `/api/list?path=${encodeURIComponent(p)}`);
    assert.equal(res.status, 400, p);
  }
  assert.equal((await api('GET', '/api/list?path=Missing')).status, 404);
});

// --- uploads ---

test('upload multiple files in one request', async () => {
  const res = await upload('Photos', [
    ['a.txt', 'hello', 'text/plain'],
    ['résumé ✓.txt', 'unicode name', 'text/plain'],
  ]);
  assert.equal(res.status, 201);
  const { files, errors } = await res.json();
  assert.deepEqual(errors, []);
  assert.deepEqual(files.map((f) => f.name).sort(), ['a.txt', 'résumé ✓.txt']);
  assert.equal(files.find((f) => f.name === 'a.txt').size, 5);
  assert.equal(files[0].mime, 'text/plain');
  assert.equal(fs.readFileSync(path.join(config.storageDir, 'Photos/résumé ✓.txt'), 'utf8'), 'unicode name');
  assert.deepEqual(tmpLeftovers(), []);
});

test('name collisions get a numbered suffix instead of overwriting', async () => {
  const first = await (await upload('Photos', [['a.txt', 'second', 'text/plain']])).json();
  const second = await (await upload('Photos', [['a.txt', 'third', 'text/plain']])).json();
  assert.equal(first.files[0].name, 'a (1).txt');
  assert.equal(second.files[0].name, 'a (2).txt');
  assert.equal(fs.readFileSync(path.join(config.storageDir, 'Photos/a.txt'), 'utf8'), 'hello');
});

test('uploaded filenames cannot escape the target folder', async () => {
  const res = await upload('Photos', [['../../escape.txt', 'x', 'text/plain']]);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).files[0].path, 'Photos/escape.txt'); // busboy keeps only the basename
  assert.equal(sanitizeName('../../escape.txt'), '.._.._escape.txt'); // and the sanitizer is a second line of defense
  assert.equal(sanitizeName('a/b\\c:d*e?.txt'), 'a_b_c_d_e_.txt');
  assert.equal(Buffer.byteLength(sanitizeName(`${'é'.repeat(200)}.jpg`)), 255 - 1); // whole chars only, ext kept
  assert.match(sanitizeName(`${'é'.repeat(200)}.jpg`), /\.jpg$/);
  assert.equal((await upload('../..', [['x.txt', 'x', 'text/plain']])).status, 400);
  assert.equal((await upload('Nope', [['x.txt', 'x', 'text/plain']])).status, 404);
});

test('chunked upload: a file arrives in pieces, resumes, and lands in its folder', async () => {
  const data = crypto.randomBytes(250_000);
  const file = { path: 'Photos', name: 'clip.bin', size: data.length, lastModified: 1_700_000_000_000 };
  let res = await startUpload(file);
  assert.equal(res.status, 200);
  const { id, offset, chunkSize } = await res.json();
  assert.equal(offset, 0);
  assert.equal(chunkSize, Math.floor(0.1 * 1024 * 1024));

  res = await putChunk(id, 0, data.subarray(0, chunkSize));
  assert.deepEqual([res.status, await res.json()], [200, { offset: chunkSize }]);

  res = await putChunk(id, 0, data.subarray(0, 10)); // stale offset: told where to continue
  assert.deepEqual([res.status, (await res.json()).offset], [409, chunkSize]);
  res = await putChunk(id, chunkSize, data.subarray(chunkSize, 2 * chunkSize + 1)); // one byte too many
  assert.equal(res.status, 413);
  assert.deepEqual(await (await api('GET', `/api/uploads/${id}`)).json(), { offset: chunkSize, size: data.length });

  // Adding the same file again (e.g. after the tab was closed) picks up where it stopped.
  assert.deepEqual(await (await startUpload(file)).json(), { id, offset: chunkSize, chunkSize });
  assert.notEqual((await (await startUpload({ ...file, lastModified: 1 })).json()).id, id); // a different file

  res = await putChunk(id, chunkSize, data.subarray(chunkSize, 2 * chunkSize));
  assert.deepEqual(await res.json(), { offset: 2 * chunkSize });
  res = await putChunk(id, 2 * chunkSize, data.subarray(2 * chunkSize));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.offset, data.length);
  assert.deepEqual([body.file.path, body.file.size], ['Photos/clip.bin', data.length]);
  assert.ok(fs.readFileSync(path.join(config.storageDir, 'Photos/clip.bin')).equals(data));
  assert.equal((await api('GET', `/api/uploads/${id}`)).status, 404);
  await api('DELETE', `/api/uploads/${(await (await startUpload({ ...file, lastModified: 1 })).json()).id}`);
  assert.deepEqual(fs.readdirSync(config.resumableDir), []);
});

test('chunked upload: empty and JSON files, limits, and cancelling', async () => {
  let { id } = await (await startUpload({ path: 'Photos', name: 'empty.txt', size: 0 })).json();
  let res = await putChunk(id, 0, Buffer.alloc(0));
  assert.deepEqual([res.status, (await res.json()).file.size], [201, 0]);

  const json = Buffer.from('{"stored":"not parsed"}'); // a .json file's bytes must not hit the JSON body parser
  ({ id } = await (await startUpload({ path: 'Photos', name: 'data.json', size: json.length })).json());
  res = await putChunk(id, 0, json, 'application/json');
  assert.equal(res.status, 201);
  assert.equal(fs.readFileSync(path.join(config.storageDir, 'Photos/data.json'), 'utf8'), json.toString());

  assert.equal((await startUpload({ path: 'Photos', name: 'huge.bin', size: 1024 * 1024 + 1 })).status, 413);
  assert.equal((await startUpload({ path: 'Photos', name: 'x', size: -1 })).status, 400);
  assert.equal((await startUpload({ path: 'Nope', name: 'x', size: 1 })).status, 404);
  assert.equal((await startUpload({ path: '../..', name: 'x', size: 1 })).status, 400);
  assert.equal((await putChunk('0'.repeat(32), 0, Buffer.from('x'))).status, 404);
  assert.equal((await putChunk('..%2F..%2Fetc', 0, Buffer.from('x'))).status, 404);
  assert.equal((await api('PUT', `/api/uploads/${'0'.repeat(32)}`, { body: 'x' })).status, 404);

  ({ id } = await (await startUpload({ path: 'Photos', name: 'gone.bin', size: 10 })).json());
  await putChunk(id, 0, Buffer.from('12345'));
  assert.equal((await api('DELETE', `/api/uploads/${id}`)).status, 204);
  assert.equal((await api('GET', `/api/uploads/${id}`)).status, 404);
  assert.deepEqual(fs.readdirSync(config.resumableDir), []);
});

test('unfinished chunked uploads survive a restart and expire after a day', async () => {
  const { id } = await (await startUpload({ path: 'Photos', name: 'later.bin', size: 10 })).json();
  await putChunk(id, 0, Buffer.from('abc'));
  fs.writeFileSync(path.join(config.tmpDir, 'interrupted.part'), 'x'); // from a single-request upload

  const restarted = await createContext(config, { log: silent });
  try {
    assert.deepEqual(tmpLeftovers(), []);
    assert.equal(await restarted.resumable.offset({ id }), 3);
    assert.equal(await restarted.resumable.prune(), 0);
    assert.equal(await restarted.resumable.prune(Date.now() + RESUMABLE_TTL_MS + 1000), 1);
    assert.deepEqual(fs.readdirSync(config.resumableDir), []);
  } finally {
    restarted.close();
  }
});

test('files over the size limit are rejected and cleaned up', async () => {
  const big = Buffer.alloc(1024 * 1024 + 1);
  const res = await upload('', [['big.bin', big, 'application/octet-stream']]);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /1 MB upload limit/);
  assert.ok(!onDisk('big.bin'));
  assert.deepEqual(tmpLeftovers(), []);
});

test('an aborted upload leaves no partial files behind', async () => {
  const boundary = 'xyzboundary';
  const req = http.request(`${base}/api/upload?path=`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': 10_000_000,
    },
  });
  req.on('error', () => {});
  req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.bin"\r\n\r\n`);
  req.write(Buffer.alloc(200_000));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(tmpLeftovers().length, 1, 'upload should be streaming into a temp file');
  req.destroy();
  for (let i = 0; i < 40 && tmpLeftovers().length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(tmpLeftovers(), []);
  assert.ok(!onDisk('partial.bin'));
});

test('non-multipart uploads are rejected', async () => {
  assert.equal((await api('POST', '/api/upload', { json: { a: 1 } })).status, 415);
});

// --- download / preview / thumbnails ---

let png;
test('download sends an attachment with a UTF-8 filename', async () => {
  const file = (await list('Photos')).find((e) => e.name === 'résumé ✓.txt');
  const res = await api('GET', `/api/files/${file.id}/download`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'unicode name');
  assert.equal(
    res.headers.get('content-disposition'),
    `attachment; filename="r_sum_ _.txt"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%E2%9C%93.txt`,
  );
});

test('raw serves images inline with range support', async () => {
  const buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a7' } }).png().toBuffer();
  png = (await (await upload('Photos/2024', [['pic.png', buf, 'image/png']])).json()).files[0];
  let res = await api('GET', `/api/files/${png.id}/raw`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('content-disposition'), /^inline;/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await res.arrayBuffer()).length, buf.length);

  res = await api('GET', `/api/files/${png.id}/raw`, { headers: { range: 'bytes=0-9' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 10);
});

test('scriptable types are sandboxed and unknown types force a download', async () => {
  const { files } = await (
    await upload('', [
      ['page.html', '<script>alert(1)</script>', 'text/html'],
      ['blob.bin', 'data', 'application/octet-stream'],
      ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
    ])
  ).json();
  const byName = Object.fromEntries(files.map((f) => [f.name, f]));

  let res = await api('GET', `/api/files/${byName['page.html'].id}/raw`);
  assert.match(res.headers.get('content-security-policy'), /^sandbox/);
  res = await api('GET', `/api/files/${byName['logo.svg'].id}/raw`);
  assert.match(res.headers.get('content-security-policy'), /^sandbox/);
  res = await api('GET', `/api/files/${byName['blob.bin'].id}/raw`);
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
});

test('thumbnails are generated as small WebP images', async () => {
  const res = await api('GET', `/api/files/${png.id}/thumb`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 400);
  assert.ok(fs.existsSync(path.join(config.thumbDir, `${png.id}.webp`)));

  const txt = (await list('Photos')).find((e) => e.name === 'a.txt');
  assert.equal((await api('GET', `/api/files/${txt.id}/thumb`)).status, 404);
  assert.equal((await api('GET', '/api/files/999999/raw')).status, 404);
  const folder = (await list()).find((e) => e.isDir);
  assert.equal((await api('GET', `/api/files/${folder.id}/raw`)).status, 404);
});

test('previews are screen-sized WebP images that never upscale', async () => {
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#a53' } }).jpeg().toBuffer();
  const jpg = (await (await upload('Photos/2024', [['big.jpg', big, 'image/jpeg']])).json()).files[0];
  let res = await api('GET', `/api/files/${jpg.id}/preview`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  let meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 1600, 1067]);
  assert.ok(fs.existsSync(path.join(config.thumbDir, `${jpg.id}-preview.webp`)));

  res = await api('GET', `/api/files/${png.id}/preview`); // 800x600 stays 800x600
  meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.deepEqual([meta.width, meta.height], [800, 600]);

  const txt = (await list('Photos')).find((e) => e.name === 'a.txt');
  assert.equal((await api('GET', `/api/files/${txt.id}/preview`)).status, 404);
  assert.equal((await api('GET', '/api/files/999999/preview')).status, 404);
});

test('HEIC photos sharp cannot decode go through the HEIF decoder', async () => {
  const heic = (await (await upload('Photos', [['iphone.heic', 'HEVC bytes sharp cannot read', 'image/heic']])).json()).files[0];
  let res = await api('GET', `/api/files/${heic.id}/preview`);
  assert.equal(res.status, 200);
  let meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 900, 1200]);
  res = await api('GET', `/api/files/${heic.id}/thumb`);
  meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.deepEqual([meta.width, meta.height], [400, 400]);
  assert.deepEqual(fs.readdirSync(config.thumbDir).filter((f) => f.endsWith('.tmp') || f.endsWith('.jpg')), []);
});

test('the viewer uses previews only for large or non-browser image formats', () => {
  const MB = 1024 * 1024;
  assert.equal(wantsPreview({ mime: 'image/jpeg', size: 5 * MB }), true);
  assert.equal(wantsPreview({ mime: 'image/jpeg', size: 300 * 1024 }), false);
  assert.equal(wantsPreview({ mime: 'image/heic', size: 300 * 1024 }), true);
  assert.equal(wantsPreview({ mime: 'image/gif', size: 5 * MB }), false);
  assert.equal(wantsPreview({ mime: 'image/svg+xml', size: 5 * MB }), false);
  assert.equal(wantsPreview({ mime: 'text/plain', size: 5 * MB }), false);
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('videos get an adaptive streaming version in two qualities', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const src = path.join(tmp, 'clip.mp4');
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=60:duration=3', '-f', 'lavfi', '-i', 'sine=duration=3'],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '150k', '-c:a', 'aac', '-shortest', src],
  ]);
  const video = (await (await upload('Photos', [['clip.mp4', fs.readFileSync(src), 'video/mp4']])).json()).files[0];

  let res;
  for (let i = 0; i < 240; i++) {
    res = await api('GET', `/api/files/${video.id}/stream/master.m3u8`);
    if (res.status === 200) break;
    assert.deepEqual([res.status, (await res.json()).status], [404, 'processing']);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.apple.mpegurl');
  const master = await res.text();
  assert.match(master, /RESOLUTION=854x480[^\n]*\nlow\/index\.m3u8/);
  assert.match(master, /RESOLUTION=1280x720[^\n]*\nhigh\/index\.m3u8/);

  const playlist = await (await api('GET', `/api/files/${video.id}/stream/high/index.m3u8`)).text();
  const segment = /seg_\d+\.ts/.exec(playlist)[0];
  res = await api('GET', `/api/files/${video.id}/stream/high/${segment}`);
  assert.deepEqual([res.status, res.headers.get('content-type')], [200, 'video/mp2t']);
  const frames = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,r_frame_rate', '-of', 'json', '-'], {
      input: Buffer.from(await res.arrayBuffer()),
    }),
  ).streams;
  assert.deepEqual(frames.map((s) => s.codec_name).sort(), ['aac', 'h264']);
  assert.equal(frames.find((s) => s.codec_name === 'h264').r_frame_rate, '30/1'); // 60 fps capped at 30

  for (const rel of ['secret.txt', 'high/..%2F..%2Fcloud-drive.db', 'low/index.m3u8.bak']) {
    assert.equal((await api('GET', `/api/files/${video.id}/stream/${rel}`)).status, 404, rel);
  }
  const txt = (await list('Photos')).find((e) => e.name === 'a.txt');
  res = await api('GET', `/api/files/${txt.id}/stream/master.m3u8`);
  assert.deepEqual([res.status, (await res.json()).status], [404, 'unavailable']);

  assert.equal((await api('DELETE', `/api/entries/${video.id}`)).status, 200);
  assert.ok(!fs.existsSync(path.join(config.streamDir, String(video.id))));
});

test('streaming qualities follow the short side, so portrait videos match landscape ones', () => {
  const sides = (w, h) => planRenditions({ width: w, height: h }).map((r) => r.shortSide);
  assert.deepEqual(sides(3840, 2160), [480, 1080]);
  assert.deepEqual(sides(1080, 1920), [480, 1080]);
  assert.deepEqual(sides(1280, 720), [480, 720]);
  assert.deepEqual(sides(640, 360), [360]);
});

// --- search / listing ---

test('search finds files in any folder, case-insensitively', async () => {
  let { entries } = await (await api('GET', '/api/search?q=PIC')).json();
  assert.deepEqual(entries.map((e) => e.path), ['Photos/2024/pic.png']);
  ({ entries } = await (await api('GET', '/api/search?q=%25')).json()); // LIKE wildcards are escaped
  assert.deepEqual(entries, []);
  ({ entries } = await (await api('GET', '/api/search?q=')).json());
  assert.deepEqual(entries, []);
});

test('listings put folders first, then newest files first', async () => {
  const entries = await list('Photos');
  assert.equal(entries[0].name, '2024');
  const files = entries.filter((e) => !e.isDir);
  const times = files.map((e) => e.createdAt);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

// --- storage / rescan ---

test('storage reports usage and device disk space', async () => {
  const s = await (await api('GET', '/api/storage')).json();
  assert.ok(s.usedBytes > 0);
  assert.ok(s.fileCount >= 8);
  assert.ok(s.diskTotalBytes > s.diskFreeBytes && s.diskFreeBytes > 0);
  assert.equal(s.maxUploadBytes, 1024 * 1024);
});

test('rescan picks up files added or removed outside the app', async () => {
  fs.writeFileSync(path.join(config.storageDir, 'Photos', 'from-termux.txt'), 'added by hand');
  fs.rmSync(path.join(config.storageDir, 'Photos', 'a (2).txt'));
  const result = await (await api('POST', '/api/rescan')).json();
  assert.deepEqual(result, { added: 1, updated: 0, removed: 1 });
  const names = (await list('Photos')).map((e) => e.name);
  assert.ok(names.includes('from-termux.txt'));
  assert.ok(!names.includes('a (2).txt'));
  assert.deepEqual(await (await api('POST', '/api/rescan')).json(), { added: 0, updated: 0, removed: 0 });
});

test('background generation fills in missing thumbnails and previews once', async () => {
  // TIFF always gets a preview (browsers can't show it), even when small.
  const tiff = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#357' } }).tiff().toBuffer();
  fs.writeFileSync(path.join(config.storageDir, 'scan.tiff'), tiff);
  await api('POST', '/api/rescan');
  const row = ctx.repo.images().find((r) => r.name === 'scan.tiff');
  assert.ok(row);
  const thumb = path.join(config.thumbDir, `${row.id}.webp`);
  const preview = path.join(config.thumbDir, `${row.id}-preview.webp`);
  assert.ok(!fs.existsSync(thumb) && !fs.existsSync(preview));

  const skipped = await ctx.thumbs.backfill([row], () => false); // deleted/replaced meanwhile
  assert.equal(skipped, 0);
  assert.ok(!fs.existsSync(thumb));

  const made = await ctx.thumbs.backfill(ctx.repo.images());
  assert.ok(made >= 2);
  assert.ok(fs.existsSync(thumb) && fs.existsSync(preview));
  assert.equal(await ctx.thumbs.backfill(ctx.repo.images()), 0); // nothing left to do
});

// --- delete ---

test('deleting a folder removes everything beneath it', async () => {
  const photos = (await list()).find((e) => e.name === 'Photos');
  const res = await api('DELETE', `/api/entries/${photos.id}`);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).deleted >= 7);
  assert.ok(!onDisk('Photos'));
  assert.ok(!(await list()).some((e) => e.name === 'Photos'));
  assert.deepEqual((await (await api('GET', '/api/search?q=pic')).json()).entries, []);
  assert.ok(!fs.existsSync(path.join(config.thumbDir, `${png.id}.webp`)));
  assert.ok(!fs.existsSync(path.join(config.thumbDir, `${png.id}-preview.webp`)));
  assert.equal((await api('DELETE', `/api/entries/${photos.id}`)).status, 404);
});

test('deleting a single file', async () => {
  const blob = (await list()).find((e) => e.name === 'blob.bin');
  assert.equal((await api('DELETE', `/api/entries/${blob.id}`)).status, 200);
  assert.ok(!onDisk('blob.bin'));
});

test('unknown API routes return a JSON 404', async () => {
  const res = await api('GET', '/api/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

// --- session end + throttling (last: they sign us out) ---

test('logout invalidates the session', async () => {
  assert.equal((await api('POST', '/api/auth/logout')).status, 204);
  assert.equal((await api('GET', '/api/list')).status, 401);
});

test('repeated failed logins are throttled', async () => {
  for (let i = 0; i < 3; i++) {
    assert.equal((await api('POST', '/api/auth/login', { json: { password: 'bad' } })).status, 401);
  }
  const res = await api('POST', '/api/auth/login', { json: { password: PASSWORD } });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('signed out, unknown API routes are 401 and the SPA placeholder is served', async () => {
  assert.equal((await api('GET', '/api/nope')).status, 401);
  const res = await fetch(`${base}/`);
  assert.match(await res.text(), /Frontend not built/);
});
