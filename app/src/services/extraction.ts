// ExtractionService (architecture §11.2, §13.1; critique G9): the text of a class file, extracted once
// per content (SHA-256) through ctx.extractHost (the extraction worker), ONE file at a time, cached in
// `cache/text/<sha256>.json` (`{"format":"tramado.text-cache","version":1,…TextCache}`; a different
// `extractor` means extract again). Each device extracts its own copy: nothing goes into the class.
// It also keeps the per-device memo of file hashes (by path, size and mtime) that the document,
// search and annotation services share (hashMemo).
import { PlatformError, toPlatformError } from '../core/errors';
import { EXTRACTOR, TEXT_KINDS, docKindOf, isScan } from '../core/import/extract';
import type { ClassId, ClassPath, Hex64 } from '../core/model/ids';
import type { AppContext } from './context';
import { Store } from './store';
import type { AppServices } from './types/common';
import type { ExtractionService, TextCache } from './types/documents';

type State = 'pending' | 'running' | 'ready' | 'scan' | 'failed' | 'unsupported';
interface StatusValue {
  running: number; queued: number; bySha: Readonly<Record<Hex64, State>>;
  progress: Readonly<Record<Hex64, number>>; pages: Readonly<Record<Hex64, number>>;
}

const FORMAT = 'tramado.text-cache';
const cacheKey = (sha: Hex64) => `text/${sha}.json`;

// ── File hashes (shared by documents, search and annotations) ───────────────────────────────────

export interface HashMemo {
  /** SHA-256 of a class file, computed once per (path, size, mtime). Throws NOT_FOUND. */
  hash(classId: ClassId, path: ClassPath): Promise<Hex64>;
  /** The memoised hash when the file's size and mtime still match, else null (no I/O). */
  known(classId: ClassId, path: ClassPath, size: number, mtimeMs: number): Hex64 | null;
}

const memos = new WeakMap<AppContext, HashMemo>();

export function hashMemo(ctx: AppContext): HashMemo {
  let m = memos.get(ctx);
  if (m) return m;
  const byPath = new Map<string, { size: number; mtimeMs: number; sha: Hex64 }>();
  const inFlight = new Map<string, Promise<Hex64>>();
  const k = (classId: ClassId, path: ClassPath) => `${classId}\u0000${path}`;
  m = {
    known(classId, path, size, mtimeMs) {
      const e = byPath.get(k(classId, path));
      return e && e.size === size && e.mtimeMs === mtimeMs ? e.sha : null;
    },
    async hash(classId, path) {
      const st = await ctx.platform.fs.stat(classId, path);
      if (!st || st.isDir) throw new PlatformError('NOT_FOUND', `no file ${path}`);
      const hit = m!.known(classId, path, st.size, st.mtimeMs);
      if (hit) return hit;
      const key = `${k(classId, path)}\u0000${st.size}\u0000${st.mtimeMs}`;
      let p = inFlight.get(key);
      if (!p) {
        p = ctx.platform.fs.hash(classId, path).then((sha) => {
          byPath.set(k(classId, path), { size: st.size, mtimeMs: st.mtimeMs, sha });
          return sha;
        }).finally(() => inFlight.delete(key));
        inFlight.set(key, p);
      }
      return p;
    },
  };
  memos.set(ctx, m);
  return m;
}

/** Parses a cache entry; null when it is not a current text cache. */
export function parseTextCache(bytes: Uint8Array | null, sha: Hex64): TextCache | null {
  if (!bytes) return null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<TextCache> & { format?: string; version?: number };
    if (raw.format !== FORMAT || raw.version !== 1 || raw.extractor !== EXTRACTOR || raw.sha256 !== sha || typeof raw.text !== 'string' || !Array.isArray(raw.units)) return null;
    const { format: _f, version: _v, ...cache } = raw;
    void _f; void _v;
    return cache as TextCache;
  } catch {
    return null;
  }
}

export interface ExtractionServiceImpl extends ExtractionService {
  /** The cached text of a content hash, without extracting (null when not extracted yet). */
  cached(sha256: Hex64): Promise<TextCache | null>;
  /** Resolves when no job is running or queued (tests). */
  idle(): Promise<void>;
}

export function createExtractionService(ctx: AppContext, app: () => AppServices): ExtractionServiceImpl {
  void app;
  const { platform } = ctx;
  const status = new Store<StatusValue>({ running: 0, queued: 0, bySha: {}, progress: {}, pages: {} });
  const memo = hashMemo(ctx);
  const results = new Map<Hex64, Promise<TextCache>>();
  const controllers = new Map<Hex64, AbortController>();
  let chain: Promise<unknown> = Promise.resolve();
  let pendingJobs = 0;

  const setState = (sha: Hex64, s: State, extra: { progress?: number | null; pages?: number } = {}) => status.update((v) => {
    const progress = { ...v.progress };
    if (extra.progress === null) delete progress[sha];
    else if (extra.progress !== undefined) progress[sha] = extra.progress;
    const pages = extra.pages !== undefined ? { ...v.pages, [sha]: extra.pages } : v.pages;
    return { ...v, bySha: { ...v.bySha, [sha]: s }, progress, pages };
  });
  const counts = (dRunning: number, dQueued: number) => status.update((v) => ({ ...v, running: v.running + dRunning, queued: v.queued + dQueued }));
  const pagesOf = (t: TextCache) => t.pageStarts?.length ?? t.slideStarts?.length;
  const settledState = (t: TextCache): State => (isScan(t) ? 'scan' : 'ready');

  async function cached(sha: Hex64): Promise<TextCache | null> {
    return parseTextCache(await platform.cache.read(cacheKey(sha)).catch(() => null), sha);
  }

  function run(classId: ClassId, path: ClassPath, sha: Hex64): Promise<TextCache> {
    const kind = docKindOf(path);
    const ctl = new AbortController();
    controllers.set(sha, ctl);
    counts(0, 1);
    pendingJobs++;
    setState(sha, 'pending');
    const job = chain.then(async () => {
      counts(1, -1);
      try {
        if (ctl.signal.aborted) throw new PlatformError('CANCELLED');
        setState(sha, 'running', { progress: 0 });
        const bytes = await platform.fs.read(classId, path);
        const name = path.slice(path.lastIndexOf('/') + 1);
        const t = await ctx.extractHost.extract(bytes, kind, name, (p) => setState(sha, 'running', { progress: p }), ctl.signal);
        // The file may have changed while it was read: cache under the hash of what was extracted.
        const cache: TextCache = { ...t, sha256: t.sha256 || sha };
        await platform.cache.write(cacheKey(cache.sha256), new TextEncoder().encode(JSON.stringify({ format: FORMAT, version: 1, ...cache })));
        const pages = pagesOf(cache);
        setState(sha, settledState(cache), { progress: null, ...(pages !== undefined ? { pages } : {}) });
        return cache;
      } catch (e) {
        const err = toPlatformError(e);
        setState(sha, err.code === 'CANCELLED' ? 'pending' : err.code === 'UNSUPPORTED_FILE' ? 'unsupported' : 'failed', { progress: null });
        results.delete(sha);
        throw err;
      } finally {
        counts(-1, 0);
        controllers.delete(sha);
        pendingJobs--;
      }
    });
    chain = job.catch(() => undefined);
    return job;
  }

  const service: ExtractionServiceImpl = {
    status,
    cached,
    async ensure(classId, path) {
      const kind = docKindOf(path);
      const sha = await memo.hash(classId, path);
      if (!TEXT_KINDS.has(kind)) {
        setState(sha, 'unsupported');
        throw new PlatformError('UNSUPPORTED_FILE', `cannot read the text of ${path}`);
      }
      const running = results.get(sha);
      if (running) return running;
      const hit = await cached(sha);
      if (hit) {
        const pages = pagesOf(hit);
        if (status.get().bySha[sha] !== settledState(hit)) setState(sha, settledState(hit), pages !== undefined ? { pages } : {});
        return hit;
      }
      const job = run(classId, path, sha);
      results.set(sha, job);
      // A finished job's result stays in memory only while the cache is being written; later
      // calls read the cache.
      void job.then(() => results.delete(sha), () => undefined);
      return job;
    },
    cancel(sha256) {
      controllers.get(sha256)?.abort();
    },
    async idle() {
      while (pendingJobs > 0) await chain;
    },
  };
  return service;
}
