// Coalesces "reload" requests for one live query (useLive).
//
// A multi-document operation (pseudonymising 151 documents, restoring a batch) commits record
// by record, and every commit tells the store's subscribers what changed. Reloading on each of
// those notices meant a screen with an expensive query (Analysis parses every coding and every
// text) started a full load per commit, all of them running at once, and froze the window for
// tens of seconds. Here at most one load runs at a time: requests while it runs mark it stale and
// one trailing load follows, after a pause as long as the last load took (capped), so a costly
// query gives the operation at least half the time instead of starving it.

export interface GateClock {
  now(): number;
  defer(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

const realClock: GateClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  defer: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The longest a trailing reload waits, however slow the last load was. */
export const MAX_TRAILING_PAUSE_MS = 500;

export class ReloadGate {
  private running = false;
  private stale = false;
  private timer: unknown = null;
  private disposed = false;

  constructor(
    private readonly run: () => Promise<unknown>,
    private readonly clock: GateClock = realClock,
  ) {}

  /** Starts a load now (the first one), or right after the one running. */
  now(): void {
    if (this.disposed) return;
    if (this.running) this.stale = true;
    else this.start();
  }

  /** Asks for a reload: a burst of requests (one per commit) becomes a single load. */
  request(): void {
    if (this.disposed) return;
    if (this.running) this.stale = true;
    else if (this.timer === null) this.later(0);
  }

  /** No more loads (the query's inputs changed, or the screen went away). */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
  }

  private later(ms: number): void {
    this.timer = this.clock.defer(() => {
      this.timer = null;
      this.start();
    }, ms);
  }

  private start(): void {
    if (this.disposed) return;
    this.running = true;
    this.stale = false;
    const t0 = this.clock.now();
    const done = () => {
      this.running = false;
      if (this.disposed || !this.stale) return;
      this.stale = false;
      this.later(Math.min(MAX_TRAILING_PAUSE_MS, Math.max(0, this.clock.now() - t0)));
    };
    let p: Promise<unknown>;
    try {
      p = this.run();
    } catch {
      p = Promise.resolve();
    }
    p.then(done, done);
  }
}
