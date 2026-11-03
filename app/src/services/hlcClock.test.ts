import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHlcClock } from './hlcClock';
import { Hlc } from '../core/hlc';

const V = JSON.parse(readFileSync(new URL('../../../test-vectors/hlc.json', import.meta.url), 'utf8'));

describe('hlcClock', () => {
  it('runs the sequences of test-vectors/hlc.json', () => {
    for (const seq of V.sequences) {
      let now = 0;
      const clock = new Hlc(seq.node, () => now);
      for (const step of seq.steps) {
        now = step.now;
        if (step.tick) expect(clock.tick(), seq.name).toBe(step.tick);
        if (step.observe) expect(clock.observe(step.observe), seq.name).toBe(step.result);
      }
    }
  });

  it('overrides registers (folder spec §3.4)', () => {
    for (const c of V.override) {
      const clock = createHlcClock(c.node, () => c.now, 0, async () => undefined);
      expect(clock.override(c.current), c.name).toBe(c.result);
    }
  });

  it('persists the ceiling before stamps pass it, and restarts above it', async () => {
    const writes: number[] = [];
    let now = 1000;
    const clock = createHlcClock('ab4z76w', () => now, 0, async (c) => void writes.push(c));
    clock.tick();
    expect(writes).toEqual([11_000]);
    now = 5000;
    clock.tick();
    expect(writes).toEqual([11_000]);
    now = 11_000;
    clock.tick();
    expect(writes).toEqual([11_000, 21_000]);
    await clock.flush();
    // A restart with a wall clock behind the ceiling never reissues an old stamp.
    const again = createHlcClock('ab4z76w', () => 2000, 21_000, async () => undefined);
    expect(again.tick() > '000000000021000').toBe(true);
  });
});
