// A manual clock for core tests (services/context's createManualClock is not importable from core).
export interface TestClock {
  now(): number; mono(): number; setTimeout(f: () => void, ms: number): () => void;
  /** Advances time, running due timers in order and letting promise chains settle between them. */
  advance(ms: number): Promise<void>;
  pending(): number;
}

export const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

export function createTestClock(startMs = 1_793_721_438_157): TestClock {
  let now = startMs;
  let mono = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; f: () => void }>();
  return {
    now: () => now,
    mono: () => mono,
    setTimeout(f, ms) {
      const id = ++seq;
      timers.set(id, { at: mono + Math.max(0, ms), f });
      return () => timers.delete(id);
    },
    async advance(ms) {
      const end = mono + ms;
      await flush();
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now += due[1].at - mono;
        mono = due[1].at;
        due[1].f();
        await flush();
      }
      now += end - mono;
      mono = end;
      await flush();
    },
    pending: () => timers.size,
  };
}
