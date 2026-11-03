// Builds the fictional fixture files used by app/src/core/import/*.test.ts.
// Run from anywhere: `node app/test-fixtures/import/make-fixtures.mjs`. The output is committed
// so tests do not depend on this script; rerun it after changing a fixture here.
//
// Everything is written by hand (no office suite involved) so each fixture stays tiny and its
// exact structure is known to the tests. All names and content are fictional.

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = require('fflate');

const here = dirname(fileURLToPath(import.meta.url));
const out = (name, data) => writeFileSync(join(here, name), data);
const latin1 = (s) => Buffer.from(s, 'latin1');
// A fixed timestamp keeps the zip bytes identical between runs.
const MTIME = new Date('2024-01-01T00:00:00Z');
const zip = (files) => {
  const entries = {};
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? strToU8(content) : content;
    // The OpenDocument mimetype must be stored uncompressed (and first).
    entries[name] = [data, { level: name === 'mimetype' ? 0 : 6, mtime: MTIME }];
  }
  return zipSync(entries);
};
const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------------------------
// Plain text and transcripts

out('plain-utf8.txt', 'Olá! Esta é uma nota de campo.\nSegunda linha com acentos: ação, coração, niño, señal 😀\n');
out('plain-utf8-bom-crlf.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Primeira linha\r\nSegunda linha — ñandú\r\n', 'utf8')]));
const utf16 = (s, le) => {
  const b = Buffer.from(s, 'utf16le');
  if (!le) b.swap16();
  return Buffer.concat([Buffer.from(le ? [0xff, 0xfe] : [0xfe, 0xff]), b]);
};
out('plain-utf16le.txt', utf16('Entrevista sobre habitação\nCanção 🎵\n', true));
out('plain-utf16be.txt', utf16('Entrevista sobre habitação\nCanção 🎵\n', false));
// Windows-1252 proper: curly quotes and en dash live in 0x80–0x9F.
out(
  'plain-cp1252.txt',
  Buffer.from([
    ...latin1('Av\xf3 disse: '), 0x93, ...latin1('n\xe3o h\xe1 p\xe3o'), 0x94, 0x20, 0x96, ...latin1(' Espa\xf1a\r\n'),
  ]),
);
out('empty.txt', '');

out(
  'interview.vtt',
  `WEBVTT
Kind: captions
Language: pt

NOTE Ficheiro fictício para testes.

STYLE
::cue { color: yellow }

1
00:00:01.000 --> 00:00:04.500 align:start
<v Entrevistadora>Bom dia. Pode apresentar-se?</v>

2
00:00:05.000 --> 00:00:08.000
<v Rui Lopes>Claro. Chamo-me Rui</v>

3
00:00:08.000 --> 00:00:10.250
<v Rui Lopes>e trabalho numa escola &amp; numa associação.</v>

00:01:02.500 --> 00:01:05.000
<v.loud Entrevistadora>Obrigada!</v>
`,
);

out(
  'teams.vtt',
  `WEBVTT

a1b2c3d4-0000-4000-8000-000000000001/12-0
00:00:00.520 --> 00:00:03.110
<v Marta Gil>Olá a todos, vamos começar.</v>

a1b2c3d4-0000-4000-8000-000000000001/20-0
00:00:03.900 --> 00:00:06.000
<v Tomás Reis>Perfeito.</v>
`,
);

out(
  'zoom.srt',
  '\u{feff}1\r\n00:00:00,000 --> 00:00:02,000\r\nCarmen Ruiz: Hola, ¿me oye bien?\r\n\r\n2\r\n00:00:02,500 --> 00:00:04,000\r\nCarmen Ruiz: Perfecto.\r\n\r\n3\r\n00:00:04,100 --> 00:00:07,900\r\nJavier Ortega: Sí, la oigo. <i>Empezamos</i> cuando quiera.\r\n\r\n',
);

out(
  'subtitles.srt',
  `1
00:00:01,000 --> 00:00:02,000
Era uma vez

2
00:00:02,100 --> 00:00:03,000
uma aldeia junto ao mar.

3
00:00:09,000 --> 00:00:11,000
{\\an8}Muito tempo depois...
`,
);

out(
  'transcript-brackets.txt',
  `Entrevista 7 — transcrição
[00:00:05] Entrevistador: Como começou o projeto?
[00:00:09] Inês: Começou em 2019, numa reunião de bairro.
Ainda me lembro bem.
[00:01:30] Entrevistador: E hoje?
[00:01:32] INÊS: Hoje somos trinta.
`,
);

// ---------------------------------------------------------------------------------------------
// Markup

out(
  'page.html',
  `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"><title>Não deve aparecer</title>
<style>p { color: red }</style><script>var x = "<p>nem isto</p>";</script></head>
<body>
<h1>Diário de campo</h1>
<p>Primeiro   parágrafo
com quebra de linha no código &amp; uma entidade &eacute; &#233; &#x1F600;.</p>
<p>Linha um<br>Linha dois</p>
<ul><li>Item A</li><li>Item <b>B</b></li></ul>
<table><tr><th>Nome</th><th>Idade</th></tr><tr><td>Ana</td><td>34</td></tr></table>
<!-- comentário <p>escondido</p> -->
<pre>  código
    indentado</pre>
</body></html>
`,
);

out(
  'notes.md',
  `# Notas da observação

Este é um parágrafo com **negrito**, *itálico* e um [link](https://example.org/x).
Continua na linha seguinte.

## Lista

- primeiro ponto
- segundo ponto com \`código\`
1. numerado

> Uma citação.

| Coluna A | Coluna B |
|---|---|
| 1 | 2 |

Fim_do_ficheiro com snake_case.
`,
);

// ---------------------------------------------------------------------------------------------
// RTF

out(
  'hand.rtf',
  latin1(
    String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss\fcharset0 Arial;}{\f1\froman\fcharset238 Times New Roman CE;}}` +
      String.raw`{\colortbl;\red255\green0\blue0;}{\info{\title Segredo}{\author Ninguem}}` +
      String.raw`{\*\generator Escrito a m\'e3o;}` +
      '\n' +
      String.raw`\pard\f0\fs24 A participante disse: \ldblquote n\'e3o sei\rdblquote .\par` +
      '\n' +
      String.raw`Cora\'e7\'e3o \u-10179?\u-8704? e caf\u233\'e9 \{chavetas\} \\ barra\par` +
      '\n' +
      String.raw`Col1\tab Col2\line nova linha\~fim\-x\_y\par` +
      '\n' +
      String.raw`{\f1 Polsk\'b9 \'9ftrod\'b3o}\par` +
      String.raw`{\header Cabe\'e7alho a ignorar}{\footer Rodap\'e9}{\pict\pngblip 89504e47}` +
      String.raw`Fim.}`,
  ),
);

// Shaped after what Word writes: \upr/\ud pairs, list text, a field, a table, a footnote,
// themedata and other \* destinations, \uc1 fallbacks.
out(
  'word.rtf',
  latin1(
    [
      String.raw`{\rtf1\adeflang1025\ansi\ansicpg1252\uc1\adeff31507\deff0\stshfdbch31505\stshfloch31506\stshfhich31506\stshfbi31507\deflang2070\deflangfe2070\themelang2070`,
      String.raw`{\fonttbl{\f0\fbidi \froman\fcharset0\fprq2{\*\panose 02020603050405020304}Times New Roman;}{\f3\fbidi \froman\fcharset2\fprq2{\*\panose 05050102010706020507}Symbol;}{\f37\fbidi \fswiss\fcharset0\fprq2{\*\panose 020f0502020204030204}Calibri;}}`,
      String.raw`{\colortbl;\red0\green0\blue0;\red0\green0\blue255;}`,
      String.raw`{\*\defchp \f31506\fs22\lang2070\langfe1033}{\*\defpap \ql \li0\ri0\sa160\sl259\slmult1}`,
      String.raw`{\stylesheet{\ql \li0\ri0\sa160 \rtlch\fcs1 \af31507 \ltrch\fcs0 \f31506\fs22 \snext0 \sqformat \spriority0 Normal;}{\*\cs10 \additive \ssemihidden Default Paragraph Font;}}`,
      String.raw`{\*\listtable{\list\listtemplateid1{\listlevel\levelnfc23{\leveltext\'01\u-3913 ?;}{\levelnumbers;}\f3\fi-360\li720}{\listname ;}\listid100}}`,
      String.raw`{\*\listoverridetable{\listoverride\listid100\listoverridecount0\ls1}}`,
      String.raw`{\*\rsidtbl \rsid1\rsid2}{\mmathPr\mmathFont34}{\info{\author Autora Fict\'edcia}{\creatim\yr2024\mo1\dy1}}`,
      String.raw`{\*\xmlnstbl {\xmlns1 http://schemas.microsoft.com/office/word/2003/wordml}}\paperw11906\paperh16838`,
      String.raw`{\*\pnseclvl1\pnucrm\pnstart1\pnindent720\pnhang {\pntxta .}}`,
      String.raw`\pard\plain \ltrpar\ql \li0\ri0\sa160 \rtlch\fcs1 \af31507 \ltrch\fcs0 \f31506\fs22\lang2070 {\rtlch\fcs1 \af31507 \ltrch\fcs0 \b\insrsid1 T\'edtulo da entrevista}{\rtlch\fcs1 \af31507 \ltrch\fcs0 \insrsid1 \par }`,
      String.raw`{\rtlch\fcs1 \ltrch\fcs0 \insrsid1 Ela respondeu que a escola }{\upr{\rtlch\fcs1 \ltrch\fcs0 \insrsid1 era 'boa'}{\*\ud{\rtlch\fcs1 \ltrch\fcs0 \insrsid1 era ${'\\'}u8216\'91boa${'\\'}u8217\'92}}}{\rtlch\fcs1 \ltrch\fcs0 \insrsid1 .}`,
      String.raw`{\rtlch\fcs1 \ltrch\fcs0 \cs15\super\insrsid1 \chftn {\footnote \pard\plain \ltrpar\s16\ql {\rtlch\fcs1 \ltrch\fcs0 \cs15\super \chftn }{\rtlch\fcs1 \ltrch\fcs0  Nota de rodap\'e9 fict\'edcia.}}}{\rtlch\fcs1 \ltrch\fcs0 \insrsid1 \par }`,
      String.raw`{\listtext\pard\plain\ltrpar \rtlch\fcs1 \af0 \ltrch\fcs0 \f3\insrsid1 \loch\af3\dbch\af31505\hich\f3 \'b7\tab}\ls1\ilvl0 {\rtlch\fcs1 \ltrch\fcs0 \insrsid1 Primeiro item\par }`,
      String.raw`{\field{\*\fldinst {\rtlch\fcs1 \ltrch\fcs0 \insrsid1  HYPERLINK "https://example.org/" }}{\fldrslt {\rtlch\fcs1 \ltrch\fcs0 \ul\cf2\insrsid1 uma liga\'e7\'e3o}}}\sectd {\rtlch\fcs1 \ltrch\fcs0 \insrsid1 \par }`,
      String.raw`\trowd \irow0\irowband0\ltrrow\ts11\trgaph108 \cellx4508\cellx9016\pard\plain \intbl {\rtlch\fcs1 \ltrch\fcs0 \insrsid1 Nome\cell Idade\cell }\pard\plain \intbl {\rtlch\fcs1 \ltrch\fcs0 \insrsid1 \trowd \cellx4508\cellx9016\row }`,
      String.raw`\trowd \irow1\cellx4508\cellx9016\pard\plain \intbl {\rtlch\fcs1 \ltrch\fcs0 \insrsid1 Rita\cell 41\cell }\pard\plain \intbl {\rtlch\fcs1 \ltrch\fcs0 \insrsid1 \trowd \cellx4508\cellx9016\row }`,
      String.raw`\pard\plain {\rtlch\fcs1 \ltrch\fcs0 {\v texto oculto}\deleted\insrsid1 apagado}{\rtlch\fcs1 \ltrch\fcs0 \insrsid1 Vis\'edvel.\par }`,
      String.raw`{\*\themedata 504b030414000600080000002100e9de0fbfff000000}{\*\colorschememapping 3c3f786d6c}{\*\latentstyles\lsdstimax376{\lsdlockedexcept \lsdqformat1 Normal;}}{\*\datastore 0105000002000000}`,
      String.raw`{\*\bkmkstart _GoBack}{\*\bkmkend _GoBack}{\nonshppict{\pict\wmetafile8 0100}}`,
      String.raw`}`,
    ].join('\r\n'),
  ),
);

// ---------------------------------------------------------------------------------------------
// DOCX (WordprocessingML written by hand; mammoth reads it like Word's own files)

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const docxFiles = (body, { footnotes = null, numbering = false } = {}) => {
  const overrides = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
  ];
  const rels = [`<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>`];
  const files = {};
  if (footnotes) {
    overrides.push('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>');
    rels.push(`<Relationship Id="rIdFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/>`);
    files['word/footnotes.xml'] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="${W}">` +
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
      `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
      footnotes.map((t, i) => `<w:footnote w:id="${i + 1}"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${xmlEsc(t)}</w:t></w:r></w:p></w:footnote>`).join('') +
      `</w:footnotes>`;
  }
  if (numbering) {
    overrides.push('<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>');
    rels.push(`<Relationship Id="rIdNumbering" Type="${R}/numbering" Target="numbering.xml"/>`);
    files['word/numbering.xml'] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}">` +
      `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  }
  return {
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      overrides.join('') +
      `</Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    'word/styles.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>` +
      `</w:styles>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ...files,
  };
};
const p = (runs, { style = null, num = null } = {}) =>
  `<w:p>${style || num ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${num ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${num}"/></w:numPr>` : ''}</w:pPr>` : ''}${runs}</w:p>`;
const run = (t, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
const cell = (t) => `<w:tc><w:p>${run(t)}</w:p></w:tc>`;

out(
  'report.docx',
  zip(
    docxFiles(
      p(run('Relatório de campo'), { style: 'Heading1' }) +
        p(run('Olá, ') + run('mundo', true) + run(' 🌍 — ação & coração.')) +
        p(run('Antes') + '<w:r><w:tab/></w:r>' + run('depois') + '<w:r><w:br/></w:r>' + run('nova linha')) +
        p(run('Ponto um'), { num: 1 }) +
        p(run('Ponto dois'), { num: 1 }) +
        p(run('Passo'), { num: 2 }) +
        `<w:tbl><w:tr>${cell('Nome')}${cell('Idade')}</w:tr><w:tr>${cell('Ana')}${cell('34')}</w:tr></w:tbl>` +
        p(run('Com nota') + '<w:r><w:footnoteReference w:id="1"/></w:r>' + run(' e fim.')) +
        p('') +
        p(run('Último parágrafo.')),
      { footnotes: ['Uma nota de rodapé fictícia.'], numbering: true },
    ),
  ),
);

out(
  'otter.docx',
  zip(
    docxFiles(
      p(run('Entrevista 4 — Otter')) +
        p(run('Speaker 1  0:01')) +
        p(run('Olá, obrigado por ter vindo.')) +
        p(run('Ana Sousa  0:07')) +
        p(run('Obrigada eu. É um prazer.')) +
        p(run('Speaker 1  1:15')) +
        p(run('Vamos então começar.')) +
        p(run('Ana Sousa  1:20')) +
        p(run('Sim.')),
    ),
  ),
);

out('empty.docx', zip(docxFiles('')));
out('not-a-zip.docx', 'PK\u0003\u0004 this is not really a zip archive');

// ---------------------------------------------------------------------------------------------
// ODT

const ODT_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/"';
out(
  'notes.odt',
  zip({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'META-INF/manifest.xml':
      '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
      '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
    'content.xml':
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODT_NS} office:version="1.2"><office:body><office:text>` +
      '<text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Illustration"/></text:sequence-decls>' +
      '<text:h text:outline-level="1">Notas de <text:span>observação</text:span></text:h>' +
      '<text:p>Dois<text:s/>espaços e<text:s text:c="3"/>quatro.<text:tab/>Tab.<text:line-break/>Quebra.</text:p>' +
      '<text:p>Nota aqui<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Texto da nota — ñ.</text:p></text:note-body></text:note> e segue.</text:p>' +
      '<text:list><text:list-item><text:p>Item um</text:p></text:list-item><text:list-item><text:p>Item dois</text:p>' +
      '<text:list><text:list-item><text:p>Sub-item</text:p></text:list-item></text:list></text:list-item></text:list>' +
      '<table:table table:name="T1"><table:table-column table:number-columns-repeated="3"/>' +
      '<table:table-header-rows><table:table-row><table:table-cell><text:p>Nome</text:p></table:table-cell><table:table-cell><text:p>Cidade</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1020"/></table:table-row></table:table-header-rows>' +
      '<table:table-row><table:table-cell><text:p>Luís</text:p></table:table-cell><table:table-cell><text:p>Évora</text:p></table:table-cell></table:table-row></table:table>' +
      '<text:p><office:annotation><dc:creator>Revisora</dc:creator><text:p>Comentário a ignorar</text:p></office:annotation>Com comentário 🎉</text:p>' +
      '<text:tracked-changes><text:changed-region text:id="c1"><text:deletion><text:p>Texto apagado</text:p></text:deletion></text:changed-region></text:tracked-changes>' +
      '<text:p/>' +
      '<text:p>Fim &amp; adeus.</text:p>' +
      '</office:text></office:body></office:document-content>',
  }),
);

// ---------------------------------------------------------------------------------------------
// XLSX

const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const sheetXml = (rows) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${SS}"><sheetData>${rows}</sheetData></worksheet>`;
out(
  'survey.xlsx',
  zip({
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${SS}" xmlns:r="${R}"><workbookPr/><sheets>` +
      `<sheet name="Respostas" sheetId="1" r:id="rId1"/><sheet name="Códigos" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${R}/worksheet" Target="/xl/worksheets/sheet2.xml"/>` +
      `<Relationship Id="rId3" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rId4" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
    'xl/sharedStrings.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${SS}" count="9" uniqueCount="9">` +
      ['ID', 'Idade', 'Data', 'O que mais valoriza?', 'P01', 'A proximidade da família.', 'P02'].map((s) => `<si><t>${xmlEsc(s)}</t></si>`).join('') +
      `<si><r><t xml:space="preserve">Ter </t></r><r><rPr><b/></rPr><t>tempo</t></r><rPh sb="0" eb="1"><t>ignorar</t></rPh></si>` +
      `<si><t xml:space="preserve">Linha 1&#10;Linha 2 — ação 😀</t></si></sst>`,
    'xl/styles.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${SS}"><numFmts count="2">` +
      `<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="0.00&quot;h&quot;"/></numFmts>` +
      `<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="22" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': sheetXml(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="inlineStr"><is><t>Ativo</t></is></c><c r="F1" t="inlineStr"><is><t>Horas</t></is></c><c r="G1" t="inlineStr"><is><t>Registo</t></is></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>34</v></c><c r="C2" s="1"><v>45306</v></c><c r="D2" t="s"><v>5</v></c><c r="E2" t="b"><v>1</v></c><c r="F2" s="3"><v>1.5</v></c><c r="G2" s="4"><v>45306.75</v></c></row>` +
        `<row r="4"><c r="A4" t="s"><v>6</v></c><c r="B4"><v>0.30000000000000004</v></c><c r="C4" s="2"><v>60</v></c><c r="D4" t="s"><v>7</v></c><c r="E4" t="b"><v>0</v></c><c r="F4" t="e"><v>#N/A</v></c><c r="G4" t="str"><f>A4&amp;"x"</f><v>P02x</v></c></row>` +
        `<row r="5"><c r="A5" t="inlineStr"><is><t>P03</t></is></c><c r="D5" t="s"><v>8</v></c></row>`,
    ),
    'xl/worksheets/sheet2.xml': sheetXml(
      `<row r="1"><c r="B1" t="inlineStr"><is><t>Código</t></is></c><c r="C1" t="inlineStr"><is><t>Definição</t></is></c></row>` +
        `<row r="2"><c r="B2" t="inlineStr"><is><t>Família</t></is></c><c r="C2" t="inlineStr"><is><t>Laços familiares</t></is></c></row>`,
    ),
  }),
);

// ---------------------------------------------------------------------------------------------
// CSV

out('survey-semicolon.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ID;Idade;Comentário\r\nP01;34;"Gosto muito; mesmo, muito"\r\nP02;41,5;"Duas\r\nlinhas"\r\n', 'utf8')]));
out('survey-comma.csv', 'id,age,answer\nR1,30,"Hello, ""world"""\nR2,,\n');
out('survey-excel-sep.csv', latin1('sep=;\r\nNome;Opini\xe3o\r\nAna;\x93Boa\x94\r\n'));

// ---------------------------------------------------------------------------------------------
// PDF (hand-written: standard Helvetica, WinAnsi encoding)

const pdfFromObjects = (objects, { trailerExtra = '' } = {}) => {
  // objects: array of strings/Buffers, object n = index + 1.
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let len = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(len);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b);
    len += b.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
};
const stream = (content, dict = '') => {
  const b = Buffer.isBuffer(content) ? content : Buffer.from(content, 'latin1');
  return Buffer.concat([Buffer.from(`<< /Length ${b.length} ${dict}>>\nstream\n`, 'latin1'), b, Buffer.from('\nendstream', 'latin1')]);
};
const pdfStr = (s) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[\x80-\xff]/g, (c) => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')) + ')';
const textAt = (x, y, size, s) => `BT /F1 ${size} Tf ${x} ${y} Td ${pdfStr(s)} Tj ET\n`;

{
  // Page 1: a heading, a paragraph with a hyphenated line break, a second paragraph after a gap,
  // and one line built from two separate text items. Page 2 has no text (as a scan would).
  const page1 =
    textAt(72, 760, 18, 'Entrevista com a participante P3') +
    textAt(72, 720, 12, 'A investiga\xe7\xe3o qualitativa exige muita aten-') +
    textAt(72, 706, 12, '\xe7\xe3o aos detalhes do contexto social') +
    textAt(72, 692, 12, 'e cultural de cada comunidade.') +
    textAt(72, 650, 12, 'Segundo par\xe1grafo come\xe7a aqui.') +
    textAt(72, 620, 12, 'Palavra') +
    textAt(140, 620, 12, 'separada');
  const page3 = textAt(72, 760, 12, 'P\xe1gina tr\xeas: \x93aspas\x94 \x96 fim.');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 8 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    stream(page1),
    stream('0 0 1 rg 72 72 451 698 re f\n'),
    stream(page3),
  ];
  out('interview.pdf', pdfFromObjects(objects));
}

{
  // A PDF that only contains a drawing: no text layer at all.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>',
    stream('0.5 g 72 72 300 300 re f\n'),
  ];
  out('scanned.pdf', pdfFromObjects(objects));
}

{
  // Standard security handler, revision 2 (RC4, 40-bit), user password "segredo": opening it
  // without the password must fail with a password error.
  const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
  const pad = (s) => Buffer.concat([Buffer.from(s, 'latin1'), PAD]).subarray(0, 32);
  const md5 = (...b) => createHash('md5').update(Buffer.concat(b)).digest();
  const rc4 = (key, data) => {
    const S = [...Array(256).keys()];
    for (let i = 0, j = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 255;
      [S[i], S[j]] = [S[j], S[i]];
    }
    const outb = Buffer.alloc(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) {
      i = (i + 1) & 255;
      j = (j + S[i]) & 255;
      [S[i], S[j]] = [S[j], S[i]];
      outb[k] = data[k] ^ S[(S[i] + S[j]) & 255];
    }
    return outb;
  };
  const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const O = rc4(md5(pad('dono')).subarray(0, 5), pad('segredo'));
  const P = -44;
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P);
  const key = md5(pad('segredo'), O, pBytes, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objKey = (n) => md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 10);
  const content = rc4(objKey(4), Buffer.from(textAt(72, 760, 12, 'Confidencial'), 'latin1'));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(content),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>`,
  ];
  out('encrypted.pdf', pdfFromObjects(objects, { trailerExtra: `/Encrypt 6 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] ` }));
}

out('damaged.pdf', '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ngarbage garbage\n%%EOF\n');

console.log('fixtures written to', here);
