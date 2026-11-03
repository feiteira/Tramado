import { strFromU8, unzipSync } from 'fflate';
import { extensionOf, sniffUtf16 } from './text';
import type { ImportFormat } from './types';

// Which importer reads a file. The extension is a hint; the bytes decide whenever they are
// unambiguous, because researchers receive files renamed by mail clients, transcription
// services and colleagues ("entrevista.doc" that is really RTF, ".txt" that is WebVTT).

export type FormatGroup = 'document' | 'transcript' | 'table';

export interface SupportedFormat {
  format: ImportFormat;
  extensions: string[];
  mime: string;
  group: FormatGroup;
}

export const SUPPORTED: readonly SupportedFormat[] = [
  { format: 'docx', extensions: ['docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', group: 'document' },
  { format: 'odt', extensions: ['odt'], mime: 'application/vnd.oasis.opendocument.text', group: 'document' },
  { format: 'pdf', extensions: ['pdf'], mime: 'application/pdf', group: 'document' },
  { format: 'rtf', extensions: ['rtf'], mime: 'application/rtf', group: 'document' },
  { format: 'txt', extensions: ['txt', 'text'], mime: 'text/plain', group: 'document' },
  { format: 'md', extensions: ['md', 'markdown'], mime: 'text/markdown', group: 'document' },
  { format: 'html', extensions: ['html', 'htm', 'xhtml'], mime: 'text/html', group: 'document' },
  { format: 'vtt', extensions: ['vtt'], mime: 'text/vtt', group: 'transcript' },
  { format: 'srt', extensions: ['srt'], mime: 'application/x-subrip', group: 'transcript' },
];

/** Extensions for a file dialog filter (all supported files, or one group). */
export function supportedExtensions(group?: FormatGroup): string[] {
  return SUPPORTED.filter((s) => !group || s.group === group).flatMap((s) => s.extensions);
}

export function mimeOf(format: ImportFormat): string {
  return SUPPORTED.find((s) => s.format === format)?.mime ?? 'application/octet-stream';
}

const BY_EXTENSION = new Map<string, ImportFormat>(SUPPORTED.flatMap((s) => s.extensions.map((e) => [e, s.format] as const)));

/** Formats whose files are binary containers: a damaged one must not be read as text. */
const BINARY: ReadonlySet<ImportFormat> = new Set(['docx', 'odt', 'pdf']);

export interface Sniffed {
  format: ImportFormat | null;
  /** For unsupported files, what they seem to be (see ImportError.detail). */
  hint: string | null;
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

function sniffZip(bytes: Uint8Array, ext: string): Sniffed {
  const names: string[] = [];
  let mimetype = '';
  try {
    // List the entries without inflating anything but the tiny OpenDocument mimetype.
    const files = unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return f.name === 'mimetype' && f.originalSize < 200;
      },
    });
    if (files.mimetype) mimetype = strFromU8(files.mimetype).trim();
  } catch {
    // A damaged archive: trust the extension so the right importer reports it as damaged.
    const format = BY_EXTENSION.get(ext) ?? null;
    return { format, hint: format ? null : 'zip' };
  }
  const has = (n: string) => names.includes(n);
  if (mimetype === 'application/vnd.oasis.opendocument.text') return { format: 'odt', hint: null };
  if (mimetype.startsWith('application/vnd.oasis.opendocument.spreadsheet')) return { format: null, hint: 'ods' };
  if (mimetype.startsWith('application/vnd.oasis.opendocument.presentation')) return { format: null, hint: 'odp' };
  if (mimetype.startsWith('application/vnd.oasis.opendocument.')) return { format: null, hint: 'odf' };
  if (has('[Content_Types].xml')) {
    if (names.some((n) => n.startsWith('word/'))) return { format: 'docx', hint: null };
    if (names.some((n) => n.startsWith('xl/'))) return { format: null, hint: 'xlsx' };
    if (names.some((n) => n.startsWith('ppt/'))) return { format: null, hint: 'pptx' };
  }
  if (has('content.xml') && ext === 'odt') return { format: 'odt', hint: null };
  return { format: null, hint: 'zip' };
}

// Media and images researchers might drop by mistake: say what they are instead of "unsupported".
function sniffMedia(b: Uint8Array): string | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47]) || startsWith(b, [0xff, 0xd8, 0xff]) || startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'image';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image';
  if (startsWith(b, [0x49, 0x44, 0x33]) || startsWith(b, [0x4f, 0x67, 0x67, 0x53]) || startsWith(b, [0x66, 0x4c, 0x61, 0x43])) return 'media';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) || startsWith(b, [0x66, 0x74, 0x79, 0x70], 4) || startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'media';
  // MPEG audio frame sync (FF Ex/Fx), but not FF FE, the UTF-16 byte-order mark.
  if (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0 && b[1] < 0xfe) return 'media';
  return null;
}

const SRT_CUE = /^\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
// Each comment's body cannot contain "-->", so a run of comments splits only one way (a lazy
// [\s\S]*? could run across "--><!--" and backtrack through 2^n splits when no <html> follows).
const HTML_START = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--(?:(?!-->)[\s\S])*-->\s*)*(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i;

function sniffText(head: string, fromExt: ImportFormat | null): ImportFormat {
  const t = head.replace(/^\u{feff}/u, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT(?:[ \t\n]|$)/.test(t)) return 'vtt';
  if (SRT_CUE.test(t)) return 'srt';
  // Explicit text formats keep their extension (a CSV whose first cell is "WEBVTT" is unlikely,
  // but a Markdown file quoting HTML is not).
  if (fromExt && fromExt !== 'txt' && !BINARY.has(fromExt) && fromExt !== 'rtf') return fromExt;
  if (HTML_START.test(t)) return 'html';
  // ".rtf" without an RTF header is plain text in disguise.
  return 'txt';
}

function looksBinary(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4096);
  let controls = 0;
  for (let i = 0; i < n; i++) {
    const x = b[i]!;
    if (x === 0) return true;
    if (x < 9 || (x > 13 && x < 32)) controls++;
  }
  return controls > n * 0.05;
}

/**
 * Sniffs a file's format from its bytes, falling back to the extension. `format` is null for
 * files Trama cannot read, with a hint saying what they seem to be.
 */
export function sniffFormat(filename: string, bytes: Uint8Array): Sniffed {
  const ext = extensionOf(filename);
  const fromExt = BY_EXTENSION.get(ext) ?? null;
  if (bytes.length === 0) return { format: fromExt ?? 'txt', hint: null };

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return sniffZip(bytes, ext);
  // PDF readers accept up to 1 KB of junk before the header; so do we.
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return { format: 'pdf', hint: null };
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // Old binary Office (OLE): .doc, .xls, .ppt, Outlook .msg.
    return { format: null, hint: ext === 'xls' ? 'xls' : ext === 'ppt' ? 'ppt' : 'doc' };
  }
  const media = sniffMedia(bytes);
  if (media) return { format: null, hint: media };

  // Text from here on (UTF-16 files are text too).
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  let text: string;
  if (utf16) text = new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(2, 4098));
  else {
    const bomless = looksBinary(bytes) ? sniffUtf16(bytes) : null;
    if (looksBinary(bytes) && !bomless) {
      return fromExt && BINARY.has(fromExt) ? { format: fromExt, hint: null } : { format: null, hint: 'binary' };
    }
    text = new TextDecoder(bomless ?? 'utf-8').decode(bytes.subarray(0, 4096));
  }
  if (/^\s*\{\\rtf/.test(text.replace(/^\u{feff}/u, ''))) return { format: 'rtf', hint: null };
  // A text file named .docx/.pdf/.xlsx is damaged as far as that format goes.
  if (fromExt && BINARY.has(fromExt)) return { format: fromExt, hint: null };
  return { format: sniffText(text, fromExt), hint: null };
}

/** The importer for a file, or null when it is not supported. */
export function formatOf(filename: string, bytes: Uint8Array): ImportFormat | null {
  return sniffFormat(filename, bytes).format;
}
