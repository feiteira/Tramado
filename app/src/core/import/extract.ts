// One document's text as Tramado searches and cites it (architecture §11.7 extract.worker, §13.1
// `cache/text/<sha256>.json`): the extracted text, its page / slide / heading structure, the search
// units with their locators (units.ts) and warnings. The same function runs in the extraction
// worker (desktop, demo) and inline (Vitest); pdf.js and mammoth are injected.
import { PlatformError } from '../errors';
import type { Locator } from '../model/files';
import { sha256Hex } from '../util/sha256';
import { docxToHtml, type MammothLike } from './docx';
import { decodeHtml, htmlToParagraphs } from './html';
import { markdownInline, markdownToText } from './md';
import { odtToText } from './odt';
import type { PdfJsLike } from './pdf';
import { extractPdfPages } from './pdfPages';
import { pptxToText } from './pptx';
import { decodeRtfBytes, isRtf, rtfToText } from './rtf';
import { canonicalize, decodeTextWithInfo, extensionOf, tidy, tidyPlain } from './text';
import { ImportError, WARNING, warning } from './types';
import { buildUnits } from './units';

/** The extractor version written into every text cache; a different value means "extract again". */
export const EXTRACTOR = 'tramado-extract/1';

/** DocSummary['kind'] (services/types/documents.ts), repeated here because core cannot import services. */
export type DocKind = 'pdf' | 'docx' | 'pptx' | 'odt' | 'md' | 'txt' | 'html' | 'rtf' | 'image' | 'audio' | 'video' | 'other';

/** TextCache (services/types/documents.ts), structurally identical. */
export interface ExtractedText {
  sha256: string; extractor: string; kind: DocKind; text: string;
  pageStarts?: number[]; pageLabels?: Array<string | null>; imagePages?: number[]; slideStarts?: number[];
  headings?: Array<{ start: number; level: number; text: string }>;
  units: Array<{ start: number; end: number; locator: Locator }>;
  warnings: string[];
}

const KIND_BY_EXT: Record<string, DocKind> = {
  pdf: 'pdf', docx: 'docx', pptx: 'pptx', odt: 'odt', md: 'md', markdown: 'md', txt: 'txt', text: 'txt',
  html: 'html', htm: 'html', xhtml: 'html', rtf: 'rtf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', heic: 'image', bmp: 'image', tif: 'image', tiff: 'image', svg: 'image',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', opus: 'audio', flac: 'audio', aac: 'audio', weba: 'audio',
  mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', avi: 'video', m4v: 'video',
};

/** The document kind from a file name (the bytes are sniffed again at extraction). */
export function docKindOf(name: string): DocKind {
  return KIND_BY_EXT[extensionOf(name)] ?? 'other';
}

/** Kinds whose text Tramado reads. */
export const TEXT_KINDS: ReadonlySet<DocKind> = new Set(['pdf', 'docx', 'pptx', 'odt', 'md', 'txt', 'html', 'rtf']);

/**
 * Places headings (in source order) on the lines of `text` that read exactly like them, scanning
 * forward; a heading that cannot be found is left out.
 */
export function locateHeadings(text: string, list: ReadonlyArray<{ level: number; text: string }>): Array<{ start: number; level: number; text: string }> {
  const out: Array<{ start: number; level: number; text: string }> = [];
  let pos = 0;
  for (const h of list) {
    const want = h.text.trim();
    if (!want) continue;
    for (let at = text.indexOf(want, pos); at !== -1; at = text.indexOf(want, at + 1)) {
      const lineStart = at === 0 || text[at - 1] === '\n';
      const lineEnd = at + want.length === text.length || text[at + want.length] === '\n';
      if (lineStart && lineEnd) {
        out.push({ start: at, level: h.level, text: want });
        pos = at + want.length;
        break;
      }
    }
  }
  return out;
}

const FENCE = /^\s*(```|~~~)/;
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Markdown headings (ATX), as markdownToText renders their text. */
export function markdownHeadings(src: string): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  let fence: string | null = null;
  for (const line of canonicalize(src).split('\n')) {
    const f = FENCE.exec(line);
    if (f) {
      fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
      continue;
    }
    if (fence) continue;
    const m = ATX.exec(line);
    if (m && m[2]!.trim()) out.push({ level: m[1]!.length, text: markdownInline(m[2]!).trim() });
  }
  return out;
}

/** `<h1>`–`<h6>` of an HTML text, as the HTML reader renders their text. */
export function htmlHeadings(html: string, literal = false): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const t = canonicalize(htmlToParagraphs(m[2]!, { literal }).join(' ')).replace(/\s+/g, ' ').trim();
    if (t) out.push({ level: Number(m[1]), text: t });
  }
  return out;
}

function toPlatformError(e: unknown, name: string): PlatformError {
  if (e instanceof PlatformError) return e;
  if (e instanceof ImportError) {
    switch (e.code) {
      case 'UNSUPPORTED': return new PlatformError('UNSUPPORTED_FILE', `${name}: ${e.message}`, { reason: 'unsupported', detail: e.detail });
      case 'ENCRYPTED_PDF': return new PlatformError('PERMISSION_DENIED', `${name}: ${e.message}`, { reason: 'encrypted' });
      case 'TOO_LARGE': return new PlatformError('INVALID', `${name}: ${e.message}`, { reason: 'tooLarge' });
      default: return new PlatformError('INVALID', `${name}: ${e.message}`, { reason: 'damaged' });
    }
  }
  return new PlatformError('INVALID', `${name}: ${e instanceof Error ? e.message : String(e)}`, { reason: 'damaged' });
}

export interface ExtractDeps {
  /** pdf.js (the worker passes its own build; tests pass the legacy Node build). */
  pdfjs: () => Promise<PdfJsLike>;
  mammoth?: () => Promise<MammothLike>;
}

/**
 * Extracts one document. `kind` comes from the file name (docKindOf); progress is 0..1. Throws
 * PlatformError: UNSUPPORTED_FILE (not a text kind), CANCELLED, PERMISSION_DENIED (encrypted PDF),
 * INVALID (damaged or too large).
 */
export async function extractText(
  bytes: Uint8Array, kind: DocKind, name: string, deps: ExtractDeps,
  onProgress: (p: number) => void = () => undefined, signal?: AbortSignal,
): Promise<ExtractedText> {
  if (!TEXT_KINDS.has(kind)) throw new PlatformError('UNSUPPORTED_FILE', `cannot read the text of ${kind} files`, { reason: 'unsupported' });
  if (signal?.aborted) throw new PlatformError('CANCELLED');
  const sha256 = sha256Hex(bytes);
  onProgress(0);
  try {
    let out: Omit<ExtractedText, 'units' | 'sha256' | 'extractor' | 'kind'>;
    switch (kind) {
      case 'pdf': {
        const r = await extractPdfPages(bytes, await deps.pdfjs(), { onProgress, ...(signal ? { signal } : {}) });
        const labels = r.pageLabels.some((l) => l !== null) ? { pageLabels: r.pageLabels } : {};
        out = { text: r.text, pageStarts: r.pageStarts, ...labels, imagePages: r.imagePages, warnings: r.warnings };
        break;
      }
      case 'pptx': {
        const r = pptxToText(bytes);
        out = { text: r.text, slideStarts: r.slideStarts, warnings: r.warnings };
        break;
      }
      case 'docx': {
        const { html, images } = await docxToHtml(bytes, deps.mammoth ? await deps.mammoth() : undefined);
        const text = tidy(canonicalize(htmlToParagraphs(html, { literal: true }).join('\n')));
        out = { text, headings: locateHeadings(text, htmlHeadings(html, true)), warnings: images ? [warning(WARNING.imagesSkipped, images)] : [] };
        break;
      }
      case 'html': {
        const d = decodeHtml(bytes);
        const text = tidy(canonicalize(htmlToParagraphs(d.text).join('\n')));
        out = { text, headings: locateHeadings(text, htmlHeadings(d.text)), warnings: d.legacy ? [WARNING.legacyEncoding] : [] };
        break;
      }
      case 'md': {
        const d = decodeTextWithInfo(bytes);
        const text = markdownToText(d.text);
        out = { text, headings: locateHeadings(text, markdownHeadings(d.text)), warnings: d.encoding === 'windows-1252' ? [WARNING.legacyEncoding] : [] };
        break;
      }
      case 'odt': {
        const r = odtToText(bytes);
        out = { text: r.text, warnings: r.warnings };
        break;
      }
      case 'rtf': {
        const src = decodeRtfBytes(bytes);
        if (!isRtf(src)) throw new ImportError('DAMAGED', 'rtf', 'no RTF header');
        const r = rtfToText(src);
        out = { text: r.text, warnings: r.warnings };
        break;
      }
      default: {
        const d = decodeTextWithInfo(bytes);
        out = { text: tidyPlain(canonicalize(d.text)), warnings: d.encoding === 'windows-1252' ? [WARNING.legacyEncoding] : [] };
      }
    }
    if (signal?.aborted) throw new PlatformError('CANCELLED');
    if (out.headings && !out.headings.length) delete out.headings;
    const units = buildUnits({ kind, ...out }, EXTRACTOR);
    onProgress(1);
    return { sha256, extractor: EXTRACTOR, kind, ...out, units };
  } catch (e) {
    throw toPlatformError(e, name);
  }
}

/** True when every page of a PDF cache is an image page (the "Scan — no text" state). */
export function isScan(t: Pick<ExtractedText, 'kind' | 'text' | 'imagePages' | 'pageStarts'>): boolean {
  return t.kind === 'pdf' && !t.text.trim() && (t.pageStarts?.length ?? 0) > 0;
}
