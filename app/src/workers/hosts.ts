// IndexHost and ExtractHost (architecture §11.2, §11.7). The inline hosts run the same engine in the
// calling thread (Vitest); the worker hosts speak rpc.ts to search.worker.ts and extract.worker.ts
// (main.tsx and demo/boot.ts). T-DOCS owns this file from wave 1.
import { PlatformError } from '../core/errors';
import { EXTRACTOR, extractText, type DocKind } from '../core/import/extract';
import type { PdfJsLike } from '../core/import/pdf';
import type { MammothLike } from '../core/import/docx';
import type { ExtractHost, IndexHost } from '../services/context';
import type { TextCache } from '../services/types/documents';
import { createIndexEngine } from './engine';
import { createRpcClient } from './rpc';

export { EXTRACTOR };
export { createIndexEngine, sourceOfKey, passageId, parsePassageId } from './engine';

/** The search engine in this thread (Vitest; same results as the worker). */
export function createInlineHost(): IndexHost {
  return createIndexEngine();
}

/** pdf.js for Node and the extraction worker: the legacy build (no DOMMatrix needed for text). */
const nodePdfjs = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike;

/**
 * Extraction in the calling thread (core/import/extract.ts); pdf.js and mammoth may be injected.
 * Jobs run one at a time, like the worker.
 */
export function createInlineExtractHost(opts: { pdfjs?: () => Promise<PdfJsLike>; mammoth?: () => Promise<MammothLike> } = {}): ExtractHost {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    extract(bytes, kind, name, onProgress, signal) {
      const job = chain.then(() => {
        if (signal.aborted) throw new PlatformError('CANCELLED');
        return extractText(bytes, kind as DocKind, name, { pdfjs: opts.pdfjs ?? nodePdfjs, ...(opts.mammoth ? { mammoth: opts.mammoth } : {}) }, onProgress, signal);
      });
      chain = job.catch(() => undefined);
      return job as Promise<TextCache>;
    },
  };
}

/** The IndexHost backed by search.worker.ts. */
export function createWorkerHost(worker: Worker): IndexHost {
  const rpc = createRpcClient(worker);
  return {
    load: (classId, docs) => rpc.call('load', [classId, docs]),
    upsert: (classId, key, text, units) => rpc.call('upsert', [classId, key, text, units]),
    remove: (classId, key) => rpc.call('remove', [classId, key]),
    query: (scope, q, opts) => rpc.call('query', [scope, q, opts]),
    passage: (classId, id, opts) => rpc.call('passage', [classId, id, opts]),
    find: (scope, q, opts) => rpc.call('find', [scope, q, opts]),
    stats: (classId) => rpc.call('stats', [classId]),
  };
}

/** The ExtractHost backed by extract.worker.ts (bytes are transferred; one job at a time in the worker). */
export function createWorkerExtractHost(worker: Worker): ExtractHost {
  const rpc = createRpcClient(worker);
  let next = 1;
  return {
    extract(bytes, kind, name, onProgress, signal) {
      if (signal.aborted) return Promise.reject(new PlatformError('CANCELLED'));
      const jobId = `x${next++}`;
      const copy = bytes.slice();
      const job = rpc.call<TextCache>('extract', [copy.buffer, kind, name, jobId], { transfer: [copy.buffer], onProgress });
      signal.addEventListener('abort', () => void rpc.call('cancel', [jobId]).catch(() => undefined), { once: true });
      return job;
    },
  };
}
