import type { SyncPoint } from '../model/legacy';

// What the importers produce: canonical documents (and tables for surveys), ready for the
// documents service to store. Importers never touch the store.

/** Lower-case format ids, the same ones DocSource.format records. */
export const IMPORT_FORMATS = ['txt', 'md', 'docx', 'odt', 'rtf', 'html', 'pdf', 'vtt', 'srt'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export type ImportedKind = 'text' | 'transcript' | 'pdf' | 'survey';

/** A half-open [start, end) range of UTF-16 offsets into ImportedDoc.text. */
export interface Span {
  start: number;
  end: number;
}

/** Who speaks where, for auto-coding speakers. Spans cover what was said, not the "Name: " label. */
export interface ImportedSpeaker {
  name: string;
  spans: Span[];
}

export interface ImportedDoc {
  /** Suggested document name (the file name without its extension, or a respondent id). */
  name: string;
  kind: ImportedKind;
  /** Canonical text: LF line endings, no BOM, NFC, no control characters except \t and \n. */
  text: string;
  /** Transcript timestamps, sorted by pos. */
  sync: SyncPoint[];
  speakers: ImportedSpeaker[];
  source: { filename: string; format: ImportFormat };
  /** The original file, kept for PDF and Word documents so it can be viewed later. */
  original?: { bytes: Uint8Array; mime: string };
  /** Warning codes (see WARNING); the importer screen turns them into sentences. */
  warnings: string[];
}

export interface ImportedTable {
  name: string;
  headers: string[];
  rows: string[][];
  source?: { filename: string; format: 'csv' | 'xlsx' };
  warnings?: string[];
}

/**
 * Warnings are language-neutral codes, optionally followed by ":" and an argument
 * (e.g. "pdf.imagePages:2,5"), so core code holds no user-facing text. Read them with
 * parseWarning.
 */
export const WARNING = {
  /** Not valid UTF-8: read as Windows-1252. Accented letters may need checking. */
  legacyEncoding: 'text.legacyEncoding',
  /** UTF-8 with a few invalid byte sequences, each read as U+FFFD (argument: how many). */
  damagedUtf8: 'text.damagedUtf8',
  /** Pages (comma-separated, from 1) without a text layer: probably scanned images. */
  pdfImagePages: 'pdf.imagePages',
  /** The whole PDF has no text layer. */
  pdfNoText: 'pdf.noText',
  /** Images in a Word or OpenDocument file were left out (argument: how many). */
  imagesSkipped: 'doc.imagesSkipped',
  /** Comments in the file were left out (argument: how many). */
  commentsSkipped: 'doc.commentsSkipped',
  /** An RTF code page we cannot decode (argument: its number); read as Windows-1252. */
  rtfCodePage: 'rtf.codePage',
  /** Subtitle blocks without a readable time line were skipped (argument: how many). */
  cuesSkipped: 'transcript.cuesSkipped',
  /** Spreadsheet formulas without a saved result were left empty (argument: how many). */
  formulasWithoutValue: 'xlsx.formulasWithoutValue',
  /** Rows with more or fewer cells than the header row (argument: how many). */
  raggedRows: 'table.raggedRows',
  /**
   * A quoted CSV field never closes properly (argument: the file's line numbers, comma-separated):
   * the lines after it may have been merged into one cell.
   */
  malformedQuotes: 'table.malformedQuotes',
} as const;
export type WarningCode = (typeof WARNING)[keyof typeof WARNING];

export function warning(code: WarningCode, arg?: string | number): string {
  return arg === undefined ? code : `${code}:${arg}`;
}

export function parseWarning(w: string): { code: string; arg: string | null } {
  const i = w.indexOf(':');
  return i < 0 ? { code: w, arg: null } : { code: w.slice(0, i), arg: w.slice(i + 1) };
}

export type ImportErrorCode = 'UNSUPPORTED' | 'EMPTY' | 'DAMAGED' | 'ENCRYPTED_PDF' | 'TOO_LARGE';

/**
 * Why a file could not be imported. `detail` is a language-neutral hint for the importer
 * screen: for UNSUPPORTED the kind of file it seems to be (doc, xls, ppt, pptx, ods, odp,
 * image, media, binary, zip), for ENCRYPTED_PDF "password" or "incorrect-password".
 */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly detail: string | null = null,
    message?: string,
  ) {
    super(message ?? (detail ? `${code}: ${detail}` : code));
    this.name = 'ImportError';
  }
}
