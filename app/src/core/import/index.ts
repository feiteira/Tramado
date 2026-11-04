import { LIMITS } from '../model/legacy';
import { mimeOf, sniffFormat } from './detect';
import { type MammothLike, docxToText } from './docx';
import { decodeHtml, htmlToText } from './html';
import { markdownToText } from './md';
import { odtToText } from './odt';
import { type PdfJsLike, extractPdfText } from './pdf';
import { pptxToText } from './pptx';
import { decodeRtfBytes, isRtf, rtfToText } from './rtf';
import { parseSrt } from './srt';
import { baseName, canonicalize, decodeTextWithInfo, tidyPlain } from './text';
import { type SpeakerOptions, cuesToTranscript, parseTextTranscript } from './transcript';
import { ImportError, type ImportFormat, type ImportedDoc, WARNING, warning } from './types';
import { parseVtt } from './vtt';

// One entry point for the importers: bytes and a file name in, canonical documents out.
// (Tramado drops Trama's CSV/XLSX survey tables.) Errors are ImportError with a code the screen can
// explain; anything unexpected from a parser is reported as DAMAGED, never thrown raw.

export * from './types';
export { SUPPORTED, supportedExtensions, formatOf, sniffFormat, mimeOf, type SupportedFormat, type FormatGroup } from './detect';
export { canonicalize, decodeText, decodeTextWithInfo, baseName, docName } from './text';
export { parseTextTranscript, cuesToTranscript, looksLikeTranscript, parseTimestamp, cleanSpeakerName, type Cue, type SpeakerOptions, type TranscriptResult } from './transcript';
export { extractPdfText, type PdfJsLike, type PdfText } from './pdf';
export { loadMammoth, type MammothLike } from './docx';
export { pptxToText, type SlidesText } from './pptx';
export { extractPdfPages, normalizePageLabels, pageOf, type PdfPages, type PdfPagesOptions } from './pdfPages';
export { stripRunningLines, runningKey } from './headers';
export { findArticleHeads, articleStructure, articleUnits } from './articles';
export { buildUnits, paragraphSpans, unitAt, type UnitSpan } from './units';
export { extractText, docKindOf, EXTRACTOR, TEXT_KINDS, isScan, type DocKind, type ExtractedText, type ExtractDeps } from './extract';
// The individual readers, for callers that already hold decoded text or want one format only.
export { htmlToText } from './html';
export { markdownToText } from './md';
export { rtfToText } from './rtf';
export { odtToText } from './odt';
export { docxToText } from './docx';
export { parseVtt } from './vtt';
export { parseSrt } from './srt';

export type TranscriptMode = 'auto' | 'always' | 'never';

export interface ImportOptions {
  /** pdf.js module, required for PDF files (the app passes its worker-backed build). */
  pdfjs?: PdfJsLike;
  /** mammoth module; loaded on demand when absent. */
  mammoth?: MammothLike;
  /** Password for an encrypted PDF (after an ENCRYPTED_PDF error). */
  password?: string;
  /** Text, Word, OpenDocument, RTF and Markdown files: read speaker turns? Default 'auto'. */
  transcript?: TranscriptMode;
  speakers?: SpeakerOptions;
  /** Subtitle files: a sync point at every cue (default) or only at each turn. */
  syncEveryCue?: boolean;
  /** Keep the original PDF/Word file in the document (default true). */
  keepOriginal?: boolean;
  /** Skip detection and read the file as this format. */
  format?: ImportFormat;
}

export type ImportResult = ImportedDoc[];

interface Parsed {
  text: string;
  warnings: string[];
  /** May be read as a transcript (formats without timing of their own). */
  transcriptable: boolean;
  kind?: ImportedDoc['kind'];
  sync?: ImportedDoc['sync'];
  speakers?: ImportedDoc['speakers'];
}

// Older Teams exports in Word, and subtitles pasted into documents: "0:0:0.0 --> 0:0:3.410"
// lines followed by the speaker and the words. Read them as subtitles.
// [^\S\n], not \s: a leading \s* would run across blank lines from every line start, quadratic
// in a long run of empty lines.
const CUE_TIMING = /^[^\S\n]*\d{1,3}:\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?[^\S\n]*-+>[^\S\n]*\d{1,3}:\d{1,2}:\d{1,2}/gm;

function textTranscript(text: string, opts: ImportOptions, force: boolean) {
  const timings = text.match(CUE_TIMING)?.length ?? 0;
  if (timings >= 2) {
    const { cues } = parseSrt(text);
    if (cues.length >= 2) {
      return cuesToTranscript(cues, { ...(opts.speakers ? { speakers: opts.speakers } : {}), ...(opts.syncEveryCue !== undefined ? { syncEveryCue: opts.syncEveryCue } : {}) });
    }
  }
  return parseTextTranscript(text, { force, ...(opts.speakers ? { speakers: opts.speakers } : {}) });
}

function encodingWarnings(legacy: boolean, invalid = 0): string[] {
  if (legacy) return [WARNING.legacyEncoding];
  return invalid ? [warning(WARNING.damagedUtf8, invalid)] : [];
}

function decoded(bytes: Uint8Array): { text: string; warnings: string[] } {
  const d = decodeTextWithInfo(bytes);
  return { text: d.text, warnings: encodingWarnings(d.encoding === 'windows-1252', d.invalid) };
}

async function parse(format: ImportFormat, bytes: Uint8Array, opts: ImportOptions): Promise<Parsed> {
  switch (format) {
    case 'txt': {
      const d = decoded(bytes);
      return { text: tidyPlain(canonicalize(d.text)), warnings: d.warnings, transcriptable: true };
    }
    case 'md': {
      const d = decoded(bytes);
      return { text: markdownToText(d.text), warnings: d.warnings, transcriptable: true };
    }
    case 'html': {
      const d = decodeHtml(bytes);
      return { text: htmlToText(d.text), warnings: encodingWarnings(d.legacy, d.invalid), transcriptable: true };
    }
    case 'rtf': {
      const src = decodeRtfBytes(bytes);
      if (!isRtf(src)) throw new ImportError('DAMAGED', 'rtf', 'no RTF header');
      const r = rtfToText(src);
      return { text: r.text, warnings: r.warnings, transcriptable: true };
    }
    case 'odt': {
      const r = odtToText(bytes);
      return { text: r.text, warnings: r.warnings, transcriptable: true };
    }
    case 'docx': {
      const r = await docxToText(bytes, opts.mammoth);
      return { text: r.text, warnings: r.warnings, transcriptable: true };
    }
    case 'pdf': {
      if (!opts.pdfjs) throw new Error('importFile: PDF files need the pdfjs option');
      const r = await extractPdfText(bytes, opts.pdfjs, opts.password !== undefined ? { password: opts.password } : {});
      // A PDF's lines are rebuilt from positions, so its layout is only read as a transcript
      // when the researcher says it is one.
      return { text: r.text, warnings: r.warnings, transcriptable: opts.transcript === 'always', kind: 'pdf' };
    }
    case 'pptx': {
      const r = pptxToText(bytes);
      return { text: r.text, warnings: r.warnings, transcriptable: false };
    }
    case 'vtt':
    case 'srt': {
      const d = decoded(bytes);
      const { cues, warnings } = format === 'vtt' ? parseVtt(d.text) : parseSrt(d.text);
      const t = cuesToTranscript(cues, { ...(opts.speakers ? { speakers: opts.speakers } : {}), ...(opts.syncEveryCue !== undefined ? { syncEveryCue: opts.syncEveryCue } : {}) });
      return { text: t.text, warnings: [...d.warnings, ...warnings], transcriptable: false, kind: 'transcript', sync: t.sync, speakers: t.speakers };
    }
  }
}

/**
 * Imports one file. Documents come back as ImportedDoc[] (one document per file today).
 */
export async function importFile(filename: string, bytes: Uint8Array, opts: ImportOptions = {}): Promise<ImportResult> {
  const sniffed = opts.format ? { format: opts.format, hint: null } : sniffFormat(filename, bytes);
  const format = sniffed.format;
  if (!format) throw new ImportError('UNSUPPORTED', sniffed.hint);
  if (bytes.length === 0) throw new ImportError('EMPTY');
  const name = baseName(filename);

  try {
    const p = await parse(format, bytes, opts);
    let { text, kind = 'text', sync = [], speakers = [] } = p;
    const mode = opts.transcript ?? 'auto';
    if (p.transcriptable && mode !== 'never') {
      const t = textTranscript(text, opts, mode === 'always');
      if (t) {
        ({ text, sync, speakers } = t);
        kind = 'transcript';
      }
    }
    if (!text.trim() && kind !== 'pdf') throw new ImportError('EMPTY');
    if (text.length > LIMITS.textMax) throw new ImportError('TOO_LARGE', String(text.length));
    const keep = (opts.keepOriginal ?? true) && (format === 'pdf' || format === 'docx');
    const doc: ImportedDoc = {
      name,
      kind,
      text,
      sync,
      speakers,
      source: { filename, format },
      warnings: [...new Set(p.warnings)],
      ...(keep ? { original: { bytes: bytes.slice(), mime: mimeOf(format) } } : {}),
    };
    return [doc];
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof Error && e.message.startsWith('importFile:')) throw e;
    throw new ImportError('DAMAGED', format, e instanceof Error ? e.message : String(e));
  }
}
