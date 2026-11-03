// peek-matrix: runs every entry of every tools/peek-routes/*.json (or only `--only=<file>[,…]`), writing
// PNGs to tools/peek/out/<file>/<name>.png, and exits 1 on any failure (plan §2.2, §2.3 item 10).
//
// An entry: { "name": "today", "route": "today", "query": "…", "lang": "en", "theme": "light", "scale": 1,
//             "size": "1440x900", "ready": "screen-today", "axe": true,
//             "steps": [{ "click": "rail-archive" }, { "expect": "rail-class:4" }, …] }
// The step verbs are peek.mjs's: click, press, type, expect, expect-not, expect-text, expect-attr.
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
const results = [];
try {
  for (const f of files) {
    const set = basename(f, '.json');
    const entries = JSON.parse(readFileSync(join(ROUTES, f), 'utf8'));
    for (const entry of entries) {
      const out = join(OUT, set, `${entry.name}.png`);
      const r = await shoot(env, { ...entry, out });
      results.push({ set, name: entry.name, ok: !r.failed, png: r.png, errors: r.errors, overflow: r.overflow, axe: (r.axe ?? []).filter((v) => v.impact === 'serious' || v.impact === 'critical') });
      console.log(`${r.failed ? 'FAIL' : 'ok  '} ${set}/${entry.name}${r.failed ? `  ${[...r.errors, r.overflow ?? ''].filter(Boolean).join(' | ')}${r.axe?.length ? ` axe: ${r.axe.map((v) => `${v.id}(${v.impact})`).join(',')}` : ''}` : ''}`);
    }
  }
} finally {
  await env.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed; PNGs in ${OUT}`);
process.exit(failed.length ? 1 : 0);
