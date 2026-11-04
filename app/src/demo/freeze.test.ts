import { describe, expect, it } from 'vitest';
import { DateTime, Settings } from 'luxon';
import { freeze, unfreeze } from './freeze';

describe('freeze / unfreeze (INT: leaving the desktop example without a reload)', () => {
  it('gives the real clock, zone and randomness back', () => {
    const zone = Settings.defaultZone;
    const before = Date.now();
    freeze('2026-11-03T15:30');
    const fixed = DateTime.fromISO('2026-11-03T15:30', { zone: 'Europe/Lisbon' }).toMillis();
    expect(Date.now()).toBe(fixed);
    expect(new Date().getTime()).toBe(fixed);
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    unfreeze();
    expect(Date.now()).toBeGreaterThanOrEqual(before);
    expect(Settings.defaultZone).toBe(zone);
    // Real randomness again: two draws differ (the seeded one would repeat its sequence from the same seed).
    const x = new Uint8Array(16);
    const y = new Uint8Array(16);
    crypto.getRandomValues(x);
    crypto.getRandomValues(y);
    expect([...x]).not.toEqual([...y]);
    unfreeze();   // twice is harmless
  });
});
