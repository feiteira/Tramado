import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from './color';
import { CLASS_COLORS } from './classColor';

// UX §1.2: tokens.css is verified with Trama's contrast algorithm plus the lab's pairs
// (tools/lab/trama-ui/scripts/contrast.mjs) and the OKLab class-mix checks (classmix.mjs).
// This test fails the build when a pair drops below its minimum.

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');

function block(start: string): Map<string, string> {
  const at = css.indexOf(start);
  expect(at).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', at);
  const out = new Map<string, string>();
  for (const m of css.slice(at, end).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)) out.set(m[1]!, m[2]!.toLowerCase());
  return out;
}

const light = block(':root {');
const darkSystem = block(":root:not([data-theme='light']) {");
const dark = block(":root[data-theme='dark'] {");
const both = { light, dark: new Map([...light, ...dark]) };

// OKLab mixing, as CSS color-mix(in oklab, a p%, b) (classmix.mjs).
const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklab(rgb: number[]): number[] {
  const [r, g, b] = rgb.map(toLin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: number[]): string {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3;
  const m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3;
  const s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, fromLin(c))) * 255).toString(16).padStart(2, '0')).join('');
}
const mix = (a: string, b: string, p: number) => {
  const A = toOklab(hex2rgb(a));
  const B = toOklab(hex2rgb(b));
  return fromOklab(A.map((x, i) => x * p + B[i]! * (1 - p)));
};

describe('tokens.css (UX §1.2)', () => {
  it('both dark blocks agree', () => {
    expect([...darkSystem]).toEqual([...dark]);
  });

  for (const [name, t] of Object.entries(both)) {
    const c = (fg: string, bg: string) => contrast(t.get(fg) ?? fg, t.get(bg) ?? bg);
    const failures: string[] = [];
    const need = (fg: string, bg: string, min: number) => {
      const r = c(fg, bg);
      if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`);
    };
    it(`text, accent, AI, states and markers reach their minimum (${name})`, () => {
      failures.length = 0;
      const surfaces = [...t.keys()].filter((k) => k.startsWith('--paper') || /-soft$/.test(k) || k === '--mark');
      for (const ink of ['--ink', '--ink-2', '--ink-3']) for (const s of surfaces) need(ink, s, 4.5);
      need('--accent-ink', '--accent', 4.5);
      need('--accent-ink', '--accent-hover', 4.5);
      for (const s of ['--paper', '--paper-raised', '--paper-sunk', '--accent-soft', '--paper-hover']) need('--accent-text', s, 4.5);
      for (const s of ['--paper', '--paper-raised', '--ai-soft']) need('--ai-text', s, 4.5);
      for (const s of ['--paper-raised', '--paper']) need('--ai', s, 3);
      for (const st of ['danger', 'warning', 'success', 'info']) {
        need(`--${st}-text`, `--${st}-soft`, 4.5);
        need(`--${st}-text`, '--paper-raised', 4.5);
      }
      for (const s of ['--paper', '--paper-raised', '--paper-sunk']) need('--focus', s, 3);
      need('--accent', '--paper-raised', 3);
      need('--rec', '--paper-raised', 3);
      need('--rec-text', '--rec-soft', 5.5); // UX §1.2 quotes 5.54 (rounded; measured 5.539)
      need('--mark-ink', '--mark', 7);
      need('--danger-ink', '--danger', 4.5);
      need('--danger-ink', '--danger-hover', 4.5);
      for (const mk of ['--mk-important', '--mk-confused', '--mk-exam', '--mk-todo', '--mk-note'])
        for (const s of ['--paper', '--paper-raised', '--paper-sunk', '--paper-reading']) need(mk, s, 3);
      // .hl: color-mix(in oklab, var(--mk) 22%, var(--paper-reading)) under --ink and --ink-3.
      for (const mk of ['--mk-important', '--mk-confused', '--mk-exam', '--mk-todo', '--mk-note']) {
        const tint = mix(t.get(mk)!, t.get('--paper-reading')!, 0.22);
        for (const ink of ['--ink', '--ink-3']) need(ink, tint, 4.5);
      }
      expect(failures).toEqual([]);
    });

    it(`class colours mixed per .cls-scope stay readable (${name})`, () => {
      const low: string[] = [];
      for (const hex of CLASS_COLORS) {
        const text = mix(hex, t.get('--ink')!, 0.5);
        for (const bg of ['--paper', '--paper-raised', '--paper-sunk']) if (contrast(text, t.get(bg)!) < 4.5) low.push(`--c-text ${hex} on ${bg}`);
        const soft = mix(hex, t.get('--paper-raised')!, 0.16);
        for (const ink of ['--ink', '--ink-3']) if (contrast(t.get(ink)!, soft) < 4.5) low.push(`${ink} on --c-soft ${hex}`);
        if (contrast(mix(hex, t.get('--ink')!, 0.75), t.get('--paper-raised')!) < 3) low.push(`--c-bar ${hex}`);
      }
      expect(low).toEqual([]);
    });
  }
});
