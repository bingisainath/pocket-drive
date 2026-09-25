#!/usr/bin/env node
/**
 * check:shared — fail if the copies in mobile/src/shared/ have drifted from their
 * originals in frontend/src/. The copies exist because mobile/ is a standalone project
 * (no npm workspaces, no packages/shared); this guard keeps the two describing the same API.
 *
 * Each copy is identical to its original except for a single leading header comment
 * ("// Copied from …"), which this script ignores when comparing.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** [original in frontend, copy in mobile] */
const PAIRS = [
  ['frontend/src/types.ts', 'mobile/src/shared/types.ts'],
  ['frontend/src/lib/entries.ts', 'mobile/src/shared/lib/entries.ts'],
  ['frontend/src/lib/format.ts', 'mobile/src/shared/lib/format.ts'],
];

const HEADER = /^\/\/ Copied from .*keep the two in sync.*\r?\n/;

/** Normalise for comparison: strip the copy's header line, unify line endings, trim trailing blanks. */
function normalise(text) {
  return text.replace(HEADER, '').replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}

function read(rel) {
  try {
    return readFileSync(resolve(repoRoot, rel), 'utf8');
  } catch (err) {
    console.error(`  cannot read ${rel}: ${err.message}`);
    return null;
  }
}

let failures = 0;
for (const [original, copy] of PAIRS) {
  const a = read(original);
  const b = read(copy);
  if (a === null || b === null) {
    failures++;
    continue;
  }
  if (normalise(a) !== normalise(b)) {
    failures++;
    console.error(`✗ ${copy} has drifted from ${original}`);
    // Show the first differing line to make the fix obvious.
    const la = normalise(a).split('\n');
    const lb = normalise(b).split('\n');
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) {
        console.error(`    line ${i + 1}:`);
        console.error(`      frontend: ${la[i] ?? '(missing)'}`);
        console.error(`      mobile:   ${lb[i] ?? '(missing)'}`);
        break;
      }
    }
  } else {
    console.log(`✓ ${copy} matches ${original}`);
  }
}

if (failures > 0) {
  console.error(
    `\ncheck:shared failed: ${failures} file(s) out of sync. ` +
      `Re-copy the frontend original into mobile/src/shared/ (keep only the "// Copied from …" header).`,
  );
  process.exit(1);
}
console.log('\ncheck:shared passed: all shared copies are in sync.');
