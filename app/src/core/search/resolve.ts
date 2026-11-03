// Citation resolution (folder spec §8.15, UX §4.1). M0 ports `resolveQuote` (Trama's demo helper,
// used by the lab's cite.ts experiments); T-DOCS completes steps 1–4 (path + sha256 → moved → changed
// → missing) on top of it.

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
