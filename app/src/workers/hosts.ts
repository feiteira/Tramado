// IndexHost and ExtractHost (architecture §11.2, §11.7). M0 implements the inline hosts (same engine,
// same thread: Vitest and, until T-DOCS finishes the workers, the app); the worker hosts speak rpc.ts.
// T-DOCS owns this file from wave 1.
import { PlatformError } from '../core/errors';
import { importFile, extractPdfText, type PdfJsLike } from '../core/import';
import { PassageIndex, paragraphUnits } from '../core/search/passageIndex';
import { contextAround } from '../core/search/search';
import { stopwordsFor } from '../core/search/stopwords';
import { fold } from '../core/text/normalize';
import { sha256Hex } from '../core/util/sha256';
import type { ClassId } from '../core/model/ids';
import type { Locator, SourceRef } from '../core/model/files';
import type { ExtractHost, IndexHost } from '../services/context';
import type { DocSummary, TextCache } from '../services/types/documents';
import type { Passage } from '../services/types/search';
import { createRpcClient } from './rpc';

export const EXTRACTOR = 'tramado-extract/1';
const STOP = new Set([...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')]);

/** A document key is the JSON of its SourceRef (T-DOCS may change the convention); else a document path. */
function sourceOf(key: string): SourceRef {
  try {
    const s = JSON.parse(key) as SourceRef;
    if (s && typeof s === 'object' && 'kind' in s) return s;
  } catch {
    // not JSON
  }
  return { kind: 'document', path: key, sha256: '' };
}

interface Doc { text: string; units: TextCache['units'] }

export function createInlineHost(): IndexHost {
  const classes = new Map<ClassId, { index: PassageIndex; docs: Map<string, Doc> }>();
  const cls = (classId: ClassId) => {
    let c = classes.get(classId);
    if (!c) {
      c = { index: new PassageIndex(STOP), docs: new Map() };
      classes.set(classId, c);
    }
    return c;
  };
  const add = (classId: ClassId, key: string, text: string, units: TextCache['units']) => {
    const c = cls(classId);
    c.docs.set(key, { text, units });
    const spans = units.length ? units.map((u) => ({ start: u.start, end: u.end })) : paragraphUnits(text);
    c.index.add(key, text, spans);
  };
  const locatorAt = (doc: Doc, start: number): Locator =>
    doc.units.find((u) => u.start <= start && start < u.end)?.locator ?? { type: 'text', start, end: start, extractor: EXTRACTOR };
  const passageId = (key: string, start: number, end: number) => `${key}#${start}-${end}`;
  const toPassage = (classId: ClassId, key: string, doc: Doc, p: { start: number; end: number; text: string; score: number; hits: Array<{ start: number; end: number }> }): Passage => ({
    id: passageId(key, p.start, p.end), classId, source: sourceOf(key), locator: locatorAt(doc, p.start), label: key, text: p.text, score: p.score,
    hits: p.hits.map((h) => [h.start - p.start, h.end - p.start] as [number, number]),
  });
  const scopes = (scope: ClassId | 'all') => (scope === 'all' ? [...classes.keys()] : [scope]);

  return {
    async load(classId, docs) {
      classes.delete(classId);
      for (const d of docs) add(classId, d.key, d.text, d.units);
      cls(classId);
    },
    async upsert(classId, key, text, units) {
      add(classId, key, text, units);
    },
    async remove(classId, key) {
      const c = cls(classId);
      c.docs.delete(key);
      c.index.remove(key);
    },
    async query(scope, q, opts = {}) {
      const out: Passage[] = [];
      for (const classId of scopes(scope)) {
        const c = classes.get(classId);
        if (!c) continue;
        const exclude = new Set(opts.exclude ?? []);
        for (const p of c.index.search(q, { limit: opts.limit ?? 30, exclude: (doc) => exclude.has(doc) || (opts.kinds ? !opts.kinds.includes(sourceOf(doc).kind) : false) })) {
          out.push(toPassage(classId, p.documentId, c.docs.get(p.documentId)!, p));
        }
      }
      return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 30);
    },
    async passage(classId, id, opts = {}) {
      const m = /^(.*)#(\d+)-(\d+)$/.exec(id);
      const c = classes.get(classId);
      if (!m || !c) return null;
      const doc = c.docs.get(m[1]!);
      if (!doc) return null;
      const start = Number(m[2]) + (opts.offset ?? 0);
      const end = Math.min(doc.text.length, opts.max ? start + opts.max : Number(m[3]));
      return { ...toPassage(classId, m[1]!, doc, { start, end, text: doc.text.slice(start, end), score: 0, hits: [] }), hasMore: end < doc.text.length };
    },
    async find(scope, q, opts = {}) {
      const want = fold(q.trim());
      if (!want) return [];
      const out: Array<{ classId: ClassId; key: string; before: string; match: string; after: string; start: number }> = [];
      for (const classId of scopes(scope)) {
        for (const [key, doc] of classes.get(classId)?.docs ?? []) {
          const hay = fold(doc.text);
          for (let at = hay.indexOf(want); at !== -1 && out.length < (opts.limit ?? 200); at = hay.indexOf(want, at + 1)) {
            // fold() keeps lengths for the Latin scripts the app supports; good enough until T-DOCS maps offsets.
            const ctx = contextAround(doc.text, at, at + want.length, 40);
            out.push({ classId, key, before: ctx.before, match: doc.text.slice(at, at + want.length), after: ctx.after, start: at });
          }
        }
      }
      return out;
    },
    async stats(classId) {
      const c = classes.get(classId);
      return { docs: c?.docs.size ?? 0, chars: [...(c?.docs.values() ?? [])].reduce((n, d) => n + d.text.length, 0) };
    },
  };
}

const TEXT_KINDS: ReadonlySet<DocSummary['kind']> = new Set(['txt', 'md', 'html', 'rtf', 'odt', 'docx', 'pdf']);

/** Extraction in the calling thread: Trama's importers; pdf.js is loaded on demand (`pdfjs` may be injected). */
export function createInlineExtractHost(opts: { pdfjs?: () => Promise<PdfJsLike> } = {}): ExtractHost {
  return {
    async extract(bytes, kind, name, onProgress, signal) {
      if (!TEXT_KINDS.has(kind)) throw new PlatformError('UNSUPPORTED_FILE', `cannot extract ${kind}`);
      if (signal.aborted) throw new PlatformError('CANCELLED');
      const sha256 = sha256Hex(bytes);
      onProgress(0);
      if (kind === 'pdf') {
        const pdfjs = await (opts.pdfjs ?? (async () => (await import('pdfjs-dist')) as unknown as PdfJsLike))();
        const r = await extractPdfText(bytes.slice(), pdfjs);
        const units = r.pageStarts.map((s, i) => ({ start: s, end: r.pageStarts[i + 1] ?? r.text.length, locator: { type: 'page', page: i + 1 } as Locator }));
        onProgress(1);
        return { sha256, extractor: EXTRACTOR, kind, text: r.text, pageStarts: r.pageStarts, imagePages: r.imagePages, units, warnings: r.warnings };
      }
      const docs = await importFile(name, bytes, { transcript: 'never' });
      const doc = docs[0];
      if (!doc) throw new PlatformError('UNSUPPORTED_FILE', name);
      const units = paragraphUnits(doc.text).map((u) => ({ start: u.start, end: u.end, locator: { type: 'text', start: u.start, end: u.end, extractor: EXTRACTOR } as Locator }));
      onProgress(1);
      return { sha256, extractor: EXTRACTOR, kind, text: doc.text, units, warnings: doc.warnings };
    },
  };
}

/** The IndexHost backed by search.worker.ts (T-DOCS implements the worker side). */
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

/** The ExtractHost backed by extract.worker.ts (bytes are transferred). */
export function createWorkerExtractHost(worker: Worker): ExtractHost {
  const rpc = createRpcClient(worker);
  return {
    extract(bytes, kind, name, onProgress, signal) {
      const copy = bytes.slice();
      const job = rpc.call<TextCache>('extract', [copy.buffer, kind, name], { transfer: [copy.buffer], onProgress });
      signal.addEventListener('abort', () => void rpc.call('cancel', []).catch(() => undefined), { once: true });
      return job;
    },
  };
}
