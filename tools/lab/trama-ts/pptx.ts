// Prototype: .pptx → text with slide starts (like PdfText.pageStarts), on Trama's bounded zip/XML helpers.
import { zipSync, strToU8 } from 'fflate';
import { canonicalize, tidy } from './src/core/import/text';
import { childElements, descendants, parseXml, readZip, zipText } from './src/core/import/xml';
import { sniffFormat } from './src/core/import/detect';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

export interface SlidesText {
  text: string;
  /** Offset where each slide starts (slide n = index + 1). */
  slideStarts: number[];
  slides: number;
}

export function pptxToText(bytes: Uint8Array): SlidesText {
  const files = readZip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  const names = Object.keys(files).filter((n) => n.startsWith('ppt/slides/')).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  // NB: real order is ppt/presentation.xml <p:sldIdLst> via ppt/_rels/presentation.xml.rels; file number is a fallback.
  const slideStarts: number[] = [];
  let text = '';
  for (const name of names) {
    const doc = parseXml(zipText(files, name)!, 'pptx');
    const paras = descendants(doc, A, 'p')
      .map((p) => descendants(p, A, 't').map((t) => t.textContent ?? '').join(''))
      .map((s) => canonicalize(s).trim())
      .filter(Boolean);
    if (text) text += '\n\n';
    slideStarts.push(text.length);
    text += paras.join('\n');
  }
  void childElements; void P;
  return { text: tidy(text), slideStarts, slides: names.length };
}

// A minimal two-slide deck built in memory.
const slide = (lines: string[]) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="${A}" xmlns:p="${P}"><p:cSld><p:spTree>${lines.map((l) => `<p:sp><p:txBody><a:p><a:r><a:t>${l}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`;
const deck = zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="' + P + '"/>'),
  'ppt/slides/slide1.xml': strToU8(slide(['Aula 3 — Contratos', 'Formação do contrato'])),
  'ppt/slides/slide2.xml': strToU8(slide(['Proposta e aceitação', 'A proposta vincula o proponente (art. 230.º CC)'])),
});
console.log('sniff:', JSON.stringify(sniffFormat('aula3.pptx', deck)));
console.log(JSON.stringify(pptxToText(deck), null, 1));
