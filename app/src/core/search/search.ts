// Text search across documents: words (with a small boolean query language), exact phrases and
// regular expressions, case- and accent-insensitive by default, with keyword-in-context.
//
// Query language for the 'words' mode (operators are upper case, so "or" is a search word):
//   trust confidence       both words in the same paragraph (any of them with `anyWord`)
//   trust OR confidence    either word
//   trust AND family       both, in the same paragraph (AND binds tighter than OR)
//   trust NOT money        `NOT x` / `-x`: paragraphs without x
//   "health care"          an exact phrase (no wildcards inside quotes)
//   garden*  *ness  c*r    `*` stands for any letters inside one word; such terms always match
//                          whole words, so garden* finds "gardening" but not "kindergarden"
//   (trust OR faith) AND doctor
// The unit for AND/NOT is the paragraph (a line, see text.ts). Hits are the occurrences of the
// terms not under a NOT, in paragraphs where the whole expression holds.

import {
  type Folded,
  type FoldOptions,
  foldWithMap,
  isWordCharAt,
  lineIndex,
  originalSpan,
} from './text';

export type SearchMode = 'words' | 'phrase' | 'regex';

export interface SearchQuery {
  query: string;
  mode: SearchMode;
  /** Match only whole words (letters/digits not continuing on either side). */
  wholeWord?: boolean;
  caseSensitive?: boolean;
  accentSensitive?: boolean;
  /** Words mode: words written side by side mean OR instead of AND. */
  anyWord?: boolean;
}

export interface SearchOptions {
  /** Hits returned at most (default 5000); `total` still counts all of them. */
  limit?: number;
  /** Characters of context on each side before snapping to a word boundary (default 60). */
  context?: number;
}

export interface SearchHit {
  documentId: string;
  start: number;
  end: number;
  /** Context before the match, within the same paragraph, starting at a word boundary. */
  before: string;
  match: string;
  /** Context after the match, within the same paragraph, ending at a word boundary. */
  after: string;
}

export interface SearchResult {
  /** In input document order, then by position. Overlapping matches are merged into one hit. */
  hits: SearchHit[];
  /** All hits, including those beyond the limit. */
  total: number;
  truncated: boolean;
  /** Number of hits per document id (all hits, not only those returned). */
  perDocument: Map<string, number>;
}

export type SearchErrorCode = 'empty' | 'invalid-regex' | 'syntax' | 'negative-only';

/** A query that cannot run. `detail` is technical (the regex engine's message, or a token). */
export class SearchError extends Error {
  constructor(
    readonly code: SearchErrorCode,
    readonly detail = '',
    /** Offset in the query where the problem was found, when known. */
    readonly position: number | null = null,
  ) {
    super(`search: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'SearchError';
  }
}

export const DEFAULT_SEARCH_LIMIT = 5000;
const W = '[\\p{L}\\p{N}\\p{M}]';

// ---------------------------------------------------------------------------------------------
// Query parser
// ---------------------------------------------------------------------------------------------

export type QueryNode =
  | { t: 'term'; text: string; phrase: boolean }
  | { t: 'and'; c: QueryNode[] }
  | { t: 'or'; c: QueryNode[] }
  | { t: 'not'; c: QueryNode };

type Tok =
  | { k: 'lp' | 'rp' | 'and' | 'or' | 'not'; pos: number }
  | { k: 'term'; text: string; phrase: boolean; pos: number };

const OPEN_QUOTES = '"“„«';
const CLOSE_QUOTES = '"”“»';
const EDGE_PUNCT_START = /^[^\p{L}\p{N}\p{M}*]+/u;
const EDGE_PUNCT_END = /[^\p{L}\p{N}\p{M}*]+$/u;
const HAS_WORD = /[\p{L}\p{N}]/u;

function lex(q: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '(' || ch === ')') {
      out.push({ k: ch === '(' ? 'lp' : 'rp', pos: i });
      i++;
    } else if (OPEN_QUOTES.includes(ch)) {
      const pos = i;
      i++;
      let j = i;
      while (j < q.length && !CLOSE_QUOTES.includes(q[j]!)) j++;
      // An unclosed quote runs to the end: the query is probably still being typed.
      const text = q.slice(i, j).trim().replace(/\s+/g, ' ');
      i = j + 1;
      if (text) out.push({ k: 'term', text, phrase: true, pos });
    } else if (ch === '-' && i + 1 < q.length && !/[\s()-]/.test(q[i + 1]!) && (i === 0 || /[\s(]/.test(q[i - 1]!))) {
      out.push({ k: 'not', pos: i });
      i++;
    } else {
      const pos = i;
      let j = i;
      while (j < q.length && !/[\s()]/.test(q[j]!) && !OPEN_QUOTES.includes(q[j]!)) j++;
      const raw = q.slice(i, j);
      i = j;
      if (raw === 'AND' || raw === 'OR' || raw === 'NOT') {
        out.push({ k: raw.toLowerCase() as 'and' | 'or' | 'not', pos });
        continue;
      }
      const text = raw.replace(EDGE_PUNCT_START, '').replace(EDGE_PUNCT_END, '');
      if (HAS_WORD.test(text)) out.push({ k: 'term', text, phrase: false, pos });
    }
  }
  return out;
}

/**
 * Parses a words-mode query. Throws SearchError ('empty', 'syntax' or 'negative-only').
 * Missing closing parentheses at the end are tolerated (the query may be mid-typing).
 */
export function parseQuery(query: string, opts: { anyWord?: boolean } = {}): QueryNode {
  const toks = lex(query);
  if (!toks.some((t) => t.k === 'term')) throw new SearchError('empty');
  let p = 0;
  const peek = () => toks[p];
  const startsOperand = (t: Tok | undefined) => !!t && (t.k === 'term' || t.k === 'lp' || t.k === 'not');
  const fail = (t: Tok | undefined): never => {
    throw new SearchError('syntax', t ? t.k : 'end', t ? t.pos : query.length);
  };

  const parseOr = (): QueryNode => {
    const c = [parseAnd()];
    for (;;) {
      const t = peek();
      if (t?.k === 'or') {
        p++;
        c.push(parseAnd());
      } else if (opts.anyWord && startsOperand(t)) c.push(parseAnd());
      else break;
    }
    return c.length === 1 ? c[0]! : { t: 'or', c };
  };
  const parseAnd = (): QueryNode => {
    const c = [parseUnary()];
    for (;;) {
      const t = peek();
      if (t?.k === 'and') {
        p++;
        c.push(parseUnary());
      } else if (!opts.anyWord && startsOperand(t)) c.push(parseUnary());
      else break;
    }
    return c.length === 1 ? c[0]! : { t: 'and', c };
  };
  const parseUnary = (): QueryNode => {
    const t = peek();
    if (t?.k === 'not') {
      p++;
      return { t: 'not', c: parseUnary() };
    }
    return parsePrimary();
  };
  const parsePrimary = (): QueryNode => {
    const t = peek();
    if (!t) return fail(t);
    if (t.k === 'term') {
      p++;
      return { t: 'term', text: t.text, phrase: t.phrase };
    }
    if (t.k === 'lp') {
      p++;
      const inner = parseOr();
      const close = peek();
      if (close?.k === 'rp') p++;
      else if (close) fail(close);
      return inner;
    }
    return fail(t);
  };

  const ast = parseOr();
  if (p < toks.length) fail(toks[p]);
  const flat = flatten(ast);
  if (positiveTerms(flat).length === 0) throw new SearchError('negative-only');
  return flat;
}

function flatten(n: QueryNode): QueryNode {
  if (n.t === 'term') return n;
  if (n.t === 'not') return { t: 'not', c: flatten(n.c) };
  const c: QueryNode[] = [];
  for (const x of n.c.map(flatten)) {
    if (x.t === n.t) c.push(...(x as { c: QueryNode[] }).c);
    else c.push(x);
  }
  return { t: n.t, c };
}

/** Terms that are not under a NOT: the ones that produce hits. */
export function positiveTerms(n: QueryNode): Extract<QueryNode, { t: 'term' }>[] {
  if (n.t === 'term') return [n];
  if (n.t === 'not') return [];
  return n.c.flatMap(positiveTerms);
}

function allTerms(n: QueryNode): Extract<QueryNode, { t: 'term' }>[] {
  if (n.t === 'term') return [n];
  if (n.t === 'not') return allTerms(n.c);
  return n.c.flatMap(allTerms);
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

// Only syntax characters: in Unicode mode an escaped '-' or letter is itself a syntax error.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function foldOpts(q: SearchQuery): FoldOptions {
  return { caseSensitive: !!q.caseSensitive, accentSensitive: !!q.accentSensitive };
}

function foldQueryText(s: string, opts: FoldOptions): string {
  return foldWithMap(opts.accentSensitive ? s.normalize('NFC') : s, opts).folded;
}

/** Regex source for one term over folded text. */
function termSource(term: { text: string; phrase: boolean }, wholeWord: boolean, opts: FoldOptions): string {
  const folded = foldQueryText(term.text, opts);
  let body: string;
  let anchored = wholeWord;
  if (term.phrase) {
    // Any run of spaces in a phrase matches any run of spaces, but never a line break.
    body = folded.trim().split(/\s+/).map(escapeRe).join('[^\\S\\n]+');
  } else {
    const parts = folded.split('*');
    if (parts.length > 1) anchored = true;
    body = parts.map(escapeRe).join(`${W}*`);
  }
  return anchored ? `(?<!${W})(?:${body})(?!${W})` : body;
}

interface Occ {
  term: number;
  start: number;
  end: number;
}

function* execAll(re: RegExp, s: string): Generator<[number, number]> {
  re.lastIndex = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const len = m[0].length;
    if (len === 0) {
      // Zero-width matches (a* on "b") would loop forever; they are not hits anyway.
      const c = s.charCodeAt(re.lastIndex);
      re.lastIndex += re.unicode && c >= 0xd800 && c <= 0xdbff ? 2 : 1;
      if (re.lastIndex > s.length) break;
      continue;
    }
    yield [m.index, m.index + len];
  }
}

/** A compiled query, reusable across documents. */
interface Compiled {
  kind: 'terms' | 'regex';
  fold: FoldOptions | null;
  terms: RegExp[];
  positive: boolean[];
  ast: QueryNode | null;
  /** Term node → index into `terms`. */
  ids: Map<QueryNode, number>;
  /** Regex mode without the Unicode flag: whole words are checked after matching. */
  postWholeWord: boolean;
}

function compileTerms(q: SearchQuery): Compiled {
  const fo = foldOpts(q);
  if (q.mode === 'phrase') {
    const text = q.query.trim();
    if (!text) throw new SearchError('empty');
    const re = new RegExp(termSource({ text, phrase: true }, !!q.wholeWord, fo), 'gu');
    return { kind: 'terms', fold: fo, terms: [re], positive: [true], ast: null, ids: new Map(), postWholeWord: false };
  }
  const ast = parseQuery(q.query, { anyWord: q.anyWord });
  const terms = allTerms(ast);
  const pos = new Set(positiveTerms(ast));
  // Term ids are their index in allTerms; the evaluator walks the tree in the same order.
  return {
    kind: 'terms',
    fold: fo,
    terms: terms.map((t) => new RegExp(termSource(t, !!q.wholeWord, fo), 'gu')),
    positive: terms.map((t) => pos.has(t)),
    ast: ast.t === 'term' ? null : ast,
    ids: new Map(terms.map((t, i) => [t, i])),
    postWholeWord: false,
  };
}

// Characters a class's extra members must escape, and a code point's length in code units.
const escapeInClass = (s: string) => s.replace(/[\\\]\[^-]/g, '\\$&');
const cpCount = (s: string) => [...s].length;
// Ranges larger than this are left as written (folding every member would be slow).
const MAX_FOLDED_RANGE = 5000;

interface PatternAtom {
  /** The source as written. */
  raw: string;
  /** The character it stands for, when it is one literal character (escapes resolved). */
  literal?: string;
}

/** Reads one escape sequence at `j` (a backslash), resolving \xHH, \uHHHH (and pairs) and \u{…}. */
function readEscape(p: string, j: number): PatternAtom & { end: number } {
  const c = p[j + 1];
  if (c === undefined) return { raw: '\\', end: j + 1 };
  const hex = (from: number, n: number) => (new RegExp(`^[0-9a-fA-F]{${n}}$`).test(p.slice(from, from + n)) ? parseInt(p.slice(from, from + n), 16) : -1);
  if (c === 'u' && p[j + 2] === '{') {
    const close = p.indexOf('}', j + 3);
    const h = close > 0 ? p.slice(j + 3, close) : '';
    if (/^[0-9a-fA-F]{1,6}$/.test(h) && parseInt(h, 16) <= 0x10ffff) return { raw: p.slice(j, close + 1), literal: String.fromCodePoint(parseInt(h, 16)), end: close + 1 };
  }
  if (c === 'u') {
    const hi = hex(j + 2, 4);
    if (hi >= 0) {
      if (hi >= 0xd800 && hi <= 0xdbff && p[j + 6] === '\\' && p[j + 7] === 'u') {
        const lo = hex(j + 8, 4);
        if (lo >= 0xdc00 && lo <= 0xdfff) return { raw: p.slice(j, j + 12), literal: String.fromCharCode(hi, lo), end: j + 12 };
      }
      return { raw: p.slice(j, j + 6), literal: String.fromCharCode(hi), end: j + 6 };
    }
  }
  if (c === 'x') {
    const h = hex(j + 2, 2);
    if (h >= 0) return { raw: p.slice(j, j + 4), literal: String.fromCharCode(h), end: j + 4 };
  }
  if ((c === 'p' || c === 'P') && p[j + 2] === '{') {
    const close = p.indexOf('}', j + 3);
    if (close > 0) return { raw: p.slice(j, close + 1), end: close + 1 };
  }
  if (c === 'k' && p[j + 2] === '<') {
    const close = p.indexOf('>', j + 3);
    if (close > 0) return { raw: p.slice(j, close + 1), end: close + 1 };
  }
  const cp = p.codePointAt(j + 1)!;
  const len = cp > 0xffff ? 2 : 1;
  // An escaped non-ASCII character is that character.
  return { raw: p.slice(j, j + 1 + len), ...(cp >= 128 ? { literal: String.fromCodePoint(cp) } : {}), end: j + 1 + len };
}

/**
 * The pattern for accent-folded text: literal characters (also written as escapes) become what
 * they fold into, and so do the members of character classes, without touching regex syntax.
 * In a class, a range's members are folded one by one ("[à-ú]" also takes a, c, e, i, n, o, u,
 * never every letter from a to u), and a character folding into several ("ß" → "ss") becomes an
 * alternative to the class.
 */
function foldRegexPattern(pattern: string, opts: FoldOptions): string {
  // Plain ASCII without escapes for other characters folds to itself.
  if (!/[^\x00-\x7f]|\\[ux]/.test(pattern)) return pattern;
  const foldCh = (ch: string) => foldWithMap(ch, opts).folded;
  const literalOut = (a: PatternAtom): string => {
    if (a.literal === undefined || a.literal.charCodeAt(0) < 128) return a.raw;
    const f = foldCh(a.literal);
    if (f === a.literal) return a.raw;
    const e = escapeRe(f);
    return cpCount(f) === 1 ? e : `(?:${e})`;
  };
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      const a = readEscape(pattern, i);
      out += literalOut(a);
      i = a.end;
      continue;
    }
    if (ch === '[') {
      // A character class: read its members up to the closing bracket.
      let j = i + 1;
      const negated = pattern[j] === '^';
      if (negated) j++;
      const atoms: PatternAtom[] = [];
      while (j < pattern.length && pattern[j] !== ']') {
        if (pattern[j] === '\\') {
          const a = readEscape(pattern, j);
          atoms.push(a);
          j = a.end;
        } else {
          const cp = pattern.codePointAt(j)!;
          const c = String.fromCodePoint(cp);
          atoms.push({ raw: c, literal: c });
          j += c.length;
        }
      }
      if (j >= pattern.length) {
        // Unclosed: leave the rest as written, the engine reports it.
        out += pattern.slice(i);
        break;
      }
      const extras = new Set<string>();
      const multis = new Set<string>();
      const add = (c: string) => {
        if (c.charCodeAt(0) < 128) return;
        const f = foldCh(c);
        if (f === c) return;
        if (cpCount(f) === 1) extras.add(f);
        else if (f) multis.add(f);
      };
      for (let k = 0; k < atoms.length; k++) {
        const a = atoms[k]!;
        const dash = atoms[k + 1];
        const b = atoms[k + 2];
        if (dash && dash.raw === '-' && b && a.literal !== undefined && b.literal !== undefined && a.raw !== '-' ) {
          const from = a.literal.codePointAt(0)!;
          const to = b.literal.codePointAt(0)!;
          if (to >= from && to - from <= MAX_FOLDED_RANGE && (from >= 128 || to >= 128)) {
            for (let cp = Math.max(from, 128); cp <= to; cp++) add(String.fromCodePoint(cp));
          }
          k += 2;
          continue;
        }
        if (a.literal !== undefined) add(a.literal);
      }
      const body = atoms.map((a) => a.raw).join('') + [...extras].map(escapeInClass).join('');
      const cls = `[${negated ? '^' : ''}${body}]`;
      out += multis.size && !negated ? `(?:${cls}|${[...multis].map(escapeRe).join('|')})` : cls;
      i = j + 1;
      continue;
    }
    const cp = pattern.codePointAt(i)!;
    const c = String.fromCodePoint(cp);
    out += literalOut({ raw: c, literal: c });
    i += c.length;
  }
  return out;
}

function compileRegex(q: SearchQuery): Compiled {
  if (!q.query) throw new SearchError('empty');
  // Accent-insensitive regexes run on accent-folded text; case is left to the `i` flag so that
  // classes such as [A-Z] keep their meaning.
  const fo: FoldOptions | null = q.accentSensitive ? null : { caseSensitive: true, accentSensitive: false };
  const pattern = fo ? foldRegexPattern(q.query, fo) : q.query;
  // `m`: ^ and $ anchor at every paragraph (line), Trama's unit for search, not only at the
  // start and end of a whole document.
  const flags = q.caseSensitive ? 'gm' : 'gim';
  let re: RegExp;
  let post = false;
  try {
    const src = q.wholeWord ? `(?<!${W})(?:${pattern})(?!${W})` : pattern;
    re = new RegExp(src, flags + 'u');
  } catch (eu) {
    // Patterns written for non-Unicode engines (e.g. "\-" outside a class) are still accepted.
    try {
      re = new RegExp(pattern, flags);
      post = !!q.wholeWord;
    } catch (e) {
      throw new SearchError('invalid-regex', (e as Error).message || (eu as Error).message);
    }
  }
  return { kind: 'regex', fold: fo, terms: [re], positive: [true], ast: null, ids: new Map(), postWholeWord: post };
}

function compile(q: SearchQuery): Compiled {
  return q.mode === 'regex' ? compileRegex(q) : compileTerms(q);
}

/** The SearchError the query would raise (without throwing it), or null if it can run. */
export function validateQuery(q: SearchQuery): SearchError | null {
  try {
    compile(q);
    return null;
  } catch (e) {
    if (e instanceof SearchError) return e;
    throw e;
  }
}

function evaluate(n: QueryNode, present: Set<number>, ids: Map<QueryNode, number>): boolean {
  switch (n.t) {
    case 'term':
      return present.has(ids.get(n)!);
    case 'not':
      return !evaluate(n.c, present, ids);
    case 'and':
      return n.c.every((c) => evaluate(c, present, ids));
    case 'or':
      return n.c.some((c) => evaluate(c, present, ids));
  }
}

/** Matches in one text, as merged original spans in order. */
function matchText(text: string, c: Compiled): { start: number; end: number }[] {
  if (!text) return [];
  const f: Folded | null = c.fold ? foldWithMap(text, c.fold) : null;
  const hay = f ? f.folded : text;
  const toOrig = (s: number, e: number) => (f ? originalSpan(f, s, e) : { start: s, end: e });

  const occ: Occ[] = [];
  c.terms.forEach((re, term) => {
    for (const [s, e] of execAll(re, hay)) {
      if (c.postWholeWord && (isWordCharAt(hay, s - 1) || isWordCharAt(hay, e))) continue;
      const o = toOrig(s, e);
      if (o.end > o.start) occ.push({ term, start: o.start, end: o.end });
    }
  });

  let kept: Occ[];
  if (!c.ast) kept = occ;
  else {
    const ast = c.ast;
    const lines = lineIndex(text);
    const byLine = new Map<number, Occ[]>();
    for (const o of occ) {
      const ln = lines.lineOf(o.start);
      const list = byLine.get(ln);
      if (list) list.push(o);
      else byLine.set(ln, [o]);
    }
    kept = [];
    for (const list of byLine.values()) {
      if (!list.some((o) => c.positive[o.term])) continue;
      const present = new Set(list.map((o) => o.term));
      if (evaluate(ast, present, c.ids)) for (const o of list) if (c.positive[o.term]) kept.push(o);
    }
  }

  kept.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: { start: number; end: number }[] = [];
  for (const o of kept) {
    const last = merged[merged.length - 1];
    if (last && o.start < last.end) {
      if (o.end > last.end) last.end = o.end;
    } else merged.push({ start: o.start, end: o.end });
  }
  return merged;
}

const isLow = (text: string, i: number) => {
  const c = text.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff;
};

/**
 * Context around [start, end): up to `width` characters each side, within the paragraph,
 * cut at word boundaries and trimmed of the whitespace at the outer edges.
 */
export function contextAround(text: string, start: number, end: number, width = 60): { before: string; after: string } {
  const ls = start <= 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  let le = text.indexOf('\n', end);
  if (le < 0) le = text.length;
  let b = Math.max(ls, start - width);
  if (b > ls && isWordCharAt(text, b - 1) && isWordCharAt(text, b)) {
    while (b < start && isWordCharAt(text, b)) b++;
  }
  if (b < start && isLow(text, b)) b++;
  let a = Math.min(le, end + width);
  if (a < le && isWordCharAt(text, a - 1) && isWordCharAt(text, a)) {
    while (a > end && isWordCharAt(text, a - 1)) a--;
  }
  if (a > end && a < text.length && isLow(text, a)) a--;
  return { before: text.slice(b, start).trimStart(), after: text.slice(end, a).trimEnd() };
}

/**
 * Searches every document. Throws SearchError for queries that cannot run (see validateQuery).
 */
export function searchTexts(
  docs: readonly { id: string; text: string }[],
  q: SearchQuery,
  opts: SearchOptions = {},
): SearchResult {
  const limit = Math.max(0, opts.limit ?? DEFAULT_SEARCH_LIMIT);
  const width = opts.context ?? 60;
  const c = compile(q);
  const hits: SearchHit[] = [];
  const perDocument = new Map<string, number>();
  let total = 0;
  for (const doc of docs) {
    const spans = matchText(doc.text, c);
    if (spans.length === 0) continue;
    perDocument.set(doc.id, (perDocument.get(doc.id) ?? 0) + spans.length);
    total += spans.length;
    for (const s of spans) {
      if (hits.length >= limit) break;
      const ctx = contextAround(doc.text, s.start, s.end, width);
      hits.push({ documentId: doc.id, start: s.start, end: s.end, before: ctx.before, match: doc.text.slice(s.start, s.end), after: ctx.after });
    }
  }
  return { hits, total, truncated: total > hits.length, perDocument };
}

// ---------------------------------------------------------------------------------------------
// Keyword in context
// ---------------------------------------------------------------------------------------------

export interface KwicRow {
  documentId: string;
  start: number;
  end: number;
  /** Left context, whitespace collapsed, at most `width` characters, cut at a word boundary. */
  left: string;
  keyword: string;
  right: string;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ');
}

function clipLeft(s: string, width: number): string {
  if (s.length <= width) return s;
  let i = s.length - width;
  if (isWordCharAt(s, i - 1) && isWordCharAt(s, i)) while (i < s.length && isWordCharAt(s, i)) i++;
  if (i < s.length && isLow(s, i)) i++;
  return s.slice(i).trimStart();
}

function clipRight(s: string, width: number): string {
  if (s.length <= width) return s;
  let i = width;
  if (isWordCharAt(s, i - 1) && isWordCharAt(s, i)) while (i > 0 && isWordCharAt(s, i - 1)) i--;
  if (i > 0 && isLow(s, i)) i--;
  return s.slice(0, i).trimEnd();
}

/** Rows for a concordance view (left context right-aligned against the keyword column). */
export function kwic(hits: readonly SearchHit[], width = 40): KwicRow[] {
  return hits.map((h) => ({
    documentId: h.documentId,
    start: h.start,
    end: h.end,
    left: clipLeft(collapse(h.before), width),
    keyword: collapse(h.match),
    right: clipRight(collapse(h.after), width),
  }));
}
