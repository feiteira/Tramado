// Text units for analysis: paragraphs, sentences, words, and folding for case- and
// accent-insensitive matching with a map back to original offsets.
//
// All offsets are UTF-16 code units into the canonical text (LF line endings, NFC), half-open.

import { type Span, upperBound } from './util';

export type { Span } from './util';

// ---------------------------------------------------------------------------------------------
// Paragraphs
//
// Definitions (used by every module that speaks of "paragraphs"):
// - A *line* is a run of text between `\n` characters (or the text's start/end). A text with k
//   newlines has k + 1 lines; the `\n` belongs to no line. Lines are numbered from 0 and that
//   number is the paragraph *index* used for "same paragraph" tests (co-occurrence, boolean
//   search), so indexes stay stable whether or not blank lines exist.
// - A *paragraph* (as returned by `paragraphs`) is a line that contains at least one
//   non-whitespace character, with leading and trailing whitespace trimmed off. Blank lines
//   separate paragraphs but are not paragraphs themselves.
// ---------------------------------------------------------------------------------------------

const WS = /\s/;

/** Every line of the text (see above), untrimmed, blank ones included. Never empty. */
export function lineSpans(text: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) break;
    out.push({ start, end: nl });
    start = nl + 1;
  }
  out.push({ start, end: text.length });
  return out;
}

/** Narrows a span to exclude leading and trailing whitespace; null if nothing is left. */
export function trimSpan(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && WS.test(text[start]!)) start++;
  while (end > start && WS.test(text[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

/** Non-blank lines, trimmed (see the definitions above). */
export function paragraphs(text: string): Span[] {
  const out: Span[] = [];
  for (const line of lineSpans(text)) {
    const t = trimSpan(text, line);
    if (t) out.push(t);
  }
  return out;
}

/** Looks up the line (paragraph index) of offsets in one text in O(log n). */
export interface LineIndex {
  /** Number of lines (newlines + 1). */
  readonly count: number;
  /** Start offset of every line, ascending. */
  readonly starts: Int32Array;
  /**
   * The line holding the character at `pos`. A `\n` counts with the line it ends, and
   * `pos === text.length` with the last line, so the end offset of a span can be passed as
   * `end - 1` or `end` with predictable results.
   */
  lineOf(pos: number): number;
  /** The untrimmed span of line `i`. */
  span(i: number): Span;
}

export function lineIndex(text: string): LineIndex {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  const starts = new Int32Array(n);
  let k = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts[k++] = i + 1;
  const length = text.length;
  return {
    count: n,
    starts,
    lineOf(pos: number) {
      if (pos <= 0) return 0;
      // The last line starting at or before pos; a '\n' at pos is before the next line's start.
      return upperBound(starts, Math.min(pos, length)) - 1;
    },
    span(i: number) {
      const start = starts[i] ?? length;
      const next = starts[i + 1];
      return { start, end: next === undefined ? length : next - 1 };
    },
  };
}

// Start of the line holding the character at pos (lastIndexOf with a negative index would
// still look at index 0, hence the guard).
function lineStartAt(text: string, pos: number): number {
  return pos <= 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1;
}

/**
 * The trimmed paragraph containing the character at `pos` (a `\n` counts with the line it
 * ends). Null when that line is blank or pos is outside the text.
 */
export function paragraphAt(text: string, pos: number): Span | null {
  if (pos < 0 || pos > text.length) return null;
  const start = lineStartAt(text, pos);
  let end = text.indexOf('\n', pos);
  if (end < 0) end = text.length;
  return trimSpan(text, { start, end });
}

// ---------------------------------------------------------------------------------------------
// Sentences
//
// A heuristic, tuned for interview transcripts in European languages: a sentence ends after a
// run of . ! ? … (or their CJK forms), plus any closing quotes or brackets, when followed by
// whitespace and then something that is not a lower-case letter. A full stop after a known
// abbreviation (Dr., Sra., e.g.) or a single-letter initial does not end a sentence. Sentences
// never cross a line, so a paragraph without final punctuation is one sentence.
// ---------------------------------------------------------------------------------------------

const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？', '‼', '⁇', '⁈', '⁉']);
const CLOSERS = new Set(['"', "'", '”', '’', '»', '›', ')', ']', '}', '」', '』']);
const ABBREVIATIONS = new Set([
  // English
  'mr', 'mrs', 'ms', 'dr', 'drs', 'prof', 'jr', 'sr', 'st', 'vs', 'e.g', 'i.e', 'cf', 'approx', 'fig', 'vol', 'pp',
  // Portuguese and Spanish
  'sra', 'srs', 'sras', 'srta', 'dra', 'dras', 'profa', 'profª', 'exmo', 'exma', 'ilmo', 'ilma', 'eng', 'arq', 'pág', 'págs',
  'ud', 'uds', 'vd', 'vds', 'av', 'n.º', 'nº', 'p.ex', 'cap', 'tel',
  // French, German, Italian, Dutch
  'mme', 'mlle', 'mm', 'z.b', 'bzw', 'usw', 'ca', 'dott', 'sig', 'sig.ra', 'dhr', 'mevr', 'bijv', 'enz',
]);
const LOWER = /\p{Ll}/u;

function isAbbreviation(text: string, lineStart: number, dot: number): boolean {
  // The "word" before the dot: back to whitespace or an opening bracket/quote.
  let s = dot;
  while (s > lineStart && !WS.test(text[s - 1]!) && !'([{"“«'.includes(text[s - 1]!)) s--;
  const w = text.slice(s, dot).toLowerCase();
  if (!w) return false;
  if (/^\p{L}$/u.test(w)) return true; // an initial: "J. Smith"
  return ABBREVIATIONS.has(w);
}

/** Trimmed sentence spans within one line [start, end). */
function sentencesInLine(text: string, start: number, end: number): Span[] {
  const out: Span[] = [];
  let sentStart = start;
  let i = start;
  while (i < end) {
    const ch = text[i]!;
    if (!TERMINATORS.has(ch)) {
      i++;
      continue;
    }
    const first = i;
    while (i < end && TERMINATORS.has(text[i]!)) i++;
    const singleDot = i - first === 1 && ch === '.';
    while (i < end && CLOSERS.has(text[i]!)) i++;
    const sentEnd = i;
    if (i >= end) break;
    if (!WS.test(text[i]!)) continue; // "3.5", "e.g.,", "?!x"
    let j = i;
    while (j < end && WS.test(text[j]!)) j++;
    if (j >= end) break;
    if (singleDot && isAbbreviation(text, start, first)) continue;
    if (LOWER.test(text[j]!)) continue;
    const t = trimSpan(text, { start: sentStart, end: sentEnd });
    if (t) out.push(t);
    sentStart = j;
    i = j;
  }
  const t = trimSpan(text, { start: sentStart, end });
  if (t) out.push(t);
  return out;
}

/** All sentences of the text, trimmed, in order. */
export function sentences(text: string): Span[] {
  const out: Span[] = [];
  for (const line of lineSpans(text)) out.push(...sentencesInLine(text, line.start, line.end));
  return out;
}

/**
 * The sentence around `pos`. Whitespace between two sentences belongs to the one before it.
 * Null when the line at pos is blank or pos is outside the text.
 */
export function sentenceAt(text: string, pos: number): Span | null {
  if (pos < 0 || pos > text.length) return null;
  const start = lineStartAt(text, pos);
  let end = text.indexOf('\n', pos);
  if (end < 0) end = text.length;
  const list = sentencesInLine(text, start, end);
  if (list.length === 0) return null;
  for (let k = list.length - 1; k >= 0; k--) if (list[k]!.start <= pos) return list[k]!;
  return list[0]!;
}

// ---------------------------------------------------------------------------------------------
// Words
//
// A word is a run of letters and digits (any script; combining marks stay with their letter),
// optionally joined by internal apostrophes or hyphens: "don't", "l'école", "well-being",
// "disse-lhe" are one word each. Leading/trailing apostrophes and hyphens are not part of it.
// ---------------------------------------------------------------------------------------------

/** Letters, digits and combining marks: what counts as "inside a word". */
export const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const WORD_SOURCE = "[\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}]*(?:['’ʼ\\u2010\\u2011-][\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}]*)*";

/** A fresh global regex matching one word (the flag `g` makes it stateful, so never shared). */
export function wordRegex(): RegExp {
  return new RegExp(WORD_SOURCE, 'gu');
}

export interface Token {
  word: string;
  start: number;
  end: number;
}

/** Every word of the text with its offsets, as written (no case folding). */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = wordRegex();
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** True if the code unit at `i` is part of a word character (surrogate pairs handled). */
export function isWordCharAt(text: string, i: number): boolean {
  if (i < 0 || i >= text.length) return false;
  const c = text.charCodeAt(i);
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  let cp = c;
  if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
    const hi = text.charCodeAt(i - 1);
    if (hi >= 0xd800 && hi <= 0xdbff) cp = (hi - 0xd800) * 0x400 + (c - 0xdc00) + 0x10000;
  } else if (c >= 0xd800 && c <= 0xdbff) {
    cp = text.codePointAt(i) ?? c;
  }
  return WORD_CHAR.test(String.fromCodePoint(cp));
}

// ---------------------------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------------------------

export interface FoldOptions {
  /** Keep upper and lower case distinct (default false: case-insensitive). */
  caseSensitive?: boolean;
  /** Keep accents and other marks distinct (default false: "coração" matches "coracao"). */
  accentSensitive?: boolean;
}

export interface Folded {
  /** The folded text. */
  folded: string;
  /**
   * map[i] = original offset where folded code unit i comes from; map[folded.length] =
   * original length. A folded match [s, e) maps back with `originalSpan`.
   */
  map: Int32Array;
  /** ends[i] = original offset just after the source of folded code unit i. */
  ends: Int32Array;
}

// Letters that Unicode does not decompose but readers treat as accented or as ligatures.
// Only applied when accent-insensitive.
const LETTER_FOLDS: Record<string, string> = {
  ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i',
};
const MARKS = /\p{M}/gu;
// Typographic apostrophes and hyphens match the plain ones (word counts fold them alike).
const APOSTROPHES: Record<number, number> = { 0x2019: 0x27, 0x2018: 0x27, 0x02bc: 0x27, 0x2032: 0x27, 0x2010: 0x2d, 0x2011: 0x2d };

const foldCaches: Map<number, string>[] = [new Map(), new Map(), new Map(), new Map()];

function foldCodePoint(cp: number, caseSensitive: boolean, accentSensitive: boolean): string {
  const cache = foldCaches[(caseSensitive ? 1 : 0) + (accentSensitive ? 2 : 0)]!;
  const hit = cache.get(cp);
  if (hit !== undefined) return hit;
  let s = String.fromCodePoint(cp);
  const ap = APOSTROPHES[cp];
  if (ap !== undefined) s = String.fromCharCode(ap);
  else {
    if (!accentSensitive) {
      // NFKD also unpacks compatibility forms that PDF extraction leaves behind (ﬁ → fi).
      s = s.normalize('NFKD').replace(MARKS, '');
      s = Array.from(s, (c) => LETTER_FOLDS[c] ?? c).join('');
    }
    if (!caseSensitive) {
      s = s.toLowerCase();
      if (s === 'ς') s = 'σ';
      if (!accentSensitive) s = s.replace(MARKS, ''); // "İ".toLowerCase() = "i" + combining dot
    }
  }
  if (cache.size < 100_000) cache.set(cp, s);
  return s;
}

/**
 * Folds text for matching and records where every folded code unit comes from. Case folding is
 * per character (toLowerCase, final sigma to sigma); accent folding is NFKD with combining marks
 * removed plus a few undecomposable letters (ß→ss, æ→ae, œ→oe, ø→o, ł→l, đ→d). Curly
 * apostrophes always fold to the straight one, since people type ' for ’.
 */
export function foldWithMap(text: string, opts: FoldOptions = {}): Folded {
  const cs = !!opts.caseSensitive;
  const as = !!opts.accentSensitive;
  const n = text.length;
  let cap = n + 16;
  let out = new Uint16Array(cap);
  let map = new Int32Array(cap + 1);
  let ends = new Int32Array(cap);
  let k = 0;
  const grow = (need: number) => {
    if (k + need <= cap) return;
    cap = Math.max(cap * 2, k + need + 16);
    const o2 = new Uint16Array(cap);
    o2.set(out);
    out = o2;
    const m2 = new Int32Array(cap + 1);
    m2.set(map);
    map = m2;
    const e2 = new Int32Array(cap);
    e2.set(ends);
    ends = e2;
  };
  for (let i = 0; i < n; ) {
    const c = text.charCodeAt(i);
    if (c < 128) {
      grow(1);
      out[k] = !cs && c >= 65 && c <= 90 ? c + 32 : c;
      map[k] = i;
      ends[k] = i + 1;
      k++;
      i++;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    const f = foldCodePoint(cp, cs, as);
    // A character that folds to nothing (a combining mark) joins the previous one, so a match
    // ending there takes the mark along instead of cutting "é" (e + U+0301) in half.
    if (f.length === 0 && k > 0) ends[k - 1] = i + width;
    grow(f.length);
    for (let j = 0; j < f.length; j++) {
      out[k] = f.charCodeAt(j);
      map[k] = i;
      ends[k] = i + width;
      k++;
    }
    i += width;
  }
  map[k] = n;
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let s = 0; s < k; s += CHUNK) parts.push(String.fromCharCode.apply(null, out.subarray(s, Math.min(k, s + CHUNK)) as unknown as number[]));
  return { folded: parts.join(''), map: map.subarray(0, k + 1), ends: ends.subarray(0, k) };
}

/** The folded text alone (same folding as foldWithMap): use it for queries. */
export function fold(text: string, opts: FoldOptions = {}): string {
  const src = opts.accentSensitive ? text.normalize('NFC') : text;
  return foldWithMap(src, opts).folded;
}

/** Maps a span of the folded text back to the original text. */
export function originalSpan(f: Folded, start: number, end: number): Span {
  const s = f.map[start] ?? f.map[f.map.length - 1]!;
  if (end <= start) return { start: s, end: s };
  const e = f.ends[end - 1] ?? f.map[f.map.length - 1]!;
  return { start: s, end: Math.max(s, e) };
}
