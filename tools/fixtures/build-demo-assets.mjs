// build-demo-assets: renders the binary documents of the browser demo (UX §7.1) from their single source,
// app/src/demo/example/content/*.ts, into app/src/demo/assets/, and prints the SHA-256 of each file. Run by hand
// after changing a content text; the outputs are committed.
//
//   node tools/fixtures/build-demo-assets.mjs            # write app/src/demo/assets/*
//   node tools/fixtures/build-demo-assets.mjs --check    # regenerate into a temp dir, compare SHA-256 with the committed files
//
// PDFs: pdf-lib 1.17.1 (standard fonts, WinAnsi text, fixed dates). PPTX and DOCX: jszip 3.10.1 (fixed dates, DEFLATE).
// The scanned pages of the judgment (image-only, no text layer) and the plant-cell PNG: ImageMagick `convert`
// (seeded noise, metadata stripped). Node ≥ 22.18 reads the .ts content files directly (type stripping).
// Everything is fictional (UX §7).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';

// Zip entries store local DOS times: pin the zone so every machine writes the same bytes.
process.env.TZ = 'UTC';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CONTENT = join(ROOT, 'app', 'src', 'demo', 'example', 'content');
const ASSETS = join(ROOT, 'app', 'src', 'demo', 'assets');
const CHECK = process.argv.includes('--check');
const FIXED = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));

const load = (name) => import(pathToFileURL(join(CONTENT, name)).href);
const { LF_PAGES, LF_HEADER, LF_TITLE, articleHeading } = await load('lf.ts');
const { SLIDES6, RESUMO, ACORDAO, CALENDARIO, ESQUEMAS, mockPaperPages, MOCK_PAPER } = await load('law-docs.ts');
const { PRIMER, SLIDES3, LAB2, CELL_LABELS, APUNTES } = await load('bio-docs.ts');

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ── PDF ──────────────────────────────────────────────────────────────────────────────────────────────
const A4 = [595.28, 841.89];
const MARGIN = 64;

async function newPdf(meta) {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author ?? 'Tramado demo (fictional)');
  doc.setSubject('Fictional document for the Tramado demo');
  doc.setCreator('tools/fixtures/build-demo-assets.mjs');
  doc.setProducer('pdf-lib 1.17.1');
  doc.setCreationDate(FIXED);
  doc.setModificationDate(FIXED);
  doc.setLanguage(meta.lang ?? 'pt-PT');
  const fonts = {
    body: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  return { doc, fonts };
}

const STYLES = {
  header: { font: 'sans', size: 8.5, color: rgb(0.45, 0.45, 0.45), before: 0, after: 18 },
  title: { font: 'bold', size: 22, color: rgb(0.1, 0.1, 0.1), before: 10, after: 14 },
  subtitle: { font: 'sansBold', size: 11, color: rgb(0.3, 0.3, 0.3), before: 40, after: 8 },
  heading: { font: 'bold', size: 13, color: rgb(0.1, 0.1, 0.1), before: 12, after: 6 },
  article: { font: 'bold', size: 11.5, color: rgb(0.1, 0.1, 0.1), before: 10, after: 4 },
  body: { font: 'body', size: 11.5, color: rgb(0.08, 0.08, 0.08), before: 0, after: 6 },
  small: { font: 'body', size: 9.5, color: rgb(0.35, 0.35, 0.35), before: 6, after: 4 },
};

/** Greedy word wrap with the font's real advance widths. */
function wrap(text, font, size, width) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** One text page: the running header (if any), then each block, wrapped. Throws if it does not fit. */
function drawTextPage(pdf, header, blocks, label) {
  const page = pdf.doc.addPage(A4);
  const width = A4[0] - 2 * MARGIN;
  let y = A4[1] - MARGIN + 10;
  const put = (text, styleName) => {
    const st = STYLES[styleName];
    const font = pdf.fonts[st.font];
    y -= st.before;
    for (const l of wrap(text, font, st.size, width)) {
      y -= st.size * 1.3;
      if (y < MARGIN) throw new Error(`${label}: text does not fit on the page`);
      page.drawText(l, { x: MARGIN, y, size: st.size, font, color: st.color });
    }
    y -= st.after;
  };
  if (header) put(header, 'header');
  for (const b of blocks) put(b.text, b.style ?? 'body');
  return page;
}

async function lawPdf() {
  const pdf = await newPdf({ title: LF_TITLE });
  LF_PAGES.forEach((p, i) => {
    const blocks = [];
    for (const b of p.blocks) {
      if ('heading' in b) blocks.push({ text: b.heading, style: 'heading' });
      else if ('article' in b) {
        blocks.push({ text: articleHeading(b.article), style: 'article' });
        for (const para of b.article.paragraphs) blocks.push({ text: para, style: 'body' });
      } else blocks.push({ text: b.text, style: b.style ?? 'body' });
    }
    drawTextPage(pdf, LF_HEADER, blocks, `lf p. ${i + 1}`);
  });
  return pdf.doc.save();
}

async function linesPdf(title, pages, opts = {}) {
  const pdf = await newPdf({ title, lang: opts.lang });
  pages.forEach((p, i) => drawTextPage(pdf, opts.header ?? null, p.lines, `${title} p. ${i + 1}`));
  return pdf.doc.save();
}

// ── ImageMagick ─────────────────────────────────────────────────────────────────────────────────────
function convert(args, out) {
  execFileSync('convert', [...args, out], { stdio: ['ignore', 'ignore', 'pipe'] });
  return readFileSync(out);
}
const SERIF = ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/TTF/DejaVuSerif.ttf'].find((f) => existsSync(f)) ?? 'Times-Roman';
const SERIF_BOLD = ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSerif-Bold.ttf'].find((f) => existsSync(f)) ?? 'Times-Bold';
const SANS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'].find((f) => existsSync(f)) ?? 'Helvetica';
const im = (s) => s.replace(/%/g, '%%');

/** A scanned page: off-white paper, text, a slight tilt, seeded grain, grey JPEG, no metadata. */
function scanPage(page, n, work) {
  const W = 900;
  const H = 1273;
  const args = ['-size', `${W}x${H}`, 'xc:#f4f1e8', '-fill', '#262626'];
  let y = 110;
  for (const l of page.lines) {
    const size = l.style === 'title' ? 27 : l.style === 'heading' ? 22 : l.style === 'small' ? 16 : 19;
    y += l.style === 'heading' ? 22 : 0;
    args.push('-font', l.style === 'title' || l.style === 'heading' ? SERIF_BOLD : SERIF, '-pointsize', String(size), '-annotate', `+70+${y}`, im(l.text));
    y += Math.round(size * 1.75);
  }
  args.push('-background', '#f4f1e8', '-rotate', n % 2 ? '-0.5' : '0.6', '-gravity', 'center', '-extent', `${W}x${H}`,
    '-seed', String(1000 + n), '-attenuate', '0.35', '+noise', 'Gaussian', '-colorspace', 'Gray', '-quality', '50', '-strip');
  return convert(args, join(work, `scan-${n}.jpg`));
}

async function scannedPdf(title, pages, work) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor('Tramado demo (fictional)');
  pdf.setCreator('tools/fixtures/build-demo-assets.mjs');
  pdf.setProducer('pdf-lib 1.17.1');
  pdf.setCreationDate(FIXED);
  pdf.setModificationDate(FIXED);
  for (let i = 0; i < pages.length; i++) {
    const jpg = await pdf.embedJpg(scanPage(pages[i], i + 1, work));
    const page = pdf.addPage(A4);
    page.drawImage(jpg, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  return pdf.save();
}

/** The plant-cell diagram: a labelled drawing (UX §7.3 `cell`). */
function cellPng(work) {
  const lbl = (x, y, text) => ['-annotate', `+${x}+${y}`, im(text)];
  const [wall, membrane, nucleus, chloroplast, vacuole, cytoplasm] = CELL_LABELS;
  const args = [
    '-size', '960x620', 'xc:white',
    '-fill', '#e8f3e4', '-stroke', '#2f6f3e', '-strokewidth', '9', '-draw', 'roundrectangle 210,70 750,550 46,46',
    '-fill', '#f5fbf2', '-stroke', '#5c9a5c', '-strokewidth', '3', '-draw', 'roundrectangle 226,86 734,534 38,38',
    '-fill', '#dbeaf7', '-stroke', '#4f7fa8', '-strokewidth', '3', '-draw', 'roundrectangle 400,180 640,440 30,30',
    '-fill', '#e9d9f2', '-stroke', '#7a4f99', '-strokewidth', '3', '-draw', 'circle 320,230 320,290',
    '-fill', '#9cc95a', '-stroke', '#4d7a1f', '-strokewidth', '2',
    '-draw', 'ellipse 290,420 34,18 0,360', '-draw', 'ellipse 360,470 34,18 0,360', '-draw', 'ellipse 680,130 30,16 0,360', '-draw', 'ellipse 690,480 30,16 0,360',
    '-stroke', '#555555', '-strokewidth', '2', '-fill', 'none',
    '-draw', 'line 210,110 120,90', '-draw', 'line 228,200 120,200', '-draw', 'line 320,230 120,310',
    '-draw', 'line 290,420 120,430', '-draw', 'line 640,320 820,300', '-draw', 'line 690,240 820,190',
    '-stroke', 'none', '-fill', '#1f1f1f', '-font', SANS, '-pointsize', '21',
    ...lbl(16, 86, wall), ...lbl(16, 196, membrane), ...lbl(16, 306, nucleus), ...lbl(16, 426, chloroplast),
    ...lbl(826, 306, vacuole), ...lbl(826, 196, cytoplasm),
    '-pointsize', '15', '-fill', '#666666', ...lbl(16, 600, 'Plant cell (simplified, fictional diagram for the Tramado demo)'),
    '-strip', '-define', 'png:exclude-chunks=date,time', '-define', 'png:compression-level=9',
  ];
  return convert(args, join(work, 'cell.png'));
}

// ── OOXML (jszip) ───────────────────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items) => `${XML}<Relationships xmlns="${NS.rel}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;
const coreXml = (title, lang) => `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Tramado demo (fictional)</dc:creator><dc:language>${lang}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-01T12:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-01T12:00:00Z</dcterms:modified></cp:coreProperties>`;

async function zipOf(files) {
  const zip = new JSZip();
  for (const [name, text] of files) zip.file(name, text, { date: FIXED, createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
}

const THEME = `${XML}<a:theme xmlns:a="${NS.a}" name="Tramado demo"><a:themeElements>`
  + '<a:clrScheme name="Tramado"><a:dk1><a:srgbClr val="1F1F1F"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1D3B36"/></a:dk2><a:lt2><a:srgbClr val="F4F1E8"/></a:lt2>'
  + '<a:accent1><a:srgbClr val="12A594"/></a:accent1><a:accent2><a:srgbClr val="30A46C"/></a:accent2><a:accent3><a:srgbClr val="F5A524"/></a:accent3><a:accent4><a:srgbClr val="3E63DD"/></a:accent4><a:accent5><a:srgbClr val="6E56CF"/></a:accent5><a:accent6><a:srgbClr val="E5484D"/></a:accent6>'
  + '<a:hlink><a:srgbClr val="0090C8"/></a:hlink><a:folHlink><a:srgbClr val="6E56CF"/></a:folHlink></a:clrScheme>'
  + '<a:fontScheme name="Tramado"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + '<a:fmtScheme name="Tramado"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  + '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'
  + '</a:themeElements></a:theme>';

const spTree = (inner) => `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${inner}</p:spTree></p:cSld>`;
const shape = (id, name, ph, xfrm, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>`;
const XF_TITLE = '<a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm>';
const XF_BODY = '<a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm>';

/** A small but complete PresentationML package: theme, master, one layout, one slide per entry (title + bullets). */
async function pptx(deck, lang) {
  const n = deck.slides.length;
  const slideXml = (s) => `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">${spTree(
    shape(2, 'Title 1', 'type="title"', '', `<a:p><a:r><a:rPr lang="${lang}"/><a:t>${esc(s.title)}</a:t></a:r></a:p>`)
    + shape(3, 'Content 2', 'idx="1"', '', s.bullets.map((b) => `<a:p><a:r><a:rPr lang="${lang}"/><a:t>${esc(b)}</a:t></a:r></a:p>`).join('')),
  )}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const master = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">${spTree(
    shape(2, 'Title Placeholder 1', 'type="title"', XF_TITLE, '<a:p><a:endParaRPr lang="en"/></a:p>')
    + shape(3, 'Text Placeholder 2', 'type="body" idx="1"', XF_BODY, '<a:p><a:endParaRPr lang="en"/></a:p>'),
  )}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3600" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="•"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const layout = `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj" preserve="1">${spTree(
    shape(2, 'Title 1', 'type="title"', '', '<a:p><a:endParaRPr lang="en"/></a:p>')
    + shape(3, 'Content Placeholder 2', 'idx="1"', '', '<a:p><a:endParaRPr lang="en"/></a:p>'),
  ).replace('<p:cSld>', '<p:cSld name="Title and Content">')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const slideIds = Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  const presentation = `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr lang="${lang}"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`;
  const types = `${XML}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const files = [
    ['[Content_Types].xml', types],
    ['_rels/.rels', rels([['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', `${REL}/extended-properties`, 'docProps/app.xml']])],
    ['docProps/core.xml', coreXml(deck.title, lang)],
    ['docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Tramado demo</Application><Slides>${n}</Slides></Properties>`],
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', rels([['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'], ...deck.slides.map((_, i) => [`rId${i + 2}`, `${REL}/slide`, `slides/slide${i + 1}.xml`]), [`rId${n + 2}`, `${REL}/theme`, 'theme/theme1.xml']])],
    ['ppt/slideMasters/slideMaster1.xml', master],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'], ['rId2', `${REL}/theme`, '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', layout],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml']])],
    ['ppt/theme/theme1.xml', THEME],
    ...deck.slides.flatMap((s, i) => [
      [`ppt/slides/slide${i + 1}.xml`, slideXml(s)],
      [`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml']])],
    ]),
  ];
  return zipOf(files);
}

/** A WordprocessingML package with Title / Heading 1 styles (mammoth maps them to headings). */
async function docx(docu, lang) {
  const p = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const body = [p(docu.title, 'Title'), ...docu.sections.flatMap((s) => [p(s.heading, 'Heading1'), ...s.paragraphs.map((x) => p(x))])].join('');
  const document = `${XML}<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `${XML}<w:styles xmlns:w="${NS.w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:lang w:val="${lang}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>';
  const types = `${XML}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  return zipOf([
    ['[Content_Types].xml', types],
    ['_rels/.rels', rels([['rId1', `${REL}/officeDocument`, 'word/document.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', `${REL}/extended-properties`, 'docProps/app.xml']])],
    ['docProps/core.xml', coreXml(docu.title, lang)],
    ['docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Tramado demo</Application></Properties>`],
    ['word/document.xml', document],
    ['word/_rels/document.xml.rels', rels([['rId1', `${REL}/styles`, 'styles.xml']])],
    ['word/styles.xml', styles],
  ]);
}

// ── Build ───────────────────────────────────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'tramado-demo-assets-'));
const out = CHECK ? join(work, 'out') : ASSETS;
mkdirSync(out, { recursive: true });
let failed = false;
try {
  const targets = [
    ['lf.pdf', () => lawPdf()],
    ['slides6.pptx', () => pptx(SLIDES6, 'pt-PT')],
    ['resumo.docx', () => docx(RESUMO, 'pt-PT')],
    ['acordao.pdf', () => scannedPdf('Acórdão fictício n.º 12/2026', ACORDAO, work)],
    ['calendario.pdf', () => linesPdf('Calendário de avaliações', [CALENDARIO])],
    ['esquemas.pdf', () => linesPdf('Os meus esquemas', ESQUEMAS)],
    ['mock.pdf', () => linesPdf(MOCK_PAPER.title, mockPaperPages())],
    ['primer.pdf', () => linesPdf('Cell Biology Primer (fictional)', PRIMER, { lang: 'en' })],
    ['slides3.pptx', () => pptx(SLIDES3, 'en')],
    ['lab2.docx', () => docx(LAB2, 'en')],
    ['cell.png', () => cellPng(work)],
    ['apuntes.pdf', () => linesPdf('Apuntes — Tema 2', APUNTES, { lang: 'es-ES' })],
  ];
  for (const [name, make] of targets) {
    const bytes = Buffer.from(await make());
    writeFileSync(join(out, name), bytes);
    const hash = sha256(bytes);
    if (CHECK) {
      const committed = join(ASSETS, name);
      const want = existsSync(committed) ? sha256(readFileSync(committed)) : '(missing)';
      const ok = want === hash;
      if (!ok) failed = true;
      console.log(`${ok ? 'ok  ' : 'DIFF'} ${hash}  ${name}${ok ? '' : `  (committed ${want})`}`);
    } else console.log(`${hash}  ${name}  (${bytes.length} bytes)`);
  }
  if (CHECK) {
    const extra = readdirSync(ASSETS).filter((f) => !targets.some(([n]) => n === f));
    if (extra.length) {
      failed = true;
      console.log(`DIFF unexpected committed files: ${extra.join(', ')}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (CHECK) console.log(failed ? 'build-demo-assets --check: the committed assets differ (run without --check and commit)' : 'build-demo-assets --check: all assets match');
process.exit(failed ? 1 : 0);
