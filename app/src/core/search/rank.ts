// Passages ranked by how well they match a question (or a code's definition): the paragraphs
// of the documents scored with BM25 over their words, accent- and case-folded, without stop
// words, and cut to their first six letters so that "movimentos" and "movimento" meet. A cheap
// stemmer, fair within Portuguese, Spanish or English, and it needs no model. It does NOT match
// across languages ("movimento" → "movime", "movement" → "moveme"): Tramado fixes Trama's comment
// here (research trama-ts §12.5) and expands queries with keywords instead. It only suggests.

import { foldWithMap, originalSpan } from './text';

export interface RankedPassage {
  documentId: string;
  /** The passage in the document's text (UTF-16 offsets, half-open). */
  start: number;
  end: number;
  text: string;
  score: number;
  /** Where the question's words are in the passage (offsets in the document). */
  hits: { start: number; end: number }[];
}

export interface RankOptions {
  /** Passages returned at most (default 30). */
  limit?: number;
  /** Words never counted (folded, as stopwordsFor gives them). */
  stopwords?: ReadonlySet<string>;
  /** Leaves out a passage (already linked, the question itself). */
  exclude?: (p: { documentId: string; start: number; end: number }) => boolean;
}

/** Longer paragraphs are scored in windows of about this many characters, cut at sentences. */
const WINDOW = 600;
const STEM = 6;
const K1 = 1.2;
const B = 0.75;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
/** A passage that is itself a question (an interviewer's, another exam's) rarely answers one. */
const ASKED = 0.5;
const asks = (text: string, u: { start: number; end: number }) => /[?¿]\s*$/.test(text.slice(u.start, u.end));

interface Unit {
  documentId: string;
  start: number;
  end: number;
  terms: Map<string, number>;
  length: number;
}

function stem(folded: string): string {
  return folded.length > STEM ? folded.slice(0, STEM) : folded;
}

/** The stems of a text, with where each word is in it. */
function words(text: string, stopwords: ReadonlySet<string>): { stem: string; start: number; end: number }[] {
  const f = foldWithMap(text, { caseSensitive: false, accentSensitive: false });
  const out: { stem: string; start: number; end: number }[] = [];
  for (const m of f.folded.matchAll(WORD)) {
    const w = m[0];
    if (w.length < 3 || stopwords.has(w) || /^\d+$/.test(w)) continue;
    const o = originalSpan(f, m.index, m.index + w.length);
    out.push({ stem: stem(w), start: o.start, end: o.end });
  }
  return out;
}

/** Paragraphs, and windows of sentences within long ones. */
function units(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let at = 0;
  while (at <= text.length) {
    let nl = text.indexOf('\n', at);
    if (nl < 0) nl = text.length;
    let a = at;
    while (a < nl) {
      let b = nl;
      if (b - a > WINDOW) {
        // The last sentence end before the window's edge, else the last space.
        const slice = text.slice(a, a + WINDOW);
        const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
        b = a + (stop > WINDOW / 3 ? stop + 1 : Math.max(slice.lastIndexOf(' '), WINDOW / 2));
      }
      if (text.slice(a, b).trim()) out.push({ start: a, end: b });
      a = b;
      while (a < nl && /\s/.test(text[a]!)) a++;
    }
    at = nl + 1;
  }
  return out;
}

/** The passages of `docs` that best match `query`, best first. */
export function rankPassages(docs: readonly { id: string; text: string }[], query: string, opts: RankOptions = {}): RankedPassage[] {
  const stopwords = opts.stopwords ?? new Set<string>();
  const want = new Set(words(query, stopwords).map((w) => w.stem));
  if (!want.size) return [];
  const all: Unit[] = [];
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const u of units(d.text)) {
      if (opts.exclude?.({ documentId: d.id, start: u.start, end: u.end })) continue;
      const terms = new Map<string, number>();
      let length = 0;
      for (const w of words(d.text.slice(u.start, u.end), stopwords)) {
        length++;
        if (want.has(w.stem)) terms.set(w.stem, (terms.get(w.stem) ?? 0) + 1);
      }
      if (!length) continue;
      for (const t of terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
      all.push({ documentId: d.id, start: u.start, end: u.end, terms, length });
    }
  }
  if (!all.length) return [];
  const textOf = new Map(docs.map((d) => [d.id, d.text]));
  const n = all.length;
  const avg = all.reduce((s, u) => s + u.length, 0) / n;
  const idf = (t: string) => {
    const k = df.get(t) ?? 0;
    return Math.log(1 + (n - k + 0.5) / (k + 0.5));
  };
  const scored = all
    .filter((u) => u.terms.size)
    .map((u) => {
      let score = 0;
      for (const [t, tf] of u.terms) score += (idf(t) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * u.length) / avg));
      return { u, score: asks(textOf.get(u.documentId)!, u) ? score * ASKED : score };
    })
    .sort((a, b) => b.score - a.score || (a.u.documentId < b.u.documentId ? -1 : a.u.documentId > b.u.documentId ? 1 : a.u.start - b.u.start))
    .slice(0, opts.limit ?? 30);
  return scored.map(({ u, score }) => {
    const text = textOf.get(u.documentId)!.slice(u.start, u.end);
    const hits = words(text, stopwords)
      .filter((w) => want.has(w.stem))
      .map((w) => ({ start: u.start + w.start, end: u.start + w.end }));
    return { documentId: u.documentId, start: u.start, end: u.end, text, score, hits };
  });
}
