// Builds mock/index.html from mock/template.html (lucide-static icons inlined, class colours)
// and screenshots it in light and dark with playwright-core (headless Chromium from
// ~/.cache/ms-playwright), the way Trama's tools/screenshots/capture.mjs does.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const LAB = join(import.meta.dirname, '..');
const require = createRequire(join(LAB, 'dl/package.json'));
const { chromium } = require('playwright-core');
const ICONS = join(LAB, 'dl/node_modules/lucide-static/icons');
const CLASS = ['#e5484d', '#f76b15', '#f5a524', '#8db600', '#30a46c', '#12a594', '#0090c8', '#3e63dd', '#6e56cf', '#ab4aba', '#d6409f', '#8d8d86'];
const ON = ['#181d29', '#181d29', '#181d29', '#181d29', '#181d29', '#181d29', '#181d29', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#181d29'];

const name = process.argv[2] ?? 'template';
let html = readFileSync(join(LAB, `mock/${name}.html`), 'utf8');
html = html.replace(/\{\{c:(\d+)\}\}/g, (_, n) => `--c:${CLASS[n - 1]};--c-on:${ON[n - 1]}`);
html = html.replace(/\{\{wave\}\}/g, () =>
  Array.from({ length: 64 }, (_, i) => `<span class="${i < 26 ? 'p' : ''}" style="height:${6 + Math.round(20 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.37)))}px"></span>`).join(''),
);
html = html.replace(/\{\{([a-z0-9-]+)\}\}/g, (_, icon) =>
  readFileSync(join(ICONS, `${icon}.svg`), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace('<svg', '<svg class="i" aria-hidden="true"')
    .replace(/\s(width|height)="24"/g, '')
    .trim(),
);
const out = join(LAB, `mock/${name === 'template' ? 'index' : name + '.out'}.html`);
writeFileSync(out, html);

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`));
  await page.goto(`file://${out}`);
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family))]);
  const png = join(LAB, `mock/${name}-${theme}.png`);
  await page.screenshot({ path: png });
  console.log(png, 'fonts:', fonts.join(', '), errors.length ? `errors: ${errors.join('; ')}` : '');
  await ctx.close();
}
await browser.close();
