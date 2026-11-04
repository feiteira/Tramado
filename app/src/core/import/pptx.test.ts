import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importFile } from './index';
import { pptxToText } from './pptx';
import { sniffFormat } from './detect';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/tramado/docs/${name}`, import.meta.url)));
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const slide = (lines: string[]) => `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}"><p:cSld><p:spTree>${lines.map((l) => `<p:sp><p:txBody><a:p><a:r><a:t>${l}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`;

describe('pptxToText', () => {
  it('follows the presentation order (sldIdLst), not the file numbers, and keeps speaker notes in the slide', () => {
    const r = pptxToText(fixture('slides.pptx'));
    expect(r.slides).toBe(3);
    const slideText = (i: number) => r.text.slice(r.slideStarts[i]!, r.slideStarts[i + 1] ?? r.text.length).trim();
    // slide3.xml is presented first, then slide1.xml, then slide2.xml.
    expect(slideText(0)).toBe('Direito Constitucional I (fictício)\nSemana 8');
    expect(slideText(1)).toBe('Aula 6 — Restrições aos direitos\nAs restrições têm limites\nConteúdo essencial\nLembrar o artigo 18.º da lei de exemplo.');
    // Notes belong to the second presented slide; the slide-number placeholder is not text.
    expect(r.notes).toEqual([{ slide: 2, start: r.text.indexOf('Lembrar'), end: r.text.indexOf('Lembrar') + 'Lembrar o artigo 18.º da lei de exemplo.'.length }]);
    expect(r.text).not.toMatch(/\n2\n|^2$/m);
    // Table cells are read.
    expect(slideText(2)).toBe('Proporcionalidade\nTeste\nPergunta\nAdequação\nServe o fim?');
  });

  it('falls back to the file numbers without a presentation list, and is sniffed and imported as pptx', async () => {
    const deck = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/slides/slide10.xml': strToU8(slide(['Dez'])),
      'ppt/slides/slide2.xml': strToU8(slide(['Dois'])),
    });
    expect(pptxToText(deck)).toMatchObject({ text: 'Dois\n\nDez', slideStarts: [0, 6], slides: 2 });
    expect(sniffFormat('aula.pptx', deck)).toEqual({ format: 'pptx', hint: null });
    const [doc] = await importFile('aula.pptx', deck);
    expect(doc).toMatchObject({ text: 'Dois\n\nDez', source: { format: 'pptx' } });
  });

  it('reports a damaged deck', () => {
    expect(() => pptxToText(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toThrow();
    expect(() => pptxToText(zipSync({ 'x.txt': strToU8('x') }))).toThrow(/DAMAGED|no slides/);
  });
});
