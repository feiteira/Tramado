import { RE_COLOUR_HEX as HEX_COLOR } from '../core/model/ids';

// Colour helpers for swatches and code chips. Pure, tested in Node.

/**
 * A colour as Trama stores it (#rrggbb, lower case), from what someone typed: with or without
 * '#', three or six digits, any case, surrounding spaces. Null when it is not a colour.
 */
export function normalizeHex(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX_COLOR.test(s) ? s : null;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = normalizeHex(hex);
  if (!n) return 0;
  const ch = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Dark or light text, whichever reads better on `background` (labels on code-coloured chips). */
export function inkOn(background: string, dark = '#1d2130', light = '#ffffff'): string {
  return contrast(background, dark) >= contrast(background, light) ? dark : light;
}

/** `hex` at `alpha` opacity as rgba(), for soft highlights of a code's colour. */
export function withAlpha(hex: string, alpha: number): string {
  const n = normalizeHex(hex) ?? '#7a7f87';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * `hex` darkened (on a light background) or lightened (on a dark one) just enough to reach
 * `min` contrast against `background`, keeping its hue: a pale code colour (amber, lime) still
 * needs 3:1 for its underline band and margin bar to be seen (WCAG 1.4.11).
 */
export function ensureContrast(hex: string, background: string, min = 3): string {
  const n = normalizeHex(hex) ?? '#7a7f87';
  if (contrast(n, background) >= min) return n;
  const toward = luminance(background) > 0.18 ? 0 : 255;
  const ch = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16));
  let out = n;
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    out = `#${ch.map((c) => Math.round(c + (toward - c) * t).toString(16).padStart(2, '0')).join('')}`;
    if (contrast(out, background) >= min) break;
  }
  return out;
}
