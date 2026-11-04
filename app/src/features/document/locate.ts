// Finding a quote in rendered text (a pdf.js text layer, a DOCX/slide/text view) and in extracted text, ignoring
// whitespace, case and accents: a cited passage (UX §3.7.2 "Cited quote"), a private highlight anchored by its quote,
// the page of a quote in a PDF's text cache. The matcher is pure (`normalizeWithMap`); `rangeOf` maps it onto DOM text
// nodes.

/** Folded characters of `s` without whitespace, and for each the index of the source character. */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (/\s/u.test(ch) || ch === '­') continue;   // whitespace and soft hyphens
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[‘’ʼ]/g, "'").replace(/[“”«»]/g, '"').replace(/[‐‑–—]/g, '-');
    for (const c of f) {
      text += c;
      map.push(i);
    }
  }
  return { text, map };
}

/** The first `n` words of a quote (UX §3.7.2: the find uses the first 8 words). */
export function firstWords(quote: string, n = 8): string {
  return quote.trim().split(/\s+/).slice(0, n).join(' ');
}

/** [start, end) of `quote` in `text` (source offsets), trying the whole quote, then its first 8 words; null when absent. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const hay = normalizeWithMap(text);
  for (const q of [quote, firstWords(quote, 8), firstWords(quote, 5)]) {
    const needle = normalizeWithMap(q).text;
    if (needle.length < 3) continue;
    const i = hay.text.indexOf(needle);
    if (i < 0) continue;
    return { start: hay.map[i]!, end: hay.map[i + needle.length - 1]! + 1 };
  }
  return null;
}

/** The 1-based page of a quote in a text cache (pageStarts), preferring `near` and its neighbours. */
export function pageOfQuote(text: string, pageStarts: readonly number[], quote: string, near: number | null): number | null {
  const pages = pageStarts.length;
  if (!pages) return null;
  const pageText = (p: number) => text.slice(pageStarts[p - 1] ?? 0, p < pages ? (pageStarts[p] ?? text.length) : text.length);
  const order: number[] = [];
  if (near && near >= 1 && near <= pages) order.push(near, near + 1, near - 1);
  for (let p = 1; p <= pages; p++) order.push(p);
  const seen = new Set<number>();
  for (const p of order) {
    if (p < 1 || p > pages || seen.has(p)) continue;
    seen.add(p);
    if (findQuote(pageText(p), quote)) return p;
  }
  return null;
}

/** Every [start, end) of `query` in `text` (whitespace/case/accents ignored), at most `max`. */
export function findAll(text: string, query: string, max = 500): Array<{ start: number; end: number }> {
  const needle = normalizeWithMap(query).text;
  if (needle.length < 2) return [];
  const hay = normalizeWithMap(text);
  const out: Array<{ start: number; end: number }> = [];
  let i = hay.text.indexOf(needle);
  while (i >= 0 && out.length < max) {
    out.push({ start: hay.map[i]!, end: hay.map[i + needle.length - 1]! + 1 });
    i = hay.text.indexOf(needle, i + needle.length);
  }
  return out;
}

/** DOM Ranges over every match of `query` inside `root` (find in a text document). */
export function rangesOf(root: Node, query: string): Range[] {
  const { nodes, starts, all } = textNodes(root);
  const doc = root.ownerDocument ?? (root as Document);
  return findAll(all, query).map((hit) => toRange(doc, nodes, starts, hit));
}

function textNodes(root: Node): { nodes: Text[]; starts: number[]; all: string } {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let all = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if ((t.parentElement?.closest('.endOfContent, .doc-overlays')) ?? false) continue;
    nodes.push(t);
    starts.push(all.length);
    all += t.data;
  }
  return { nodes, starts, all };
}

function toRange(doc: Document, nodes: Text[], starts: number[], hit: { start: number; end: number }): Range {
  const at = (pos: number, end: boolean) => {
    let i = starts.length - 1;
    while (i > 0 && starts[i]! > pos - (end ? 1 : 0)) i--;
    return { node: nodes[i]!, offset: pos - starts[i]! };
  };
  const a = at(hit.start, false);
  const b = at(hit.end, true);
  const r = doc.createRange();
  r.setStart(a.node, Math.min(a.offset, a.node.length));
  r.setEnd(b.node, Math.min(b.offset, b.node.length));
  return r;
}

/** A DOM Range over `quote` inside `root`'s text (whitespace/case/accents ignored), or null. */
export function rangeOf(root: Node, quote: string): Range | null {
  const { nodes, starts, all } = textNodes(root);
  if (!nodes.length) return null;
  const hit = findQuote(all, quote);
  if (!hit) return null;
  return toRange(root.ownerDocument ?? (root as Document), nodes, starts, hit);
}

/** The rectangles of a range relative to `box` (merged per line), for overlays drawn inside `box`. */
export function rectsIn(range: Range, box: HTMLElement): Array<{ left: number; top: number; width: number; height: number }> {
  const b = box.getBoundingClientRect();
  const out: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue;
    const rect = { left: r.left - b.left, top: r.top - b.top, width: r.width, height: r.height };
    const same = out.find((o) => Math.abs(o.top - rect.top) < rect.height * 0.5 && rect.left <= o.left + o.width + 4 && rect.left + rect.width >= o.left - 4);
    if (same) {
      const right = Math.max(same.left + same.width, rect.left + rect.width);
      same.left = Math.min(same.left, rect.left);
      same.width = right - same.left;
      same.top = Math.min(same.top, rect.top);
      same.height = Math.max(same.height, rect.height);
    } else out.push(rect);
  }
  return out;
}

/** Up to `n` characters before and after a quote in `text` (TextQuote prefix/suffix, folder spec §8.17). */
export function contextOf(text: string, quote: string, n = 32): { prefix: string; suffix: string } {
  const hit = findQuote(text, quote);
  if (!hit) return { prefix: '', suffix: '' };
  return { prefix: text.slice(Math.max(0, hit.start - n), hit.start).replace(/\s+/g, ' ').trimStart(), suffix: text.slice(hit.end, hit.end + n).replace(/\s+/g, ' ').trimEnd() };
}
