// Citation resolution (folder spec §8.15, UX §4.1). M0 ports `resolveQuote` (Trama's demo helper,
// used by the lab's cite.ts experiments); T-DOCS completes steps 1–4 (path + sha256 → moved → changed
// → missing) on top of it.
import type { Citation, TextQuote } from '../model/files';
import { findQuote, type Anchored } from './anchor';

/**
 * Where `quote` sits in `text`. `occurrence` (1-based) picks among repeats; without it the quote
 * must appear exactly once. Overlapping repeats count ("aa" occurs twice in "aaa").
 */
export function resolveQuote(text: string, quote: string, occurrence?: number): { start: number; end: number } {
  if (!quote) throw new Error('empty quote');
  if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) {
    throw new Error(`occurrence must be a whole number from 1: ${occurrence}`);
  }
  const found: number[] = [];
  const want = occurrence ?? 2; // without an occurrence, a second hit is already an error
  for (let at = text.indexOf(quote); at !== -1 && found.length < want; at = text.indexOf(quote, at + 1)) found.push(at);
  if (!found.length) throw new Error(`quote not found: “${quote}”`);
  if (occurrence === undefined && found.length > 1) throw new Error(`quote is ambiguous (give an occurrence): “${quote}”`);
  const start = found[(occurrence ?? 1) - 1];
  if (start === undefined) throw new Error(`quote occurs ${found.length} time(s), not ${occurrence}: “${quote}”`);
  return { start, end: start + quote.length };
}

/**
 * Re-anchors a stored TextQuote {exact, prefix, suffix} (folder spec §8.15) in a text that may have
 * changed: the occurrence of `exact` whose surroundings best match prefix/suffix, or null.
 */
export function anchorQuote(text: string, q: { exact: string; prefix: string; suffix: string }): { start: number; end: number } | null {
  if (!q.exact) return null;
  let best: { start: number; score: number } | null = null;
  for (let at = text.indexOf(q.exact); at !== -1; at = text.indexOf(q.exact, at + 1)) {
    const before = text.slice(Math.max(0, at - q.prefix.length), at);
    const after = text.slice(at + q.exact.length, at + q.exact.length + q.suffix.length);
    let score = 0;
    for (let i = 1; i <= Math.min(before.length, q.prefix.length) && before[before.length - i] === q.prefix[q.prefix.length - i]; i++) score++;
    for (let i = 0; i < Math.min(after.length, q.suffix.length) && after[i] === q.suffix[i]; i++) score++;
    if (!best || score > best.score) best = { start: at, score };
  }
  return best ? { start: best.start, end: best.start + q.exact.length } : null;
}

// ── Citation resolution, steps 1–4 of folder spec §8.15 (UX §4.1) ─────────────────────────────


export type CitationStatus = 'exact' | 'moved' | 'changed' | 'missing';

/** What the resolver may ask about the class (the search service answers from the store and caches). */
export interface CitationLookup {
  /** SHA-256 of the file at a class path, or null when there is none. */
  shaOf(path: string): Promise<string | null>;
  /** Class paths (documents and notes) whose content has this SHA-256. */
  pathsWithSha(sha256: string): Promise<string[]>;
  /** The extracted text of the file at a path now (null when it cannot be read). */
  textOf(path: string): Promise<string | null>;
  /** Other paths whose text may hold the quote (step 3, the class index), in the order to try. */
  candidates(kind: 'document' | 'note'): Promise<string[]>;
  lectureExists(lectureId: string): Promise<boolean>;
  examExists(examId: string): Promise<boolean>;
}

export interface ResolvedCitation {
  status: CitationStatus;
  /** Where the source is now (documents and notes). */
  path?: string;
  /** Where the quote is in the current text (when it had to be searched). */
  at?: Anchored;
}

/**
 * (1) the stored path still has the stored SHA-256 → exact; (2) the SHA-256 at another path →
 * moved; (3) the quote found in the class (the same path first) → changed; (4) missing.
 * Lectures and exams resolve by id.
 */
export async function resolveCitation(c: Pick<Citation, 'source' | 'locator' | 'quote'>, look: CitationLookup): Promise<ResolvedCitation> {
  const s = c.source;
  if (s.kind === 'lecture') return { status: (await look.lectureExists(s.lectureId)) ? 'exact' : 'missing' };
  if (s.kind === 'exam') return { status: (await look.examExists(s.examId)) ? 'exact' : 'missing' };
  const here = await look.shaOf(s.path);
  if (here !== null && here === s.sha256) return { status: 'exact', path: s.path };
  const moved = (await look.pathsWithSha(s.sha256)).filter((p) => p !== s.path);
  if (moved.length) return { status: 'moved', path: moved.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0]! };
  if (c.quote?.exact) {
    const tryPath = async (path: string) => {
      const text = await look.textOf(path);
      return text === null ? null : findQuote(text, c.quote as TextQuote, { fuzzy: path === s.path });
    };
    if (here !== null) {
      const at = await tryPath(s.path);
      if (at) return { status: 'changed', path: s.path, at };
    }
    for (const path of await look.candidates(s.kind)) {
      if (path === s.path) continue;
      const at = await tryPath(path);
      if (at) return { status: 'changed', path, at };
    }
  }
  return { status: 'missing' };
}
