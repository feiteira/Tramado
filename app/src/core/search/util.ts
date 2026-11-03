// Small shared helpers for the analysis modules: half-open spans, binary search, and the
// expansion of a code selection to the codes whose codings count for it.

/** A half-open range [start, end) of UTF-16 offsets. */
export interface Span {
  start: number;
  end: number;
}

/**
 * Returns the descendants of a code (children, grandchildren…), not the code itself, as ids or
 * as records with an id, so `buildTree(codes).descendants` (tree.ts) can be passed as it is.
 */
export type Descendants = (codeId: string) => Iterable<string | { id: string }>;

/** The descendant ids of a code. */
export function descendantIds(descendants: Descendants, codeId: string): string[] {
  const out: string[] = [];
  for (const d of descendants(codeId)) out.push(typeof d === 'string' ? d : d.id);
  return out;
}

/** Index of the first element greater than x in an ascending array (array length if none). */
export function upperBound(sorted: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element not less than x in an ascending array (array length if none). */
export function lowerBound(sorted: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Sorted union of spans: overlapping and touching spans are joined, empty ones dropped.
 * Touching spans are joined because a union is about covered characters, and [0,5)+[5,9)
 * covers the same characters as [0,9).
 */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** Number of characters covered by merged spans (as returned by mergeSpans). */
export function totalLength(merged: readonly Span[]): number {
  let n = 0;
  for (const s of merged) n += s.end - s.start;
  return n;
}

/** Intersection of two merged span lists (each sorted and non-overlapping). */
export function intersectSpans(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    const s = Math.max(x.start, y.start);
    const e = Math.min(x.end, y.end);
    if (s < e) out.push({ start: s, end: e });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

/** Characters shared by two merged span lists. */
export function intersectLength(a: readonly Span[], b: readonly Span[]): number {
  let n = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    const s = Math.max(x.start, y.start);
    const e = Math.min(x.end, y.end);
    if (s < e) n += e - s;
    if (x.end < y.end) i++;
    else j++;
  }
  return n;
}

/** Spans clamped to [0, length), dropping what falls outside. */
export function clampSpans(spans: readonly Span[], length: number): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const start = Math.max(0, Math.min(s.start, length));
    const end = Math.max(0, Math.min(s.end, length));
    if (end > start) out.push({ start, end });
  }
  return out;
}

/**
 * Maps each code id whose codings count to the indexes of the selected codes they count for.
 * With includeChildren, a coding of a descendant also counts for every selected ancestor, so a
 * coding can count for several rows (a parent and a child that are both selected).
 */
export function codeRows(
  codeIds: readonly string[],
  includeChildren = false,
  descendants?: Descendants,
): Map<string, number[]> {
  if (includeChildren && !descendants) throw new Error('includeChildren needs a descendants function');
  const rows = new Map<string, number[]>();
  const add = (id: string, row: number) => {
    const list = rows.get(id);
    if (!list) rows.set(id, [row]);
    else if (list[list.length - 1] !== row && !list.includes(row)) list.push(row);
  };
  codeIds.forEach((id, row) => {
    add(id, row);
    if (includeChildren) for (const d of descendantIds(descendants!, id)) add(d, row);
  });
  return rows;
}

/** Records that are not tombstones. */
export function live<T extends { deleted: boolean }>(records: readonly T[]): T[] {
  return records.filter((r) => !r.deleted);
}

/** Groups items by a key, keeping input order within each group. */
export function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}
