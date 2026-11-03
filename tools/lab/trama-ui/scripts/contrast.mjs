// Contrast checks for the proposed Tramado tokens (same algorithm as Trama's ui/color.ts).
import { readFileSync } from 'node:fs';

const css = readFileSync(process.argv[2], 'utf8');
function block(start) {
  const at = css.indexOf(start);
  if (at < 0) throw new Error('no block ' + start);
  const end = css.indexOf('}', at);
  const out = new Map();
  for (const m of css.slice(at, end).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)) out.set(m[1], m[2].toLowerCase());
  return out;
}
const lum = (hex) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function ensure(hex, bg, min) {
  if (contrast(hex, bg) >= min) return hex;
  const toward = lum(bg) > 0.18 ? 0 : 255;
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let out = hex;
  for (let step = 1; step <= 40; step++) {
    const t = step / 40;
    out = '#' + ch.map((c) => Math.round(c + (toward - c) * t).toString(16).padStart(2, '0')).join('');
    if (contrast(out, bg) >= min) break;
  }
  return out;
}
const themes = { light: block(':root {'), darkSystem: block(":root:not([data-theme='light']) {"), dark: block(":root[data-theme='dark'] {") };
const same = JSON.stringify([...themes.darkSystem]) === JSON.stringify([...themes.dark]);
console.log('dark blocks agree:', same);
let fails = 0;
const check = (name, t, fg, bg, min) => {
  const r = contrast(t.get(fg) ?? fg, t.get(bg) ?? bg);
  const ok = r >= min;
  if (!ok) fails++;
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${fg} on ${bg} = ${r.toFixed(2)} (min ${min})`);
  return r;
};
for (const [name, t] of Object.entries({ light: themes.light, dark: themes.dark })) {
  console.log(`--- ${name}`);
  const surfaces = [...t.keys()].filter((k) => k.startsWith('--paper') || /-soft$/.test(k) || k === '--mark');
  for (const ink of ['--ink', '--ink-2', '--ink-3']) for (const s of surfaces) check(name, t, ink, s, 4.5);
  check(name, t, '--accent-ink', '--accent', 4.5);
  check(name, t, '--accent-ink', '--accent-hover', 4.5);
  for (const s of ['--paper', '--paper-raised', '--paper-sunk', '--accent-soft', '--paper-hover']) check(name, t, '--accent-text', s, 4.5);
  for (const s of ['--paper', '--paper-raised', '--ai-soft']) check(name, t, '--ai-text', s, 4.5);
  for (const s of ['--paper-raised', '--paper']) check(name, t, '--ai', s, 3);
  for (const st of ['danger', 'warning', 'success', 'info']) {
    check(name, t, `--${st}-text`, `--${st}-soft`, 4.5);
    check(name, t, `--${st}-text`, '--paper-raised', 4.5);
  }
  check(name, t, '--focus', '--paper', 3);
  check(name, t, '--focus', '--paper-raised', 3);
  check(name, t, '--focus', '--paper-sunk', 3);
  check(name, t, '--accent', '--paper-raised', 3);
  check(name, t, '--rec', '--paper-raised', 3);
  check(name, t, '--mark-ink', '--mark', 7);
  const markBar = contrast(t.get('--mark-strong'), t.get('--paper-reading'));
  console.log(`info mark-strong on paper-reading = ${markBar.toFixed(2)} (decorative; cited passages also carry a numbered chip)`);
  check(name, t, '--danger-ink', '--danger', 4.5);
  check(name, t, '--danger-ink', '--danger-hover', 4.5);
  check(name, t, '--rule-strong', '--paper-raised', 1.3);
}

// Class colours (binder dividers): solid swatches; text/bar variants made with ensure() per theme.
const CLASS = ['#e5484d', '#f76b15', '#f5a524', '#8db600', '#30a46c', '#12a594', '#0090c8', '#3e63dd', '#6e56cf', '#ab4aba', '#d6409f', '#8d8d86'];
const ROWS = [];
for (const hex of CLASS) {
  const row = { hex };
  for (const [name, t] of Object.entries({ light: themes.light, dark: themes.dark })) {
    const bg = t.get('--paper-raised');
    row[`${name}Text`] = ensure(hex, bg, 4.5);
    row[`${name}Bar`] = ensure(hex, bg, 3);
    row[`${name}Raw`] = contrast(hex, bg).toFixed(2);
  }
  const white = contrast('#ffffff', hex), dark = contrast('#181d29', hex);
  row.label = white >= dark ? `white ${white.toFixed(2)}` : `ink ${dark.toFixed(2)}`;
  ROWS.push(row);
}
console.table(ROWS);
console.log(fails ? `${fails} failing pair(s)` : 'all pairs pass');
process.exit(fails ? 1 : 0);
