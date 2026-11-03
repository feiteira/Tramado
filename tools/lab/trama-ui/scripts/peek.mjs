// peek: one screenshot of the browser demo, for agents and people checking a screen headlessly.
// Adapted from Trama's tools/screenshots/capture.mjs (in-process Vite, no HMR, playwright-core
// Chromium, settle: fonts/spinners/animations), plus an axe-core scan and a sideways-overflow check.
//
//   node tools/peek.mjs --route=classes --lang=pt --theme=dark [--query=demo=empty] \
//        [--ready=screen-classes] [--click=tab-exams,question-2] [--size=1440x900] [--scale=1]
//        [--out=/tmp/peek.png] [--axe] [--app=app]
//
// Prints JSON: { png, errors, console, overflow, axe } and exits 1 on page errors, a Vite
// overlay, a missing `ready` test id, sideways overflow, or (with --axe) serious/critical violations.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : 'true'];
}));
const APP = resolve(args.app ?? 'app');
const require = createRequire(join(APP, 'package.json'));
const { createServer } = await import(require.resolve('vite'));
const { chromium } = require('playwright-core');
const [w, h] = (args.size ?? '1440x900').split('x').map(Number);
const VIEWPORT = { width: w, height: h };
const out = resolve(args.out ?? `peek-${args.route ?? 'home'}-${args.lang ?? 'en'}-${args.theme ?? 'light'}.png`);

const server = await createServer({
  root: APP,
  configFile: join(APP, 'vite.config.ts'),
  server: { port: Number(args.port) || 1530, strictPort: false, hmr: false, watch: null },
  logLevel: 'error',
  clearScreen: false,
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const report = { png: null, errors: [], console: [], overflow: null, axe: null };
let failed = false;
try {
  const theme = args.theme ?? 'light';
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: Number(args.scale) || 1, colorScheme: theme, reducedMotion: 'reduce',
    locale: { en: 'en-GB', pt: 'pt-PT', es: 'es-ES' }[args.lang ?? 'en'], timezoneId: 'Europe/Lisbon',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && report.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  const qs = new URLSearchParams({ lang: args.lang ?? 'en', theme, clock: args.clock ?? '2026-10-05T10:30' });
  if (args.route) qs.set('route', args.route);
  await page.goto(`${base}?${qs}${args.query ? `&${args.query}` : ''}`);
  await page.waitForFunction(() => document.querySelector('#root')?.children.length, null, { timeout: 60000 });
  if (args.ready) await page.getByTestId(args.ready).first().waitFor({ timeout: 60000 });
  for (const id of (args.click ?? '').split(',').filter(Boolean)) {
    await page.getByTestId(id).first().click();
  }
  // Settle (as Trama's capture.mjs): pointer away, no focus ring, fonts, no spinners, no running animations.
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('[role="progressbar"]:not([aria-valuenow]), .spinner, [aria-busy="true"]'), null, { timeout: 30000 }).catch(() => report.errors.push('still busy after 30 s'));
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const overlay = await page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    return o ? (o.shadowRoot?.querySelector('.message')?.textContent ?? 'Vite error overlay').trim() : null;
  });
  if (overlay) report.errors.push(`vite: ${overlay.split('\n')[0]}`);
  report.overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollWidth > innerWidth + 1 ? `page is ${de.scrollWidth}px wide in a ${innerWidth}px window` : null;
  });
  if (args.axe) {
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const r = await page.evaluate(async () => {
      const res = await window.axe.run(document, { resultTypes: ['violations'] });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
    });
    report.axe = r;
    if (r.some((v) => v.impact === 'serious' || v.impact === 'critical')) failed = true;
  }
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, animations: 'disabled', caret: 'hide' });
  report.png = out;
  await context.close();
} catch (e) {
  report.errors.push(String(e.message ?? e).split('\n')[0]);
} finally {
  await browser.close();
  await server.close();
}
if (report.errors.length || report.overflow) failed = true;
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
