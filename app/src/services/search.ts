// SearchService (architecture §11.2, §11.7, §12 rule 7; D-8, D16; UX §3.13): one PassageIndex per
// class in the search worker (ctx.indexHost), fed with every source of the class —
//   documents (`document:<path>`, text from ExtractionService, extracted one file at a time),
//   class notes (`note:<path>`), my private notes (`private:notes/<name>.md`),
//   lecture transcripts (`lecture:<lectureId>`, segment locators) and exam questions (`exam:<examId>`)
// — rebuilt from the text cache when a class opens (no index persistence in 0.1, D-8) and kept up
// to date from the store's `document`, `note`, `transcript`, `lecture` and `exam` changes.
// Passages carry a spec SourceRef (with the document's SHA-256), a Locator and a stored-citation
// label; `resolve` follows folder spec §8.15 steps 1–4 and builds the route of UX §4.5.
import { PlatformError, toPlatformError } from '../core/errors';
import { EXTRACTOR, TEXT_KINDS, docKindOf, extractText } from '../core/import/extract';
import type { Citation, ExamFile, LectureFile, Locator, SourceRef, TranscriptFile } from '../core/model/files';
import type { ClassId, ClassPath, Hex64 } from '../core/model/ids';
import { parserFor } from '../core/model/parse';
import { citationLabel } from '../core/search/labels';
import { locatorPage, passageLocator, unitContaining } from '../core/search/locators';
import { resolveCitation, type CitationLookup } from '../core/search/resolve';
import { transcriptIndexText } from '../core/transcript/units';
import { sha256Hex } from '../core/util/sha256';
import type { AppContext } from './context';
import { hashMemo, type ExtractionServiceImpl } from './extraction';
import type { LectureServiceImpl } from './lectures';
import { Store, type ReadableStore } from './store';
import type { AppServices, ClassStore } from './types/common';
import type { TextCache } from './types/documents';
import type { IndexStatus, Passage, SearchService } from './types/search';

type Units = TextCache['units'];
interface Entry {
  key: string;
  sig: string;
  source: SourceRef;
  title: string;
  private: boolean;
  units: Units;
  /** Exams: the question id of each unit, by unit start. */
  questions?: Array<{ start: number; id: string }>;
}
interface Want {
  key: string;
  sig: string;
  title: string;
  private: boolean;
  /** Reads the text now (quick sources) — or null for documents, which go through extraction. */
  load: (() => Promise<{ text: string; units: Units; source: SourceRef; questions?: Entry['questions'] } | null>) | null;
  path?: ClassPath;
}
interface ClassIdx {
  status: Store<IndexStatus>;
  entries: Map<string, Entry>;
  first: Promise<void> | null;
  syncing: Promise<void> | null;
  again: boolean;
  pending: Set<string>;
  failed: Map<string, string>;   // key → sig whose extraction failed (not retried until the file changes)
  off: Array<() => void>;
  settledWaiters: Array<() => void>;
}

const dec = new TextDecoder();
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const stem = (p: string) => nameOf(p).replace(/\.[^.]+$/, '') || nameOf(p);
const NOTE_TITLE = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m;
const noteTitle = (path: string, text: string) => NOTE_TITLE.exec(text)?.[1] ?? stem(path);
const NO_PDF = async () => {
  throw new PlatformError('UNSUPPORTED_FILE', 'not a PDF');
};

/** Waits until a class store has finished its first load. */
export function storeReady(store: ClassStore): Promise<void> {
  if (store.state.get().status !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    const off = store.state.subscribe(() => {
      if (store.state.get().status === 'loading') return;
      off();
      resolve();
    });
  });
}

export interface SearchServiceImpl extends SearchService {
  settled(classId: ClassId): Promise<IndexStatus>;
  refresh(classId: ClassId): void;
  /** Stops listening to a class (tests). */
  drop(classId: ClassId): void;
}

export function createSearchService(ctx: AppContext, app: () => AppServices): SearchServiceImpl {
  const host = ctx.indexHost;
  const memo = hashMemo(ctx);
  const classes = new Map<ClassId, ClassIdx>();
  const lang = () => ctx.prefs.get('ui.locale') || 'en';
  const extraction = () => app().extraction as ExtractionServiceImpl;

  const idx = (classId: ClassId): ClassIdx => {
    let c = classes.get(classId);
    if (!c) {
      c = {
        status: new Store<IndexStatus>({ classId, state: 'idle', docs: 0, pending: 0, chars: 0 }),
        entries: new Map(), first: null, syncing: null, again: false, pending: new Set(), failed: new Map(), off: [], settledWaiters: [],
      };
      classes.set(classId, c);
    }
    return c;
  };

  const publish = async (classId: ClassId, c: ClassIdx, state?: IndexStatus['state']) => {
    const stats = await host.stats(classId).catch(() => ({ docs: c.entries.size, chars: 0 }));
    const next: IndexStatus = { classId, state: state ?? (c.pending.size ? 'building' : 'ready'), docs: stats.docs, pending: c.pending.size, chars: stats.chars };
    c.status.set(next);
    if (!c.pending.size && !c.syncing) for (const w of c.settledWaiters.splice(0)) w();
  };

  /**
   * The effective transcript (pending corrections applied, folder spec §8.9) from the class's LectureService, which
   * replays every lecture's edit logs on each refresh (not only the lectures someone opened). Null when the service
   * has no record of the lecture (the trusted transcript.json is read instead).
   */
  async function effectiveTranscript(classId: ClassId, lectureId: string): Promise<TranscriptFile | null> {
    try {
      const lectures = app().forClass(classId).lectures as Partial<LectureServiceImpl>;
      if (typeof lectures.records !== 'function') return null;
      // A refresh started by the same store change may be running: its result includes the change.
      await lectures.idle?.();
      return lectures.records().get(lectureId)?.effective ?? null;
    } catch {
      return null;
    }
  }

  // ── What a class holds ────────────────────────────────────────────────────────────────────────
  async function collect(classId: ClassId, store: ClassStore): Promise<Want[]> {
    const ix = store.state.get().index;
    const wants: Want[] = [];
    for (const d of ix.documents) {
      if (!TEXT_KINDS.has(docKindOf(d.path))) continue;
      wants.push({ key: `document:${d.path}`, sig: `${d.size}:${d.mtimeMs}`, title: stem(d.path), private: false, load: null, path: d.path });
    }
    for (const n of ix.notes) {
      wants.push({
        key: `note:${n.path}`, sig: `${n.size}:${n.mtimeMs}`, title: stem(n.path), private: false, path: n.path,
        load: async () => {
          const bytes = await store.readBytes(n.path);
          if (!bytes) return null;
          const t = await extractText(bytes, 'md', nameOf(n.path), { pdfjs: NO_PDF });
          return { text: t.text, units: t.units, source: { kind: 'note', path: n.path, sha256: t.sha256 } };
        },
      });
    }
    const privatePaths = (await ctx.platform.privateFiles.list(classId, 'notes').catch(() => [] as string[])).filter((p) => p.toLowerCase().endsWith('.md'));
    for (const rel of privatePaths) {
      const path = `notes/${rel}`;
      const bytes = await ctx.platform.privateFiles.read(classId, path).catch(() => null);
      if (!bytes) continue;
      const sha = sha256Hex(bytes);
      wants.push({
        key: `private:${path}`, sig: sha, title: noteTitle(path, dec.decode(bytes)), private: true, path,
        load: async () => {
          const t = await extractText(bytes, 'md', nameOf(path), { pdfjs: NO_PDF });
          return { text: t.text, units: t.units, source: { kind: 'note', path, sha256: sha } };
        },
      });
    }
    for (const [id, item] of ix.lectures) {
      const tPath = item.dir ? `${item.dir}/transcript.json` : 'transcript.json';
      const st = await ctx.platform.fs.stat(classId, tPath).catch(() => null);
      if (!st) continue;
      // Corrections not folded yet (folder spec §8.9) change the effective text: their sizes are in the signature.
      let edits = 0;
      for (const [p, e] of ix.machine) if (p.startsWith(`.tramado/edits/${id}/`)) edits += e.size;
      wants.push({
        key: `lecture:${id}`, sig: `${st.size}:${st.mtimeMs}:${item.mtimeMs}:${edits}`, title: '', private: false,
        load: async () => {
          const effective = await effectiveTranscript(classId, id);
          const t = effective ? { value: effective } : await store.readJson<TranscriptFile>(tPath, parserFor('tramado.transcript'));
          if (!t || t.value.lectureId !== id) return null;
          const { text, units } = transcriptIndexText(t.value);
          return { text, units, source: { kind: 'lecture', lectureId: id, audioSha256: t.value.audioSha256, transcriptRevision: t.value.revision } };
        },
      });
    }
    for (const [id, item] of ix.exams) {
      wants.push({
        key: `exam:${id}`, sig: `${item.size}:${item.mtimeMs}`, title: '', private: false,
        load: async () => {
          const e = await store.readJson<ExamFile>(item.manifest, parserFor('tramado.exam'));
          if (!e || e.value.id !== id) return null;
          let text = '';
          const units: Units = [];
          const questions: NonNullable<Entry['questions']> = [];
          for (const q of e.value.questions ?? []) {
            if (q.kind === 'container' && !q.text.trim()) continue;
            const body = [q.text, ...(q.options ?? []).map((o) => `${o.key}) ${o.text}`)].join('\n').trim();
            if (!body) continue;
            if (text) text += '\n';
            const start = text.length;
            text += body;
            units.push({ start, end: text.length, locator: { type: 'whole' } });
            questions.push({ start, id: q.id });
          }
          return { text, units, source: { kind: 'exam', examId: id }, questions };
        },
      });
    }
    // Lecture and exam titles from their manifests (cheap: the store caches trusted reads).
    for (const w of wants) {
      if (w.key.startsWith('lecture:')) {
        const item = ix.lectures.get(w.key.slice(8));
        const l = item ? await store.readJson<LectureFile>(item.manifest, parserFor('tramado.lecture')).catch(() => null) : null;
        w.title = l?.value.title ?? '';
      } else if (w.key.startsWith('exam:')) {
        const item = ix.exams.get(w.key.slice(5));
        const e = item ? await store.readJson<ExamFile>(item.manifest, parserFor('tramado.exam')).catch(() => null) : null;
        w.title = e?.value.title ?? '';
      }
    }
    return wants;
  }

  // ── Keeping the index in step ───────────────────────────────────────────────────────────────
  async function indexDocument(classId: ClassId, c: ClassIdx, w: Want, first: Map<string, { text: string; units: Units }> | null) {
    const path = w.path!;
    let sha: Hex64;
    try {
      sha = await memo.hash(classId, path);
    } catch {
      return;
    }
    const cachedText = await extraction().cached(sha);
    const put = async (t: TextCache) => {
      const entry: Entry = { key: w.key, sig: w.sig, source: { kind: 'document', path, sha256: sha }, title: w.title, private: false, units: t.units };
      c.entries.set(w.key, entry);
      if (first) first.set(w.key, { text: t.text, units: t.units });
      else await host.upsert(classId, w.key, t.text, t.units);
    };
    if (cachedText) {
      await put(cachedText);
      return;
    }
    // Not extracted yet: queue it, index it when it is ready.
    if (c.pending.has(w.key)) return;
    c.pending.add(w.key);
    void extraction().ensure(classId, path).then(
      async (t) => {
        // A sync in progress may be about to (re)load the whole class: index after it.
        while (c.syncing) await c.syncing.catch(() => undefined);
        c.pending.delete(w.key);
        // Still wanted (the file may have changed or gone meanwhile)?
        const now = await ctx.platform.fs.stat(classId, path).catch(() => null);
        if (now && `${now.size}:${now.mtimeMs}` === w.sig) {
          const entry: Entry = { key: w.key, sig: w.sig, source: { kind: 'document', path, sha256: t.sha256 }, title: w.title, private: false, units: t.units };
          c.entries.set(w.key, entry);
          await host.upsert(classId, w.key, t.text, t.units);
        } else if (now) {
          // It changed while it was being read: index the new version.
          void schedule(classId);
        }
        await publish(classId, c);
      },
      async (e: unknown) => {
        while (c.syncing) await c.syncing.catch(() => undefined);
        c.pending.delete(w.key);
        if (toPlatformError(e).code !== 'CANCELLED') c.failed.set(w.key, w.sig);
        await publish(classId, c);
      },
    );
  }

  async function syncClass(classId: ClassId, initial: boolean): Promise<void> {
    const c = idx(classId);
    const store = app().forClass(classId).store;
    await storeReady(store);
    if (c.status.get().state === 'idle') c.status.set({ ...c.status.get(), state: 'building' });
    const wants = await collect(classId, store);
    const wanted = new Map(wants.map((w) => [w.key, w]));
    const first = initial ? new Map<string, { text: string; units: Units }>() : null;
    for (const key of [...c.entries.keys()]) {
      const w = wanted.get(key);
      if (w && c.entries.get(key)!.sig === w.sig) continue;
      if (!w) {
        c.entries.delete(key);
        if (!first) await host.remove(classId, key);
      }
    }
    for (const w of wants) {
      const have = c.entries.get(w.key);
      if (have && have.sig === w.sig && !first) continue;
      if (c.failed.get(w.key) === w.sig) continue;
      if (!w.load) {
        await indexDocument(classId, c, w, first);
        continue;
      }
      try {
        const got = await w.load();
        if (!got) {
          if (have) {
            c.entries.delete(w.key);
            if (!first) await host.remove(classId, w.key);
          }
          continue;
        }
        c.entries.set(w.key, { key: w.key, sig: w.sig, source: got.source, title: w.title, private: w.private, units: got.units, ...(got.questions ? { questions: got.questions } : {}) });
        if (first) first.set(w.key, { text: got.text, units: got.units });
        else await host.upsert(classId, w.key, got.text, got.units);
      } catch (e) {
        ctx.log('warn', 'search: could not index a source', { classId, key: w.key, error: String(e) });
      }
    }
    if (first) await host.load(classId, [...first].map(([key, d]) => ({ key, text: d.text, units: d.units })));
  }

  function schedule(classId: ClassId): Promise<void> {
    const c = idx(classId);
    if (c.syncing) {
      c.again = true;
      return c.syncing;
    }
    const initial = !c.first;
    const run = syncClass(classId, initial)
      .catch((e: unknown) => {
        ctx.log('error', 'search: index sync failed', { classId, error: String(e) });
        c.status.set({ ...c.status.get(), state: 'error' });
      })
      .finally(async () => {
        c.syncing = null;
        if (c.again) {
          c.again = false;
          void schedule(classId);
        } else if (c.status.get().state !== 'error') await publish(classId, c);
      });
    c.syncing = run;
    return run;
  }

  async function ensure(classId: ClassId): Promise<void> {
    const c = idx(classId);
    if (!c.first) {
      const store = app().forClass(classId).store;
      c.off.push(store.onChange(['document', 'note', 'transcript', 'lecture', 'exam', 'edits'], () => void schedule(classId)));
      c.first = schedule(classId);
    }
    await c.first;
  }

  const scopeIds = async (scope: ClassId | 'all') => {
    if (scope !== 'all') return [scope];
    return app().library.classes.get().filter((v) => !v.archived).map((v) => v.id);
  };

  // ── Passages as the services and screens see them ──────────────────────────────────────────
  function decorate(p: Passage): Passage {
    const key = p.id.slice(0, p.id.lastIndexOf('#'));
    const e = classes.get(p.classId)?.entries.get(key);
    if (!e) return { ...p, label: citationLabel(p.source, p.locator, lang()) };
    let source = e.source;
    if (source.kind === 'exam' && e.questions?.length) {
      const start = Number(/#(\d+)-\d+$/.exec(p.id)?.[1] ?? 0);
      const q = [...e.questions].reverse().find((x) => x.start <= start);
      if (q) source = { ...source, questionId: q.id };
    }
    const label = citationLabel(source, p.locator, lang(), e.source.kind === 'document' ? nameOf(e.source.path) : e.title);
    return { ...p, source, label, title: e.title, ...(e.private ? { private: true } : {}) };
  }

  // ── Citation resolution ─────────────────────────────────────────────────────────────────────
  function lookup(classId: ClassId): CitationLookup {
    const store = app().forClass(classId).store;
    const files = () => {
      const ix = store.state.get().index;
      return [...ix.documents, ...ix.notes];
    };
    return {
      async shaOf(path) {
        return memo.hash(classId, path).catch(() => null);
      },
      async pathsWithSha(sha) {
        const out: string[] = [];
        for (const f of files()) {
          const h = await memo.hash(classId, f.path).catch(() => null);
          if (h === sha) out.push(f.path);
        }
        return out;
      },
      async textOf(path) {
        if (docKindOf(path) === 'md' && store.state.get().index.notes.some((n) => n.path === path)) {
          const bytes = await store.readBytes(path);
          return bytes ? (await extractText(bytes, 'md', nameOf(path), { pdfjs: NO_PDF })).text : null;
        }
        if (!TEXT_KINDS.has(docKindOf(path))) return null;
        return (await app().extraction.ensure(classId, path).catch(() => null))?.text ?? null;
      },
      async candidates(kind) {
        const ix = store.state.get().index;
        return kind === 'note' ? ix.notes.map((n) => n.path) : ix.documents.map((d) => d.path).filter((p) => TEXT_KINDS.has(docKindOf(p)));
      },
      async lectureExists(id) {
        return store.state.get().index.lectures.has(id);
      },
      async examExists(id) {
        return store.state.get().index.exams.has(id);
      },
    };
  }

  function routeOf(classId: ClassId, c: Citation, path: string | undefined): unknown {
    const s = c.source;
    const quote = c.quote?.exact;
    const q = quote ? { quote } : {};
    switch (s.kind) {
      case 'document': {
        const loc: Locator = c.locator;
        const page = locatorPage(loc);
        return { name: 'document', classId, relPath: path ?? s.path, sha256: s.sha256, ...(page ? { page } : {}), ...(loc.type === 'slide' ? { slide: loc.slide } : {}), ...q };
      }
      case 'note':
        return { name: 'note', classId, relPath: path ?? s.path, private: false, ...q };
      case 'lecture': {
        const loc = c.locator;
        return { name: 'lecture', classId, lectureId: s.lectureId, ...(loc.type === 'segment' ? { at: loc.startMs, segmentId: loc.segmentId } : {}), ...q };
      }
      case 'exam':
        return { name: 'exam', classId, examId: s.examId, ...(s.questionId ? { questionId: s.questionId } : {}) };
    }
  }

  const service: SearchServiceImpl = {
    status: (classId) => idx(classId).status as ReadableStore<IndexStatus>,
    ensure,
    async passages(scope, query, opts = {}) {
      for (const id of await scopeIds(scope)) await ensure(id);
      const found = await host.query(scope, query, opts);
      return found.map(decorate);
    },
    async passage(classId, id, opts) {
      await ensure(classId);
      const p = await host.passage(classId, id, opts);
      return p ? { ...decorate(p), hasMore: p.hasMore } : null;
    },
    async find(scope, query, opts) {
      const ids = await scopeIds(scope);
      for (const id of ids) await ensure(id);
      const hits = await host.find(scope, query, opts);
      return hits.map((h) => {
        const e = classes.get(h.classId)?.entries.get(h.key);
        const source = e?.source ?? { kind: 'document' as const, path: h.key, sha256: '' };
        const hit = [{ start: h.start, end: h.start + h.match.length }];
        const locator = passageLocator(e ? unitContaining(e.units, h.start) : null, h.start, h.start + h.match.length, hit, EXTRACTOR);
        let src: SourceRef = source;
        if (source.kind === 'exam' && e?.questions?.length) {
          const q = [...e.questions].reverse().find((x) => x.start <= h.start);
          if (q) src = { ...source, questionId: q.id };
        }
        const title = e ? (e.source.kind === 'document' ? nameOf(e.source.path) : e.title) : undefined;
        return { classId: h.classId, source: src, label: citationLabel(src, locator, lang(), title), before: h.before, match: h.match, after: h.after, locator };
      });
    },
    async resolve(classId, c) {
      const r = await resolveCitation(c, lookup(classId));
      const label = c.label || citationLabel(c.source, c.locator, lang());
      if (r.status === 'missing') return { status: 'missing', route: null, label };
      return { status: r.status, route: routeOf(classId, c, r.path), label, ...(r.path ? { path: r.path } : {}) };
    },
    async settled(classId) {
      await ensure(classId);
      const c = idx(classId);
      for (;;) {
        if (c.syncing) await c.syncing;
        if (!c.pending.size && !c.syncing) break;
        await new Promise<void>((resolve) => c.settledWaiters.push(resolve));
      }
      await publish(classId, c);
      return c.status.get();
    },
    refresh(classId) {
      if (classes.get(classId)?.first) void schedule(classId);
    },
    reindex(classId, path) {
      const c = classes.get(classId);
      if (!c?.first) return;
      const key = `document:${path}`;
      c.entries.delete(key);
      c.failed.delete(key);
      void schedule(classId);
    },
    drop(classId) {
      const c = classes.get(classId);
      if (!c) return;
      for (const off of c.off) off();
      classes.delete(classId);
    },
  };
  return service;
}
