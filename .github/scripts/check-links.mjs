// Checks the relative links of the repository's documents (plan §8.2): every Markdown link, image and HTML src/href
// in README.md, the root documents, the manual and the release notes must point at a file that exists, and a #anchor at
// a heading of the target (GitHub's slugs). Also checks the manual's pictures: each one is used, the folder stays under
// 10 MB, and no picture is wider than 1440 px.
//   node .github/scripts/check-links.mjs        exit 0 = all good, 1 = problems (listed)
// External links (http, https, mailto) are not fetched.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const IMG_DIR = join(ROOT, 'docs/manual/img');
const MAX_IMG_BYTES = 10 * 1024 * 1024;
const MAX_IMG_WIDTH = 1440;

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const docs = [
  ...['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md', 'PRIVACY.pt.md', 'PRIVACY.es.md'].map((f) => join(ROOT, f)),
  ...walk(join(ROOT, 'docs/manual')),
  ...walk(join(ROOT, 'docs/release-notes')),
].filter((f) => f.endsWith('.md') && existsSync(f));

/** Text without fenced code blocks and inline code (links in code are examples, not links). */
const prose = (md) => md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');

/** GitHub's heading anchor (github-slugger): lower case, punctuation dropped, spaces to hyphens. */
function slug(heading) {
  const text = heading
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`]/g, '');
  return text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    const seen = new Map();
    const set = new Set();
    for (const m of prose(readFileSync(file, 'utf8')).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      const base = slug(m[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      set.add(n ? `${base}-${n}` : base);
    }
    for (const m of readFileSync(file, 'utf8').matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) set.add(m[1]);
    anchorCache.set(file, set);
  }
  return anchorCache.get(file);
}

const problems = [];
const usedImages = new Set();
let links = 0;
for (const file of docs) {
  const text = prose(readFileSync(file, 'utf8'));
  const targets = [
    ...[...text.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const raw of targets) {
    if (/^(https?:|mailto:|tramado:)/i.test(raw)) continue;
    links++;
    const [pathPart, anchor] = raw.split('#');
    const target = pathPart ? resolve(dirname(file), decodeURI(pathPart)) : file;
    const where = relative(ROOT, file);
    if (!target.startsWith(ROOT)) {
      problems.push(`${where}: ${raw} points outside the repository`);
      continue;
    }
    if (!existsSync(target)) {
      problems.push(`${where}: ${raw} does not exist`);
      continue;
    }
    if (target.startsWith(IMG_DIR)) usedImages.add(target);
    if (anchor !== undefined && target.endsWith('.md') && !anchorsOf(target).has(decodeURIComponent(anchor))) {
      problems.push(`${where}: ${raw}: no heading "#${anchor}" in ${relative(ROOT, target)}`);
    }
  }
}

// The homepage (site/index.html, assembled by tools/build-site.mjs) shows some of the pictures too, in all three
// languages: data-img="<name>" is docs/manual/img/<lang>/<name>.webp.
for (const m of readFileSync(join(ROOT, 'site/index.html'), 'utf8').matchAll(/\sdata-img="([a-z0-9-]+)"/g)) {
  for (const lang of ['en', 'pt', 'es']) usedImages.add(join(IMG_DIR, lang, `${m[1]}.webp`));
}

/** Width of a PNG or WebP picture, or null when the format is not recognised. */
function widthOf(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 1, 4) === 'PNG') return b.readUInt32BE(16);
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8L') return 1 + (b[21] | ((b[22] & 0x3f) << 8));
    if (chunk === 'VP8 ') return b.readUInt16LE(26) & 0x3fff;
    if (chunk === 'VP8X') return 1 + b.readUIntLE(24, 3);
  }
  if (b[0] === 0xff && b[1] === 0xd8) return null; // JPEG: not checked
  return null;
}

// PNGs are what `npm run screenshots` writes next to the WebP copies; they are git-ignored there (docs/manual/img/
// .gitignore), so a local run after taking screenshots must not count them.
const images = walk(IMG_DIR).filter((f) => /\.(webp|jpe?g|gif|svg)$/i.test(f));
let bytes = 0;
for (const img of images) {
  bytes += statSync(img).size;
  if (!usedImages.has(img)) problems.push(`${relative(ROOT, img)} is not used by any document`);
  const w = widthOf(img);
  if (w !== null && w > MAX_IMG_WIDTH) problems.push(`${relative(ROOT, img)} is ${w} px wide (at most ${MAX_IMG_WIDTH})`);
}
if (bytes > MAX_IMG_BYTES) problems.push(`the manual's pictures take ${(bytes / 1048576).toFixed(1)} MB (at most 10 MB)`);

for (const p of problems) console.error(p);
console.log(
  `${docs.length} documents, ${links} relative links, ${images.length} pictures (${(bytes / 1048576).toFixed(1)} MB): ` +
    (problems.length ? `${problems.length} problem(s).` : 'all good.'),
);
process.exit(problems.length ? 1 : 0);
