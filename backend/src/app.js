import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { requireAuth } from './auth.js';
import { accountDeletionPageHtml } from './deletion-page.js';
import { privacyPolicyPageHtml } from './privacy-page.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { fileRoutes } from './routes/files.js';

// Defense in depth for the web app: only same-origin code runs. ('wasm-unsafe-eval' is for pdf.js's
// image decoders; inline styles are React `style` props; googleusercontent.com serves profile photos.)
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function createApp(ctx) {
  const { config } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });

  // --- API ---
  // Public health check for uptime monitors, the container's HEALTHCHECK and the deploy script's
  // post-restart gate. It says only whether the database answers and storage has room, nothing
  // about the files or users.
  app.get('/api/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let problem = null;
    try {
      ctx.db.prepare('SELECT 1').get();
    } catch {
      problem = 'database';
    }
    if (!problem) {
      const disk = await fsp.statfs(config.storageDir).catch(() => null);
      if (!disk || disk.bavail * disk.bsize < config.minFreeBytes) problem = 'storage';
    }
    if (problem) res.status(503).json({ status: 'error', problem });
    else res.json({ status: 'ok' });
  });

  // Chunks of a file upload (PUT /api/uploads/:id) are raw bytes even when the file itself is JSON.
  app.use('/api', express.json({ limit: '32kb', type: (req) => req.method !== 'PUT' && Boolean(req.is('application/json')) }));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/admin', requireAuth(ctx), adminRoutes(ctx));
  app.use('/api', requireAuth(ctx), deviceRoutes(ctx), fileRoutes(ctx));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Public account-deletion instructions, linked from the Google Play Console.
  app.get('/delete-account', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(accountDeletionPageHtml({ ownerEmail: config.ownerEmail }));
  });

  // Public privacy policy. Google Play requires a reachable URL for it, and the app links here.
  app.get('/privacy', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(
      privacyPolicyPageHtml({ ownerEmail: config.ownerEmail, activityRetentionDays: config.activityRetentionDays }),
    );
  });

  // --- Built frontend (single-page app) ---
  const indexHtml = path.join(config.frontendDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.frontendDist, {
        index: false,
        setHeaders(res, file) {
          const hashed = file.includes(`${path.sep}assets${path.sep}`);
          res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    app.get('/{*splat}', (req, res) =>
      res.sendFile(indexHtml, { headers: { 'Cache-Control': 'no-cache', 'Content-Security-Policy': APP_CSP } }),
    );
  } else {
    app.get('/', (req, res) =>
      res.type('text').send('Frontend not built yet. Run `npm run build` in the project root, then restart.'),
    );
  }

  // --- Errors ---
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.code === 'ENOENT') [status, message] = [404, 'Not found'];
    if (err.code === 'ENOSPC') [status, message] = [507, 'Device storage is full'];
    if (status >= 500 && status !== 507) {
      console.error(err);
      message = 'Internal server error';
    }
    res.status(status).json({ error: message });
  });

  return app;
}
