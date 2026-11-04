// Article units for law texts (research trama-ts §5(a), critique G9.4, lab articles.ts): one search
// unit per article, from its heading to the next heading, so a citation says "art. 483.º (pp. 52–53)"
// even when the article runs over a page break. Headings are matched at a paragraph start only —
// the PDF paragraph builder may merge "Artigo 2.º Época de recurso" with its first sentence, so the
// heading is not assumed to be a line of its own. PT `Artigo 483.º` / `Art. 251.º-A`, ES
// `Artículo 1902` / `Artículo 3 bis`, EN `Article 6`. Long articles are windowed (~1 500 chars),
// every window keeping the article's locator.
import type { Locator } from '../model/files';
import { pageOf } from './pdfPages';

export interface ArticleHead {
  /** Offset of the heading (a paragraph start). */
  start: number;
  /** Normalised article id as the folder spec's Locator stores it: "483.º", "251.º-A", "1902", "3 bis", "6". */
  article: string;
  /** The number, for the order check. */
  n: number;
}

// "Artigo 483.º", "Art. 2º", "ARTIGO 1.º", "Artículo 1902.", "Artículo 3 bis", "Article 6", "Artigo 251.º-A".
const HEAD = /^[ \t]*(?:Artigo|Art\.|Art|Artículo|Articulo|Article)[ \t]+(\d{1,5})(?:[ \t]*(\.?[ \t]?[º°ºo])\.?)?(?:[ \t]*[-‐–][ \t]*([A-Z])\b)?(?:[ \t]+(bis|ter|quater|quinquies|sexies)\b)?(?=$|[\s.,:;)\-–—(])/gimu;

/** Every article heading at a paragraph start, in text order. */
export function findArticleHeads(text: string): ArticleHead[] {
  const out: ArticleHead[] = [];
  for (const m of text.matchAll(HEAD)) {
    const start = m.index + (m[0].length - m[0].trimStart().length);
    const ordinal = m[2] !== undefined;
    const letter = m[3] ? `-${m[3].toUpperCase()}` : '';
    const latin = m[4] ? ` ${m[4].toLowerCase()}` : '';
    out.push({ start, article: `${m[1]}${ordinal ? '.º' : ''}${letter}${latin}`, n: Number(m[1]) });
  }
  return out;
}

/** Heads that really structure the text: at least two, mostly in increasing order (a code, not a mention). */
export function articleStructure(text: string): ArticleHead[] {
  const heads = findArticleHeads(text);
  if (heads.length < 2) return [];
  let up = 0;
  for (let i = 1; i < heads.length; i++) if (heads[i]!.n >= heads[i - 1]!.n) up++;
  return up * 2 >= heads.length - 1 ? heads : [];
}

const WINDOW = 1500;

/** Cuts [start, end) into windows of about `size` characters at paragraph, then sentence, then space boundaries. */
export function windows(text: string, start: number, end: number, size = WINDOW): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let a = start;
  while (end - a > size * 1.25) {
    const slice = text.slice(a, a + size);
    let cut = slice.lastIndexOf('\n');
    if (cut < size / 3) cut = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '), slice.lastIndexOf('? '));
    if (cut < size / 3) cut = slice.lastIndexOf(' ');
    if (cut < size / 3) cut = size - 1;
    let b = a + cut + 1;
    out.push({ start: a, end: b });
    while (b < end && /\s/.test(text[b]!)) b++;
    a = b;
  }
  if (a < end && text.slice(a, end).trim()) out.push({ start: a, end });
  return out;
}

/**
 * One unit (or several windows) per article with an `article` locator, its physical page range when
 * `pageStarts` is known. Returns null when the text has no article structure.
 */
export function articleUnits(text: string, pageStarts: readonly number[] | null): {
  before: { start: number; end: number } | null;
  units: Array<{ start: number; end: number; locator: Extract<Locator, { type: 'article' }> }>;
} | null {
  const heads = articleStructure(text);
  if (!heads.length) return null;
  const units: Array<{ start: number; end: number; locator: Extract<Locator, { type: 'article' }> }> = [];
  heads.forEach((h, i) => {
    let end = i + 1 < heads.length ? heads[i + 1]!.start : text.length;
    while (end > h.start && /\s/.test(text[end - 1]!)) end--;
    if (end <= h.start) return;
    const pages: [number, number] | null = pageStarts && pageStarts.length
      ? [pageOf(pageStarts, h.start), pageOf(pageStarts, end - 1)]
      : null;
    for (const w of windows(text, h.start, end)) units.push({ ...w, locator: { type: 'article', article: h.article, pages } });
  });
  const first = heads[0]!.start;
  return { before: text.slice(0, first).trim() ? { start: 0, end: first } : null, units };
}
