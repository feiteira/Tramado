// Search units with citation locators (architecture §11.1 `units.ts`, research trama-ts §5(a),
// folder spec §8.15): what PassageIndex scores, each unit carrying the Locator a citation stores.
//   - law texts (any format with an article structure): one unit per article (articles.ts);
//   - PDF: paragraphs (≤ 600-char windows), each on one physical page (`page`, with the printed label);
//   - slides: paragraphs inside a slide (`slide`);
//   - documents with headings (DOCX, Markdown, HTML): paragraphs under their heading path (`heading`);
//   - anything else: paragraphs with their offsets (`text`, tied to the extractor version).
import type { Locator } from '../model/files';
import { articleUnits } from './articles';
import { pageOf } from './pdfPages';

export interface UnitSpan { start: number; end: number; locator: Locator }

export interface UnitSource {
  kind: string;
  text: string;
  pageStarts?: number[];
  pageLabels?: Array<string | null>;
  slideStarts?: number[];
  headings?: Array<{ start: number; level: number; text: string }>;
}

const WINDOW = 600;

/** Trama's paragraph units: each `\n` line, lines longer than 600 chars cut at sentence ends (rank.ts). */
export function paragraphSpans(text: string, from = 0, to = text.length): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let at = from;
  while (at < to) {
    let nl = text.indexOf('\n', at);
    if (nl < 0 || nl > to) nl = to;
    let a = at;
    while (a < nl) {
      let b = nl;
      if (b - a > WINDOW) {
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

function pageLocator(src: UnitSource, pos: number): Locator {
  const page = pageOf(src.pageStarts!, pos);
  const label = src.pageLabels?.[page - 1];
  return label ? { type: 'page', page, pageLabel: label } : { type: 'page', page };
}

/** The heading path in force at `pos` (outermost first), or null before the first heading. */
export function headingAt(headings: NonNullable<UnitSource['headings']>, pos: number): string[] | null {
  const path: Array<{ level: number; text: string }> = [];
  for (let i = 0; i < headings.length && headings[i]!.start <= pos; i++) {
    const h = headings[i]!;
    while (path.length && path[path.length - 1]!.level >= h.level) path.pop();
    path.push({ level: h.level, text: h.text });
  }
  return path.length ? path.map((h) => h.text) : null;
}

/** Units with locators for an extracted text (see the header). `extractor` names the text version. */
export function buildUnits(src: UnitSource, extractor: string): UnitSpan[] {
  const { text } = src;
  const plain = (start: number, end: number): UnitSpan[] => paragraphSpans(text, start, end).map((u) => {
    if (src.pageStarts?.length) return { ...u, locator: pageLocator(src, u.start) };
    if (src.slideStarts?.length) return { ...u, locator: { type: 'slide', slide: pageOf(src.slideStarts, u.start) } };
    if (src.headings?.length) {
      const path = headingAt(src.headings, u.start);
      // The paragraph number under the heading is filled in below, once the units are in order.
      if (path) return { ...u, locator: { type: 'heading', path, paragraph: 0 } };
    }
    return { ...u, locator: { type: 'text', start: u.start, end: u.end, extractor } };
  });

  const articles = src.kind === 'pptx' ? null : articleUnits(text, src.pageStarts?.length ? src.pageStarts : null);
  const units = articles
    ? [...(articles.before ? plain(articles.before.start, articles.before.end) : []), ...articles.units]
    : plain(0, text.length);

  // Number the paragraphs under each heading (1-based), now that the units are in order.
  let current = '';
  let n = 0;
  for (const u of units) {
    if (u.locator.type !== 'heading') continue;
    const key = u.locator.path.join('\u0000');
    n = key === current ? n + 1 : 1;
    current = key;
    u.locator = { ...u.locator, paragraph: n };
  }
  return units;
}

/** The unit holding `pos` (the last one starting at or before it), for locating a hit. */
export function unitAt<U extends { start: number; end: number }>(units: readonly U[], pos: number): U | null {
  let lo = 0;
  let hi = units.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (units[mid]!.start <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? units[lo - 1]! : null;
}
