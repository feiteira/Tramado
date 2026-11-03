import { fromWindows1252 } from '../bytes';
import { canonicalize, tidy } from './text';
import { WARNING, warning } from './types';

// RTF → text. RTF is 7-bit text with groups {…}, control words (\par, \u233, \'e9) and
// "destinations" (font tables, pictures, headers, metadata…) whose content is not body text.
// Bytes outside ASCII arrive as \'hh in the code page of the current font (\fcharset) or of
// the document (\ansicpg); they are collected and decoded together so double-byte code pages
// work too. \uN gives a UTF-16 unit, followed by \ucN fallback characters to skip.
//
// Word writes footnotes inline ({\footnote …}); they are moved to the end as "[n] text" with
// "[n]" left at the reference, as the other importers do.

/** Destinations whose content is never body text (\* destinations are skipped as well). */
const SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'header', 'headerl', 'headerr', 'headerf',
  'footer', 'footerl', 'footerr', 'footerf', 'fldinst', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'xmlnstbl',
  'filetbl', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'generator', 'pn', 'nonshppict', 'shpinst',
  'sp', 'sn', 'sv', 'xe', 'tc', 'tcn', 'txe', 'bkmkstart', 'bkmkend', 'mmathPr', 'pgdsctbl', 'operator', 'comment',
  'company', 'title', 'subject', 'author', 'keywords', 'doccomm', 'creatim', 'revtim', 'printim', 'buptim', 'atnid',
  'atnauthor', 'annotation', 'atrfstart', 'atrfend', 'atndate', 'protusertbl', 'userprops', 'wgrffmtfilter', 'fchars',
  'lchars', 'background', 'falt', 'panose', 'blipuid', 'passwordhash', 'template', 'docvar', 'ftnsep', 'ftnsepc',
  'aftnsep', 'aftnsepc', 'pnseclvl', 'listpicture', 'shppict', 'do', 'formfield', 'datafield', 'ffname', 'ffdeftext',
]);

// Not a real code page: the Symbol font's charset, whose 0xB7 is the bullet Word puts in \listtext.
const SYMBOL_CP = -2;

/** \fcharset → Windows code page. */
const CHARSET_CP: Record<number, number> = {
  0: 1252, 1: 0, 2: SYMBOL_CP, 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258,
  177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250, 254: 437, 255: 850,
};

/** Code page → TextDecoder label (the Encoding Standard names). 1252 has its own table. */
const CP_LABEL: Record<number, string> = {
  874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 1250: 'windows-1250', 1251: 'windows-1251',
  1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257',
  1258: 'windows-1258', 10000: 'macintosh', 20866: 'koi8-r', 28591: 'iso-8859-1', 28592: 'iso-8859-2', 28595: 'iso-8859-5',
  28597: 'iso-8859-7', 28605: 'iso-8859-15', 866: 'ibm866', 65001: 'utf-8',
};

// Code page 850 (DOS Western Europe, still in some old Portuguese/Spanish RTF) and 437, which
// the Encoding Standard does not cover: bytes 0x80–0xFF.
const CP850 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u{ad}±‗¾¶§÷¸°¨·¹³²■\u{a0}';
const CP437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u{a0}';

const decoders = new Map<number, TextDecoder | null>();

/** Decodes bytes in a code page; null when this engine cannot. */
function decodeCodePage(bytes: Uint8Array, cp: number): string | null {
  if (cp === 1252 || cp === 0) return fromWindows1252(bytes);
  if (cp === SYMBOL_CP) return Array.from(bytes, (b) => (b === 0xb7 ? '\u{2022}' : String.fromCharCode(b))).join('');
  if (cp === 850 || cp === 437) {
    const table = cp === 850 ? CP850 : CP437;
    let s = '';
    for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : table[b - 0x80]!;
    return s;
  }
  let d = decoders.get(cp);
  if (d === undefined) {
    const label = CP_LABEL[cp];
    try {
      d = label ? new TextDecoder(label) : null;
    } catch {
      d = null;
    }
    decoders.set(cp, d);
  }
  return d ? d.decode(bytes) : null;
}

interface GroupState {
  /** Inside a destination that is not body text. */
  skip: boolean;
  /** Fallback characters after \uN. */
  uc: number;
  /** Current font's code page (0: use the document's). */
  cp: number;
  /** Hidden (\v) or deleted (\deleted) text. */
  hidden: boolean;
  /** Collecting a footnote. */
  note: boolean;
  /** In a table paragraph (\intbl): a paragraph break stays inside the cell. */
  inTable: boolean;
  /** Reading the font table: font number being defined, -1 elsewhere. */
  fontDef: number;
  inFontTable: boolean;
}

export interface RtfResult {
  text: string;
  warnings: string[];
}

/** Characters for symbol control words. */
const SYMBOL_WORDS: Record<string, string> = {
  emdash: '\u{2014}', endash: '\u{2013}', bullet: '\u{2022}', lquote: '\u{2018}', rquote: '\u{2019}', ldblquote: '\u{201c}',
  rdblquote: '\u{201d}', enspace: '\u{2002}', emspace: '\u{2003}', qmspace: '\u{2005}', zwj: '\u{200d}', zwnj: '\u{200c}',
  zwbo: '\u{200b}', zwnbo: '\u{2060}',
};

const isLetter = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
const isDigit = (c: number) => c >= 48 && c <= 57;

/**
 * Parses RTF source given as a "binary string" (one char per byte, as decodeRtfBytes makes)
 * into canonical text.
 */
export function rtfToText(src: string): RtfResult {
  const warnings = new Set<string>();
  const body: string[] = [];
  const notes: string[][] = [];
  let ansiCp = 1252;
  let defaultFont = -1;
  const fontCp = new Map<number, number>();

  let state: GroupState = { skip: false, uc: 1, cp: 0, hidden: false, note: false, inTable: false, fontDef: -1, inFontTable: false };
  const stack: GroupState[] = [];
  let pendingBytes: number[] = [];
  let ucSkip = 0; // fallback characters still to skip after \uN
  let atGroupStart = false; // the next control word may name a destination
  let starred = false; // "\*" seen at the start of this group
  let noteCount = 0;

  const out = () => (state.note ? (notes[notes.length - 1] ?? body) : body);
  const visible = () => !state.skip && !state.hidden;
  const emit = (s: string) => {
    if (visible()) out().push(s);
  };
  const currentCp = () => state.cp || ansiCp;
  const flushBytes = () => {
    if (!pendingBytes.length) return;
    const bytes = Uint8Array.from(pendingBytes);
    pendingBytes = [];
    if (!visible()) return;
    const cp = currentCp();
    let s = decodeCodePage(bytes, cp);
    if (s === null) {
      warnings.add(warning(WARNING.rtfCodePage, cp));
      s = fromWindows1252(bytes);
    }
    out().push(s);
  };
  const pushByte = (b: number) => {
    if (ucSkip > 0) {
      ucSkip--;
      return;
    }
    pendingBytes.push(b);
  };

  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 123 /* { */) {
      flushBytes();
      ucSkip = 0;
      stack.push(state);
      state = { ...state };
      atGroupStart = true;
      starred = false;
      i++;
      continue;
    }
    if (c === 125 /* } */) {
      flushBytes();
      ucSkip = 0;
      state = stack.pop() ?? state;
      atGroupStart = false;
      i++;
      continue;
    }
    if (c === 92 /* \ */) {
      const d = src.charCodeAt(i + 1);
      if (Number.isNaN(d)) break;
      if (!isLetter(d)) {
        // Control symbols.
        i += 2;
        const sym = String.fromCharCode(d);
        if (sym === "'") {
          const hex = src.slice(i, i + 2);
          i += 2;
          const b = parseInt(hex, 16);
          if (!Number.isNaN(b) && /^[0-9a-fA-F]{2}$/.test(hex)) {
            if (!state.inFontTable) pushByte(b);
          }
          atGroupStart = false;
          continue;
        }
        if (sym === '*') {
          if (atGroupStart) starred = true;
          continue;
        }
        flushBytes();
        atGroupStart = false;
        if (ucSkip > 0 && sym !== '\n' && sym !== '\r') {
          ucSkip--;
          continue;
        }
        switch (sym) {
          case '\\':
          case '{':
          case '}':
            emit(sym);
            break;
          case '~':
            emit('\u{a0}');
            break;
          case '_':
            emit('-');
            break;
          case '-': // optional hyphen: invisible unless the line breaks there
            break;
          case '\n':
          case '\r': // "\" before a line break is an old spelling of \par
            emit('\n');
            break;
          case '\t':
            emit('\t');
            break;
          default:
            break;
        }
        continue;
      }
      // Control word: letters, optional signed number, optional single space delimiter.
      let j = i + 1;
      while (j < n && isLetter(src.charCodeAt(j))) j++;
      const word = src.slice(i + 1, j);
      let k = j;
      if (src[k] === '-' && isDigit(src.charCodeAt(k + 1))) k++;
      while (k < n && isDigit(src.charCodeAt(k))) k++;
      const hasArg = k > j;
      const arg = hasArg ? parseInt(src.slice(j, k), 10) : NaN;
      i = src[k] === ' ' ? k + 1 : k;

      if (word === 'bin' && hasArg) {
        // Raw binary data follows: skip it, whatever it contains.
        flushBytes();
        i += Math.max(0, arg);
        atGroupStart = false;
        continue;
      }
      if (word !== 'u') flushBytes();

      if (atGroupStart) {
        atGroupStart = false;
        if (word === 'ud') {
          // {\upr{ANSI text}{\*\ud{Unicode text}}}: the Unicode copy is the one to keep.
          // stack: [..., enclosing \upr, \upr]; visible when what encloses \upr is.
          state.skip = stack[stack.length - 2]?.skip ?? false;
          starred = false;
          continue;
        }
        if (word === 'upr') {
          state.skip = true; // its first child (ANSI) stays hidden; \ud re-opens
          continue;
        }
        if (word === 'fonttbl') {
          state.skip = true;
          state.inFontTable = true;
          continue;
        }
        if (word === 'footnote') {
          state.note = true;
          notes.push([]);
          continue;
        }
        if (starred || SKIP.has(word)) {
          state.skip = true;
          starred = false;
          continue;
        }
      }
      starred = false;

      if (state.inFontTable) {
        if (word === 'f' && hasArg) state.fontDef = arg;
        else if (word === 'fcharset' && hasArg && state.fontDef >= 0) {
          const cp = CHARSET_CP[arg];
          if (cp !== undefined && !fontCp.has(state.fontDef)) fontCp.set(state.fontDef, cp);
        } else if (word === 'cpg' && hasArg && state.fontDef >= 0) fontCp.set(state.fontDef, arg);
        continue;
      }

      if (word === 'u' && hasArg) {
        flushBytes();
        const unit = arg < 0 ? arg + 65536 : arg;
        emit(String.fromCharCode(unit));
        ucSkip = state.uc;
        continue;
      }
      // A control word in place of a fallback character counts as one character.
      if (ucSkip > 0) {
        ucSkip--;
        if (word !== 'par' && word !== 'line' && word !== 'tab' && word !== 'cell' && word !== 'row') continue;
      }

      switch (word) {
        case 'par':
          emit(state.inTable ? ' ' : '\n');
          break;
        case 'intbl':
          state.inTable = true;
          break;
        case 'pard':
          state.inTable = false;
          break;
        case 'line':
        case 'sect':
        case 'page':
        case 'column':
          emit('\n');
          break;
        case 'tab':
          emit('\t');
          break;
        case 'cell':
        case 'nestcell':
          emit('\t');
          break;
        case 'row':
        case 'nestrow':
          if (visible()) {
            // Cells end with \cell; the row's last tab is not content.
            const o = out();
            if (o[o.length - 1] === '\t') o.pop();
            o.push('\n');
          }
          break;
        case 'uc':
          if (hasArg) state.uc = Math.max(0, arg);
          break;
        case 'ansicpg':
          if (hasArg) ansiCp = arg;
          break;
        case 'mac':
          ansiCp = 10000;
          break;
        case 'pc':
          ansiCp = 437;
          break;
        case 'pca':
          ansiCp = 850;
          break;
        case 'deff':
          if (hasArg) defaultFont = arg;
          break;
        case 'f':
          if (hasArg) state.cp = fontCp.get(arg) ?? 0;
          break;
        case 'plain':
          state.cp = fontCp.get(defaultFont) ?? 0;
          state.hidden = false;
          break;
        case 'v':
          state.hidden = !hasArg || arg !== 0;
          break;
        case 'deleted':
          state.hidden = !hasArg || arg !== 0;
          break;
        case 'chftn':
          // Inside the note it is the note's own number, which we write as "[n]" at the end.
          if (state.note) break;
          else if (visible()) emit(`[${++noteCount}]`);
          break;
        default: {
          const sym = SYMBOL_WORDS[word];
          if (sym) emit(sym);
        }
      }
      continue;
    }
    // Plain characters. Line breaks in the source are not content.
    if (c === 10 || c === 13) {
      i++;
      continue;
    }
    atGroupStart = false;
    if (c >= 0x80) {
      // Raw 8-bit bytes (not valid RTF, but common): bytes in the current code page.
      if (!state.inFontTable) pushByte(c & 0xff);
      i++;
      continue;
    }
    // A run of ordinary characters at once.
    let j = i;
    while (j < n) {
      const x = src.charCodeAt(j);
      if (x === 92 || x === 123 || x === 125 || x === 10 || x === 13 || x >= 0x80) break;
      j++;
    }
    flushBytes();
    let run = src.slice(i, j);
    i = j;
    if (ucSkip > 0) {
      const drop = Math.min(ucSkip, run.length);
      run = run.slice(drop);
      ucSkip -= drop;
    }
    if (run) emit(run);
  }
  flushBytes();

  // Empty paragraphs are spacing (double Enter): left out, as mammoth does for Word files.
  let text = body.join('').replace(/\n[ \t\u{a0}]*(?=\n)/gu, '').trimEnd();
  const noteTexts = notes.map((p) => p.join('').replace(/\s+/g, ' ').trim());
  if (noteTexts.some((t) => t)) {
    text += '\n' + noteTexts.map((t, idx) => `[${idx + 1}] ${t}`).join('\n');
  }
  return { text: tidy(canonicalize(text).replace(/(?<!\u{a0})\u{a0}+$/gmu, '')), warnings: [...warnings] };
}

/** Reads RTF bytes: each byte becomes one char, so \'hh and raw bytes decode in rtfToText. */
export function decodeRtfBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

export function isRtf(src: string): boolean {
  return /^\s*\{\\rtf/.test(src.replace(/^\u{feff}/u, '').replace(/^\u{ef}\u{bb}\u{bf}/u, ''));
}
