// ExtractionService (architecture §11.2, §13.1; critique G9): the text of a class file, extracted once
// per content (SHA-256) through ctx.extractHost (the extraction worker), ONE file at a time, cached in
// `cache/text/<sha256>.json` (`{"format":"tramado.text-cache","version":1,…TextCache}`; a different
// `extractor` means extract again). Each device extracts its own copy: nothing goes into the class.
// It also keeps the per-device memo of file hashes (by path, size and mtime) that the document,
// search and annotation services share (hashMemo).
import { PlatformError, toPlatformError } from '../core/errors';
import { EXTRACTOR, TEXT_KINDS, docKindOf, isScan } from '../core/import/extract';
import { buildUnits } from '../core/import/units';
import type { ClassId, ClassPath, Hex64 } from '../core/model/ids';
import { instant } from '../core/model/time';
import { sha256Hex } from '../core/util/sha256';
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

/** "Read the text with AI" handles scans of at most this many pages (UX §3.7.2; critique G10, D15). */
export const MAX_OCR_PAGES = 20;
/** The OCR'd text of a scan is marked in its cache entry (the extraction cache, never the class folder). */
export const OCR_WARNING = 'ocr';

// Vision prompts for documents (the exam OCR prompt of core/ai talks about exam papers).
const OCR_PROMPT: Record<'en' | 'pt' | 'es', string> = {
  en: 'This is one page of a scanned document. Transcribe ALL of its text verbatim, in the original language, keeping line breaks, accents and punctuation exactly. Output only the transcribed text, no commentary.',
  pt: 'Isto é uma página de um documento digitalizado. Transcreve TODO o texto literalmente, na língua original, mantendo as quebras de linha, os acentos e a pontuação. Escreve apenas o texto transcrito, sem comentários.',
  es: 'Esta es una página de un documento escaneado. Transcribe TODO su texto literalmente, en el idioma original, manteniendo los saltos de línea, las tildes y la puntuación. Escribe solo el texto transcrito, sin comentarios.',
};
const DESCRIBE_PROMPT: Record<'en' | 'pt' | 'es', string> = {
  en: 'Describe this image for a student in a few short sentences: what it shows and every label or text on it. Answer in English.',
  pt: 'Descreve esta imagem para um estudante em poucas frases curtas: o que mostra e todas as legendas ou textos que tem. Responde em português de Portugal.',
  es: 'Describe esta imagen para un estudiante en pocas frases cortas: qué muestra y todas las etiquetas o textos que contiene. Responde en español.',
};
const promptLang = (l: string | undefined): 'en' | 'pt' | 'es' => (l === 'pt' || l === 'es' ? l : 'en');
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ── File hashes (shared by documents, search and annotations) ───────────────────────────────────
//
// UI-DOCS: the memo is also persisted per class in `private/<classId>/hashes.json`
// ({"format":"tramado.hash-cache","version":1,"files":{path:{size,mtimeMs,sha256}}}), so a start-up
// does not hash every document again (an entry counts only while the file's size and mtime match).
// The cache directory only takes the keys of architecture §13.1, so the per-class private directory
// holds it (never synced, removed with the class).

export interface HashMemo {
  /** SHA-256 of a class file, computed once per (path, size, mtime). Throws NOT_FOUND. */
  hash(classId: ClassId, path: ClassPath): Promise<Hex64>;
  /** The memoised hash when the file's size and mtime still match, else null (no I/O). */
  known(classId: ClassId, path: ClassPath, size: number, mtimeMs: number): Hex64 | null;
  /** Reads the hashes persisted for a class, once (later calls resolve at once). */
  load(classId: ClassId): Promise<void>;
  /** Forgets (and stops persisting) the entries of paths no longer in the class. */
  retain(classId: ClassId, paths: Iterable<ClassPath>): void;
  /** Resolves when the persisted file is up to date (tests). */
  flush(classId: ClassId): Promise<void>;
}

export const HASHES_FILE = 'hashes.json';
const HASHES_FORMAT = 'tramado.hash-cache';
const HEX64 = /^[0-9a-f]{64}$/;
const SAVE_DELAY_MS = 400;

const memos = new WeakMap<AppContext, HashMemo>();

/** Parses `hashes.json` (bad entries are skipped; a broken file is an empty memo). */
export function parseHashCache(bytes: Uint8Array | null): Map<ClassPath, { size: number; mtimeMs: number; sha: Hex64 }> {
  const out = new Map<ClassPath, { size: number; mtimeMs: number; sha: Hex64 }>();
  if (!bytes) return out;
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as { format?: unknown; version?: unknown; files?: unknown };
    if (raw.format !== HASHES_FORMAT || raw.version !== 1 || !raw.files || typeof raw.files !== 'object') return out;
    for (const [path, v] of Object.entries(raw.files as Record<string, unknown>)) {
      const e = v as { size?: unknown; mtimeMs?: unknown; sha256?: unknown } | null;
      if (!e || typeof e.size !== 'number' || typeof e.mtimeMs !== 'number' || typeof e.sha256 !== 'string' || !HEX64.test(e.sha256)) continue;
      out.set(path, { size: e.size, mtimeMs: e.mtimeMs, sha: e.sha256 });
    }
  } catch {
    // rebuilt as files are hashed again
  }
  return out;
}

export function hashMemo(ctx: AppContext): HashMemo {
  let m = memos.get(ctx);
  if (m) return m;
  const byPath = new Map<string, { size: number; mtimeMs: number; sha: Hex64 }>();
  const inFlight = new Map<string, Promise<Hex64>>();
  const loaded = new Map<ClassId, Promise<void>>();
  const saves = new Map<ClassId, { timer: ReturnType<typeof setTimeout> | null; writing: Promise<void> | null; dirty: boolean }>();
  const k = (classId: ClassId, path: ClassPath) => `${classId}\u0000${path}`;

  async function write(classId: ClassId): Promise<void> {
    const prefix = `${classId}\u0000`;
    const files: Record<string, { size: number; mtimeMs: number; sha256: Hex64 }> = {};
    for (const [key, e] of byPath) if (key.startsWith(prefix)) files[key.slice(prefix.length)] = { size: e.size, mtimeMs: e.mtimeMs, sha256: e.sha };
    const body = JSON.stringify({ format: HASHES_FORMAT, version: 1, files });
    await ctx.platform.privateFiles.write(classId, HASHES_FILE, new TextEncoder().encode(body)).catch((e: unknown) => ctx.log('warn', 'hashes: could not save', { classId, error: String(e) }));
  }
  function save(classId: ClassId) {
    let s = saves.get(classId);
    if (!s) {
      s = { timer: null, writing: null, dirty: false };
      saves.set(classId, s);
    }
    s.dirty = true;
    if (s.timer || s.writing) return;
    const st = s;
    st.timer = setTimeout(() => {
      st.timer = null;
      st.dirty = false;
      st.writing = write(classId).finally(() => {
        st.writing = null;
        if (st.dirty) save(classId);
      });
    }, SAVE_DELAY_MS);
  }

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
          save(classId);
          return sha;
        }).finally(() => inFlight.delete(key));
        inFlight.set(key, p);
      }
      return p;
    },
    load(classId) {
      let p = loaded.get(classId);
      if (!p) {
        p = ctx.platform.privateFiles.read(classId, HASHES_FILE).catch(() => null).then((bytes) => {
          for (const [path, e] of parseHashCache(bytes)) if (!byPath.has(k(classId, path))) byPath.set(k(classId, path), e);
        });
        loaded.set(classId, p);
      }
      return p;
    },
    retain(classId, paths) {
      const keep = new Set([...paths].map((p) => k(classId, p)));
      const prefix = `${classId}\u0000`;
      let dropped = false;
      for (const key of [...byPath.keys()]) {
        if (key.startsWith(prefix) && !keep.has(key)) {
          byPath.delete(key);
          dropped = true;
        }
      }
      if (dropped) save(classId);
    },
    async flush(classId) {
      for (let i = 0; i < 10; i++) {
        const s = saves.get(classId);
        if (!s || (!s.timer && !s.writing && !s.dirty)) return;
        if (s.timer) {
          clearTimeout(s.timer);
          s.timer = null;
          s.dirty = false;
          s.writing = write(classId).finally(() => {
            s.writing = null;
            if (s.dirty) save(classId);
          });
        }
        await s.writing;
      }
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
  ocr: NonNullable<ExtractionService['ocr']>;
  describe: NonNullable<ExtractionService['describe']>;
  /** Resolves when no job is running or queued (tests). */
  idle(): Promise<void>;
}

export function createExtractionService(ctx: AppContext, app: () => AppServices): ExtractionServiceImpl {
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
    async ocr(classId, path, opts = {}) {
      if (docKindOf(path) !== 'pdf') throw new PlatformError('UNSUPPORTED_FILE', 'only scanned PDFs are read with AI');
      const base = await service.ensure(classId, path);
      const bytes = await platform.fs.read(classId, path);
      const sha = sha256Hex(bytes);
      const pages = base.pageStarts?.length ?? (await ctx.pdfRender.pages(bytes));
      if (pages > MAX_OCR_PAGES) throw new PlatformError('INVALID', `a scan of ${pages} pages is too long to read with AI`, { reason: 'tooLong' });
      const image = new Set(base.imagePages ?? (isScan(base) ? Array.from({ length: pages }, (_, i) => i + 1) : []));
      const lang = promptLang(ctx.prefs.get('ui.locale'));
      const texts: string[] = [];
      let done = 0;
      const total = image.size;
      opts.onProgress?.(0, total);
      setState(sha, 'running', { progress: 0 });
      try {
        for (let page = 1; page <= pages; page++) {
          if (opts.signal?.aborted) throw new PlatformError('CANCELLED');
          if (!image.has(page)) {
            const start = base.pageStarts?.[page - 1] ?? 0;
            const end = page < pages ? (base.pageStarts?.[page] ?? base.text.length) : base.text.length;
            texts.push(base.text.slice(start, end).trim());
            continue;
          }
          const jpeg = await ctx.pdfRender.renderJpeg(bytes, page, 1600);
          const key = `ocr/${sha256Hex(jpeg)}.json`;
          let text: string | null = null;
          try {
            const hit = await platform.cache.read(key);
            const j = hit ? (JSON.parse(new TextDecoder().decode(hit)) as { format?: string; text?: unknown }) : null;
            if (j?.format === 'tramado.ocr-cache' && typeof j.text === 'string') text = j.text;
          } catch {
            text = null;
          }
          if (text === null) {
            const r = await app().ai.client.run({
              task: 'ocr', vision: true, activity: { classId, action: 'docOcr', passages: 0 }, ...(opts.signal ? { signal: opts.signal } : {}),
              messages: [{ role: 'user', content: [{ type: 'text', text: OCR_PROMPT[lang] }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64(jpeg)}` } }] }],
            });
            text = r.content.trim();
            await platform.cache.write(key, new TextEncoder().encode(JSON.stringify({ format: 'tramado.ocr-cache', version: 1, model: r.model, text, at: instant(ctx.clock.now()) }))).catch(() => undefined);
          }
          texts.push(text);
          done++;
          opts.onProgress?.(done, total);
          setState(sha, 'running', { progress: total ? done / total : 1 });
        }
        let text = '';
        const pageStarts: number[] = [];
        texts.forEach((t, i) => {
          if (i) text += '\n\n';
          pageStarts.push(text.length);
          text += t;
        });
        const cache: TextCache = {
          sha256: sha, extractor: EXTRACTOR, kind: 'pdf', text, pageStarts, imagePages: [],
          ...(base.pageLabels ? { pageLabels: base.pageLabels } : {}),
          units: buildUnits({ kind: 'pdf', text, pageStarts }, EXTRACTOR),
          warnings: [...base.warnings.filter((w) => w !== OCR_WARNING), OCR_WARNING],
        };
        await platform.cache.write(cacheKey(sha), new TextEncoder().encode(JSON.stringify({ format: FORMAT, version: 1, ...cache })));
        setState(sha, settledState(cache), { progress: null, pages });
        app().search.reindex?.(classId, path);
        return cache;
      } catch (e) {
        setState(sha, settledState(base), { progress: null });
        throw toPlatformError(e);
      }
    },
    async describe(classId, path, opts = {}) {
      if (docKindOf(path) !== 'image') throw new PlatformError('UNSUPPORTED_FILE', 'not an image');
      const bytes = await platform.fs.read(classId, path);
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      const prep = await ctx.imagePrep.prepare(bytes, IMAGE_MIME[ext] ?? 'image/png', 1400, 0.75);
      const lang = promptLang(ctx.prefs.get('ui.locale'));
      const r = await app().ai.client.run({
        task: 'explain', vision: true, activity: { classId, action: 'describe', passages: 0 }, ...(opts.signal ? { signal: opts.signal } : {}),
        messages: [{ role: 'user', content: [{ type: 'text', text: DESCRIBE_PROMPT[lang] }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64(prep.jpeg)}` } }] }],
      });
      return { text: r.content.trim(), model: r.model };
    },
    async idle() {
      while (pendingJobs > 0) await chain;
    },
  };
  return service;
}
