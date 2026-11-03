import { describe, expect, it } from 'vitest';
import { CLASS_COLORS as PALETTE } from './classColor';
import { contrast, inkOn, luminance, normalizeHex, withAlpha } from './color';

describe('normalizeHex', () => {
  it('accepts what people type', () => {
    expect(normalizeHex('#3A6EA5')).toBe('#3a6ea5');
    expect(normalizeHex(' 3a6ea5 ')).toBe('#3a6ea5');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('fff')).toBe('#ffffff');
  });
  it('refuses what is not a colour', () => {
    for (const bad of ['', '#', '#12', '#12345', '#1234567', 'red', '#ggg', '##123456']) expect(normalizeHex(bad)).toBeNull();
  });
});

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#777777', '#777777')).toBe(1);
  });

  it('chooses readable text on every palette colour (at least 3:1 for chip labels)', () => {
    for (const c of PALETTE) expect(contrast(c, inkOn(c))).toBeGreaterThanOrEqual(3);
  });
});

describe('withAlpha', () => {
  it('makes rgba, clamping alpha, with a grey fallback', () => {
    expect(withAlpha('#3a6ea5', 0.2)).toBe('rgba(58, 110, 165, 0.2)');
    expect(withAlpha('#3a6ea5', 4)).toBe('rgba(58, 110, 165, 1)');
    expect(withAlpha('nope', 0.5)).toBe('rgba(122, 127, 135, 0.5)');
  });
});
