import { fromWindows1252 } from '../bytes';
import { decodeEntities } from './entities';
import { canonicalize, decodeTextWithInfo, tidy } from './text';

// Tolerant HTML → text without a DOM (core code runs in Node too). It is not a full HTML5
// parser: it reads the tag soup that word processors, browsers' "Save page as" and mammoth
// produce, keeping what a researcher would read: paragraphs, headings, list items (with a
// marker), table rows (cells separated by tabs), and footnotes as mammoth writes them.

// Elements whose start and end both end the current paragraph.
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr',
  'html', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'ul', 'caption', 'tr', 'table',
  'tbody', 'thead', 'tfoot', 'listing', 'output',
]);
// Content that is never text, read as raw characters up to the matching end tag.
const RAW_SKIP = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'noscript', 'iframe', 'noembed', 'noframes']);
// Content that is markup but not reading text (nested, so counted).
const NESTED_SKIP = new Set(['svg', 'math', 'template', 'object', 'audio', 'video', 'canvas', 'select', 'map']);

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of s.matchAll(ATTR)) out.set(m[1]!.toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  return out;
}

/** Finds the '>' closing a tag that starts at `from`, skipping quoted attribute values. */
function tagEnd(s: string, from: number): number {
  let quote = '';
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      // A quote only opens a value after "=" (an apostrophe in a broken tag must not swallow the page).
      let k = i - 1;
      while (k > from && /\s/.test(s[k]!)) k--;
      if (s[k] === '=') quote = c;
    } else if (c === '>') return i;
  }
  return -1;
}

interface ListState {
  ordered: boolean;
  n: number;
}

export interface HtmlOptions {
  /**
   * Keep spaces and tabs as written. For mammoth's output, which has no layout whitespace:
   * its spaces and tabs are the Word document's own.
   */
  literal?: boolean;
}

/** Splits HTML into paragraphs of plain text (not yet canonical). */
export function htmlToParagraphs(html: string, opts: HtmlOptions = {}): string[] {
  const space = opts.literal ? /[\n\r\f]/g : /[ \t\n\r\f]+/g;
  const paras: string[] = [];
  let cur = '';
  let prefix = ''; // a list marker waiting for its item's first paragraph
  let pre = 0;
  let skipTag = '';
  let skipDepth = 0;
  let backlinkDepth = 0; // inside mammoth's "↑" links back from a footnote
  const lists: ListState[] = [];
  // Tables: cells collect separately so empty cells keep their tab.
  let tableDepth = 0;
  let row: string[] | null = null;
  let cell: string | null = null;

  const clean = (p: string) => (pre ? p.replace(/^\n+/, '').trimEnd() : opts.literal ? p.trim() : p.replace(/ {2,}/g, ' ').trim());
  const flush = () => {
    if (cell !== null) {
      cell += ' ';
      return;
    }
    const p = clean(cur);
    cur = '';
    if (!p) return;
    paras.push(prefix + p);
    prefix = '';
  };
  const endCell = () => {
    if (cell !== null && row) row.push(cell.replace(/\s+/g, ' ').trim());
    cell = null;
  };
  const endRow = () => {
    endCell();
    if (row && row.some((c) => c)) {
      paras.push(prefix + row.join('\t'));
      prefix = '';
    }
    row = null;
  };
  const addText = (t: string) => {
    if (skipDepth || backlinkDepth) return;
    let s = decodeEntities(t);
    if (!pre) s = s.replace(space, ' ');
    if (cell !== null) cell += s;
    else if (row) {
      // Text between cells (invalid but common): give it a cell of its own.
      if (s.trim()) row.push(s.trim());
    } else cur += s;
  };

  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      addText(html.slice(i));
      break;
    }
    if (lt > i) addText(html.slice(i, lt));
    i = lt;
    const next = html[i + 1] ?? '';
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (next === '!' || next === '?') {
      const end = html.indexOf('>', i + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const closing = next === '/';
    const nameStart = closing ? i + 2 : i + 1;
    const nm = /^[A-Za-z][A-Za-z0-9:-]*/.exec(html.slice(nameStart, nameStart + 40));
    if (!nm) {
      addText('<');
      i++;
      continue;
    }
    const name = nm[0].toLowerCase();
    const end = tagEnd(html, nameStart + nm[0].length);
    if (end < 0) {
      // An unterminated tag at the end of the file: drop it.
      break;
    }
    const attrText = html.slice(nameStart + nm[0].length, end);
    i = end + 1;

    if (skipDepth) {
      if (name === skipTag) skipDepth += closing ? -1 : attrText.trimEnd().endsWith('/') ? 0 : 1;
      continue;
    }
    if (closing) {
      if (name === 'a' && backlinkDepth) backlinkDepth--;
      else if (name === 'td' || name === 'th') {
        if (tableDepth === 1) endCell();
        else if (cell !== null) cell += ' ';
      } else if (name === 'tr') {
        if (tableDepth === 1) endRow();
      } else if (name === 'table') {
        if (tableDepth === 1) endRow();
        tableDepth = Math.max(0, tableDepth - 1);
        if (tableDepth === 0) flush();
      } else if (name === 'ul' || name === 'ol') {
        flush();
        lists.pop();
        prefix = '';
      } else if (name === 'pre' || name === 'listing') {
        flush();
        pre = Math.max(0, pre - 1);
      } else if (BLOCK.has(name)) flush();
      continue;
    }

    if (RAW_SKIP.has(name)) {
      if (attrText.trimEnd().endsWith('/')) continue;
      // A global regex from lastIndex: slicing the rest of the page for every <script> would
      // make a page full of them quadratic.
      const re = new RegExp(`</${name}[\\s>/]`, 'gi');
      re.lastIndex = i;
      const close = re.exec(html);
      if (!close) break;
      i = close.index;
      const gt = html.indexOf('>', i);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    if (NESTED_SKIP.has(name)) {
      if (!attrText.trimEnd().endsWith('/')) {
        skipTag = name;
        skipDepth = 1;
      }
      continue;
    }
    switch (name) {
      case 'br':
        if (pre) addText('\n');
        else flush();
        break;
      case 'a': {
        const href = /href/i.test(attrText) ? (parseAttrs(attrText).get('href') ?? '') : '';
        if (/^#(?:foot|end)note-ref-/.test(href)) backlinkDepth++;
        break;
      }
      case 'table':
        if (tableDepth === 0) flush();
        tableDepth++;
        break;
      case 'tr':
        if (tableDepth <= 1) {
          endRow();
          row = [];
        } else if (cell !== null) cell += ' ';
        break;
      case 'td':
      case 'th':
        if (tableDepth <= 1) {
          if (!row) row = [];
          endCell();
          cell = '';
        } else if (cell !== null) cell += ' ';
        break;
      case 'ul':
      case 'ol':
      case 'dir':
      case 'menu': {
        flush();
        const start = name === 'ol' ? parseInt(parseAttrs(attrText).get('start') ?? '1', 10) : 1;
        lists.push({ ordered: name === 'ol', n: Number.isFinite(start) ? start - 1 : 0 });
        break;
      }
      case 'li': {
        flush();
        const id = /id/i.test(attrText) ? (parseAttrs(attrText).get('id') ?? '') : '';
        const note = /^(?:foot|end)note-(\d+)$/.exec(id);
        const list = lists[lists.length - 1];
        if (note) prefix = `[${note[1]}] `;
        else if (list?.ordered) prefix = `${++list.n}. `;
        else prefix = '\u{2022} ';
        break;
      }
      case 'pre':
      case 'listing':
        flush();
        pre++;
        // The newline right after <pre> is not content.
        if (html[i] === '\n') i++;
        else if (html.startsWith('\r\n', i)) i += 2;
        break;
      default:
        if (BLOCK.has(name)) flush();
    }
  }
  endRow();
  flush();
  return paras;
}

/** HTML → canonical text: one paragraph per line. */
export function htmlToText(html: string): string {
  return tidy(canonicalize(htmlToParagraphs(html).join('\n')));
}

/**
 * Decodes an HTML file: UTF-8 or UTF-16 when the bytes say so, otherwise the charset its
 * <meta> declares (when the engine knows it), otherwise Windows-1252.
 */
export function decodeHtml(bytes: Uint8Array): { text: string; legacy: boolean; invalid?: number } {
  const d = decodeTextWithInfo(bytes);
  if (d.encoding !== 'windows-1252') return { text: d.text, legacy: false, ...(d.invalid ? { invalid: d.invalid } : {}) };
  const head = fromWindows1252(bytes.subarray(0, 4096));
  const label = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1]?.toLowerCase();
  if (label && label !== 'utf-8' && label !== 'utf8') {
    try {
      return { text: new TextDecoder(label).decode(bytes), legacy: false };
    } catch {
      // Unknown to this engine: fall through to Windows-1252.
    }
  }
  return { text: d.text, legacy: true };
}
