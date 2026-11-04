// PowerPoint (.pptx) → text with slide starts (like PdfText.pageStarts), on the bounded zip and XML
// helpers of xml.ts (research trama-ts §3, lab pptx.ts). The slide order is the presentation's
// (`ppt/presentation.xml` <p:sldIdLst> resolved through `ppt/_rels/presentation.xml.rels`), not the
// file numbering, which only serves as a fallback. Speaker notes (the "body" placeholder of each
// slide's notes slide) follow the slide's own text inside the slide's section, so a passage found
// in the notes still cites "slide N". Slide numbers, dates and footers are left out.
import type { Element, Node } from '@xmldom/xmldom';
import { canonicalize } from './text';
import { ImportError } from './types';
import { childElements, descendants, firstChild, isElement, parseXml, readZip, zipText } from './xml';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NOTES_REL = /\/notesSlide$/;
/** Placeholders whose text is chrome, not content. */
const CHROME = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);

export interface SlidesText {
  /** Slides joined by a blank line; inside a slide, one paragraph per line, then its notes. */
  text: string;
  /** Offset in `text` where each slide starts (slide n = index + 1). */
  slideStarts: number[];
  slides: number;
  /** Where each slide's speaker notes are in `text` (only slides that have notes). */
  notes: Array<{ slide: number; start: number; end: number }>;
  warnings: string[];
}

/** `base` is the directory of the part that holds the relationship ("ppt", "ppt/slides"). */
function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base ? base.split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function relationships(files: Record<string, Uint8Array>, relsPath: string, base: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>();
  const xml = zipText(files, relsPath);
  if (!xml) return out;
  const doc = parseXml(xml, 'pptx');
  for (const r of descendants(doc, PKG_REL, 'Relationship')) {
    const id = r.getAttribute('Id');
    const target = r.getAttribute('Target');
    if (!id || !target || r.getAttribute('TargetMode') === 'External') continue;
    out.set(id, { type: r.getAttribute('Type') ?? '', target: resolveTarget(base, target) });
  }
  return out;
}

const slideNumber = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? Number.MAX_SAFE_INTEGER);

/** The slide part names in presentation order; file numbering when the presentation does not say. */
function slideOrder(files: Record<string, Uint8Array>): string[] {
  const present = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const byNumber = [...present].sort((a, b) => slideNumber(a) - slideNumber(b));
  const xml = zipText(files, 'ppt/presentation.xml');
  if (!xml) return byNumber;
  const rels = relationships(files, 'ppt/_rels/presentation.xml.rels', 'ppt');
  const doc = parseXml(xml, 'pptx');
  const list = descendants(doc, P, 'sldIdLst')[0];
  if (!list) return byNumber;
  const ordered: string[] = [];
  for (const id of childElements(list, P, 'sldId')) {
    const rid = id.getAttributeNS(R, 'id') ?? id.getAttribute('r:id');
    const target = rid ? rels.get(rid)?.target : undefined;
    if (target && files[target] && !ordered.includes(target)) ordered.push(target);
  }
  if (!ordered.length) return byNumber;
  // Slides the list forgot (a damaged deck) keep their file order after the listed ones.
  return [...ordered, ...byNumber.filter((n) => !ordered.includes(n))];
}

function placeholderType(sp: Element): string | null {
  const nv = firstChild(sp, P, 'nvSpPr');
  const nvPr = nv ? firstChild(nv, P, 'nvPr') : null;
  const ph = nvPr ? firstChild(nvPr, P, 'ph') : null;
  if (!ph) return null;
  return ph.getAttribute('type') ?? 'body';   // an untyped placeholder is a body placeholder
}

/** Paragraph texts of a slide or notes part, in document order, `keep` choosing the shapes. */
function paragraphs(xml: string, keep: (sp: Element) => boolean): string[] {
  const doc = parseXml(xml, 'pptx');
  const out: string[] = [];
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (!isElement(c)) continue;
      if (c.namespaceURI === P && c.localName === 'sp') {
        if (!keep(c)) continue;
        for (const p of descendants(c, A, 'p')) {
          let line = '';
          for (let r = p.firstChild; r; r = r.nextSibling) {
            if (!isElement(r) || r.namespaceURI !== A) continue;
            if (r.localName === 'r' || r.localName === 'fld') line += descendants(r, A, 't').map((t) => t.textContent ?? '').join('');
            else if (r.localName === 'br') line += '\n';
          }
          for (const part of canonicalize(line).split('\n')) {
            const t = part.replace(/[ \t]+/g, ' ').trim();
            if (t) out.push(t);
          }
        }
        continue;
      }
      walk(c);   // group shapes, graphic frames (tables keep their a:p paragraphs)
    }
  };
  // Tables live in graphicFrame/a:tbl, outside p:sp: read their paragraphs too.
  walk(doc);
  for (const tbl of descendants(doc, A, 'tbl')) {
    for (const tc of descendants(tbl, A, 'tc')) {
      const t = descendants(tc, A, 't').map((x) => x.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
      if (t) out.push(canonicalize(t));
    }
  }
  return out;
}

/** Reads a .pptx. Throws ImportError DAMAGED (not a deck) or TOO_LARGE (zip limits). */
export function pptxToText(bytes: Uint8Array): SlidesText {
  const files = readZip(bytes, (n) => n === 'ppt/presentation.xml' || n === 'ppt/_rels/presentation.xml.rels'
    || /^ppt\/slides\/slide\d+\.xml$/.test(n) || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n)
    || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  const order = slideOrder(files);
  if (!order.length && !files['ppt/presentation.xml']) throw new ImportError('DAMAGED', 'pptx', 'no slides');
  const slideStarts: number[] = [];
  const notes: SlidesText['notes'] = [];
  let text = '';
  order.forEach((name, i) => {
    const own = paragraphs(zipText(files, name) ?? '', (sp) => !CHROME.has(placeholderType(sp) ?? ''));
    const file = name.slice(name.lastIndexOf('/') + 1);
    const rels = relationships(files, `ppt/slides/_rels/${file}.rels`, 'ppt/slides');
    const notesPart = [...rels.values()].find((r) => NOTES_REL.test(r.type))?.target;
    const notesXml = notesPart ? zipText(files, notesPart) : null;
    const said = notesXml ? paragraphs(notesXml, (sp) => placeholderType(sp) === 'body') : [];
    if (text) text += '\n\n';
    slideStarts.push(text.length);
    text += own.join('\n');
    if (said.length) {
      if (own.length) text += '\n';
      const start = text.length;
      text += said.join('\n');
      notes.push({ slide: i + 1, start, end: text.length });
    }
  });
  // Paragraphs are trimmed and never empty, so the text needs no tidy() (which would move offsets).
  return { text, slideStarts, slides: order.length, notes, warnings: [] };
}
