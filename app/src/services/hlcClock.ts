// The device's HLC (folder spec §3.3) with its persisted ceiling (data/hlc.json): whenever a stamp would
// pass the persisted ceiling, the new ceiling (lastMs + 10 000) is written before the stamp is used.
// Writes are fire-and-forget but ordered; at start lastMs = max(now, ceilingMs). Frozen after M0.
import { Hlc, maxHlc, succHlc } from '../core/hlc';
import type { HlcFile } from '../core/model/files';
import type { Platform } from '../platform/types';
import type { HlcClock } from './context';

export const CEILING_STEP_MS = 10_000;

export function parseHlcFile(raw: string | null): number {
  if (!raw) return 0;
  try {
    const f = JSON.parse(raw) as Partial<HlcFile>;
    return f.format === 'tramado.hlc' && typeof f.ceilingMs === 'number' && Number.isFinite(f.ceilingMs) ? f.ceilingMs : 0;
  } catch {
    return 0;
  }
}

/**
 * Creates the clock for `node` (the device's ShortId in lower case). `persist` writes data/hlc.json; tests pass
 * a recorder. The ceiling write is synchronous from the clock's point of view: tick() raises the in-memory ceiling
 * first and queues the write, so a stamp is never issued above a ceiling that was not at least queued.
 */
export function createHlcClock(
  node: string,
  now: () => number,
  ceilingMs: number,
  persist: (ceilingMs: number) => Promise<void>,
): HlcClock & { readonly ceiling: number; flush(): Promise<void> } {
  let ceiling = ceilingMs;
  const startMs = Math.max(now(), ceilingMs);
  const hlc = new Hlc(node, now);
  hlc.fromState({ ms: startMs, counter: 0 });
  let chain: Promise<void> = Promise.resolve();
  const guard = () => {
    const { ms } = hlc.toState();
    if (ms >= ceiling) {
      ceiling = ms + CEILING_STEP_MS;
      // Started at once (not queued behind a microtask), so the write is under way before the stamp is used.
      const write = persist(ceiling).catch(() => undefined);
      chain = chain.then(() => write);
    }
  };
  const clock = {
    get ceiling() {
      return ceiling;
    },
    tick() {
      const s = hlc.tick();
      guard();
      return s;
    },
    observe(stamp: string) {
      const r = hlc.observe(stamp);
      guard();
      return r;
    },
    override(current: string | null) {
      const t = clock.tick();
      return current ? maxHlc(t, succHlc(current, node)) : t;
    },
    flush: () => chain,
  };
  return clock;
}

/** The clock over platform.appFiles (`hlc.json`). */
export async function createPlatformHlcClock(platform: Pick<Platform, 'appFiles'>, node: string, now: () => number) {
  const ceiling = parseHlcFile(await platform.appFiles.read('hlc.json'));
  return createHlcClock(node, now, ceiling, (c) =>
    platform.appFiles.write('hlc.json', JSON.stringify({ format: 'tramado.hlc', version: 1, ceilingMs: c } satisfies HlcFile)),
  );
}
