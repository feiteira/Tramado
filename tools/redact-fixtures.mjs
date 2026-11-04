// redact-fixtures: makes saved OpenRouter outputs safe to commit (architecture §17). In place, for each file:
// every "user_id" value becomes the fixed fictional id, every metadata.raw becomes "<redacted>",
// Authorization headers lose their credential, and generation ids (gen-<10 digits>-<20 alnum>) become stable
// fictional ones (gen-1700000000-Fixture<13 hex of their SHA-256>, so repeated ids still match). Handles JSON, JSONL and SSE text ("data: {…}" lines).
//
//   node tools/redact-fixtures.mjs <file|dir>…          rewrite in place, list the files changed
//   node tools/redact-fixtures.mjs --check <file|dir>…  exit 1 if any file would change
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const FICTIONAL_USER_ID = 'user_2demoFixtureFictional000000';
export const FICTIONAL_GEN_PREFIX = 'gen-1700000000-Fixture';
const fictionalGen = (id) => (id.includes('Fixture') ? id : FICTIONAL_GEN_PREFIX + createHash('sha256').update(id).digest('hex').slice(0, 13));
const TEXT = /\.(json|jsonl|ndjson|sse|txt|http|log)$/i;

export function redactText(text) {
  return text
    .replace(/("user_id"\s*:\s*)"[^"]*"/g, `$1"${FICTIONAL_USER_ID}"`)
    .replace(/("raw"\s*:\s*)("(?:[^"\\]|\\.)*"|\{[^{}]*\}|\[[^[\]]*\])/g, '$1"<redacted>"')
    .replace(/((?:"|\b)authorization"?\s*[:=]\s*"?)(Bearer\s+)?[^"\s,}]+/gi, '$1$2<redacted>')
    .replace(/sk-or-v1-[0-9a-f]{8,}/g, 'sk-or-v1-<redacted>')
    .replace(/gen-\d{10}-[A-Za-z0-9]{20}/g, fictionalGen);
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
