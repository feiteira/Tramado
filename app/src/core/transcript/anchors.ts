// Anchors into a transcript that survive corrections (audio-pipeline §5.5; folder spec §8.9, §8.15):
// highlights, comments, citations and AI notes point at `{segmentId, charStart, charEnd}` plus a text
// quote and the time range. After a `set_text`, `split` or `merge` they are found again, in this order:
//   1. the same segment (or the one that absorbed it) still has the quote at the same offsets → exact;
//   2. the quote occurs in that segment, in the segments split off it, or in the segments that overlap the
//      anchor's time → moved (the occurrence that best matches prefix/suffix, nearest the old offset);
//   3. a case/accent-insensitive or approximate match there → approximate;
//   4. the segment at the anchor's time (always valid for playback: the audio is immutable) → approximate;
//   5. no segment at all → lost.
// The editor also maps anchors through its own edits at once (`remapThroughEdit`).
import type { SegmentId } from '../model/ids';
import type { Locator, Segment, TextQuote, TranscriptEditLine, TranscriptFile } from '../model/files';
import { findSegment } from './effective';

export type SegmentLocator = Extract<Locator, { type: 'segment' }>;
export type AnchorStatus = 'exact' | 'moved' | 'approximate' | 'lost';
export interface Reanchored { locator: SegmentLocator; quote: TextQuote | null; status: AnchorStatus }
export interface ReanchorHints {
  /** Ids split off in the replay → the segment they came from (`ReplayInfo.splitFrom`). */
  splitFrom?: Readonly<Record<SegmentId, SegmentId>>;
}

export const QUOTE_MAX = 300;
export const CONTEXT_MAX = 32;

/** The quote of `text[start, end)` with up to 32 characters of context on each side (folder spec §8.15). */
export function quoteOf(text: string, start: number, end: number): TextQuote {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return { exact: text.slice(s, Math.min(e, s + QUOTE_MAX)), prefix: text.slice(Math.max(0, s - CONTEXT_MAX), s), suffix: text.slice(e, e + CONTEXT_MAX) };
}

/** A segment locator for `seg` (whole segment, or a character range of it). */
export function segmentLocator(seg: Pick<Segment, 'id' | 'startMs' | 'endMs'>, range?: { start: number; end: number }): SegmentLocator {
  return { type: 'segment', segmentId: seg.id, startMs: seg.startMs, endMs: seg.endMs, ...(range ? { charStart: range.start, charEnd: range.end } : {}) };
}

// ── text matching ──────────────────────────────────────────────────────────────────────────────

/** Case- and accent-folded text with a map from each folded index to the original index. */
function folded(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const isSpace = /\s/.test(ch);
    const piece = isSpace ? ' ' : f;
    if (isSpace && text.endsWith(' ')) {
      i += ch.length;
      continue;
    }
    for (let k = 0; k < piece.length; k++) map.push(i);
    text += piece;
    i += ch.length;
  }
  map.push(i);
  return { text, map };
}

const commonSuffix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** Every start index of `needle` in `hay`. */
function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) out.push(at);
  return out;
}

/** The occurrence whose context matches the quote best, then the one nearest `near`. */
function bestOccurrence(text: string, starts: number[], q: TextQuote, len: number, near: number): number {
  let best = starts[0]!;
  let bestScore = -Infinity;
  for (const at of starts) {
    const score = commonSuffix(text.slice(0, at), q.prefix) + commonPrefix(text.slice(at + len), q.suffix) - Math.abs(at - near) / 1000;
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return best;
}

/**
 * Approximate substring match (Sellers): the window of `text` with the smallest edit distance to
 * `pattern`, if that distance is at most `maxErr`. O(|text|·|pattern|); both are short here.
 */
export function approxFind(text: string, pattern: string, maxErr: number): { start: number; end: number; errors: number } | null {
  const m = pattern.length;
  const n = text.length;
  if (m === 0 || n === 0) return null;
  let prev = new Array<number>(m + 1);
  let prevStart = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) {
    prev[i] = i;
    prevStart[i] = 0;
  }
  let best: { start: number; end: number; errors: number } | null = null;
  for (let j = 1; j <= n; j++) {
    const cur = new Array<number>(m + 1);
    const curStart = new Array<number>(m + 1);
    cur[0] = 0;
    curStart[0] = j;
    for (let i = 1; i <= m; i++) {
      const sub = prev[i - 1]! + (pattern[i - 1] === text[j - 1] ? 0 : 1);
      const del = prev[i]! + 1;
      const ins = cur[i - 1]! + 1;
      if (sub <= del && sub <= ins) {
        cur[i] = sub;
        curStart[i] = prevStart[i - 1]!;
      } else if (del <= ins) {
        cur[i] = del;
        curStart[i] = prevStart[i]!;
      } else {
        cur[i] = ins;
        curStart[i] = curStart[i - 1]!;
      }
    }
    if (cur[m]! <= maxErr && (!best || cur[m]! < best.errors)) best = { start: curStart[m]!, end: j, errors: cur[m]! };
    prev = cur;
    prevStart = curStart;
  }
  // A window as long as the pattern reads better than a slightly shorter one ("artigo 438" over "artigo 43").
  if (best && best.end - best.start !== m && best.start + m <= n) {
    const full = levenshtein(text.slice(best.start, best.start + m), pattern);
    if (full <= maxErr) best = { start: best.start, end: best.start + m, errors: full };
  }
  return best;
}

/** Edit distance between two short strings. */
export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

// ── re-anchoring ───────────────────────────────────────────────────────────────────────────────

const overlaps = (s: Pick<Segment, 'startMs' | 'endMs'>, from: number, to: number) => s.startMs < Math.max(to, from + 1) && s.endMs > from;

function timesFor(seg: Segment, old: SegmentLocator): { startMs: number; endMs: number } {
  // The audio never changes: the old times stay right when they still fall inside the segment.
  if (old.startMs >= seg.startMs && old.endMs <= seg.endMs && old.endMs >= old.startMs) return { startMs: old.startMs, endMs: old.endMs };
  return { startMs: seg.startMs, endMs: seg.endMs };
}

/** The segment at time `ms` (the one containing it, else the nearest). */
export function segmentAt(t: Pick<TranscriptFile, 'segments'>, ms: number): Segment | null {
  let best: Segment | null = null;
  let bestD = Infinity;
  for (const s of t.segments) {
    if (ms >= s.startMs && ms < Math.max(s.endMs, s.startMs + 1)) return s;
    const d = Math.min(Math.abs(ms - s.startMs), Math.abs(ms - s.endMs));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Finds an anchor again in the current (effective) transcript. */
export function reanchor(t: Pick<TranscriptFile, 'segments'>, locator: SegmentLocator, quote: TextQuote | null, hints: ReanchorHints = {}): Reanchored {
  if (t.segments.length === 0) return { locator, quote, status: 'lost' };
  const home = findSegment(t, locator.segmentId);
  const redirected = !!home && home.id !== locator.segmentId;
  const exact = quote?.exact ?? '';
  const at = (seg: Segment, start: number, end: number, status: AnchorStatus): Reanchored => ({
    locator: { type: 'segment', segmentId: seg.id, ...timesFor(seg, locator), charStart: start, charEnd: end },
    quote: quoteOf(seg.text, start, end),
    status,
  });

  if (!exact) {
    // A whole-segment anchor (or one without a quote): follow the id, else the time.
    if (home) {
      const range = locator.charStart !== undefined && locator.charEnd !== undefined && !redirected && locator.charEnd <= home.text.length
        ? { charStart: locator.charStart, charEnd: locator.charEnd } : {};
      return { locator: { type: 'segment', segmentId: home.id, ...timesFor(home, locator), ...range }, quote, status: redirected ? 'moved' : 'exact' };
    }
    const seg = segmentAt(t, locator.startMs);
    return seg ? { locator: segmentLocator(seg), quote, status: 'approximate' } : { locator, quote, status: 'lost' };
  }

  // 1. Unchanged.
  const cs = locator.charStart ?? 0;
  const ce = locator.charEnd ?? cs + exact.length;
  if (home && !redirected && home.text.slice(cs, ce) === exact) return at(home, cs, ce, 'exact');

  // Candidates: the home segment, those split off it, then the ones the anchor's time overlaps (nearest first).
  const candidates: Segment[] = [];
  const push = (s: Segment | null | undefined) => {
    if (s && !candidates.includes(s)) candidates.push(s);
  };
  push(home);
  const root = hints.splitFrom?.[locator.segmentId] ?? locator.segmentId;
  for (const [child, from] of Object.entries(hints.splitFrom ?? {})) if (from === root || from === locator.segmentId) push(t.segments.find((s) => s.id === child));
  const mid = (locator.startMs + locator.endMs) / 2;
  const nearby = t.segments
    .filter((s) => overlaps(s, locator.startMs, locator.endMs) || (home && overlaps(s, home.startMs, home.endMs)))
    .sort((a, b) => Math.abs((a.startMs + a.endMs) / 2 - mid) - Math.abs((b.startMs + b.endMs) / 2 - mid));
  for (const s of nearby) push(s);

  // 2. The exact quote somewhere close.
  for (const seg of candidates) {
    const starts = occurrences(seg.text, exact);
    if (starts.length) {
      const s = bestOccurrence(seg.text, starts, quote!, exact.length, seg === home ? cs : 0);
      return at(seg, s, s + exact.length, 'moved');
    }
  }
  // 3. Case/accent/space-insensitive, then approximate.
  const fq = folded(exact).text;
  for (const seg of candidates) {
    const f = folded(seg.text);
    const starts = occurrences(f.text, fq);
    if (starts.length) {
      const s = starts[0]!;
      return at(seg, f.map[s]!, f.map[s + fq.length]!, 'approximate');
    }
  }
  const maxErr = Math.max(2, Math.floor(fq.length * 0.25));
  let best: { seg: Segment; start: number; end: number; errors: number } | null = null;
  for (const seg of candidates) {
    const f = folded(seg.text);
    const m = approxFind(f.text, fq, maxErr);
    if (m && (!best || m.errors < best.errors)) best = { seg, start: f.map[m.start]!, end: f.map[m.end]!, errors: m.errors };
  }
  if (best) return at(best.seg, best.start, best.end, 'approximate');

  // 4. The time.
  const seg = segmentAt(t, locator.startMs);
  return seg ? { locator: segmentLocator(seg), quote, status: 'approximate' } : { locator, quote, status: 'lost' };
}

// ── the editor's own edits ─────────────────────────────────────────────────────────────────────

/** Maps an offset of `oldText` into `newText` through the one changed region between them. */
export function mapOffset(oldText: string, newText: string, offset: number, bias: 'start' | 'end' = 'start'): number {
  const p = commonPrefix(oldText, newText);
  const sfx = Math.min(commonSuffix(oldText, newText), oldText.length - p, newText.length - p);
  if (offset <= p) return offset;
  if (offset >= oldText.length - sfx) return offset + (newText.length - oldText.length);
  // Inside the replaced region: to its start, or to its end.
  return bias === 'start' ? p : newText.length - sfx;
}

/**
 * Where an anchor goes when an edit line is applied to `before` (the transcript the editor looked at).
 * `set_text` maps the offsets through the change, `split` moves anchors after the cut to the new segment,
 * `merge` moves anchors of the absorbed segment behind the text they joined. Anchors elsewhere stay.
 */
export function remapThroughEdit(before: Pick<TranscriptFile, 'segments'>, op: TranscriptEditLine, locator: SegmentLocator): SegmentLocator {
  const seg = before.segments.find((s) => s.id === locator.segmentId);
  if (!seg || locator.charStart === undefined || locator.charEnd === undefined) {
    if (op.op === 'merge' && locator.segmentId === op.with) return { ...locator, segmentId: op.segment! };
    return locator;
  }
  const { charStart: cs, charEnd: ce } = locator;
  switch (op.op) {
    case 'set_text':
      if (op.segment !== seg.id) return locator;
      return { ...locator, charStart: mapOffset(seg.text, op.text!, cs, 'start'), charEnd: Math.max(mapOffset(seg.text, op.text!, cs, 'start'), mapOffset(seg.text, op.text!, ce, 'end')) };
    case 'split': {
      if (op.segment !== seg.id) return locator;
      const at = op.atChar!;
      const head = seg.text.slice(0, at);
      const tail = seg.text.slice(at);
      const lead = tail.length - tail.trimStart().length;
      const headLen = head.trimEnd().length;
      if (cs >= at) {
        return { ...locator, segmentId: op.newId!, charStart: Math.max(0, cs - at - lead), charEnd: Math.max(0, ce - at - lead), startMs: Math.max(locator.startMs, op.atMs!) };
      }
      return { ...locator, charStart: Math.min(cs, headLen), charEnd: Math.min(ce, headLen), endMs: Math.min(locator.endMs, op.atMs!) };
    }
    case 'merge': {
      if (locator.segmentId !== op.with) return locator;
      const into = before.segments.find((s) => s.id === op.segment);
      if (!into) return locator;
      const shift = into.text.length + 1;
      return { ...locator, segmentId: into.id, charStart: cs + shift, charEnd: ce + shift };
    }
    default:
      return locator;
  }
}
