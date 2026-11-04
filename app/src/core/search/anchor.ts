// Finding a stored quote again (folder spec §8.15 TextQuote, §8.17 re-anchoring, research
// audio-pipeline §5.5): the exact text where it was, else the occurrence whose prefix/suffix agree
// best (then the nearest to where it was), else the same words with different spacing, else a fuzzy
// match (approximate string matching, at most a quarter of the quote's characters wrong).
// Transcript anchors (segment locators) re-anchor in the segment, through `merged` redirects, in the
// segments overlapping its time, and finally fall back to the time itself ("approximate").
import type { Locator, TextQuote } from '../model/files';

export interface Anchored { start: number; end: number; how: 'exact' | 'nearest' | 'spacing' | 'fuzzy' }

const PREFIX = 32;
const SUFFIX = 32;
const EXACT_MAX = 300;

/** A TextQuote for [start, end) of `text`: exact ≤ 300 chars, prefix/suffix ≤ 32 (folder spec §8.15). */
export function makeQuote(text: string, start: number, end: number): TextQuote {
  const e = Math.min(end, start + EXACT_MAX);
  return { exact: text.slice(start, e), prefix: text.slice(Math.max(0, start - PREFIX), start), suffix: text.slice(e, e + SUFFIX) };
}

function agreement(text: string, at: number, q: TextQuote): number {
  let score = 0;
  for (let i = 1; i <= q.prefix.length && at - i >= 0 && text[at - i] === q.prefix[q.prefix.length - i]; i++) score++;
  const after = at + q.exact.length;
  for (let i = 0; i < q.suffix.length && after + i < text.length && text[after + i] === q.suffix[i]; i++) score++;
  return score;
}

/** Every exact occurrence, best first: prefix/suffix agreement, then distance to `hint`. */
function exactOccurrences(text: string, q: TextQuote, hint: number | undefined): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(q.exact); at !== -1 && found.length < 10_000; at = text.indexOf(q.exact, at + 1)) found.push(at);
  return found
    .map((at) => ({ at, s: agreement(text, at, q), d: hint === undefined ? 0 : Math.abs(at - hint) }))
    .sort((a, b) => b.s - a.s || a.d - b.d || a.at - b.at)
    .map((x) => x.at);
}

/** `text` with every run of white space collapsed to one space, and the map back to `text`. */
function collapseSpace(text: string): { s: string; map: number[] } {
  let s = '';
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]!)) {
      if (!space) {
        s += ' ';
        map.push(i);
      }
      space = true;
    } else {
      s += text[i];
      map.push(i);
      space = false;
    }
  }
  map.push(text.length);
  return { s, map };
}

/**
 * Approximate occurrence of `pattern` in `text` (Sellers' algorithm, edit distance with a free
 * start): the end with the fewest edits ≤ maxErrors, then the start found by walking back. Case is
 * ignored. O(|text| · |pattern|): callers bound the text.
 */
export function fuzzyFind(text: string, pattern: string, maxErrors: number): { start: number; end: number; errors: number } | null {
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  const m = p.length;
  if (!m || !t.length) return null;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  const startPrev = new Int32Array(m + 1);
  const startCur = new Int32Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best: { end: number; errors: number; start: number } | null = null;
  let sPrev = startPrev;
  let sCur = startCur;
  for (let j = 1; j <= t.length; j++) {
    cur[0] = 0;
    sCur[0] = j;
    const c = t.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const sub = prev[i - 1]! + (p.charCodeAt(i - 1) === c ? 0 : 1);
      const del = prev[i]! + 1;       // text char skipped
      const ins = cur[i - 1]! + 1;     // pattern char missing
      if (sub <= del && sub <= ins) {
        cur[i] = sub;
        sCur[i] = sPrev[i - 1]!;
      } else if (del <= ins) {
        cur[i] = del;
        sCur[i] = sPrev[i]!;
      } else {
        cur[i] = ins;
        sCur[i] = sCur[i - 1]!;
      }
    }
    if (cur[m]! <= maxErrors && (!best || cur[m]! < best.errors)) best = { end: j, errors: cur[m]!, start: sCur[m]! };
    [prev, cur] = [cur, prev];
    [sPrev, sCur] = [sCur, sPrev];
  }
  return best ? { start: best.start, end: best.end, errors: best.errors } : null;
}

export interface FindQuoteOptions {
  /** Where the quote was (an offset in `text`): breaks ties and centres the fuzzy search window. */
  hint?: number;
  /** Allow fuzzy matches (default true). */
  fuzzy?: boolean;
  /** Characters searched around `hint` by the fuzzy step (default 6 000; whole text when it is shorter). */
  window?: number;
}

/** Finds a stored quote in a text that may have changed. */
export function findQuote(text: string, q: TextQuote, opts: FindQuoteOptions = {}): Anchored | null {
  if (!q.exact) return null;
  const exact = exactOccurrences(text, q, opts.hint);
  if (exact.length) {
    const at = exact[0]!;
    const how = exact.length === 1 || at === opts.hint ? 'exact' : 'nearest';
    return { start: at, end: at + q.exact.length, how };
  }
  const c = collapseSpace(text);
  const cq = collapseSpace(q.exact.trim()).s;
  if (cq) {
    const at = c.s.indexOf(cq);
    if (at !== -1) return { start: c.map[at]!, end: c.map[at + cq.length - 1]! + 1, how: 'spacing' };
  }
  if (opts.fuzzy === false || cq.length < 8) return null;
  const win = opts.window ?? 6000;
  let from = 0;
  let to = text.length;
  if (text.length > win) {
    const centre = Math.min(Math.max(opts.hint ?? 0, 0), text.length);
    from = Math.max(0, centre - win / 2);
    to = Math.min(text.length, from + win);
  }
  const hit = fuzzyFind(text.slice(from, to), q.exact, Math.floor(q.exact.length / 4));
  return hit ? { start: from + hit.start, end: from + hit.end, how: 'fuzzy' } : null;
}

// ── Transcript anchors ──────────────────────────────────────────────────────────────────────────

export interface AnchorSegment { id: string; startMs: number; endMs: number; text: string; merged?: string[] }
export type SegmentLocator = Extract<Locator, { type: 'segment' }>;
export interface SegmentAnchor {
  locator: SegmentLocator;
  status: 'exact' | 'moved' | 'approximate';
}

/**
 * Re-anchors a transcript quote (research audio-pipeline §5.5): (1) same segment (or the one it was
 * merged into) and same characters → exact; (2) the quote elsewhere in that segment → moved;
 * (3) a fuzzy match in it, then in the segments overlapping its time → moved; (4) its time →
 * approximate (always valid for playback: the audio never changes).
 */
export function reanchorSegment(segments: readonly AnchorSegment[], loc: SegmentLocator, quote: TextQuote | null): SegmentAnchor {
  const own = segments.find((s) => s.id === loc.segmentId) ?? segments.find((s) => s.merged?.includes(loc.segmentId));
  const found = (s: AnchorSegment, a: { start: number; end: number }, status: SegmentAnchor['status']): SegmentAnchor => ({
    locator: { type: 'segment', segmentId: s.id, startMs: s.startMs, endMs: s.endMs, charStart: a.start, charEnd: a.end },
    status,
  });
  if (own && quote?.exact) {
    const same = own.id === loc.segmentId;
    if (same && loc.charStart !== undefined && own.text.slice(loc.charStart, loc.charStart + quote.exact.length) === quote.exact) {
      return found(own, { start: loc.charStart, end: loc.charStart + quote.exact.length }, 'exact');
    }
    const hit = findQuote(own.text, quote, { ...(loc.charStart !== undefined ? { hint: loc.charStart } : {}) });
    if (hit) return found(own, hit, same && hit.how === 'exact' && loc.charStart === undefined ? 'exact' : 'moved');
  } else if (own && !quote?.exact) {
    return { locator: { ...loc, segmentId: own.id, startMs: own.startMs, endMs: own.endMs }, status: own.id === loc.segmentId ? 'exact' : 'moved' };
  }
  if (quote?.exact) {
    const overlapping = segments.filter((s) => s !== own && s.startMs < loc.endMs + 1000 && s.endMs > loc.startMs - 1000);
    for (const s of overlapping) {
      const hit = findQuote(s.text, quote);
      if (hit) return found(s, hit, 'moved');
    }
  }
  // (4) The time: the segment that covers loc.startMs, else the nearest one.
  const at = segments.find((s) => s.startMs <= loc.startMs && loc.startMs < s.endMs)
    ?? [...segments].sort((a, b) => Math.abs(a.startMs - loc.startMs) - Math.abs(b.startMs - loc.startMs))[0];
  return {
    locator: at ? { type: 'segment', segmentId: at.id, startMs: loc.startMs, endMs: loc.endMs } : { ...loc },
    status: 'approximate',
  };
}
