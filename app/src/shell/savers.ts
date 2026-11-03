// Work that must finish before the practice's database closes: a page's last words, a final
// backup. Locking (and, later, quitting) runs every saver first, stage by stage.

export type Saver = () => Promise<void> | void;

/** Savers run stage by stage, lowest first: pages are written before the backup reads them. */
export const SAVE_STAGE = { flush: 0, backup: 10 } as const;

export interface SaverOptions {
  /** Defaults to `SAVE_STAGE.flush`. Savers of one stage run together. */
  stage?: number;
  /** How long to wait for this saver before going on without it. Default 8 s. */
  limitMs?: number;
}

export const SAVER_LIMIT_MS = 8000;

interface Entry {
  fn: Saver;
  stage: number;
  limitMs: number;
}

export class Savers {
  private entries = new Set<Entry>();

  /** Adds a saver; returns the function that removes it. */
  register(fn: Saver, opts: SaverOptions = {}): () => void {
    const entry: Entry = { fn, stage: opts.stage ?? SAVE_STAGE.flush, limitMs: opts.limitMs ?? SAVER_LIMIT_MS };
    this.entries.add(entry);
    return () => void this.entries.delete(entry);
  }

  /** Runs every saver, stage by stage. A saver that fails or overruns is logged, never thrown. */
  async run(): Promise<void> {
    const entries = [...this.entries];
    const stages = [...new Set(entries.map((e) => e.stage))].sort((a, b) => a - b);
    for (const stage of stages) {
      await Promise.all(entries.filter((e) => e.stage === stage).map((e) => runLimited(e.fn, e.limitMs)));
    }
  }
}

async function runLimited(fn: Saver, limitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.error(`saver still running after ${limitMs} ms; going on without it`);
      resolve();
    }, limitMs);
  });
  const work = (async () => fn())().catch((e: unknown) => console.error('saver failed', e));
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps `fn` so that a call made while an earlier one is still running gets that run's promise
 * instead of starting another. The run is forgotten once it settles, even when it settled
 * without ever awaiting.
 */
export function oneAtATime<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let current: Promise<void> | null = null;
  return (...args) => {
    if (current) return current;
    const run = fn(...args);
    current = run;
    const forget = () => {
      if (current === run) current = null;
    };
    void run.then(forget, forget);
    return run;
  };
}

/**
 * A saver that waits for the work `current` returns (if any) to settle, failed or not: a lock
 * or the window closing then waits for an operation that must not be cut short half-way.
 */
export function waitForRunning(current: () => Promise<unknown> | null | undefined): Saver {
  return async () => {
    await current()?.catch(() => undefined);
  };
}
