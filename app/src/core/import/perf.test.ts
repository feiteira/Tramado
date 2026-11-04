// Performance budget (plan §4.3, critique G9 / R11): an 800-page synthetic law PDF (research lab
// `bigpdf.mjs`: Helvetica, a running header on every page, an article heading every 12 lines)
// is extracted in < 10 s and indexed in < 1 s under Node; a query takes < 50 ms.
// Skipped with CI_SLOW=0.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { PassageIndex } from '../search/passageIndex';
import { stopwordsFor } from '../search/stopwords';
import { extractText } from './extract';
import type { PdfJsLike } from './pdf';

/** The lab generator (tools/lab/critique/scripts/bigpdf.mjs), in memory. */
function bigPdf(pages: number): Uint8Array {
  const words = 'o a de que em para estudante contrato obrigação prazo tribunal prova direito dever norma lei negócio jurídico vontade declaração nulidade anulabilidade capacidade exercício gozo menor tutela herança doação venda compra arrendamento renda trabalho salário férias despedimento causa indemnização responsabilidade civil dano culpa ilicitude'.split(' ');
  let seed = 11;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const line = () => Array.from({ length: 11 + Math.floor(rnd() * 3) }, () => words[Math.floor(rnd() * words.length)]).join(' ');
  const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
  const pdfStr = (s: string) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[\u0080-ÿ]/g, (c) => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')) + ')';
  let art = 1;
  const contents: string[] = [];
  for (let p = 0; p < pages; p++) {
    let y = 800;
    let s = `BT /F1 8 Tf 72 820 Td ${pdfStr('Diário da República, 1.ª série  N.º 123 (fictício)')} Tj ET\n`;
    for (let l = 0; l < 45; l++) {
      if (l % 12 === 0) {
        y -= 6;
        s += `BT /F1 11 Tf 72 ${y} Td ${pdfStr(`Artigo ${art++}.º Disposição ${art}`)} Tj ET\n`;
        y -= 15;
      }
      s += `BT /F1 10 Tf 72 ${y} Td ${pdfStr(line() + '.')} Tj ET\n`;
      y -= 13;
      if (y < 60) break;
    }
    contents.push(s);
  }
  const n = contents.length;
  const font = 3 + n;
  const objs: Array<string | Uint8Array> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${n} >>`,
    ...contents.map((_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${font + 1 + i} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ...contents.map((c) => {
      const b = latin1(c);
      const head = latin1(`<< /Length ${b.length} >>\nstream\n`);
      const tail = latin1('\nendstream');
      const out = new Uint8Array(head.length + b.length + tail.length);
      out.set(head);
      out.set(b, head.length);
      out.set(tail, head.length + b.length);
      return out;
    }),
  ];
  const parts: Uint8Array[] = [latin1('%PDF-1.4\n')];
  const offs: number[] = [];
  let len = parts[0]!.length;
  objs.forEach((o, i) => {
    offs.push(len);
    const body = typeof o === 'string' ? latin1(o) : o;
    const pre = latin1(`${i + 1} 0 obj\n`);
    const post = latin1('\nendobj\n');
    parts.push(pre, body, post);
    len += pre.length + body.length + post.length;
  });
  parts.push(latin1(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe.skipIf(process.env.CI_SLOW === '0')('performance: 800-page law PDF', () => {
  it('extracts in < 10 s, indexes in < 1 s and answers a query in < 50 ms', async () => {
    const bytes = bigPdf(800);
    let t = performance.now();
    const cache = await extractText(bytes, 'pdf', 'codigo.pdf', { pdfjs: async () => pdfjs as unknown as PdfJsLike });
    const extractMs = performance.now() - t;
    expect(cache.pageStarts).toHaveLength(800);
    // The running header is gone from every page; the article structure is found.
    expect(cache.text.includes('Diário da República')).toBe(false);
    expect(cache.units.filter((u) => u.locator.type === 'article').length).toBeGreaterThan(2000);
    const stop = new Set([...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')]);
    t = performance.now();
    const idx = new PassageIndex(stop);
    idx.add('codigo', cache.text, cache.units);
    const indexMs = performance.now() - t;
    idx.search('nulidade do contrato');   // warm up the JIT
    t = performance.now();
    const hits = idx.search('anulabilidade do negócio celebrado por menor', { limit: 10 });
    const queryMs = performance.now() - t;
    expect(hits[0]?.locator.type).toBe('article');
    console.log(JSON.stringify({ pages: 800, chars: cache.text.length, extractMs: Math.round(extractMs), indexMs: Math.round(indexMs), queryMs: +queryMs.toFixed(1) }));
    expect(extractMs).toBeLessThan(10_000);
    expect(indexMs).toBeLessThan(1_000);
    expect(queryMs).toBeLessThan(50);
  });
});
