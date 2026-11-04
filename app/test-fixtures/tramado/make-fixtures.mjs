// Builds the fictional document fixtures of app/test-fixtures/tramado/docs/ (T-DOCS tests).
// Run from anywhere: `node app/test-fixtures/tramado/make-fixtures.mjs`. The output is committed so
// tests do not depend on this script; rerun it after changing a fixture here (it prints SHA-256s).
//
// Everything is written by hand (raw PDF objects, zipped XML), so each file is tiny and its exact
// structure is known to the tests. All names, laws and content are fictional.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = require('fflate');

const here = join(dirname(fileURLToPath(import.meta.url)), 'docs');
mkdirSync(here, { recursive: true });
const out = (name, data) => {
  writeFileSync(join(here, name), data);
  console.log(createHash('sha256').update(data).digest('hex'), name);
};
const MTIME = new Date('2024-01-01T00:00:00Z');
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([n, c]) => [n, [typeof c === 'string' ? strToU8(c) : c, { level: 6, mtime: MTIME }]])));
const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------------------------
// PDF: a fictional law, 6 pages, printed page labels (i, ii, 1, 2, 3, 4), a running header and a
// page-number footer on every text page, articles that cross a page break, and a scanned page
// (page 5: an image, no text layer).

const pdfFromObjects = (objects, root = 1) => {
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let len = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(len);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b);
    len += b.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
};
const stream = (content, dict = '') => {
  const b = Buffer.isBuffer(content) ? content : Buffer.from(content, 'latin1');
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${b.length} >>\nstream\n`, 'latin1'), b, Buffer.from('\nendstream', 'latin1')]);
};
// WinAnsiEncoding: Latin-1 plus a few typographic characters in 0x80–0x9F.
const WIN_ANSI = { '—': 0x97, '–': 0x96, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '…': 0x85 };
const pdfStr = (s) => '(' + [...s].map((c) => {
  if (c === '\\' || c === '(' || c === ')') return '\\' + c;
  const code = WIN_ANSI[c] ?? c.charCodeAt(0);
  if (code > 0xff) throw new Error(`not in WinAnsi: ${c}`);
  return code < 0x80 ? c : '\\' + code.toString(8).padStart(3, '0');
}).join('') + ')';
const textAt = (x, y, size, s) => `BT /F1 ${size} Tf ${x} ${y} Td ${pdfStr(s)} Tj ET\n`;

const HEADER = 'Diário da República fictício, 1.ª série — N.º 12 — 3 de outubro de 2026';
// [size, text, gap before]; the header and footer are added to every text page.
const lawPages = [
  [[18, 'Lei Fundamental de Exemplo (texto fictício)', 40], [11, 'Aprovada pela Assembleia de Exemplo para efeitos de teste.', 30]],
  [[13, 'Preâmbulo', 40], [11, 'A presente lei fictícia serve apenas para testar a extração de texto,', 24], [11, 'a numeração das páginas e as citações por artigo.', 14]],
  [
    [12, 'Artigo 1.º Objeto', 40],
    [11, 'A presente lei define os direitos fundamentais dos estudantes fictícios', 22],
    [11, 'da Universidade de Exemplo.', 14],
    [12, 'Artigo 2.º Restrições', 30],
    [11, 'As leis restritivas devem ser gerais e abstratas, não podem ter efeito', 22],
    [11, 'retroativo e nunca podem atingir o conteúdo essencial do direito restringido.', 14],
  ],
  [
    [11, 'A restrição deve limitar-se ao necessário para salvaguardar outros', 40],
    [11, 'direitos ou interesses protegidos pela lei de exemplo.', 14],
    [12, 'Artigo 3.º Época de recurso', 30],
    [11, 'O estudante reprovado na época normal pode inscrever-se na época de recurso,', 22],
    [11, 'mediante o pagamento de uma taxa fixada anualmente.', 14],
  ],
  null,   // page 5: scanned
  [
    [12, 'Artigo 4.º Melhoria de nota', 40],
    [11, 'O estudante aprovado pode requerer melhoria de nota uma única vez.', 22],
    [12, 'Artigo 5.º Fraude académica', 40],
    [11, 'A fraude em prova de avaliação determina a anulação da prova.', 22],
  ],
];
const labels = ['i', 'ii', '1', '2', '3', '4'];
const n = lawPages.length;
// Objects: 1 catalog, 2 pages, 3 font, 4 image, then per page: page object, content stream.
const objs = [];
const pageObj = (i) => 5 + i * 2;
const contentObj = (i) => 6 + i * 2;
objs[0] = `<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >> >>`;
objs[1] = `<< /Type /Pages /Kids [${lawPages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`;
objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
const pixels = Buffer.alloc(64);
for (let i = 0; i < 64; i++) pixels[i] = (i * 37) % 256;
objs[3] = stream(pixels, '/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8');
lawPages.forEach((lines, i) => {
  objs[pageObj(i) - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${contentObj(i)} 0 R >>`;
  let content;
  if (!lines) content = 'q 400 0 0 560 97 140 cm /Im1 Do Q\n';
  else {
    let y = 800;
    content = textAt(72, 812, 8, HEADER);
    for (const [size, s, gap] of lines) {
      y -= gap;
      content += textAt(72, y, size, s);
    }
    content += textAt(290, 40, 9, `- ${labels[i]} -`);
  }
  objs[contentObj(i) - 1] = stream(content);
});
out('law.pdf', pdfFromObjects(objs));

// ---------------------------------------------------------------------------------------------
// PPTX: three slides stored as slide1..3.xml, presented in the order 3, 1, 2 (sldIdLst), slide 1
// with speaker notes, a slide-number placeholder that must not be read as text, and a table.

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const sp = (lines, ph = null) => `<p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${xmlEsc(l)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const slide = (body) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const table = (rows) => `<p:graphicFrame><a:graphic><a:graphicData><a:tbl>${rows.map((r) => `<a:tr>${r.map((c) => `<a:tc><a:txBody><a:p><a:r><a:t>${xmlEsc(c)}</a:t></a:r></a:p></a:txBody></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
out('slides.pptx', zip({
  '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId13"/><p:sldId id="257" r:id="rId11"/><p:sldId id="258" r:id="rId12"/></p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${PR}"><Relationship Id="rId11" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="rId12" Type="${R}/slide" Target="slides/slide2.xml"/><Relationship Id="rId13" Type="${R}/slide" Target="/ppt/slides/slide3.xml"/></Relationships>`,
  'ppt/slides/slide1.xml': slide(sp(['Aula 6 — Restrições aos direitos'], 'title') + sp(['As restrições têm limites', 'Conteúdo essencial']) + sp(['2'], 'sldNum')),
  'ppt/slides/_rels/slide1.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
  'ppt/notesSlides/notesSlide1.xml': `<?xml version="1.0"?><p:notes xmlns:a="${A}" xmlns:p="${P}"><p:cSld><p:spTree>${sp([''], 'sldImg')}${sp(['Lembrar o artigo 18.º da lei de exemplo.'], 'body')}${sp(['2'], 'sldNum')}</p:spTree></p:cSld></p:notes>`,
  'ppt/slides/slide2.xml': slide(sp(['Proporcionalidade'], 'title') + table([['Teste', 'Pergunta'], ['Adequação', 'Serve o fim?']])),
  'ppt/slides/slide3.xml': slide(sp(['Direito Constitucional I (fictício)'], 'ctrTitle') + sp(['Semana 8'])),
}));

// ---------------------------------------------------------------------------------------------
// DOCX with headings (heading locators).

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const para = (t, style = null) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`;
out('resumo.docx', zip({
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PR}"><Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
  'word/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    para('Resumo — Direitos fundamentais', 'Heading1') +
    para('Notas de estudo fictícias da Carla.') +
    para('Restrições', 'Heading2') +
    para('Uma restrição nunca pode atingir o conteúdo essencial.') +
    para('A proporcionalidade tem três testes.') +
    para('Exame', 'Heading1') +
    para('Rever os artigos 1.º a 5.º.') +
    '<w:sectPr/></w:body></w:document>',
}));
