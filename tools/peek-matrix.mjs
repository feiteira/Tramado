// peek-matrix: runs every entry of every tools/peek-routes/*.json (or only `--only=<file>[,…]`), writing
// PNGs to tools/peek/out/<file>/<name>.png, and exits 1 on any failure (plan §2.2, §2.3 item 10).
//
// An entry: { "name": "today", "route": "today", "query": "…", "lang": "en", "theme": "light", "scale": 1,
//             "size": "1440x900", "ready": "screen-today", "axe": true,
//             "steps": [{ "click": "rail-archive" }, { "expect": "rail-class:4" }, …] }
// The step verbs are peek.mjs's: click, press, type, expect, expect-not, expect-text, expect-attr.
// `--axe` scans every entry (an entry's own `"axe": false` still opts out); `--jobs=N` shoots N entries at once
// (one browser context each; default 1); `--name=<a>[,…]` keeps only the named entries. `--lang=pt|es|en` shoots every
// entry in that language (PNGs in out/<lang>/<file>/): an entry written for another language keeps its steps except
// the assertions that name that language's words (`expect-text`, and `expect-attr` on aria-label, title or
// placeholder); an entry that types an English query can still fail (the L10N review, plan §8.3).
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shoot, startPeek } from './peek-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : 'true'];
}));
const only = args.only ? new Set(args.only.split(',')) : null;
const ROUTES = join(HERE, 'peek-routes');
const OUT = resolve(args.out ?? join(HERE, 'peek', 'out'));
const files = readdirSync(ROUTES).filter((f) => f.endsWith('.json')).filter((f) => !only || only.has(basename(f, '.json'))).sort();
if (files.length === 0) {
  console.error('peek-matrix: no route files');
  process.exit(1);
}

const env = await startPeek({ app: args.app ?? join(HERE, '..', 'app'), port: Number(args.port) || 1531 });
const names = args.name ? new Set(args.name.split(',')) : null;
const LANGS = ['en', 'pt', 'es'];
const forcedLang = args.lang && args.lang !== 'true' ? args.lang : null;
if (forcedLang && !LANGS.includes(forcedLang)) {
  console.error(`peek-matrix: --lang must be one of ${LANGS.join(', ')}`);
  process.exit(2);
}
/** The entry in the forced language: its wording assertions go when it was written for another one. */
const WORDING = /^[^:]+:(aria-label|title|placeholder)=/;
const inLang = (entry) => {
  if (!forcedLang) return entry;
  const own = entry.lang ?? 'en';
  if (own === forcedLang) return entry;
  const wording = (s) => 'expect-text' in s || ('expect-attr' in s && WORDING.test(s['expect-attr']));
  return { ...entry, lang: forcedLang, steps: (entry.steps ?? []).filter((s) => !wording(s)) };
};
const queue = [];
for (const f of files) {
  const set = basename(f, '.json');
  for (const entry of JSON.parse(readFileSync(join(ROUTES, f), 'utf8'))) {
    if (names && !names.has(entry.name)) continue;
    const e = inLang(entry);
    queue.push({ set, entry: args.axe && e.axe !== false ? { ...e, axe: true } : e });
  }
}
const results = new Array(queue.length);
let next = 0;
async function worker() {
  while (next < queue.length) {
    const i = next++;
    const { set, entry } = queue[i];
    const out = join(OUT, ...(forcedLang ? [forcedLang] : []), set, `${entry.name}.png`);
    const r = await shoot(env, { ...entry, out });
    results[i] = { set, name: entry.name, ok: !r.failed, png: r.png, errors: r.errors, overflow: r.overflow, axe: (r.axe ?? []).filter((v) => v.impact === 'serious' || v.impact === 'critical') };
    console.log(`${r.failed ? 'FAIL' : 'ok  '} ${set}/${entry.name}${r.failed ? `  ${[...r.errors, r.overflow ?? ''].filter(Boolean).join(' | ')}${r.axe?.length ? ` axe: ${r.axe.map((v) => `${v.id}(${v.impact})`).join(',')}` : ''}` : ''}`);
  }
}
try {
  await Promise.all(Array.from({ length: Math.max(1, Number(args.jobs) || 1) }, worker));
} finally {
  await env.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed; PNGs in ${OUT}`);
process.exit(failed.length ? 1 : 0);
