import { describe, expect, it } from 'vitest';
import { MAX_TRAILING_PAUSE_MS, ReloadGate, type GateClock } from './reloadGate';

/** A clock the test moves by hand. */
function fakeClock() {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const clock: GateClock = {
    now: () => t,
    defer: (fn, ms) => {
      const id = ++ids;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    cancel: (h) => {
      timers = timers.filter((x) => x.id !== h);
    },
  };
  const advance = async (ms: number) => {
    t += ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      due.fn();
      await flush();
    }
    await flush();
  };
  return { clock, advance, pending: () => timers.length, set: (v: number) => (t = v) };
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A load the test finishes by hand. */
function loads() {
  const open: (() => void)[] = [];
  let started = 0;
  return {
    run: () => {
      started++;
      return new Promise<void>((resolve) => open.push(resolve));
    },
    finish: async () => {
      open.shift()?.();
      await flush();
    },
    get started() {
      return started;
    },
    get running() {
      return open.length;
    },
  };
}

describe('ReloadGate', () => {
  it('turns a burst of change notices into one load', async () => {
    const { clock, advance } = fakeClock();
    const l = loads();
    const gate = new ReloadGate(l.run, clock);
    for (let i = 0; i < 151; i++) gate.request();
    expect(l.started).toBe(0);
    await advance(0);
    expect(l.started).toBe(1);
  });

  it('never runs two loads at once: notices during a load give one trailing load', async () => {
    const { clock, advance } = fakeClock();
    const l = loads();
    const gate = new ReloadGate(l.run, clock);
    gate.now();
    expect(l.started).toBe(1);
    for (let i = 0; i < 50; i++) gate.request();
    expect(l.started).toBe(1);
    await advance(300); // the load takes 300 ms
    await l.finish();
    expect(l.running).toBe(0);
    // It waits as long as the last load took before reloading, giving the work time to run.
    await advance(299);
    expect(l.started).toBe(1);
    await advance(1);
    expect(l.started).toBe(2);
    await l.finish();
    await advance(10_000);
    expect(l.started).toBe(2);
  });

  it('caps the pause after a very slow load', async () => {
    const { clock, advance } = fakeClock();
    const l = loads();
    const gate = new ReloadGate(l.run, clock);
    gate.now();
    gate.request();
    await advance(40_000);
    await l.finish();
    await advance(MAX_TRAILING_PAUSE_MS);
    expect(l.started).toBe(2);
  });

  it('still reloads after a failed load', async () => {
    const { clock, advance } = fakeClock();
    let n = 0;
    const gate = new ReloadGate(() => (++n === 1 ? Promise.reject(new Error('locked')) : Promise.resolve()), clock);
    gate.now();
    gate.request();
    await flush();
    await advance(0);
    expect(n).toBe(2);
  });

  it('does nothing once disposed', async () => {
    const { clock, advance, pending } = fakeClock();
    const l = loads();
    const gate = new ReloadGate(l.run, clock);
    gate.request();
    gate.dispose();
    expect(pending()).toBe(0);
    gate.request();
    gate.now();
    await advance(1000);
    expect(l.started).toBe(0);
  });
});
