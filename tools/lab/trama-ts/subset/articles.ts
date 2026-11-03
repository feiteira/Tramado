// Units for citation: PDF paragraphs with their page, and legal articles (which may span pages).
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfText, type PdfJsLike } from './src/core/import/pdf';
import { PassageIndex, paragraphUnits, type UnitSpan } from './src/core/qda/passageIndex';
import { stopwordsFor } from './src/core/qda/stopwords';
import { upperBound } from './src/core/qda/util';

const pageOf = (pageStarts: readonly number[], pos: number) => Math.max(1, upperBound(pageStarts, pos));

/** Paragraph units, each with the page it is on (a paragraph never crosses a page: pages are joined by "\n\n"). */
export function pdfParagraphUnits(text: string, pageStarts: readonly number[]): UnitSpan[] {
  return paragraphUnits(text).map((u) => ({ ...u, locator: { kind: 'page', page: pageOf(pageStarts, u.start) } }));
}

// "Artigo 2.º", "Art. 2.º", "Artículo 2", "Article 2", "Artigo 1-A.º" at a paragraph start.
const ARTICLE = /^(?:Artigo|Art\.?|Artículo|Article)\s+(\d+(?:\.º|º|°)?(?:-[A-Z])?)(?:\.º|º)?/gmu;

/** One unit per article (heading to the next heading), labelled, with the page it starts on. Text before the first article: paragraphs. */
export function articleUnits(text: string, pageStarts: readonly number[]): UnitSpan[] {
  const heads = [...text.matchAll(ARTICLE)];
  if (heads.length < 2) return pdfParagraphUnits(text, pageStarts);
  const out: UnitSpan[] = pdfParagraphUnits(text.slice(0, heads[0]!.index), pageStarts);
  heads.forEach((m, i) => {
    const start = m.index!;
    const end = i + 1 < heads.length ? heads[i + 1]!.index! - 1 : text.length;
    const p0 = pageOf(pageStarts, start);
    const p1 = pageOf(pageStarts, Math.max(start, end - 1));
    out.push({ start, end, locator: { kind: 'article', label: `art. ${m[1]!.replace(/\.?º|°/, '')}.º`, page: p0, ...(p1 !== p0 ? { label: `art. ${m[1]!.replace(/\.?º|°/, '')}.º (pp. ${p0}–${p1})` } : {}) } });
  });
  return out;
}

const pdf = await extractPdfText(new Uint8Array(readFileSync(process.argv[2]!)), pdfjs as unknown as PdfJsLike);
const idx = new PassageIndex(new Set([...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')]));
idx.add('regulamento', pdf.text, articleUnits(pdf.text, pdf.pageStarts));
for (const r of idx.search('Um estudante reprovou na época normal. Pode ir a recurso e quanto paga?', { limit: 3 })) {
  console.log(r.score.toFixed(2), JSON.stringify(r.locator), '|', r.text.replace(/\n+/g, ' ¶ ').slice(0, 160));
}
