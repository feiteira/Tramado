import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { extractPdfPages, normalizePageLabels, pageOf } from './pdfPages';
import { extractText } from './extract';
import type { PdfJsLike } from './pdf';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/tramado/docs/${name}`, import.meta.url)));
const lib = pdfjs as unknown as PdfJsLike;

describe('extractPdfPages (fixture: law.pdf, page labels i, ii, 1–4, page 5 scanned)', () => {
  it('keeps pageStarts, the printed page labels and the image pages; strips the running header and footer', async () => {
    const progress: number[] = [];
    const r = await extractPdfPages(fixture('law.pdf'), lib, { onProgress: (p) => progress.push(p) });
    expect(r.pages).toBe(6);
    expect(r.pageLabels).toEqual(['i', 'ii', '1', '2', '3', '4']);
    expect(r.imagePages).toEqual([5]);
    expect(r.warnings).toEqual(['pdf.imagePages:5']);
    expect(r.pageStarts).toHaveLength(6);
    expect(r.headerLines).toBe(10);
    expect(r.text).not.toContain('Diário da República');
    expect(r.text).not.toMatch(/- (i|ii|\d) -/);
    // Article 2 starts on page 3 (label "1") and continues on page 4.
    const art2 = r.text.indexOf('Artigo 2.º');
    const cont = r.text.indexOf('A restrição deve limitar-se');
    expect([pageOf(r.pageStarts, art2), pageOf(r.pageStarts, cont)]).toEqual([3, 4]);
    // The scanned page holds no text: the text after it is on page 6.
    expect(pageOf(r.pageStarts, r.text.indexOf('Artigo 4.º'))).toBe(6);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toHaveLength(6);
  });

  it('builds article units with physical page ranges, and page units with labels before the first article', async () => {
    const t = await extractText(fixture('law.pdf'), 'pdf', 'law.pdf', { pdfjs: async () => lib });
    expect(t.pageLabels).toEqual(['i', 'ii', '1', '2', '3', '4']);
    expect(t.units.map((u) => u.locator)).toEqual([
      { type: 'page', page: 1, pageLabel: 'i' }, { type: 'page', page: 1, pageLabel: 'i' },
      { type: 'page', page: 2, pageLabel: 'ii' }, { type: 'page', page: 2, pageLabel: 'ii' },
      { type: 'article', article: '1.º', pages: [3, 3] }, { type: 'article', article: '2.º', pages: [3, 4] },
      { type: 'article', article: '3.º', pages: [4, 4] }, { type: 'article', article: '4.º', pages: [6, 6] },
      { type: 'article', article: '5.º', pages: [6, 6] },
    ]);
  });

  it('stops with CANCELLED when aborted, and reports an all-scan PDF', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(extractPdfPages(fixture('law.pdf'), lib, { signal: ctl.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    const scanned = new Uint8Array(readFileSync(new URL('../../../test-fixtures/import/scanned.pdf', import.meta.url)));
    const r = await extractPdfPages(scanned, lib);
    expect(r.text).toBe('');
    expect(r.warnings).toEqual(['pdf.noText']);
  });

  it('leaves out labels that are just the physical number', () => {
    expect(normalizePageLabels(['1', '2', 'iii'], 3)).toEqual([null, null, 'iii']);
    expect(normalizePageLabels(null, 2)).toEqual([null, null]);
    expect(pageOf([0, 10, 10, 20], 10)).toBe(3);
    expect(pageOf([0, 10, 10, 20], 9)).toBe(1);
    expect(pageOf([0, 10, 10, 20], 25)).toBe(4);
  });
});
