// check-versions: every locked dependency must have been published at least 14 days ago (architecture §18.6, D59).
// Reads Cargo.lock (crates.io packages) and package-lock.json (npm registry packages), finds when each version was
// published, prints the youngest versions as a table and exits 1 when any is younger than the limit. Run at release:
//   npm run check:versions                       (the same as node tools/check-versions.mjs)
//   node tools/check-versions.mjs [--days=14] [--now=2026-11-17] [--all] [--json] [--offline] [--no-exceptions]
// --now checks against another date ("will the lock pass on the 17th?"); --all prints every row; --json prints the
// rows as JSON; --offline uses only what is already known (unknown dates fail); --no-exceptions ignores the list below.
//
// Reviewed exceptions (tools/check-versions.exceptions.json): a version younger than the limit passes as "excepted"
// when the list names its exact ecosystem, name and version, with the date of the review, the reason (a security fix,
// a lab-verified pin) and a summary of the published source that was read (the diff against the previous release).
// An exception never matches another version. One whose version is no longer locked, or is already old enough, is
// reported as stale (a warning) so it gets removed.
//
// Where the dates come from (no account, no API key, small downloads):
//   crates  the `pubtime` field of the crates.io sparse index (https://index.crates.io), read from Cargo's own index
//           cache first ($CARGO_HOME/registry/index/*/.cache), downloaded only when the cache lacks the version.
//   npm     the Last-Modified header of the version's tarball (a HEAD request to the lockfile's `resolved` URL): the
//           registry sets it when the version is published, and it agrees with the packument's `time` within
//           seconds. Without the header the full packument is read.
// Found dates are kept in tools/.cache/publish-dates.json (git-ignored): a published version's date never changes.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_FILE = join(ROOT, 'tools/.cache/publish-dates.json');
const EXCEPTIONS_FILE = join(ROOT, 'tools/check-versions.exceptions.json');
const DAY = 86_400_000;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);
for (const k of Object.keys(args)) {
  if (!['days', 'now', 'all', 'json', 'offline', 'no-exceptions'].includes(k)) {
    console.error(`unknown option --${k} (use --days=N --now=YYYY-MM-DD --all --json --offline --no-exceptions)`);
    process.exit(2);
  }
}
const LIMIT_DAYS = args.days === undefined ? 14 : Number(args.days);
const NOW = args.now ? Date.parse(String(args.now)) : Date.now();
if (!Number.isFinite(LIMIT_DAYS) || LIMIT_DAYS < 0 || !Number.isFinite(NOW)) {
  console.error('--days must be a number of days and --now a date (YYYY-MM-DD).');
  process.exit(2);
}

// ---------------------------------------------------------------- reviewed exceptions

/** The reviewed exceptions, checked field by field: a malformed list stops the check (exit 2). */
function loadExceptions() {
  if (args['no-exceptions'] || !existsSync(EXCEPTIONS_FILE)) return [];
  let doc;
  try {
    doc = JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8'));
  } catch (e) {
    console.error(`tools/check-versions.exceptions.json is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  const list = Array.isArray(doc?.exceptions) ? doc.exceptions : null;
  const problems = [];
  if (!list) problems.push('it needs an "exceptions" array');
  const seen = new Set();
  for (const [i, x] of (list ?? []).entries()) {
    const at = `exceptions[${i}]`;
    if (!['crates', 'npm'].includes(x?.ecosystem)) problems.push(`${at}.ecosystem must be "crates" or "npm"`);
    for (const f of ['name', 'version', 'reason', 'review']) {
      if (typeof x?.[f] !== 'string' || !x[f].trim()) problems.push(`${at}.${f} must be a non-empty string`);
    }
    if (typeof x?.version === 'string' && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(x.version)) {
      problems.push(`${at}.version must be one exact version (no ranges)`);
    }
    if (typeof x?.reviewed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.reviewed) || !Number.isFinite(Date.parse(x.reviewed))) {
      problems.push(`${at}.reviewed must be the review date (YYYY-MM-DD)`);
    }
    const key = `${x?.ecosystem}:${x?.name}@${x?.version}`;
    if (seen.has(key)) problems.push(`${at} repeats ${key}`);
    seen.add(key);
  }
  if (problems.length) {
    console.error(`tools/check-versions.exceptions.json: ${problems.join('; ')}.`);
    process.exit(2);
  }
  return list;
}
const exceptions = loadExceptions();

// ---------------------------------------------------------------- locked versions

/** crates.io packages of Cargo.lock (path and git packages have no registry date and are skipped). */
function cargoPackages() {
  const text = readFileSync(join(ROOT, 'Cargo.lock'), 'utf8');
  const out = [];
  for (const block of text.split('[[package]]').slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    const source = /^source = "([^"]+)"/m.exec(block)?.[1];
    if (name && version && source === 'registry+https://github.com/rust-lang/crates.io-index') out.push({ eco: 'crates', name, version });
  }
  return out;
}

/** npm registry packages of package-lock.json (workspace links are skipped). */
function npmPackages() {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const seen = new Map();
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/') || p.link || !p.version || !p.resolved?.startsWith('https://registry.npmjs.org/')) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const key = `${name}@${p.version}`;
    if (!seen.has(key)) seen.set(key, { eco: 'npm', name, version: p.version, resolved: p.resolved });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- publish dates

let cache = {};
try {
  cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
} catch {
  // First run, or an unreadable cache: start empty.
}
const cacheKey = (p) => `${p.eco}:${p.name}@${p.version}`;

/** The sparse-index path of a crate (https://doc.rust-lang.org/cargo/reference/registry-index.html#index-files). */
function indexPath(name) {
  const n = name.toLowerCase();
  if (n.length <= 2) return `${n.length}/${n}`;
  if (n.length === 3) return `3/${n[0]}/${n}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
}

/** The index lines of a crate as {vers, pubtime} records, from text that holds one JSON object per line (or per NUL). */
function indexRecords(text) {
  const out = [];
  for (const part of text.split(/[\n\0]/)) {
    if (!part.startsWith('{')) continue;
    try {
      const r = JSON.parse(part);
      if (r.vers) out.push(r);
    } catch {
      // Not a record (Cargo's cache header, a truncated line).
    }
  }
  return out;
}

const CARGO_HOME = process.env.CARGO_HOME || join(homedir(), '.cargo');
const localIndexDirs = (() => {
  const base = join(CARGO_HOME, 'registry/index');
  try {
    return readdirSync(base).filter((d) => d.startsWith('index.crates.io-')).map((d) => join(base, d, '.cache'));
  } catch {
    return [];
  }
})();

function crateDateFromLocal(p) {
  for (const dir of localIndexDirs) {
    const file = join(dir, indexPath(p.name));
    if (!existsSync(file)) continue;
    const rec = indexRecords(readFileSync(file, 'latin1')).find((r) => r.vers === p.version);
    if (rec?.pubtime) return rec.pubtime;
  }
  return null;
}

async function fetchText(url, init) {
  const res = await fetch(url, { ...init, headers: { 'user-agent': 'tramado-check-versions (https://github.com/feiteira/Tramado)', ...init?.headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return init?.method === 'HEAD' ? res : res.text();
}

const crateIndexes = new Map();
async function crateDate(p) {
  const local = crateDateFromLocal(p);
  if (local) return local;
  if (args.offline) return null;
  if (!crateIndexes.has(p.name)) crateIndexes.set(p.name, fetchText(`https://index.crates.io/${indexPath(p.name)}`).then(indexRecords));
  const rec = (await crateIndexes.get(p.name)).find((r) => r.vers === p.version);
  return rec?.pubtime ?? null;
}

async function npmDate(p) {
  if (args.offline) return null;
  const head = await fetchText(p.resolved, { method: 'HEAD' });
  const lm = head.headers.get('last-modified');
  if (lm && Number.isFinite(Date.parse(lm))) return new Date(lm).toISOString();
  const doc = JSON.parse(await fetchText(`https://registry.npmjs.org/${p.name.replace('/', '%2F')}`));
  return doc.time?.[p.version] ?? null;
}

/** Runs `fn` over `items` with at most `n` at once. */
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// ---------------------------------------------------------------- main

const packages = [...cargoPackages(), ...npmPackages()];
const errors = [];
await pool(packages, 8, async (p) => {
  const key = cacheKey(p);
  if (!cache[key]) {
    try {
      const date = p.eco === 'crates' ? await crateDate(p) : await npmDate(p);
      if (date) cache[key] = date;
    } catch (e) {
      errors.push(`${key}: ${e.message}`);
    }
  }
  p.published = cache[key] ?? null;
});
try {
  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 0).replaceAll(',"', ',\n"')}\n`);
} catch {
  // A read-only checkout still gets its answer.
}

const ageDays = (iso) => (NOW - Date.parse(iso)) / DAY;
const exceptionFor = (p) => exceptions.find((x) => x.ecosystem === p.eco && x.name === p.name && x.version === p.version);
for (const p of packages) {
  p.age = p.published ? ageDays(p.published) : null;
  p.ok = p.age !== null && p.age >= LIMIT_DAYS;
  // An exception covers one exact locked version that is too new (or whose date is unknown); never an old one.
  p.exception = p.ok ? null : (exceptionFor(p) ?? null);
}
packages.sort((a, b) => (a.age ?? -Infinity) - (b.age ?? -Infinity) || a.name.localeCompare(b.name));
const young = packages.filter((p) => p.age !== null && !p.ok && !p.exception);
const unknown = packages.filter((p) => p.age === null && !p.exception);
const excepted = packages.filter((p) => p.exception);
const failing = [...unknown, ...young];

// Stale exceptions: the version is no longer locked, or it is already old enough. Reported, never fatal.
const stale = [];
for (const x of exceptions) {
  const p = packages.find((q) => q.eco === x.ecosystem && q.name === x.name && q.version === x.version);
  const id = `${x.ecosystem} ${x.name} ${x.version}`;
  if (!p) stale.push(`${id} is no longer locked`);
  else if (p.ok) stale.push(`${id} is already ${Math.floor(p.age)} days old`);
}

if (args.json) {
  console.log(JSON.stringify(packages.map(({ eco, name, version, published, age, ok, exception }) => ({ eco, name, version, published, ageDays: age === null ? null : Math.floor(age), ok, excepted: Boolean(exception), ...(exception ? { reviewed: exception.reviewed } : {}) })), null, 2));
} else {
  const shown = args.all ? packages : [...failing, ...excepted, ...packages.filter((p) => p.ok).slice(0, 10)];
  const rows = shown.map((p) => [
    p.ok ? 'ok' : p.exception ? 'excepted' : p.age === null ? 'UNKNOWN' : 'TOO NEW',
    p.eco,
    p.name,
    p.version,
    p.published ? p.published.slice(0, 10) : '—',
    p.age === null ? '—' : String(Math.floor(p.age)),
    p.ok || !p.published ? '' : new Date(Date.parse(p.published) + LIMIT_DAYS * DAY).toISOString().slice(0, 10),
  ]);
  const head = ['status', 'from', 'package', 'version', 'published', 'age (days)', `ok from`];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => `| ${r.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  console.log(line(head));
  console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
  for (const r of rows) console.log(line(r));
  if (!args.all && packages.length > shown.length) console.log(`(${packages.length - shown.length} older versions not shown; --all prints every row)`);
  console.log('');
  const crates = packages.filter((p) => p.eco === 'crates').length;
  console.log(
    `Checked ${packages.length} locked versions (${crates} crates, ${packages.length - crates} npm packages) against ${LIMIT_DAYS} days on ${new Date(NOW).toISOString().slice(0, 10)}` +
      (excepted.length ? `; ${excepted.length} excepted after review (tools/check-versions.exceptions.json): ${excepted.map((p) => `${p.name} ${p.version}`).join(', ')}.` : '.'),
  );
}
for (const e of errors) console.error(`lookup failed: ${e}`);
for (const s of stale) {
  const msg = `stale exception in tools/check-versions.exceptions.json: ${s}; remove it.`;
  console.error(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`);
}
if (failing.length) {
  const last = young.reduce((m, p) => Math.max(m, Date.parse(p.published)), 0);
  console.error(
    `${young.length} version(s) younger than ${LIMIT_DAYS} days` +
      (unknown.length ? `, ${unknown.length} with no known publish date` : '') +
      (young.length ? `; the youngest turns ${LIMIT_DAYS} days old on ${new Date(last + LIMIT_DAYS * DAY).toISOString().slice(0, 10)}.` : '.'),
  );
  process.exit(1);
}
console.error(
  excepted.length
    ? `Every other locked version is at least ${LIMIT_DAYS} days old; ${excepted.length} younger version(s) passed as reviewed exceptions.`
    : `Every locked version is at least ${LIMIT_DAYS} days old.`,
);
