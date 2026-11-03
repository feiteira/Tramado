// Experiment: Trama's extractPdfText + rankPassages → citations with page / article / timestamp.
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfText, type PdfJsLike } from './src/core/import/pdf';
import { cuesToTranscript } from './src/core/import/transcript';
import { rankPassages } from './src/core/qda/rank';
import { stopwordsFor } from './src/core/qda/stopwords';
import { upperBound } from './src/core/qda/util';
import { draftMessages } from './src/core/service/prompt';

const pdfPath = process.argv[2]!;
const bytes = new Uint8Array(readFileSync(pdfPath));
const pdf = await extractPdfText(bytes, pdfjs as unknown as PdfJsLike);
console.log('PDF pages', pdf.pages, 'pageStarts', pdf.pageStarts);
console.log('---- PDF text ----\n' + pdf.text + '\n------------------');

// A fictional lecture transcript as whisper would hand it back (segments in ms).
const t = cuesToTranscript([
  { start: 0, end: 4000, speaker: null, text: 'Bom dia a todos, hoje vamos falar do regulamento académico.' },
  { start: 4200, end: 12000, speaker: null, text: 'Quem chumbar na época normal pode ir à época de recurso, mas tem de pagar uma taxa.' },
  { start: 15000, end: 22000, speaker: null, text: 'Atenção que a melhoria de nota só se pode pedir uma vez.' },
  { start: 61000, end: 70000, speaker: null, text: 'E a fraude numa prova dá anulação da prova e processo disciplinar.' },
]);
console.log('transcript text:\n' + t.text);
console.log('sync', JSON.stringify(t.sync));

/** Page (from 1) of an offset in a PDF's text. */
const pageOf = (pageStarts: number[], pos: number) => Math.max(1, upperBound(pageStarts, pos));
/** Media time of an offset in a transcript: the last sync point at or before it. */
const msAt = (sync: { pos: number; ms: number }[], pos: number) => {
  let ms = 0;
  for (const s of sync) if (s.pos <= pos) ms = s.ms; else break;
  return ms;
};
/** The article heading in force at an offset (Portuguese "Artigo N.º"). */
const articleAt = (text: string, pos: number) => {
  const re = /^(?:Artigo|Art\.)\s+(\d+[.º°-]*[A-Z]?)\.?º?\s*(.*)$/gmu;
  let found: string | null = null;
  for (const m of text.matchAll(re)) {
    if (m.index! > pos) break;
    found = `Art. ${m[1]!.replace(/[.º°]+$/, '')}.º${m[2] ? ` (${m[2]})` : ''}`;
  }
  return found;
};

const docs = [
  { id: 'reg', text: pdf.text },
  { id: 'aula', text: t.text },
];
const stop = new Set([...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')]);
const question = 'Um estudante reprovou na época normal. Pode ir a recurso e quanto paga?';
const ranked = rankPassages(docs, question, { stopwords: stop, limit: 5 });
for (const r of ranked) {
  const where = r.documentId === 'reg'
    ? `p. ${pageOf(pdf.pageStarts, r.start)}${pageOf(pdf.pageStarts, r.start) !== pageOf(pdf.pageStarts, r.end - 1) ? `–${pageOf(pdf.pageStarts, r.end - 1)}` : ''}, ${articleAt(pdf.text, r.start) ?? '—'}`
    : `@ ${(msAt(t.sync, r.start) / 1000).toFixed(1)} s`;
  console.log(r.score.toFixed(3), r.documentId, where, '|', r.text);
}
const msgs = draftMessages(question, ranked.map((r) => ({ document: r.documentId === 'reg' ? `Regulamento, p. ${pageOf(pdf.pageStarts, r.start)}` : `Aula 1 @ ${msAt(t.sync, r.start) / 1000}s`, text: r.text })));
console.log(JSON.stringify(msgs, null, 1));
