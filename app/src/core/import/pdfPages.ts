// A PDF as Tramado indexes and cites it (research trama-ts §5(b), critique G9): the text with the
// offset where each physical page starts (`pageStarts`), the printed page labels when the PDF has
// them (`pageLabels`, null where the label is just the physical number), the pages without a text
// layer (`imagePages`: scans), and the running headers and footers removed (headers.ts). Pages are
// read one at a time with progress and can be cancelled (AbortSignal).
import { stripRunningLines } from './headers';
import { extractPdfPageTexts, joinPdfPages, type PdfJsLike } from './pdf';

export interface PdfPages {
  text: string;
  pages: number;
  pageStarts: number[];
  /** One entry per page: the printed label, or null where it equals the physical number. */
  pageLabels: Array<string | null>;
  imagePages: number[];
  /** Running header/footer lines dropped (headers.ts). */
  headerLines: number;
  warnings: string[];
}

export interface PdfPagesOptions {
  password?: string;
  /** 0..1 after each page. */
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
  /** Drop running headers and footers (default true). */
  stripHeaders?: boolean;
}

/** Page labels with the plain physical numbers left out (null), or all null when the PDF has none. */
export function normalizePageLabels(labels: readonly string[] | null, pages: number): Array<string | null> {
  return Array.from({ length: pages }, (_, i) => {
    const l = labels?.[i]?.trim();
    return l && l !== String(i + 1) ? l : null;
  });
}

/** The 1-based physical page that holds `pos` (pages are joined by "\n\n"; empty pages own no text). */
export function pageOf(pageStarts: readonly number[], pos: number): number {
  // The last page whose start is ≤ pos; among pages with the same start (empty pages before a
  // page with text), the last one, because that is the page the text at `pos` belongs to.
  let lo = 0;
  let hi = pageStarts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pageStarts[mid]! <= pos) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(1, lo);
}

export async function extractPdfPages(bytes: Uint8Array, pdfjs: PdfJsLike, opts: PdfPagesOptions = {}): Promise<PdfPages> {
  const read = await extractPdfPageTexts(bytes, pdfjs, {
    ...(opts.password !== undefined ? { password: opts.password } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    onPage: (done, total) => opts.onProgress?.(total ? done / total : 1),
  });
  const stripped = opts.stripHeaders === false ? { pages: read.pages, removed: 0 } : stripRunningLines(read.pages);
  const joined = joinPdfPages(stripped.pages);
  // A page that held only a running header is still a page with text: it was not scanned.
  const imagePages = joined.imagePages.filter((n) => (read.pages[n - 1]?.length ?? 0) === 0);
  const warnings = joined.warnings.filter((w) => !w.startsWith('pdf.'));
  if (joined.pages > 0 && imagePages.length === joined.pages) warnings.push('pdf.noText');
  else if (imagePages.length) warnings.push(`pdf.imagePages:${imagePages.join(',')}`);
  return {
    text: joined.text, pages: joined.pages, pageStarts: joined.pageStarts,
    pageLabels: normalizePageLabels(read.labels, joined.pages), imagePages, headerLines: stripped.removed, warnings,
  };
}
