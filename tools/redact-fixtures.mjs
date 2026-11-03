// redact-fixtures: makes saved OpenRouter outputs safe to commit (architecture §17). In place, for each file:
// every "user_id" value becomes the fixed fictional id, every metadata.raw becomes "<redacted>", and
// Authorization headers lose their credential. Handles JSON, JSONL and SSE text ("data: {…}" lines).
//
//   node tools/redact-fixtures.mjs <file|dir>…          rewrite in place, list the files changed
//   node tools/redact-fixtures.mjs --check <file|dir>…  exit 1 if any file would change
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FICTIONAL_USER_ID = 'user_2demoFixtureFictional000000';
const TEXT = /\.(json|jsonl|ndjson|sse|txt|http|log)$/i;

export function redactText(text) {
  return text
    .replace(/("user_id"\s*:\s*)"[^"]*"/g, `$1"${FICTIONAL_USER_ID}"`)
    .replace(/("raw"\s*:\s*)("(?:[^"\\]|\\.)*"|\{[^{}]*\}|\[[^[\]]*\])/g, '$1"<redacted>"')
    .replace(/((?:"|\b)authorization"?\s*[:=]\s*"?)(Bearer\s+)?[^"\s,}]+/gi, '$1$2<redacted>')
    .replace(/sk-or-v1-[0-9a-f]{8,}/g, 'sk-or-v1-<redacted>');
}

function files(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return [p];
  return readdirSync(p).flatMap((n) => files(join(p, n))).filter((f) => TEXT.test(f));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const targets = args.filter((a) => a !== '--check');
  if (targets.length === 0) {
    console.error('usage: node tools/redact-fixtures.mjs [--check] <file|dir>…');
    process.exit(2);
  }
  const changed = [];
  for (const f of targets.flatMap(files)) {
    const before = readFileSync(f, 'utf8');
    const after = redactText(before);
    if (after === before) continue;
    changed.push(f);
    if (!check) writeFileSync(f, after);
  }
  for (const f of changed) console.log(`${check ? 'needs redaction' : 'redacted'}: ${f}`);
  process.exit(check && changed.length ? 1 : 0);
}
