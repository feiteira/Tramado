// The extraction worker (architecture §11.7, critique G9): pdf.js page by page (`isEvalSupported:
// false`, running in this worker's own thread: no nested worker), mammoth lazily, pptx; ONE file at a
// time (≈ 80 MB for 800 pages), progress events, cancel by job id. Returns a TextCache.
import './streamIteration';
import { PlatformError } from '../core/errors';
import { extractText, type DocKind } from '../core/import/extract';
import type { PdfJsLike } from '../core/import/pdf';
import { serveRpc } from './rpc';

let pdfjs: Promise<PdfJsLike> | null = null;
/** pdf.js with its worker code loaded into this thread (`globalThis.pdfjsWorker`: pdf.js's own hook). */
function loadPdfjs(): Promise<PdfJsLike> {
  pdfjs ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs')]).then(([lib, worker]) => {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return lib as unknown as PdfJsLike;
  });
  return pdfjs;
}

const jobs = new Map<string, AbortController>();
let chain: Promise<unknown> = Promise.resolve();

serveRpc(self as unknown as Parameters<typeof serveRpc>[0], {
  extract(args, progress) {
    const [buffer, kind, name, jobId] = args as [ArrayBuffer, DocKind, string, string];
    const ctl = new AbortController();
    jobs.set(jobId, ctl);
    const job = chain.then(() => {
      if (ctl.signal.aborted) throw new PlatformError('CANCELLED');
      return extractText(new Uint8Array(buffer), kind, name, { pdfjs: loadPdfjs }, progress, ctl.signal);
    });
    chain = job.catch(() => undefined).finally(() => jobs.delete(jobId));
    return job;
  },
  cancel(args) {
    jobs.get(String(args[0]))?.abort();
  },
});
