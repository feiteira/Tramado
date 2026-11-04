// Running headers and footers (research trama-ts §5(b).4, critique G9.3): law gazettes repeat
// "Diário da República, 1.ª série — N.º 123 — …" and a page number on every page, which pollutes
// BM25 and every citation quote. A first or last line of a page that appears (digits ignored) as a
// first or last line on at least half of the pages with text is dropped from every page where it
// stands there. Two levels deep at the top and at the bottom (a header line and a date line).
// Article headings are never dropped, and a document needs at least three pages with text.

const MAX_LINE = 160;
const MIN_PAGES = 3;
/** Never a running line: article headings (articles.ts) may open most pages of a code. */
const KEEP = /^(?:Artigo|Art\.?|Artículo|Article|Arts?\.?)\s+\d/iu;

/** The comparison key of a line: digits, page counters and spacing do not matter. */
export function runningKey(line: string): string {
  const k = line
    .normalize('NFC')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  // A page number in roman figures standing alone ("- iv -", "xii").
  return /^[^\p{L}]*[ivxlcdm]{1,7}[^\p{L}]*$/u.test(k) ? k.replace(/[ivxlcdm]+/, '#') : k;
}

export interface StrippedPages {
  pages: string[][];
  /** How many lines were dropped in all. */
  removed: number;
  /** The distinct keys that were dropped (diagnostics, tests). */
  keys: string[];
}

/** Drops running header and footer lines from pages of paragraphs (one array per page). */
export function stripRunningLines(input: readonly (readonly string[])[], opts: { threshold?: number; depth?: number } = {}): StrippedPages {
  const threshold = opts.threshold ?? 0.5;
  const depth = opts.depth ?? 2;
  const pages = input.map((p) => [...p]);
  const withText = pages.filter((p) => p.length > 0).length;
  const out: StrippedPages = { pages, removed: 0, keys: [] };
  if (withText < MIN_PAGES) return out;
  const need = Math.max(2, Math.ceil(withText * threshold));
  const candidate = (line: string | undefined) => line !== undefined && line.length <= MAX_LINE && !KEEP.test(line.trim());

  // Level by level, top then bottom: a page-number footer goes before a second header line is judged.
  for (let level = 0; level < depth; level++) {
    let any = false;
    for (const edge of ['top', 'bottom'] as const) {
      const at = (p: string[]) => (edge === 'top' ? p[0] : p[p.length - 1]);
      const counts = new Map<string, number>();
      for (const p of pages) {
        // A page keeps at least one line: a page that is only a header is still a page.
        if (p.length < 2) continue;
        const line = at(p);
        if (!candidate(line)) continue;
        const k = runningKey(line!);
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const running = new Set([...counts].filter(([, n]) => n >= need).map(([k]) => k));
      if (!running.size) continue;
      any = true;
      for (const p of pages) {
        if (p.length < 2) continue;
        const line = at(p);
        if (!candidate(line) || !running.has(runningKey(line!))) continue;
        if (edge === 'top') p.shift();
        else p.pop();
        out.removed++;
      }
      for (const k of running) if (!out.keys.includes(k)) out.keys.push(k);
    }
    if (!any) break;
  }
  return out;
}
