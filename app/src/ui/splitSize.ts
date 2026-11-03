// Sizes of a SplitPane's first pane: clamped, and remembered per pane (localStorage, which can
// be missing or throw in a private window: the default is used then).

export interface SplitLimits {
  min: number;
  max: number;
  /** The whole pane's size; the second pane keeps at least `minRest` of it. */
  total?: number;
  minRest?: number;
}

/** The size to use, within the limits. Non-numbers fall back to `min`. */
export function clampSplit(size: number, { min, max, total, minRest = 0 }: SplitLimits): number {
  let hi = max;
  if (total !== undefined && total > 0) hi = Math.min(hi, total - minRest);
  hi = Math.max(min, hi);
  if (!Number.isFinite(size)) return min;
  return Math.round(Math.max(min, Math.min(size, hi)));
}

const PREFIX = 'tramado.split.';

export function loadSplit(key: string, fallback: number, storage: Pick<Storage, 'getItem'> | null = safeStorage()): number {
  try {
    const raw = storage?.getItem(PREFIX + key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

export function saveSplit(key: string, size: number, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(PREFIX + key, String(Math.round(size)));
  } catch {
    // Not remembered: a private window or blocked storage. The size still applies now.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
