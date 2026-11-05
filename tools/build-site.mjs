#!/usr/bin/env node
// Assembles the GitHub Pages site (https://feiteira.github.io/Tramado/, .github/workflows/pages.yml) from site/:
//
//   node tools/build-site.mjs --out=<new or empty dir> [--release=<release.json>]
//
// Copies site/ (the homepage index.html, join/, fonts/, favicon.svg) to --out, adds the manual's screenshots that
// site/index.html names with data-img="<name>" (docs/manual/img/<lang>/<name>.webp → img/<lang>/<name>.webp, for en,
// pt and es) and writes release.js, which sets window.TRAMADO_RELEASE: the release in --release (what
// `gh release view <tag> --json tagName,isPrerelease,publishedAt,url,assets` prints), or null without one, in which
// case the page's download buttons open the Releases page.
//
// Checks on the way and exits 1 on any problem: the homepage's strings (the #i18n block) have the same keys and
// {placeholders} in English, Portuguese and Spanish, and every key the page uses exists; every screenshot exists; the
// page keeps its Content-Security-Policy and loads nothing from another origin; the release's links point at GitHub.
// Run without --release in CI (the web job) to check the page; the Pages workflow passes the newest release.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SITE = join(ROOT, 'site');
const IMG = join(ROOT, 'docs/manual/img');
const LANGS = ['en', 'pt', 'es'];

for (const a of process.argv.slice(2)) {
  if (!/^--(out|release)=./.test(a)) {
    console.error(`build-site: unknown argument ${a} (use --out=<dir> and --release=<file>)`);
    process.exit(2);
  }
}
const arg = (name) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = arg('out');
const releasePath = arg('release');
if (!out) {
  console.error('usage: node tools/build-site.mjs --out=<new or empty dir> [--release=<release.json>]');
  process.exit(2);
}
const OUT = resolve(out);
if (existsSync(OUT) && (!statSync(OUT).isDirectory() || readdirSync(OUT).length > 0)) {
  console.error(`build-site: ${OUT} is not an empty folder; give a new or empty one`);
  process.exit(2);
}
if (OUT === SITE || OUT.startsWith(SITE + '/') || OUT === ROOT) {
  console.error('build-site: --out must be outside site/ and not the repository root');
  process.exit(2);
}

const problems = [];
const html = readFileSync(join(SITE, 'index.html'), 'utf8');

// Strings.
const block = /<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/.exec(html);
let strings = null;
try {
  strings = block ? JSON.parse(block[1]) : null;
} catch (e) {
  problems.push(`index.html: the #i18n block is not JSON (${e.message})`);
}
if (!block) problems.push('index.html: no <script type="application/json" id="i18n"> block');
if (strings) {
  const placeholders = (v) => [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const en = strings.en ?? {};
  for (const lang of LANGS) {
    const t = strings[lang];
    if (!t) { problems.push(`index.html: no "${lang}" strings`); continue; }
    for (const key of Object.keys(en)) {
      if (!(key in t)) problems.push(`index.html: "${lang}" lacks "${key}"`);
      else if (placeholders(t[key]) !== placeholders(en[key])) problems.push(`index.html: "${lang}.${key}" changes the {placeholders}`);
      else if (typeof t[key] !== 'string' || !t[key].trim()) problems.push(`index.html: "${lang}.${key}" is empty`);
    }
    for (const key of Object.keys(t)) if (!(key in en)) problems.push(`index.html: "${lang}.${key}" is not an English key`);
  }
  const used = new Set([
    ...[...html.matchAll(/\sdata-i18n(?:-alt|-aria)?="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\bs\('([\w.]+)'\)/g)].map((m) => m[1]),
  ]);
  for (const key of used) if (!(key in en)) problems.push(`index.html: uses "${key}", which has no string`);
  for (const key of Object.keys(en)) if (!used.has(key)) problems.push(`index.html: the string "${key}" is never used`);
}

// Nothing from another origin: exactly this CSP, and every src, every <link> that fetches and every CSS url() is
// relative (the CSP would block the rest, but a page that tries is a mistake to catch here).
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'";
const csp = [...html.matchAll(/<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi)];
if (csp.length !== 1 || /\scontent="([^"]*)"/.exec(csp[0][0])?.[1] !== CSP) problems.push('index.html: the Content-Security-Policy changed');
const external = (u) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u) && !u.startsWith('data:');
for (const m of html.matchAll(/\ssrc="([^"]*)"/g)) if (external(m[1])) problems.push(`index.html: loads ${m[1]}`);
for (const m of html.matchAll(/<link\s[^>]*rel="(?:icon|stylesheet|preload|modulepreload|manifest|preconnect|dns-prefetch|prefetch|prerender)"[^>]*>/g)) {
  const href = /\shref="([^"]*)"/.exec(m[0])?.[1] ?? '';
  if (external(href)) problems.push(`index.html: loads ${href}`);
}
for (const m of html.matchAll(/url\(([^)]*)\)/g)) if (external(m[1].replace(/['"]/g, ''))) problems.push(`index.html: loads ${m[1]}`);

// Screenshots: <img data-img="<name>"> without src (the script sets img/<lang>/<name>.webp); any other picture of
// this site is img/en/<name>.webp of one of those names (the <noscript> hero).
const images = [];
const imgTags = [...html.matchAll(/<img\s[^>]*>/g)].map((m) => m[0]);
for (const tag of imgTags) {
  const name = /\sdata-img="([^"]*)"/.exec(tag)?.[1];
  if (name === undefined) continue;
  if (!/^[a-z0-9-]+$/.test(name)) problems.push(`index.html: data-img="${name}" (only a-z, 0-9 and -)`);
  else if (!images.includes(name)) images.push(name);
  if (/\ssrc=/.test(tag)) problems.push(`index.html: <img data-img="${name}"> has a src; the script sets it`);
}
for (const tag of imgTags) {
  const src = /\ssrc="([^"]*)"/.exec(tag)?.[1];
  if (src === undefined || src.startsWith('data:') || external(src)) continue;
  const m = /^img\/en\/([a-z0-9-]+)\.webp$/.exec(src);
  if (!m || !images.includes(m[1])) problems.push(`index.html: <img src="${src}"> is not one of the screenshots`);
}
for (const name of images) {
  for (const lang of LANGS) {
    if (!existsSync(join(IMG, lang, `${name}.webp`))) problems.push(`docs/manual/img/${lang}/${name}.webp is missing`);
  }
}

// The release.
let release = null;
if (releasePath) {
  try {
    const r = JSON.parse(readFileSync(releasePath, 'utf8'));
    const gh = (u) => typeof u === 'string' && u.startsWith('https://github.com/');
    if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(r.tagName ?? '')) problems.push(`release: unexpected tag ${r.tagName}`);
    if (!gh(r.url)) problems.push(`release: unexpected url ${r.url}`);
    const assets = (r.assets ?? []).map((a) => ({ name: String(a.name), url: a.url, size: Number(a.size) }));
    for (const a of assets) {
      if (!gh(a.url) || !Number.isFinite(a.size)) problems.push(`release: unexpected asset ${a.name}`);
    }
    release = { tag: r.tagName, prerelease: r.isPrerelease === true, date: r.publishedAt ?? null, url: r.url, assets };
  } catch (e) {
    problems.push(`release: cannot read ${releasePath} (${e.message})`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`build-site: ${p}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
cpSync(SITE, OUT, { recursive: true });
for (const lang of LANGS) {
  mkdirSync(join(OUT, 'img', lang), { recursive: true });
  for (const name of images) cpSync(join(IMG, lang, `${name}.webp`), join(OUT, 'img', lang, `${name}.webp`));
}
writeFileSync(join(OUT, 'release.js'), `window.TRAMADO_RELEASE = ${JSON.stringify(release)};\n`);
console.log(`build-site: ${OUT}: ${images.length} screenshots × ${LANGS.length} languages, release ${release ? release.tag : 'none'}`);
