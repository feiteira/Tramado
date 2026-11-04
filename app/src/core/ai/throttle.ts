// The client-side guard of openrouter-lab §8 / §11.5 rule 8: at most 18 `:free` requests in any 60 s window, at
// most 3 requests in flight, and interactive requests before bulk ones (exam batches, summaries of long lectures).
import { PlatformError } from '../errors';
import type { Priority } from './types';

export interface ThrottleClock { mono(): number; setTimeout(f: () => void, ms: number): () => void }
export interface ThrottleOptions { perMinute?: number; maxInFlight?: number; windowMs?: number }
export interface Throttle {
  /** Resolves with `release` once the request may start. Rejects with CANCELLED when `signal` aborts first. */
  acquire(opts: { free: boolean; priority: Priority; signal?: AbortSignal }): Promise<() => void>;
  stats(): { inFlight: number; waiting: number; recentFree: number };
  /** Milliseconds until another `:free` request may start (0 = now). */
  freeInMs(): number;
}

interface Waiter { free: boolean; priority: Priority; seq: number; resolve: (release: () => void) => void; reject: (e: unknown) => void; off: () => void }

export function createThrottle(clock: ThrottleClock, opts: ThrottleOptions = {}): Throttle {
  const perMinute = opts.perMinute ?? 18;
  const maxInFlight = opts.maxInFlight ?? 3;
  const windowMs = opts.windowMs ?? 60_000;
  const starts: number[] = [];          // mono times of recent :free starts
  const waiters: Waiter[] = [];
  let inFlight = 0;
  let seq = 0;
  let wake: (() => void) | null = null;

  const prune = () => {
    const now = clock.mono();
    while (starts.length && now - starts[0]! >= windowMs) starts.shift();
  };
  const freeInMs = () => {
    prune();
    return starts.length < perMinute ? 0 : Math.max(0, starts[0]! + windowMs - clock.mono());
  };

  function start(w: Waiter) {
    inFlight++;
    if (w.free) starts.push(clock.mono());
    w.off();
    let released = false;
    w.resolve(() => {
      if (released) return;
      released = true;
      inFlight--;
      pump();
    });
  }

  function pump() {
    prune();
    waiters.sort((a, b) => (a.priority === b.priority ? a.seq - b.seq : a.priority === 'interactive' ? -1 : 1));
    for (let i = 0; i < waiters.length && inFlight < maxInFlight; ) {
      const w = waiters[i]!;
      if (w.free && starts.length >= perMinute) {
        i++;
        continue;
      }
      waiters.splice(i, 1);
      start(w);
    }
    wake?.();
    wake = null;
    if (waiters.some((w) => w.free) && inFlight < maxInFlight) {
      const ms = freeInMs();
      if (ms > 0) wake = clock.setTimeout(() => {
        wake = null;
        pump();
      }, ms);
    }
  }

  return {
    acquire({ free, priority, signal }) {
      return new Promise<() => void>((resolve, reject) => {
        if (signal?.aborted) return reject(new PlatformError('CANCELLED', 'cancelled'));
        const w: Waiter = { free, priority, seq: ++seq, resolve, reject, off: () => undefined };
        if (signal) {
          const onAbort = () => {
            const i = waiters.indexOf(w);
            if (i >= 0) waiters.splice(i, 1);
            reject(new PlatformError('CANCELLED', 'cancelled'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
          w.off = () => signal.removeEventListener('abort', onAbort);
        }
        waiters.push(w);
        pump();
      });
    },
    stats: () => {
      prune();
      return { inFlight, waiting: waiters.length, recentFree: starts.length };
    },
    freeInMs,
  };
}
