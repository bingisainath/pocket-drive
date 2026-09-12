// End-to-end UI test: starts the real server (throwaway data dir, random port) with the built
// frontend, then drives it in headless Chromium at phone and desktop sizes.
// Screenshots go to e2e/screenshots/. Usage: see README → "Browser tests".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
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
const step = (msg) => {
  currentStep = msg;
  console.log(`• ${msg}`);
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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
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

// Center first so the target isn't under the sticky header or the fixed upload panel / FAB.
async function tapCentered(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await page.tap(selector);
}

function watch(page, label) {
  page.on('console', (m) => {
    // 401s are expected: the deliberate wrong-password attempt and the post-sign-out check.
    if (m.type() === 'error' && !m.text().includes('status of 401')) problems.push(`[${label} console] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${label} pageerror] ${e.message}`));
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText;
    if (why !== 'net::ERR_ABORTED') problems.push(`[${label} requestfailed] ${r.url()} ${why}`);
  });
}

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
  await page.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
  });

  step('login page, wrong then right password');
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#password');
  await shot(page, '01-login');
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

  step('image preview: keyboard + swipe navigation, back button closes');
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
  const afterKey = (await dialogs(page))[0];
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
    afterKey,
  );
  const afterSwipe = (await dialogs(page))[0];
  expect(afterSwipe === before, `swiping right returns to the previous photo (${before} → ${afterKey} → ${afterSwipe})`);
  expect((await page.evaluate(() => history.state?.preview)) === true, 'swipe did not trigger browser back-navigation');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));

  step('PDF preview renders pages with pdf.js');
  await tapCentered(page, item('report.pdf'));
  await page.waitForFunction(() => document.querySelectorAll('[role=dialog] canvas').length >= 1, { timeout: 20000 });
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

  step('sign out');
  await desk.click('button[aria-label="More options"]');
  await clickText(desk, 'Sign out');
  await desk.waitForSelector('#password');
  const status = await desk.evaluate(() => fetch('/api/list').then((r) => r.status));
  expect(status === 401, `API rejects after sign-out (got ${status})`);

  console.log('\nALL STEPS PASSED');
} catch (err) {
  console.log(`\nFAILED at "${currentStep}": ${err.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await browser.close();
  server.kill();
  await fsp.rm(TMP, { recursive: true, force: true });
  console.log(problems.length ? `\nConsole/network problems:\n${problems.join('\n')}` : '\nNo console errors, CSP violations or failed requests.');
  if (problems.length) process.exitCode = 1;
  if (process.exitCode) console.log(`\nServer log:\n${serverLog}`);
  console.log(`Screenshots: ${path.relative(process.cwd(), SHOTS) || SHOTS}/`);
}
