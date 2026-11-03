import { fromWindows1252 } from '../bytes';
import { LIMITS } from '../model/legacy';

// Bytes → canonical text. Every importer funnels its output through canonicalize() so that
// offsets mean the same thing everywhere (see core/model/types.ts).

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
  /** UTF-8 with this many invalid byte sequences, each read as U+FFFD (absent when none). */
  invalid?: number;
}

/**
 * Lenient UTF-8: invalid sequences become U+FFFD. `invalid` counts them, `valid` the non-ASCII
 * characters decoded correctly (a U+FFFD written in the file as EF BF BD is one of these).
 */
export function decodeUtf8Lenient(body: Uint8Array): { text: string; invalid: number; valid: number } {
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(body);
  let valid = 0;
  let invalid = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd) invalid++;
    else if (c > 0x7f && (c < 0xdc00 || c > 0xdfff)) valid++;
  }
  for (let i = 0; i + 2 < body.length; i++) {
    if (body[i] === 0xef && body[i + 1] === 0xbf && body[i + 2] === 0xbd) {
      invalid--;
      valid++;
    }
  }
  return { text, invalid, valid };
}

/**
 * UTF-16 files saved without a byte-order mark are rare but real (some transcription tools).
 * Text in a Latin script then has a zero byte in every other position; real UTF-8 or 1252
 * text has none.
 */
export function sniffUtf16(b: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(b.length, 4096) & ~1;
  if (n < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) evenZeros++;
    if (b[i + 1] === 0) oddZeros++;
  }
  const pairs = n / 2;
  if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.05) return 'utf-16le';
  if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.05) return 'utf-16be';
  return null;
}

function decodeUtf16(b: Uint8Array, littleEndian: boolean): string {
  try {
    return new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be').decode(b);
  } catch {
    // Some engines only know utf-16le: swap the bytes ourselves.
    const swapped = new Uint8Array(b.length & ~1);
    for (let i = 0; i + 1 < b.length; i += 2) {
      swapped[i] = littleEndian ? b[i]! : b[i + 1]!;
      swapped[i + 1] = littleEndian ? b[i + 1]! : b[i]!;
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
}

/**
 * Decodes a text file of unknown encoding: UTF-16 with a byte-order mark (or recognisably
 * UTF-16 without one), UTF-8 with or without a BOM (a few invalid bytes become U+FFFD and are
 * counted in `invalid`), and Windows-1252 when the bytes are mostly not UTF-8 (files saved by
 * older Notepad or Excel in Portugal and Spain). Never throws.
 */
export function decodeTextWithInfo(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decodeUtf16(bytes.subarray(2), true), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decodeUtf16(bytes.subarray(2), false), encoding: 'utf-16be' };
  const utf16 = sniffUtf16(bytes);
  if (utf16) return { text: decodeUtf16(bytes, utf16 === 'utf-16le'), encoding: utf16 };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // Not valid UTF-8. A file that is mostly UTF-8 with a stray byte or two (a damaged copy, a
    // paste from elsewhere) keeps its UTF-8 reading with U+FFFD for the bad bytes: decoding all
    // of it as Windows-1252 would turn every accented letter into mojibake. Only a file whose
    // invalid sequences outnumber its valid non-ASCII characters is read as Windows-1252.
  }
  const lenient = decodeUtf8Lenient(bytes);
  if (lenient.invalid > lenient.valid) return { text: fromWindows1252(bytes), encoding: 'windows-1252' };
  const bom = lenient.text.charCodeAt(0) === 0xfeff ? 1 : 0;
  return { text: lenient.text.slice(bom), encoding: 'utf-8', invalid: lenient.invalid };
}

export function decodeText(bytes: Uint8Array): string {
  return decodeTextWithInfo(bytes).text;
}

// Line and paragraph separators of every flavour become \n: CRLF, CR, NEL, LS, PS, and the
// vertical tab and form feed that Word and old text files use for line and page breaks.
const NEWLINES = /\r\n?|[\u{000b}\u{000c}\u{0085}\u{2028}\u{2029}]/gu;
// C0 controls except \t \n (\r is gone by then), DEL, C1 controls, BOMs/ZWNBSP, non-characters.
const CONTROLS = /[\u{0000}-\u{0008}\u{000e}-\u{001f}\u{007f}-\u{009f}\u{feff}\u{fffe}\u{ffff}]/gu;
// Unpaired surrogates would turn into U+FFFD on the way to UTF-8 (SQLite, exports) and shift
// every later offset; replace them now so the text means the same everywhere. With the u flag
// a surrogate range matches only unpaired surrogates (pairs are read as one code point).
const LONE_SURROGATE = /[\u{d800}-\u{dfff}]/gu;

/** The canonical form of document text: LF line endings, no BOM, NFC, no control characters but \t and \n. */
export function canonicalize(text: string): string {
  return text.replace(NEWLINES, '\n').replace(CONTROLS, '').replace(LONE_SURROGATE, '\u{fffd}').normalize('NFC');
}

// The lookbehinds make each match start only where a run of spaces (or newlines) begins. Without
// them an end-anchored run that is not at the end is rescanned from every position inside it,
// and a long run of spaces in the middle of a line hangs the importer for minutes.
const TRAILING_SPACE = /(?<![ \t\u{a0}])[ \t\u{a0}]+$/gmu;
const TRAILING_BLANKS = /(?<![ \t])[ \t]+$/gm;
const EDGE_NEWLINES = /^\n+|(?<!\n)\n+$/g;

/**
 * Tidies canonical text produced from a structured format: no trailing spaces on lines, at
 * most one blank line in a row, no blank lines at the start or end.
 */
export function tidy(text: string): string {
  return text
    .replace(TRAILING_SPACE, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(EDGE_NEWLINES, '');
}

/** Tidies a plain-text file lightly: trailing spaces and the blank lines at both ends only. */
export function tidyPlain(text: string): string {
  return text.replace(TRAILING_BLANKS, '').replace(EDGE_NEWLINES, '');
}

/** "folder/Entrevista 3.final.docx" → "Entrevista 3.final" (both / and \ separators). */
export function baseName(filename: string): string {
  const name = filename.split(/[\\/]/).pop() ?? filename;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return docName(base) || docName(name);
}

/** Lower-case extension without the dot ("" when there is none). */
export function extensionOf(filename: string): string {
  const name = filename.split(/[\\/]/).pop() ?? filename;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** A document name: one line, at most LIMITS.nameMax characters (cut at a word when possible). */
export function docName(s: string): string {
  const one = canonicalize(s).replace(/\s+/g, ' ').trim();
  if (one.length <= LIMITS.nameMax) return one;
  const cut = one.slice(0, LIMITS.nameMax - 1);
  const space = cut.lastIndexOf(' ');
  // Never split a surrogate pair at the cut.
  const base = (space > LIMITS.nameMax * 0.6 ? cut.slice(0, space) : cut).replace(/[\u{d800}-\u{dbff}]$/u, '');
  return `${base.trimEnd()}\u{2026}`;
}
