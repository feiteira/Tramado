// Hybrid logical clock. Every write is stamped with one, so that edits made on different
// devices (or restored from a backup) can be ordered without trusting wall clocks alone.
// Format: 15-digit milliseconds, 5-digit base-36 counter, device id — fixed width, so plain
// string comparison orders stamps correctly.

export interface HlcParts {
  ms: number;
  counter: number;
  device: string;
}

const MS_WIDTH = 15;
const COUNTER_WIDTH = 5;

export function formatHlc({ ms, counter, device }: HlcParts): string {
  return `${String(ms).padStart(MS_WIDTH, '0')}-${counter.toString(36).padStart(COUNTER_WIDTH, '0')}-${device}`;
}

export function parseHlc(s: string): HlcParts {
  const m = /^(\d{15})-([0-9a-z]{5})-([0-9a-z]+)$/.exec(s);
  if (!m) throw new Error(`invalid HLC: ${s}`);
  return { ms: Number(m[1]), counter: parseInt(m[2]!, 36), device: m[3]! };
}

export const compareHlc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Hlc {
  private ms = 0;
  private counter = 0;

  constructor(
    readonly device: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^[0-9a-z]+$/.test(device)) throw new Error('device id must be lowercase alphanumeric');
  }

  /** A new stamp, strictly greater than every stamp this clock has issued or observed. */
  tick(): string {
    const pt = this.now();
    if (pt > this.ms) {
      this.ms = pt;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return formatHlc({ ms: this.ms, counter: this.counter, device: this.device });
  }

  /**
   * Advances the clock past a stamp that came from elsewhere (an import, later sync).
   * Tramado guard (folder spec §3.3–3.4): a stamp more than 1 hour ahead of this device's wall
   * clock is still ordered by its readers, but never observed — it returns 'ahead' and leaves the
   * clock alone, so one device with a wrong clock cannot drag every other clock forward.
   */
  observe(remote: string): 'ok' | 'ahead' {
    const r = parseHlc(remote);
    const pt = this.now();
    if (r.ms > pt + FAR_AHEAD_MS) return 'ahead';
    const max = Math.max(pt, this.ms, r.ms);
    if (max === this.ms && max === r.ms) this.counter = Math.max(this.counter, r.counter) + 1;
    else if (max === this.ms) this.counter++;
    else if (max === r.ms) this.counter = r.counter + 1;
    else this.counter = 0;
    this.ms = max;
    return 'ok';
  }

  /** The clock's state, to persist (with the ceiling rule of folder spec §3.3, services/hlcClock.ts). */
  toState(): { ms: number; counter: number } {
    return { ms: this.ms, counter: this.counter };
  }

  /** Restores a state: the clock never goes back below what it had issued. */
  fromState(s: { ms: number; counter: number }): void {
    if (s.ms > this.ms || (s.ms === this.ms && s.counter > this.counter)) {
      this.ms = s.ms;
      this.counter = s.counter;
    }
  }
}

/** Stamps further ahead than this (1 hour) are ordered but not observed (folder spec §3.4). */
export const FAR_AHEAD_MS = 3_600_000;

/**
 * `succ(h)` of folder spec §3.4: the stamp `h` with counter + 1 and `node` as its node. Used to
 * override a last-writer-wins register whose current value was stamped by a clock far ahead.
 */
export function succHlc(h: string, node: string): string {
  const p = parseHlc(h);
  return formatHlc({ ms: p.ms, counter: p.counter + 1, device: node });
}

/** The greater of two stamps (string order). */
export const maxHlc = (a: string, b: string): string => (a >= b ? a : b);
