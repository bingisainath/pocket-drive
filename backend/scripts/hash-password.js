// Prompts for a password, hashes it with scrypt, and saves PASSWORD_HASH into backend/.env.
//   npm run hash-password            interactive (input hidden)
//   npm run hash-password -- --print print the hash instead of writing .env
//   echo 'pw' | npm run hash-password non-interactive
import fs from 'node:fs';
import readline from 'node:readline';
import { hashPassword } from '../src/auth.js';
import { ENV_EXAMPLE_PATH, ENV_PATH } from '../src/config.js';

async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  rl._writeToOutput = (s) => {
    if (!muted) rl.output.write(s);
  };
  const answer = new Promise((resolve) => rl.question(prompt, resolve));
  muted = true; // prompt is already written; hide what's typed
  const value = await answer;
  rl.close();
  process.stdout.write('\n');
  return value;
}

const password = await readSecret('New password: ');
if (password.length < 8) {
  console.error('Use at least 8 characters — this login is reachable from the internet, so longer is better.');
  process.exit(1);
}
if (process.stdin.isTTY && (await readSecret('Repeat password: ')) !== password) {
  console.error('Passwords did not match.');
  process.exit(1);
}

const line = `PASSWORD_HASH=${hashPassword(password)}`;
if (process.argv.includes('--print')) {
  console.log(line);
  process.exit(0);
}

let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
if (/^PASSWORD_HASH=.*$/m.test(env)) env = env.replace(/^PASSWORD_HASH=.*$/m, () => line);
else env += `${env && !env.endsWith('\n') ? '\n' : ''}${line}\n`;
fs.writeFileSync(ENV_PATH, env, { mode: 0o600 });
console.log(`Saved PASSWORD_HASH to ${ENV_PATH}`);
console.log('Restart the server to apply it (existing sessions will be signed out).');
