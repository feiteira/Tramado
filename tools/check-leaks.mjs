// check-leaks: fails when a secret or an account identifier would be committed (architecture §17).
// Scans every tracked and untracked, non-ignored file with `git grep` for:
//   "user_id": "<20+ alnum>"  ·  sk-or-v1-<hex>  ·  OPENROUTER_API_KEY=<value>   (outside docs/)
//   sk-or-v1-<hex ≥ 16>                                                              (everywhere, docs/ included)
// and, when ~/.openrouter.key exists, the key itself (fixed string; matches are never printed, only file names).
// Run before every merge and push: `npm run check:leaks`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** Files (with line numbers) matching a pattern; [] when none. `show` false hides the matching text. */
function grep(args, pathspec, show = true) {
  try {
    const out = execFileSync('git', ['grep', '--untracked', '-I', '-n', ...(show ? [] : ['-l']), ...args, '--', ...pathspec], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    return out.split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

const OUTSIDE_DOCS = ['.', ':(exclude)docs/**', ':(exclude)tools/check-leaks.mjs', ':(exclude)tools/redact-fixtures.mjs'];
const EVERYWHERE = ['.', ':(exclude)tools/check-leaks.mjs', ':(exclude)tools/redact-fixtures.mjs'];
const findings = [];
const add = (what, lines) => {
  for (const l of lines) findings.push(`${what}: ${l.length > 200 ? `${l.slice(0, 200)}…` : l}`);
};

// The fixed fictional id that redact-fixtures.mjs writes is not an account id (G1).
const FICTIONAL_USER_ID = 'user_2demoFixtureFictional000000';
add('OpenRouter user_id', grep(['-E', '"user_id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_]{20,}"'], OUTSIDE_DOCS)
  .filter((l) => !(l.match(/"user_id"\s*:\s*"[A-Za-z0-9_]{20,}"/g) ?? []).every((m) => m.includes(`"${FICTIONAL_USER_ID}"`))));
add('OpenRouter key', grep(['-E', 'sk-or-v1-[0-9a-f]+'], OUTSIDE_DOCS));
add('API key assignment', grep(['-E', 'OPENROUTER_API_KEY=[^[:space:]…<$"\'`]+'], OUTSIDE_DOCS));
add('OpenRouter key (docs)', grep(['-E', 'sk-or-v1-[0-9a-f]{16,}'], EVERYWHERE));

// The local key itself, if this machine has one (never printed: file names only).
const keyFile = join(homedir(), '.openrouter.key');
if (existsSync(keyFile)) {
  const key = readFileSync(keyFile, 'utf8').replace(/\s+/g, '');
  if (key.length >= 16) add('the local OpenRouter key (value hidden)', grep(['-F', '-e', key], EVERYWHERE, false));
}

if (findings.length) {
  console.error(`check-leaks: ${findings.length} finding(s)`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log('check-leaks: clean');
