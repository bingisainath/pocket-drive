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
  ctx.scanner
    .run()
    .then((r) => console.log(`Index synced with disk (+${r.added} ~${r.updated} -${r.removed})`))
    .catch((scanErr) => console.error('Initial disk scan failed:', scanErr));
});

// Big uploads over mobile links can take far longer than Node's 5-minute request default.
// Instead, drop connections only when they go idle.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.timeout = 120_000;

setInterval(() => ctx.sessions.prune(), 60 * 60 * 1000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    ctx.close();
    process.exit(0);
  });
}
