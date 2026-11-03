// Shared by tools/peek.mjs and tools/peek-matrix.mjs: an in-process Vite server (no HMR) over the browser
// demo, playwright-core Chromium, the settle rules of Trama's capture.mjs, the step and assertion verbs of
// plan §2.3 item 10, an axe-core scan and a sideways-overflow check.
// Adapted from tools/lab/trama-ui/scripts/peek.mjs (MPL-2.0, from Trama's tools/screenshots/capture.mjs).
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

export const DEFAULT_CLOCK = '2026-11-03T15:30';
export const STEP_VERBS = ['click', 'press', 'type', 'expect', 'expect-not', 'expect-text', 'expect-attr'];

/** Starts Vite on the app and launches Chromium. */
export async function startPeek({ app = 'app', port = 1530 } = {}) {
  const APP = resolve(app);
  const require = createRequire(join(APP, 'package.json'));
  const { createServer } = await import(require.resolve('vite'));
  const { chromium } = require('playwright-core');
  const server = await createServer({
    root: APP,
    configFile: join(APP, 'vite.config.ts'),
    server: { port, strictPort: false, hmr: false, watch: null },
    logLevel: 'error',
    clearScreen: false,
  });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch();
  return {
    base,
    browser,
    axePath: require.resolve('axe-core/axe.min.js'),
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

/** One step: { click } | { press } | { type: "id=text" } | { expect: "id[:n]" } | { 'expect-not' } | { 'expect-text': "id=sub" } | { 'expect-attr': "id:attr=value|null" }. */
async function runStep(page, step) {
  const [verb, raw] = Object.entries(step)[0];
  const value = String(raw);
  const byId = (id) => page.getByTestId(id);
  switch (verb) {
    case 'click':
      for (const id of value.split(',').filter(Boolean)) await byId(id).first().click({ timeout: 15000 });
      return;
    case 'press':
      for (const key of value.split(',').filter(Boolean)) await page.keyboard.press(key);
      return;
    case 'type': {
      const i = value.indexOf('=');
      const id = value.slice(0, i);
      const text = value.slice(i + 1);
      const el = byId(id).first();
      await el.waitFor({ timeout: 15000 });
      const tag = await el.evaluate((n) => n.tagName);
      const target = tag === 'INPUT' || tag === 'TEXTAREA' ? el : el.locator('input, textarea, [contenteditable="true"]').first();
      await target.fill(text);
      return;
    }
    case 'expect': {
      const [id, n] = value.split(':');
      if (n === undefined) {
        await byId(id).first().waitFor({ timeout: 15000 });
        return;
      }
      const want = Number(n);
      const deadline = Date.now() + 15000;
      let got = -1;
      while (Date.now() < deadline) {
        got = await byId(id).count();
        if (got === want) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`expect ${id}: ${got} elements, wanted ${want}`);
    }
    case 'expect-not': {
      await page.waitForTimeout(200);
      const got = await byId(value).count();
      if (got !== 0) throw new Error(`expect-not ${value}: found ${got}`);
      return;
    }
    case 'expect-text': {
      const i = value.indexOf('=');
      const id = value.slice(0, i);
      const sub = value.slice(i + 1);
      const el = byId(id).first();
      await el.waitFor({ timeout: 15000 });
      const deadline = Date.now() + 5000;
      let text = '';
      while (Date.now() < deadline) {
        text = (await el.textContent()) ?? '';
        if (text.includes(sub)) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`expect-text ${id}: "${text.slice(0, 120)}" does not contain "${sub}"`);
    }
    case 'expect-attr': {
      const m = /^([^:]+):([^=]+)=(.*)$/.exec(value);
      if (!m) throw new Error(`expect-attr: bad argument "${value}" (want testid:attr=value|null)`);
      const [, id, attr, want] = m;
      const el = byId(id).first();
      await el.waitFor({ state: 'attached', timeout: 15000 });
      const got = await el.getAttribute(attr);
      if (want === 'null' ? got !== null : got !== want) throw new Error(`expect-attr ${id} ${attr}: ${got === null ? 'absent' : `"${got}"`}, wanted ${want === 'null' ? 'absent' : `"${want}"`}`);
      return;
    }
    default:
      throw new Error(`unknown step verb "${verb}"`);
  }
}

/**
 * One screenshot. opts: { route, query, lang, theme, clock, size, scale, ready, axe, out, steps }.
 * Returns { png, errors, console, overflow, axe, failed }.
 */
export async function shoot(env, opts) {
  const [w, h] = (opts.size ?? '1440x900').split('x').map(Number);
  const VIEWPORT = { width: w, height: h };
  const theme = opts.theme ?? 'light';
  const lang = opts.lang ?? 'en';
  const report = { png: null, errors: [], console: [], overflow: null, axe: null, failed: false };
  const context = await env.browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: Number(opts.scale) || 1, colorScheme: theme, reducedMotion: 'reduce',
    locale: { en: 'en-GB', pt: 'pt-PT', es: 'es-ES' }[lang] ?? 'en-GB', timezoneId: 'Europe/Lisbon',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && report.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  try {
    const qs = new URLSearchParams({ lang, theme, clock: opts.clock ?? DEFAULT_CLOCK });
    if (opts.route) qs.set('route', opts.route);
    await page.goto(`${env.base}?${qs}${opts.query ? `&${opts.query}` : ''}`);
    await page.waitForFunction(() => document.querySelector('#root')?.children.length, null, { timeout: 60000 });
    if (opts.ready) await page.getByTestId(opts.ready).first().waitFor({ timeout: 60000 });
    for (const step of opts.steps ?? []) {
      try {
        await runStep(page, step);
      } catch (e) {
        report.errors.push(`step ${JSON.stringify(step)}: ${String(e.message ?? e).split('\n')[0]}`);
        break;
      }
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
    if (opts.axe) {
      // Evaluated through the devtools protocol: the app's CSP (no inline scripts) stays on.
      await page.evaluate(readFileSync(env.axePath, 'utf8'));
      const r = await page.evaluate(async () => {
        const res = await window.axe.run(document, { resultTypes: ['violations'] });
        return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
      });
      report.axe = r;
      if (r.some((v) => v.impact === 'serious' || v.impact === 'critical')) report.failed = true;
    }
    if (opts.out) {
      mkdirSync(dirname(opts.out), { recursive: true });
      await page.screenshot({ path: opts.out, animations: 'disabled', caret: 'hide' });
      report.png = opts.out;
    }
  } catch (e) {
    report.errors.push(String(e.message ?? e).split('\n')[0]);
  } finally {
    await context.close();
  }
  if (report.errors.length || report.overflow) report.failed = true;
  return report;
}
