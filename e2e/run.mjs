// End-to-end UI test: starts the real server (throwaway data dir, random port) with the built
// frontend, then drives it in headless Chromium at phone and desktop sizes.
// Screenshots go to e2e/screenshots/. Usage: see README → "Browser tests".
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { hashPassword } from '../backend/src/auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'screenshots');
const PASSWORD = 'e2e-test-password';
const sharp = createRequire(path.join(ROOT, 'backend/package.json'))('sharp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(message);
  process.exit(1);
}

const CHROME =
  process.env.CHROME_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
if (!CHROME) fail('No Chromium found. Install it (`apt install chromium`) or set CHROME_PATH.');
if (!fs.existsSync(path.join(ROOT, 'frontend/dist/index.html'))) fail('Frontend not built. Run `npm run build` first.');

// ---------- watchdog: if a step stalls for 60s, say which one and tear everything down ----------
const problems = [];
const killers = [];
let currentStep = '';
let watchdog;
const memAvailableMb = () => {
  try {
    return Math.round(Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024);
  } catch {
    return '?';
  }
};
const step = (msg) => {
  currentStep = msg;
  console.log(`• ${msg}  (free memory: ${memAvailableMb()} MB)`);
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    console.log(`\nHUNG for 60s at: ${currentStep}`);
    for (const kill of killers) kill();
    process.exit(2);
  }, 60_000);
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(`Expectation failed: ${msg}`);
};

// ---------- fixtures ----------
const TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'cloud-drive-e2e-'));
const DATA = path.join(TMP, 'data');
const FIX = path.join(TMP, 'fixtures');
await fsp.rm(SHOTS, { recursive: true, force: true });
await Promise.all([fsp.mkdir(FIX, { recursive: true }), fsp.mkdir(SHOTS, { recursive: true })]);
const F = (name) => path.join(FIX, name);

async function photo(file, { w, h, c1, c2, label, orientation }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.72}" cy="${h * 0.28}" r="${Math.min(w, h) * 0.13}" fill="rgba(255,255,255,0.6)"/>
    <text x="50%" y="82%" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${Math.round(Math.min(w, h) / 9)}" fill="#fff" text-anchor="middle">${label}</text>
  </svg>`;
  let img = sharp(Buffer.from(svg));
  if (orientation) img = img.rotate(270).withMetadata({ orientation }); // stored sideways + EXIF "rotate 90° CW"
  img = file.endsWith('.png') ? img.png() : img.jpeg({ quality: 85 });
  await img.toFile(file);
}

function makePdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const fontId = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    const s = `BT /F1 40 Tf 72 720 Td (${text}) Tj ET 0.15 0.39 0.92 rg 72 400 451 200 re f`;
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return `${out}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

await photo(F('beach.jpg'), { w: 1600, h: 1200, c1: '#38bdf8', c2: '#0f766e', label: 'Beach' });
await photo(F('portrait.jpg'), { w: 1200, h: 1600, c1: '#f472b6', c2: '#7c3aed', label: 'Upright', orientation: 6 });
await photo(F('sunset.png'), { w: 1200, h: 900, c1: '#fb923c', c2: '#be123c', label: 'Sunset' });
await fsp.writeFile(F('report.pdf'), makePdf(['Page one', 'Page two']));
await fsp.writeFile(F('notes.txt'), 'Shopping list\n- milk\n- eggs\n\nThis file is previewed as text.\n');
await fsp.writeFile(F('archive.zip'), Buffer.alloc(300_000, 7));
const uploads = ['beach.jpg', 'portrait.jpg', 'sunset.png', 'report.pdf', 'notes.txt', 'archive.zip'].map(F);

// ---------- server (explicit env always wins over backend/.env, so real data is never touched) ----------
const PORT = await new Promise((resolve, reject) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
  probe.on('error', reject);
});
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- stand-in for Google: a sign-in page that signs in `nextGoogleAccount`, and a token endpoint ----------
const OWNER = 'owner@example.com';
const FRIEND = 'friend@example.com';
const CLIENT_ID = 'e2e-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'e2e-secret';
let nextGoogleAccount = null;
const googleCodes = new Map();
const fakeGoogle = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://google.test');
  if (url.pathname === '/auth') {
    const code = crypto.randomUUID();
    googleCodes.set(code, {
      ...nextGoogleAccount,
      nonce: url.searchParams.get('nonce'),
      challenge: url.searchParams.get('code_challenge'),
      redirectUri: url.searchParams.get('redirect_uri'),
    });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.search = new URLSearchParams({ code, state: url.searchParams.get('state') }).toString();
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    const grant = googleCodes.get(form.get('code'));
    googleCodes.delete(form.get('code'));
    const pkceOk = grant && crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === grant.challenge;
    if (!pkceOk || form.get('client_secret') !== CLIENT_SECRET || form.get('redirect_uri') !== grant.redirectUri) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end('{"error":"invalid_grant"}');
    }
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const claims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: grant.nonce,
      sub: `google-${grant.email}`,
      email: grant.email,
      email_verified: true,
      name: grant.name,
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.signature` }));
  }
  res.writeHead(404);
  res.end();
});
fakeGoogle.listen(0, '127.0.0.1');
await once(fakeGoogle, 'listening');
const GOOGLE = `http://127.0.0.1:${fakeGoogle.address().port}`;
killers.push(() => fakeGoogle.close());

let serverLog = '';
const server = spawn(process.execPath, [path.join(ROOT, 'backend/src/server.js')], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(PORT),
    DATA_DIR: DATA,
    STORAGE_DIR: path.join(DATA, 'files'),
    FRONTEND_DIST: path.join(ROOT, 'frontend/dist'),
    PASSWORD_HASH: hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 }),
    MAX_UPLOAD_MB: '100',
    LOGIN_MAX_ATTEMPTS: '10',
    OWNER_EMAIL: OWNER,
    PUBLIC_ORIGINS: BASE,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_AUTH_URL: `${GOOGLE}/auth`,
    GOOGLE_TOKEN_URL: `${GOOGLE}/token`,
  },
});
killers.push(() => server.kill());
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; ; i++) {
  try {
    await fetch(`${BASE}/api/auth/me`);
    break;
  } catch {
    if (i > 50) {
      server.kill();
      fail(`Server did not start:\n${serverLog}`);
    }
    await sleep(200);
  }
}

// ---------- helpers ----------
// captureBeyondViewport (puppeteer's default) briefly resizes the page and can hang under phone emulation.
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: false });
const item = (name) => `[role=button][aria-label="${name}"]`;
const dialogs = (page) => page.$$eval('[role=dialog]', (ds) => ds.map((d) => d.getAttribute('aria-label')));
const waitText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const waitThumbs = (page, n) =>
  page.waitForFunction(
    (n) => [...document.querySelectorAll('img[src*="/thumb"]')].filter((i) => i.complete && i.naturalWidth > 0).length >= n,
    { timeout: 20000 },
    n,
  );

// Clicks the last visible element (top-most dialog wins) whose text contains `text`.
async function clickText(page, text, selector = 'button, a, [role=menuitem]') {
  await page.waitForFunction(
    (t, sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length && el.innerText.trim().includes(t)),
    { timeout: 10000 },
    text,
    selector,
  );
  await page.evaluate(
    (t, sel) =>
      [...document.querySelectorAll(sel)]
        .reverse()
        .find((el) => el.getClientRects().length && el.innerText.trim().includes(t))
        .click(),
    text,
    selector,
  );
}

// --- E2E_DEBUG=1 diagnostics: which input events reach the page, and is it still drawing frames? ---
async function recordInput(page) {
  await page.evaluate(() => {
    window.__events = [];
    for (const type of ['touchstart', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'pointercancel', 'click', 'contextmenu']) {
      window.addEventListener(type, (e) => window.__events.push(`${type}→${e.target?.getAttribute?.('aria-label') ?? e.target?.tagName}`), true);
    }
  });
}
function probe(page) {
  return Promise.race([
    page.evaluate(async () => ({
      visibility: document.visibilityState,
      frames: await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
        setTimeout(() => resolve(false), 1000);
      }),
      scrollLock: document.documentElement.style.overflow || 'none',
      dialogs: [...document.querySelectorAll('[role=dialog]')].map((d) => d.getAttribute('aria-label')),
      events: (window.__events ?? []).slice(-6),
    })),
    sleep(5000).then(() => 'NOT RESPONDING'),
  ]);
}

// Center the target, then tap a spot on it that nothing (sticky header, upload panel, the +
// button) is covering — the way a person taps the visible part of a card.
async function tapCentered(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const point = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.25], [0.25, 0.25], [0.25, 0.5], [0.5, 0.1], [0.1, 0.1]]) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      if (el.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  });
  if (!point) throw new Error(`${selector} is completely covered by something else`);
  // Human pacing: Chrome treats a tap that arrives while the previous gesture (a swipe, the
  // back navigation) is still settling as "stop the motion", not as a click. A person never taps
  // that fast; the test did, so the preview sometimes didn't open.
  await sleep(600);
  if (process.env.E2E_DEBUG) {
    console.log(`    tap ${selector} at ${Math.round(point.x)},${Math.round(point.y)}`);
    console.log(`      before: ${JSON.stringify(await probe(page))}`);
  }
  if (page.viewport()?.hasTouch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  if (process.env.E2E_DEBUG) {
    await sleep(500);
    console.log(`      after:  ${JSON.stringify(await probe(page))}`);
  }
}

function watch(page, label) {
  page.on('console', (m) => {
    // 401s are expected: the deliberate wrong-password attempt and the post-sign-out check.
    if (m.type() === 'error' && !m.text().includes('status of 401')) problems.push(`[${label} console] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${label} pageerror] ${e.message}`));
  // The tab's renderer died (e.g. killed for memory): say so right away instead of timing out blind.
  page.on('error', (e) => {
    console.log(`!! [${label}] page crashed: ${e.message} (free memory: ${memAvailableMb()} MB)`);
    problems.push(`[${label} crash] ${e.message}`);
  });
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText;
    if (why !== 'net::ERR_ABORTED') problems.push(`[${label} requestfailed] ${r.url()} ${why}`);
  });
}

const PHONE = {
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
};
// Same phone-sized layout, driven by mouse. After many emulated touch gestures headless Chrome can
// stop turning taps into clicks on a tab, so only the owner's phone session exercises touch.
const PHONE_SIZED = {
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  userAgent: PHONE.userAgent,
};
const hasDialogButton = (page, text) =>
  page.evaluate((t) => [...document.querySelectorAll('[role=dialog] button')].some((b) => b.innerText.includes(t)), text);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
killers.push(() => browser.process()?.kill('SIGKILL'));

try {
  // ================= PHONE =================
  const page = await browser.newPage();
  watch(page, 'phone');
  await page.emulate(PHONE);

  step('login page: Google first, owner password as backup (wrong, then right)');
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  if (process.env.E2E_DEBUG) await recordInput(page);
  await waitText(page, 'Continue with Google');
  await shot(page, '01-login');
  await clickText(page, 'Owner? Use your password');
  await page.waitForSelector('#password');
  await page.type('#password', 'not-the-password');
  await page.keyboard.press('Enter');
  await waitText(page, 'Wrong password');
  await page.type('#password', PASSWORD);
  await page.keyboard.press('Enter');
  await waitText(page, 'This folder is empty');
  await sleep(300);
  await shot(page, '02-empty');

  step('upload 6 files via the picker');
  await (await page.$('input[type=file]')).uploadFile(...uploads);
  await page.waitForFunction(() => /6 uploads complete/.test(document.body.innerText), { timeout: 30000 });
  await waitThumbs(page, 3);
  await sleep(300);
  await shot(page, '03-uploaded');
  expect((await page.$$('[role=button][aria-label]')).length === 6, 'six items in grid');

  step('FAB → new folder, open it, upload into it, back button');
  await page.tap('button[aria-label="Upload or create"]');
  await clickText(page, 'New folder');
  await page.waitForSelector('input[aria-label="Folder name"]');
  await page.type('input[aria-label="Folder name"]', 'Holiday 2026');
  await shot(page, '04-new-folder');
  await page.keyboard.press('Enter');
  await page.waitForSelector(item('Holiday 2026'));
  await tapCentered(page, item('Holiday 2026'));
  await page.waitForFunction(() => location.search === '?p=Holiday%202026');
  await waitText(page, 'This folder is empty');
  await (await page.$('input[type=file]')).uploadFile(F('beach.jpg'));
  await page.waitForSelector(item('beach.jpg'));
  await waitThumbs(page, 1);
  await sleep(300);
  await shot(page, '05-in-folder');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.search === '');
  await page.waitForSelector(item('Holiday 2026'));
  await waitText(page, '1 item');

  step('image preview: keyboard navigation, back button closes');
  // Dismiss the finished-uploads panel first, as a person would, so it can't cover the photo.
  const dismissUploads = await page.$('button[aria-label="Dismiss uploads"]');
  if (dismissUploads) await dismissUploads.tap();
  await tapCentered(page, item('portrait.jpg'));
  await page.waitForFunction(() => {
    const img = document.querySelector('[role=dialog] img[alt="portrait.jpg"]');
    return img && img.complete && img.naturalWidth > 0;
  });
  const dims = await page.$eval('[role=dialog] img', (i) => [i.naturalWidth, i.naturalHeight]);
  expect(dims[1] > dims[0], `EXIF-rotated photo displays upright (got ${dims})`);
  await sleep(300);
  await shot(page, '06-preview-photo');
  const before = (await dialogs(page))[0];
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((b) => document.querySelector('[role=dialog]')?.getAttribute('aria-label') !== b, {}, before);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction((b) => document.querySelector('[role=dialog]')?.getAttribute('aria-label') === b, {}, before);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));

  step('PDF preview renders pages with pdf.js');
  await tapCentered(page, item('report.pdf'));
  // Poll with a bounded evaluate, so a stuck page reports as "not responding" instead of a silent timeout.
  let pdfState = null;
  for (let i = 0; i < 10 && !(pdfState?.canvases > 0); i++) {
    await sleep(2000);
    pdfState = await Promise.race([
      page.evaluate(async (debug) => {
        const dialog = document.querySelector('[role=dialog]');
        const state = {
          dialog: dialog?.getAttribute('aria-label') ?? null,
          canvases: document.querySelectorAll('[role=dialog] canvas').length,
          fallback: Boolean(dialog?.innerText.includes('couldn’t be displayed')),
        };
        if (debug) {
          state.events = window.__events;
          state.visibility = document.visibilityState;
          state.scrollLock = document.documentElement.style.overflow || 'none';
          // Is the browser still producing frames? (requestAnimationFrame stops if not)
          state.framesRunning = await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
            setTimeout(() => resolve(false), 1000);
          });
        }
        return state;
      }, Boolean(process.env.E2E_DEBUG)),
      sleep(8000).then(() => null),
    ]);
    console.log(`    pdf check ${i + 1}: ${pdfState ? JSON.stringify(pdfState) : 'PAGE NOT RESPONDING'}`);
    if (!pdfState) break;
  }
  expect(pdfState?.canvases > 0, `PDF preview rendered (last state: ${JSON.stringify(pdfState)})`);
  await sleep(1000);
  const ink = await page.$eval('[role=dialog] canvas', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 128) dark++;
    return dark;
  });
  expect(ink > 100, `PDF canvas has rendered content (dark samples: ${ink})`);
  await shot(page, '07-preview-pdf');
  await page.tap('button[aria-label="Close preview"]');
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));

  step('text preview');
  await tapCentered(page, item('notes.txt'));
  await waitText(page, 'Shopping list');
  await shot(page, '08-preview-text');
  await page.tap('button[aria-label="Close preview"]');
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));

  step('long-press → action sheet → delete with confirmation');
  await page.$eval(item('archive.zip'), (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const box = await (await page.$(item('archive.zip'))).boundingBox();
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 3);
  await sleep(700); // longer than our 450ms threshold, shorter than the browser's own long-press
  await page.touchscreen.touchEnd();
  await page.waitForSelector('[role=dialog][aria-label="archive.zip"]');
  await sleep(250);
  expect((await dialogs(page)).length === 1, `only the action sheet opened (dialogs: ${await dialogs(page)})`);
  await shot(page, '09-action-sheet');
  await clickText(page, 'Delete', '[role=dialog] button');
  await waitText(page, 'Delete file?');
  await sleep(250);
  await shot(page, '10-confirm-delete');
  await clickText(page, 'Delete', '[role=dialog] button');
  await waitText(page, 'Deleted');
  await page.waitForFunction((s) => !document.querySelector(s), {}, item('archive.zip'));
  expect(!fs.existsSync(path.join(DATA, 'files/archive.zip')), 'archive.zip removed from disk');

  step('search across folders');
  await page.type('input[type=search]', 'beach');
  await page.waitForFunction(() => /2 results for/.test(document.body.innerText), { timeout: 10000 });
  await waitText(page, 'Holiday 2026 ·');
  await waitThumbs(page, 2);
  await shot(page, '11-search');
  await page.tap('button[aria-label="Clear search"]');
  await page.waitForSelector(item('Holiday 2026'));

  step('list view + dark mode');
  await page.tap('button[aria-label="List view"]');
  await waitThumbs(page, 3);
  await shot(page, '12-list');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await sleep(200);
  await shot(page, '13-list-dark');
  await page.tap('button[aria-label="Grid view"]');
  await waitThumbs(page, 3);
  await shot(page, '14-grid-dark');
  await page.tap('button[aria-label="Upload or create"]');
  await sleep(300);
  await shot(page, '15-fab-open-dark');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // Last on this page on purpose: after a real touch swipe, headless Chrome keeps treating the
  // page's next taps as "stop the gesture" instead of clicks (screenshots of the tab stall too).
  step('swipe between photos without triggering the browser’s back gesture');
  await page.tap('button[aria-label="Close menu"]'); // the + menu left open by the previous step
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Close menu"]'));
  await tapCentered(page, item('portrait.jpg'));
  await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth > 0);
  const firstPhoto = (await dialogs(page))[0];
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((b) => document.querySelector('[role=dialog]')?.getAttribute('aria-label') !== b, {}, firstPhoto);
  const secondPhoto = (await dialogs(page))[0];
  await page.touchscreen.touchStart(80, 450);
  await page.touchscreen.touchMove(200, 452);
  await page.touchscreen.touchMove(330, 455);
  await page.touchscreen.touchEnd();
  await page.waitForFunction(
    (b) => {
      const label = document.querySelector('[role=dialog]')?.getAttribute('aria-label');
      return label && label !== b;
    },
    { timeout: 5000 },
    secondPhoto,
  );
  const afterSwipe = (await dialogs(page))[0];
  expect(afterSwipe === firstPhoto, `swiping right returns to the previous photo (${firstPhoto} → ${secondPhoto} → ${afterSwipe})`);
  expect((await page.evaluate(() => history.state?.preview)) === true, 'the swipe did not trigger browser back-navigation');

  // ================= DESKTOP =================
  const desk = await browser.newPage();
  watch(desk, 'desktop');
  await desk.setViewport({ width: 1366, height: 860 });
  await desk.goto(BASE, { waitUntil: 'networkidle0' });
  await waitThumbs(desk, 3);
  await shot(desk, '16-desktop-grid');

  step('desktop drag-and-drop upload');
  await desk.evaluate(() => {
    window.__dt = new DataTransfer();
    window.__dt.items.add(new File(['dropped via drag and drop'], 'dropped.txt', { type: 'text/plain' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: window.__dt, cancelable: true }));
  });
  await waitText(desk, 'Drop to upload');
  await shot(desk, '17-desktop-dragging');
  await desk.evaluate(() => window.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, cancelable: true })));
  await desk.waitForSelector(item('dropped.txt'));
  await waitText(desk, 'upload complete');
  await shot(desk, '18-desktop-dropped');

  step('desktop right-click → actions, Escape closes');
  await desk.click(item('dropped.txt'), { button: 'right' });
  await desk.waitForSelector('[role=dialog][aria-label="dropped.txt"]');
  await sleep(250);
  await shot(desk, '19-desktop-actions');
  await desk.keyboard.press('Escape');
  await desk.waitForFunction(() => !document.querySelector('[role=dialog]'));

  step('desktop list view + photo preview');
  await desk.click('button[aria-label="List view"]');
  await shot(desk, '20-desktop-list');
  await desk.click(item('sunset.png'));
  await desk.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth > 0);
  await sleep(300);
  await shot(desk, '21-desktop-preview');
  await desk.keyboard.press('Escape');

  // ================= SHARING =================
  step('owner shares "Holiday 2026" with a friend as a contributor');
  await desk.bringToFront();
  await desk.click(item('Holiday 2026'), { button: 'right' });
  await desk.waitForSelector('[role=dialog][aria-label="Holiday 2026"]');
  await clickText(desk, 'Share', '[role=dialog] button');
  await desk.waitForSelector('input[aria-label="Email address"]');
  await desk.type('input[aria-label="Email address"]', FRIEND);
  await clickText(desk, 'Share', '[role=dialog] form button[type=submit]');
  await waitText(desk, 'Hasn’t signed in yet');
  expect(await desk.$eval('[role=dialog] ul select', (s) => s.value) === 'contributor', 'friend was added as a contributor');
  await sleep(250);
  await shot(desk, '22-share-dialog');
  await clickText(desk, 'Done', '[role=dialog] button');
  await desk.waitForSelector('[aria-label="Shared with 1 person"]');
  const ownersRootFile = (await desk.evaluate(() => fetch('/api/list?path=').then((r) => r.json()))).entries.find((e) => !e.isDir);

  step('the friend signs in with Google and sees only "Shared with me"');
  const friendContext = await browser.createBrowserContext(); // a separate, private browser session
  const fp = await friendContext.newPage();
  watch(fp, 'friend');
  await fp.bringToFront(); // only the front tab gets keyboard input and animation frames
  await fp.emulate(PHONE_SIZED);
  nextGoogleAccount = { email: FRIEND, name: 'Friend' };
  await fp.goto(BASE, { waitUntil: 'networkidle0' });
  await clickText(fp, 'Continue with Google');
  await fp.waitForSelector(item('Holiday 2026'), { timeout: 20000 });
  await waitText(fp, 'Shared with me');
  expect((await fp.$$('[role=button][aria-label]')).length === 1, 'the friend sees just the shared folder');
  expect(!(await fp.evaluate(() => document.body.innerText.includes('My Drive'))), 'no "My Drive" for friends');
  expect(!(await fp.$('button[aria-label="Upload or create"]')), 'no upload button on "Shared with me"');
  await sleep(300);
  await shot(fp, '23-friend-shared-with-me');

  step('the friend can add photos, but not delete the owner’s');
  await tapCentered(fp, item('Holiday 2026'));
  await fp.waitForSelector(item('beach.jpg'));
  await fp.waitForSelector('button[aria-label="Upload or create"]'); // contributors can upload
  await (await fp.$('input[type=file]')).uploadFile(F('sunset.png'));
  await fp.waitForSelector(item('sunset.png'));
  await waitThumbs(fp, 2);
  await fp.click('button[aria-label="Actions for beach.jpg"]');
  await fp.waitForSelector('[role=dialog][aria-label="beach.jpg"]');
  expect(!(await hasDialogButton(fp, 'Delete')), 'no Delete on the owner’s photo');
  await sleep(250);
  await shot(fp, '24-friend-owner-photo-actions');
  await fp.keyboard.press('Escape');
  await fp.waitForFunction(() => !document.querySelector('[role=dialog]'));
  await fp.click('button[aria-label="Actions for sunset.png"]');
  await fp.waitForSelector('[role=dialog][aria-label="sunset.png"]');
  expect(await hasDialogButton(fp, 'Delete'), 'Delete is offered on their own upload');
  await fp.keyboard.press('Escape');
  await fp.waitForFunction(() => !document.querySelector('[role=dialog]'));
  await sleep(300);
  await shot(fp, '25-friend-in-folder');
  const friendCookie = (await fp.cookies()).find((c) => c.name === 'cd_session');
  const peek = await fetch(`${BASE}/api/files/${ownersRootFile.id}/raw`, { headers: { cookie: `cd_session=${friendCookie.value}` } });
  expect(peek.status === 404, `the owner's private files stay invisible, even by id (got ${peek.status})`);

  step('someone who wasn’t invited gets a clear message');
  const strangerContext = await browser.createBrowserContext();
  const sp = await strangerContext.newPage();
  watch(sp, 'stranger');
  await sp.bringToFront();
  await sp.emulate(PHONE_SIZED);
  nextGoogleAccount = { email: 'stranger@example.com', name: 'Stranger' };
  await sp.goto(BASE, { waitUntil: 'networkidle0' });
  await clickText(sp, 'Continue with Google');
  await waitText(sp, 'doesn’t have access', 20000);
  expect(!(await sp.evaluate(() => location.search.includes('login_error'))), 'error code is tidied out of the URL');
  await shot(sp, '26-not-invited');

  step('owner reviews People & access and Activity');
  await desk.bringToFront();
  await desk.click('button[aria-label="Account and options"]');
  await clickText(desk, 'People & access');
  await desk.waitForFunction(
    (email) => {
      const text = document.querySelector('[role=dialog]')?.innerText ?? '';
      return text.includes(email) && text.includes('Holiday 2026') && text.includes('Contributor');
    },
    { timeout: 15000 },
    FRIEND,
  );
  await sleep(250);
  await shot(desk, '27-people');
  await clickText(desk, 'Done', '[role=dialog] button');
  await desk.click('button[aria-label="Account and options"]');
  await clickText(desk, 'Activity');
  await waitText(desk, 'uploaded Holiday 2026/sunset.png');
  await waitText(desk, 'stranger@example.com was refused sign-in');
  await sleep(250);
  await shot(desk, '28-activity');
  await clickText(desk, 'Done', '[role=dialog] button');

  step('sign out');
  await desk.click('button[aria-label="Account and options"]');
  await clickText(desk, 'Sign out');
  await waitText(desk, 'Continue with Google');
  const status = await desk.evaluate(() => fetch('/api/list').then((r) => r.status));
  expect(status === 401, `API rejects after sign-out (got ${status})`);

  console.log('\nALL STEPS PASSED');
} catch (err) {
  console.log(`\nFAILED at "${currentStep}": ${err.message}`);
  process.exitCode = 1;
  // Capture every open tab in every session, newest first (bounded, in case a tab is wedged).
  clearTimeout(watchdog);
  const tabs = [];
  for (const context of browser.browserContexts()) tabs.push(...(await context.pages()));
  for (const [i, p] of tabs.reverse().entries()) {
    const file = path.join(SHOTS, `zz-failure-${i}.png`);
    await Promise.race([
      p.bringToFront().then(() => p.screenshot({ path: file, captureBeyondViewport: false })),
      sleep(10_000).then(() => {
        throw new Error('timed out');
      }),
    ]).catch((e) => console.log(`(could not save ${path.basename(file)} of ${p.url()}: ${e.message})`));
  }
} finally {
  clearTimeout(watchdog);
  fakeGoogle.closeAllConnections();
  fakeGoogle.close();
  await browser.close();
  server.kill();
  await fsp.rm(TMP, { recursive: true, force: true });
  console.log(problems.length ? `\nConsole/network problems:\n${problems.join('\n')}` : '\nNo console errors, CSP violations or failed requests.');
  if (problems.length) process.exitCode = 1;
  if (process.exitCode) console.log(`\nServer log:\n${serverLog}`);
  console.log(`Screenshots: ${path.relative(process.cwd(), SHOTS) || SHOTS}/`);
}
