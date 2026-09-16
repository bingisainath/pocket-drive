import { createApp } from './app.js';
import { buildConfig, loadEnvFile } from './config.js';
import { createContext } from './context.js';
import { formatBytes } from './uploads.js';

function fail(message) {
  console.error(message);
  process.exit(1);
}

loadEnvFile();
let config;
try {
  config = buildConfig();
} catch (err) {
  fail(`Invalid configuration: ${err.message}`);
}
if (!config.passwordHash) {
  fail('PASSWORD_HASH is not set.\nRun `npm run hash-password` from the project root, then start again.');
}

const ctx = await createContext(config).catch((err) => fail(`Startup failed: ${err.message}`));
const server = createApp(ctx).listen(config.port, config.host, (err) => {
  if (err) fail(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use.` : err.message);
  console.log(`Cloud Drive running at http://${config.host}:${config.port}`);
  console.log(`  files:  ${config.storageDir}`);
  console.log(`  data:   ${config.dataDir}`);
  console.log(`  upload limit: ${formatBytes(config.maxUploadBytes)} per file`);
  console.log(`  owner: ${ctx.users.owner().email}`);
  if (ctx.google.enabled) console.log(`  Google sign-in: on for ${ctx.google.origins.join(', ')}`);
  else if (config.google.clientId) {
    console.log('  Google sign-in: OFF — also set OWNER_EMAIL and PUBLIC_ORIGINS (and GOOGLE_CLIENT_SECRET)');
  } else console.log('  Google sign-in: not set up (owner password only)');
  ctx.scanner
    .run()
    .then((r) => console.log(`Index synced with disk (+${r.added} ~${r.updated} -${r.removed})`))
    .catch((scanErr) => console.error('Initial disk scan failed:', scanErr))
    .then(() => {
      // Make missing thumbnails/previews in the background, so opening a photo never waits on one.
      const started = Date.now();
      const isCurrent = (row) => ctx.repo.get(row.id)?.size === row.size;
      return ctx.thumbs.backfill(ctx.repo.images(), isCurrent).then((made) => {
        if (made) console.log(`Generated ${made} missing thumbnails/previews in ${Math.round((Date.now() - started) / 1000)}s`);
      });
    })
    .then(() => {
      // Then streaming versions of videos, one at a time (each can take minutes on a phone).
      const started = Date.now();
      return ctx.streams.backfill(ctx.repo.videos()).then((made) => {
        if (made) console.log(`Made streaming versions of ${made} videos in ${Math.round((Date.now() - started) / 1000)}s`);
      });
    })
    .catch((err) => console.error('Background thumbnail/preview generation failed:', err));
});

// Big uploads over mobile links can take far longer than Node's 5-minute request default.
// Instead, drop connections only when they go idle.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.timeout = 120_000;

setInterval(() => ctx.sessions.prune(), 60 * 60 * 1000).unref();
setInterval(() => ctx.resumable.prune().catch(() => {}), 60 * 60 * 1000).unref();
setInterval(() => ctx.activity.prune(), 24 * 60 * 60 * 1000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    ctx.close();
    process.exit(0);
  });
}
