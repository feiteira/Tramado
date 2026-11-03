// Adapted from Trama (tools/screenshots/capture.mjs), MPL-2.0.
// Takes every manual screenshot (UX §7.4) in every language from the browser demo:
//   npm run screenshots                       (from the root or app/)
//   node tools/screenshots/capture.mjs [--only=welcome,today] [--lang=pt] [--jobs=2] [--port=1524]
// Output: docs/manual/img/<lang>/<name>.png (or --out=<dir>/<lang>/) at 1440×900. The run fails, and writes nothing for
// that shot, when a step cannot find what it needs or the page throws.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { SHOTS } from './shots.mjs';

const ROOT = join(import.meta.dirname, '../..');
const APP = join(ROOT, 'app');
const FIXTURES = join(import.meta.dirname, 'fixtures');

const LANGS_ALL = ['en', 'pt', 'es'];
/** Tuesday 3 November 2026, 15:30 in Lisbon (UX §7.2): every date and relative time in the pictures. */
const CLOCK = '2026-11-03T15:30';
const VIEWPORT = { width: 1440, height: 900 };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
  }),
);
const LANGS = args.lang ? args.lang.split(',') : LANGS_ALL;
/** docs/manual/img by default; --out=<dir> writes elsewhere (a check that must not touch the manual). */
const OUT = args.out ? resolve(args.out) : join(ROOT, 'docs/manual/img');
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const JOBS = Math.max(1, Number(args.jobs) || 2);
const PORT = Number(args.port) || 1524;

for (const l of LANGS) if (!LANGS_ALL.includes(l)) throw new Error(`unknown language ${l} (use ${LANGS_ALL.join(', ')})`);
if (ONLY) for (const n of ONLY) if (!SHOTS.some((s) => s.name === n)) throw new Error(`unknown shot ${n} (shots: ${SHOTS.map((s) => s.name).join(', ')})`);

const jobs = [];
for (const lang of LANGS) {
  for (const shot of SHOTS) {
    if (ONLY && !ONLY.has(shot.name)) continue;
    if (shot.langs && !shot.langs.includes(lang)) continue;
    jobs.push({ lang, shot });
  }
}
if (!jobs.length) {
  console.error('Nothing to take.');
  process.exit(1);
}

let hasConvert = true;
try {
  execFileSync('convert', ['-version'], { stdio: 'ignore' });
} catch {
  hasConvert = false;
}

const server = await createServer({
  root: APP,
  configFile: join(APP, 'vite.config.ts'),
  // No watcher and no HMR: a file saved during a run must not reload a page mid-shot. A file
  // caught half-edited shows as Vite's error overlay, which fails that shot.
  server: { port: PORT, strictPort: false, hmr: false, watch: null },
  logLevel: 'error',
  clearScreen: false,
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
let failed = 0;

/** Copies fixtures (paths under ./fixtures) into a demo class folder (window.__tramadoDemo, UX §7.2); returns their class paths. */
const addFilesTo = (page) => async (classKey, dir, files) => {
  const paths = [];
  for (const f of files) {
    const path = `${dir}/${f.split('/').pop()}`;
    await page.evaluate(([k, p, b]) => window.__tramadoDemo.addFile(k, p, b), [classKey, path, readFileSync(join(FIXTURES, f)).toString('base64')]);
    paths.push(path);
  }
  return paths;
};

async function open(lang, theme, query) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', locale: { en: 'en-GB', pt: 'pt-PT', es: 'es-ES' }[lang], timezoneId: 'Europe/Lisbon' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?lang=${lang}&theme=${theme}&clock=${CLOCK}&${query}`);
  return { context, page, errors };
}

/** No caret, no hover, no toast, no spinner, fonts loaded, nothing still moving. */
async function settle(page, keepFocus) {
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
  if (!keepFocus) await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  for (const close of await page.locator('.toast__close').all()) await close.click().catch(() => {});
  await page.locator('[data-testid="toast"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Chromium can keep lengths in ch/em computed with the fallback font when the web font
    // arrives at the wrong moment (a title wraps differently from run to run). Restyling every
    // element once more recomputes them with the font now loaded.
    const nudge = document.createElement('style');
    nudge.textContent = '* { outline-offset: 0.01px !important; }';
    document.head.append(nudge);
    void document.body.offsetHeight;
    nudge.remove();
    void document.body.offsetHeight;
  });
  await page.waitForFunction(() => !document.querySelector('[role="progressbar"]:not([aria-valuenow]), .spinner, [aria-busy="true"]'), null, { timeout: 30000 });
  // Transitions finish (reducedMotion shortens most); an endless animation is a spinner.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/** Vite shows a failed module (a file mid-edit, a syntax error) as an overlay, not a page error. */
async function viteError(page) {
  return page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    return o ? (o.shadowRoot?.querySelector('.message')?.textContent ?? 'Vite error overlay').trim() : null;
  });
}

async function take({ lang, shot }) {
  const theme = shot.theme ?? 'light';
  const { context, page, errors } = await open(lang, theme, shot.query);
  try {
    await page.waitForFunction(() => document.querySelector('#root')?.children.length, null, { timeout: 60000 });
    if (shot.ready) await page.getByTestId(shot.ready).first().waitFor({ timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    if (shot.steps) await shot.steps(page, lang, { addFiles: addFilesTo(page) });
    await settle(page, shot.keepFocus);
    const overlay = await viteError(page);
    if (overlay) errors.push(overlay);
    if (errors.length) throw new Error(errors.join('; '));
    const dir = join(OUT, lang);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${shot.name}.png`);
    const tmp = `${file}.tmp.png`;
    await page.screenshot({ path: tmp, animations: 'disabled', caret: 'hide' });
    // Lossless for PNG: drops ancillary chunks; quality 95 = zlib level 9, adaptive filtering.
    if (hasConvert) execFileSync('convert', [tmp, '-strip', '-quality', '95', tmp]);
    if (errors.length) throw new Error(errors.join('; '));
    renameSync(tmp, file);
    console.log(`✓ ${lang}/${shot.name}`);
  } catch (e) {
    failed++;
    rmSync(join(OUT, lang, `${shot.name}.png.tmp.png`), { force: true });
    // A step that timed out often did so because a module failed to load: say which.
    const overlay = await viteError(page).catch(() => null);
    const why = [String(e.message ?? e).split('\n')[0], ...(overlay && !String(e.message).includes(overlay) ? [overlay.split('\n')[0]] : [])];
    console.error(`✗ ${lang}/${shot.name}: ${why.join(' — ')}`);
  } finally {
    await context.close();
  }
}

try {
  // The first load makes Vite optimise dependencies, which can reload the page mid-run.
  const warm = await open('en', 'light', 'route=today');
  await warm.page.getByTestId('screen-today').waitFor({ timeout: 120000 });
  await warm.context.close();

  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) await take(queue.shift());
  }));
} finally {
  await browser.close();
  await server.close();
}
if (failed) {
  console.error(`${failed} of ${jobs.length} screenshot(s) failed.`);
  process.exit(1);
}
console.log(`${jobs.length} screenshot(s) in ${OUT}`);
