// Pure debounce helpers over an injected clock (services use AppContext.clock; tests use fakes).

export interface TimerClock {
  setTimeout(f: () => void, ms: number): () => void;
}

/** Calls `f` once, `ms` after the last call; `flush()` runs a pending call now; `cancel()` drops it. */
export function debounce<A extends unknown[]>(clock: TimerClock, ms: number, f: (...args: A) => void) {
  let cancel: (() => void) | null = null;
  let last: A | null = null;
  const run = () => {
    cancel = null;
    const a = last;
    last = null;
    if (a) f(...a);
  };
  const call = (...args: A) => {
    last = args;
    cancel?.();
    cancel = clock.setTimeout(run, ms);
  };
  call.flush = () => {
    cancel?.();
    run();
  };
  call.cancel = () => {
    cancel?.();
    cancel = null;
    last = null;
  };
  call.pending = () => last !== null;
  return call;
}

/** At most one call per `ms`; the last call inside a window runs at its end. */
export function throttle<A extends unknown[]>(clock: TimerClock & { now(): number }, ms: number, f: (...args: A) => void) {
  let lastRun = -Infinity;
  let timer: (() => void) | null = null;
  let pending: A | null = null;
  return (...args: A) => {
    const now = clock.now();
    if (now - lastRun >= ms && !timer) {
      lastRun = now;
      f(...args);
      return;
    }
    pending = args;
    if (!timer) {
      timer = clock.setTimeout(() => {
        timer = null;
        lastRun = clock.now();
        const a = pending;
        pending = null;
        if (a) f(...a);
      }, Math.max(0, ms - (now - lastRun)));
    }
  };
}
