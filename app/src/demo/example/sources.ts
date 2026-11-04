// The canonical text of each demo document unit (a PDF page, a slide, a whole DOCX), from content/*.ts: what the
// citations quote and what `example.test.ts` resolves every quote against. One line per printed paragraph.
import { ACORDAO, CALENDARIO, ESQUEMAS, RESUMO, SLIDES6 } from './content/law-docs';
import { APUNTES, LAB2, PRIMER, SLIDES3 } from './content/bio-docs';
import { LF_PAGES, lfPageLines } from './content/lf';

type Lines = { lines: Array<{ text: string }> };
const linesText = (p: Lines | undefined) => (p ? p.lines.map((l) => l.text).join('\n') : null);
const slideText = (s: { title: string; bullets: string[] } | undefined) => (s ? [s.title, ...s.bullets].join('\n') : null);
const docxText = (d: { title: string; sections: Array<{ heading: string; paragraphs: string[] }> }) =>
  [d.title, ...d.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join('\n');

/** The units (pages or slides) a document has; DOCX files are one unit. */
export function docUnits(doc: string): number {
  switch (doc) {
    case 'lf': return LF_PAGES.length;
    case 'primer': return PRIMER.length;
    case 'apuntes': return APUNTES.length;
    case 'esquemas': return ESQUEMAS.length;
    case 'acordao': return ACORDAO.length;
    case 'calendario': return 1;
    case 'slides6': return SLIDES6.slides.length;
    case 'slides3': return SLIDES3.slides.length;
    case 'resumo':
    case 'lab2': return 1;
    default: throw new Error(`no source text for document ${doc}`);
  }
}

/** The text of page / slide `unit` (1-based) of a demo document; DOCX files ignore `unit`. */
export function docSourceText(doc: string, unit: number): string {
  let t: string | null;
  switch (doc) {
    case 'lf': t = LF_PAGES[unit - 1] ? lfPageLines(LF_PAGES[unit - 1]!).join('\n') : null; break;
    case 'primer': t = linesText(PRIMER[unit - 1]); break;
    case 'apuntes': t = linesText(APUNTES[unit - 1]); break;
    case 'esquemas': t = linesText(ESQUEMAS[unit - 1]); break;
    case 'acordao': t = linesText(ACORDAO[unit - 1]); break;
    case 'calendario': t = unit === 1 ? linesText(CALENDARIO) : null; break;
    case 'slides6': t = slideText(SLIDES6.slides[unit - 1]); break;
    case 'slides3': t = slideText(SLIDES3.slides[unit - 1]); break;
    case 'resumo': t = docxText(RESUMO); break;
    case 'lab2': t = docxText(LAB2); break;
    default: t = null;
  }
  if (t === null) throw new Error(`no unit ${unit} in document ${doc}`);
  return t;
}

/** The whole text of a document (all units joined), for uniqueness checks. */
export function docWholeText(doc: string): string {
  const n = docUnits(doc);
  const parts: string[] = [];
  for (let i = 1; i <= n; i++) parts.push(docSourceText(doc, i));
  return parts.join('\n\n');
}
