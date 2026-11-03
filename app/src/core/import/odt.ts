import type { Element, Node } from '@xmldom/xmldom';
import { canonicalize, tidy } from './text';
import { ImportError, WARNING, warning } from './types';
import { CDATA_SECTION_NODE, TEXT_NODE, isElement, parseXml, readZip, zipText } from './xml';

// OpenDocument text (LibreOffice, Google Docs export) → text. content.xml holds the body:
// paragraphs and headings with spans, links, spaces (<text:s text:c="n"/>), tabs, line
// breaks, lists, tables and notes. Comments (office:annotation) and the deleted text kept
// for tracked changes are not part of what the document says, so they are left out.

const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';

/** Elements whose content is never body text. */
const SKIP_TEXT = new Set(['tracked-changes', 'sequence-decls', 'variable-decls', 'user-field-decls', 'table-of-content', 'alphabetical-index', 'bibliography', 'illustration-index']);

// <text:s/> stands for spaces the author typed; a private-use stand-in keeps them apart from
// layout whitespace until the paragraph is trimmed.
const SPACE = '\u{e000}';
const SPACE_RE = /\u{e000}/gu;

export interface OdtResult {
  text: string;
  warnings: string[];
}

export function odtToText(bytes: Uint8Array): OdtResult {
  const files = readZip(bytes, (n) => n === 'content.xml');
  const xml = zipText(files, 'content.xml');
  if (xml === null) throw new ImportError('DAMAGED', 'odt', 'content.xml missing');
  const doc = parseXml(xml, 'odt');

  const paras: string[] = [];
  const notes: { label: string; text: string }[] = [];
  let images = 0;
  let comments = 0;

  /** Inline content of a paragraph or heading. Line breaks become "\n" (paragraph breaks). */
  const inline = (n: Node): string => {
    let s = '';
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === TEXT_NODE || c.nodeType === CDATA_SECTION_NODE) {
        // Inside text:p, XML whitespace runs collapse to one space (ODF 6.1.2).
        s += (c.nodeValue ?? '').replace(/[ \t\n\r]+/g, ' ');
        continue;
      }
      if (!isElement(c)) continue;
      const ns = c.namespaceURI;
      const name = c.localName;
      if (ns === TEXT) {
        if (name === 's') {
          const count = parseInt(c.getAttributeNS(TEXT, 'c') ?? '1', 10);
          s += SPACE.repeat(Math.min(Number.isFinite(count) && count > 0 ? count : 1, 1000));
        } else if (name === 'tab') s += '\t';
        else if (name === 'line-break') s += '\n';
        else if (name === 'note') {
          const citation = c.getElementsByTagNameNS(TEXT, 'note-citation').item(0);
          const body = c.getElementsByTagNameNS(TEXT, 'note-body').item(0);
          const label = (citation ? inline(citation).trim() : '') || String(notes.length + 1);
          notes.push({ label, text: body ? blockText(body) : '' });
          s += `[${label}]`;
        } else if (name === 'tracked-changes' || name === 'bookmark' || name === 'bookmark-start' || name === 'bookmark-end' || name === 'soft-page-break') {
          // Markers without text.
        } else if (name === 'ruby') {
          const base = c.getElementsByTagNameNS(TEXT, 'ruby-base').item(0);
          if (base) s += inline(base);
        } else s += inline(c); // span, a, meta, sequence, date, page-number…
      } else if (ns === OFFICE && name === 'annotation') comments++;
      else if (ns === OFFICE && name === 'annotation-end') {
        // End marker of a ranged comment.
      } else if (ns === DRAW && name === 'frame') {
        // A frame holds an image or a text box; a text box's paragraphs are read in place.
        const box = c.getElementsByTagNameNS(DRAW, 'text-box').item(0);
        if (box) s += ' ' + blockText(box) + ' ';
        else images++;
      } else s += inline(c);
    }
    return s;
  };

  const blockText = (n: Node): string => {
    const saved = paras.length;
    blocks(n);
    return paras.splice(saved).join(' ').replace(/\s+/g, ' ').trim();
  };

  const pushPara = (s: string) => {
    // Whitespace from the XML layout is trimmed; spaces the author typed (<text:s/>) stay.
    // Empty paragraphs are spacing, as Word users' double Enter: left out, as mammoth does.
    for (const line of s.split('\n')) {
      // Layout whitespace collapses across the whole paragraph (ODF 6.1.2), typed spaces do not.
      const t = line.replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '').replace(SPACE_RE, ' ');
      if (t.trim()) paras.push(t);
    }
  };

  const table = (t: Element) => {
    const rows: string[][] = [];
    const walkRows = (n: Node) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (!isElement(c) || c.namespaceURI !== TABLE) continue;
        if (c.localName === 'table-row') {
          const cells: string[] = [];
          for (let d = c.firstChild; d; d = d.nextSibling) {
            if (!isElement(d) || d.namespaceURI !== TABLE) continue;
            if (d.localName !== 'table-cell' && d.localName !== 'covered-table-cell') continue;
            const value = d.localName === 'table-cell' ? blockText(d) : '';
            // Spreadsheet-style files repeat empty cells thousands of times: cap the repeat.
            const repeat = Math.min(parseInt(d.getAttributeNS(TABLE, 'number-columns-repeated') ?? '1', 10) || 1, value ? 100 : 1000);
            for (let k = 0; k < repeat; k++) cells.push(value);
          }
          while (cells.length && !cells[cells.length - 1]) cells.pop();
          const repeatRows = Math.min(parseInt(c.getAttributeNS(TABLE, 'number-rows-repeated') ?? '1', 10) || 1, 100);
          if (cells.length) for (let k = 0; k < repeatRows; k++) rows.push(cells);
        } else if (['table-header-rows', 'table-rows', 'table-row-group'].includes(c.localName ?? '')) walkRows(c);
      }
    };
    walkRows(t);
    for (const r of rows) paras.push(r.join('\t'));
  };

  const blocks = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (!isElement(c)) continue;
      const ns = c.namespaceURI;
      const name = c.localName ?? '';
      if (ns === TEXT && (name === 'p' || name === 'h')) pushPara(inline(c));
      else if (ns === TEXT && SKIP_TEXT.has(name)) continue;
      else if (ns === TABLE && name === 'table') table(c);
      else if (ns === OFFICE && name === 'annotation') comments++;
      else if (ns === OFFICE && name === 'forms') continue;
      else if (ns === DRAW && name === 'frame') {
        const box = c.getElementsByTagNameNS(DRAW, 'text-box').item(0);
        if (box) blocks(box);
        else images++;
      } else blocks(c); // list, list-item, section, list-header, office:text…
    }
  };

  const body = doc.getElementsByTagNameNS(OFFICE, 'text').item(0) ?? doc.documentElement;
  if (body) blocks(body);

  let text = paras.join('\n');
  if (notes.length) text += '\n' + notes.map((n) => `[${n.label}] ${n.text}`).join('\n');
  const warnings: string[] = [];
  if (images) warnings.push(warning(WARNING.imagesSkipped, images));
  if (comments) warnings.push(warning(WARNING.commentsSkipped, comments));
  return { text: tidy(canonicalize(text)), warnings };
}
