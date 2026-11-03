import { describe, expect, it } from 'vitest';
import { clampSplit, loadSplit, saveSplit } from './splitSize';

describe('clampSplit', () => {
  it('keeps the size within min and max', () => {
    expect(clampSplit(50, { min: 160, max: 600 })).toBe(160);
    expect(clampSplit(900, { min: 160, max: 600 })).toBe(600);
    expect(clampSplit(301.6, { min: 160, max: 600 })).toBe(302);
  });
  it('leaves the second pane its minimum, but never goes below min', () => {
    expect(clampSplit(700, { min: 160, max: 800, total: 900, minRest: 300 })).toBe(600);
    expect(clampSplit(700, { min: 160, max: 800, total: 300, minRest: 300 })).toBe(160);
  });
  it('falls back to min for nonsense', () => {
    expect(clampSplit(NaN, { min: 160, max: 600 })).toBe(160);
    expect(clampSplit(Infinity, { min: 160, max: 600 })).toBe(160);
  });
});

describe('loadSplit / saveSplit', () => {
  it('round-trips through storage', () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveSplit('codes', 333.4, storage);
    expect(loadSplit('codes', 200, storage)).toBe(333);
    expect(loadSplit('other', 200, storage)).toBe(200);
  });
  it('survives storage that is missing, throws or holds garbage', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadSplit('x', 240, throwing)).toBe(240);
    expect(() => saveSplit('x', 100, throwing)).not.toThrow();
    expect(loadSplit('x', 240, null)).toBe(240);
    expect(loadSplit('x', 240, { getItem: () => 'abc' })).toBe(240);
    expect(loadSplit('x', 240, { getItem: () => '-5' })).toBe(240);
  });
});
