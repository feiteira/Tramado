// ClassStore: the generic file layer of one class (architecture §11.2, §12). Discovery by manifest
// (folder spec §5.3), incremental change ingestion with coalescing (one load at a time, a trailing
// reload, ≤ 500 ms), per-kind change counters, trusted reads (TrustGate), incremental JSONL reads and
// own-write echo suppression. Frozen after M0; no DOM.
import { toPlatformError, type ErrorCode } from '../core/errors';
import { compactJson, jsonlLine, manifestJson } from '../core/json';
import { DIR_NAMES, LEGACY_DIR_NAMES } from '../core/model/dirs';
import { parseJsonl, type Parsed } from '../core/model/parse';
import { classifyPath, type PathKind } from '../core/model/paths';
import { isUlid, type ClassId, type ClassPath, type Hex64, type Ulid } from '../core/model/ids';
import { sha256Hex } from '../core/util/sha256';
import type { ClassEntry, ClassFileEntry, FileStamp } from '../platform/types';
import type { AppContext } from './context';
import { Store } from './store';
import type {
  ChangeKind, ClassIndex, ClassStore, ClassStoreState, IndexedItem, Loaded, LoadedLines, TrustGate, TrustVerdict,
} from './types/common';

export const CHANGE_KINDS: readonly ChangeKind[] = [
  'classFile', 'meta', 'members', 'presence', 'consent', 'chat', 'annotations', 'claims', 'edits', 'markers', 'examEdits',
  'answers', 'mod', 'bans', 'lecture', 'transcript', 'audio', 'exam', 'document', 'note', 'conflict',
];

type Dirs = { lectures: string; documents: string; exams: string; notes: string; fromChat: string };

const PATH_TO_KIND: Partial<Record<PathKind, ChangeKind>> = {
  classFile: 'classFile', meta: 'meta', members: 'members', presence: 'presence', consent: 'consent', chat: 'chat',
  annotations: 'annotations', claims: 'claims', edits: 'edits', markers: 'markers', examEdits: 'examEdits', answers: 'answers',
  mod: 'mod', bans: 'bans', lectureManifest: 'lecture', transcriptJson: 'transcript', transcriptMd: 'transcript',
  transcriptVtt: 'transcript', audio: 'audio', examManifest: 'exam', conflictCopy: 'conflict',
};

const TRUSTED: TrustVerdict = { kind: 'trusted' };
const DEFAULT_GATE: TrustGate = { verify: async () => TRUSTED, noteOwnWrite: () => undefined };
const NOTES_NAMES = new Set([...Object.values(DIR_NAMES).map((d) => d.notes), ...(LEGACY_DIR_NAMES.notes ?? [])]);
const COALESCE_MS = 500;
const SAFETY_PASS_MS = 10 * 60_000;

const zeroKinds = (): Record<ChangeKind, number> => Object.fromEntries(CHANGE_KINDS.map((k) => [k, 0])) as Record<ChangeKind, number>;
const emptyIndex = (): ClassIndex => ({ lectures: new Map(), exams: new Map(), documents: [], notes: [], machine: new Map(), conflicts: [], duplicates: [] });
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** The kind of change a class path stands for, given the notes directory (null = nothing to report). */
export function changeKindOf(path: ClassPath, isNote: (p: ClassPath) => boolean): ChangeKind | null {
  const info = classifyPath(path);
  if (info.kind === 'content') return isNote(path) ? 'note' : 'document';
  return PATH_TO_KIND[info.kind] ?? null;
}

export interface ClassStoreImpl extends ClassStore {
  /** Routes `class:changed` / `remoteChange` paths into the store (services/index.ts, architecture §12). */
  ingest(paths: ClassPath[], opts: { selfWrite: boolean; rescan: boolean }): void;
  /** Resolves when no load is running or queued (tests). */
  idle(): Promise<void>;
  /** Replaces the registry entry after the library reloaded it (shared, archived, leaving…; G1, services/index.ts). */
  setEntry(entry: ClassEntry): void;
}

export function createClassStore(ctx: AppContext, entry: ClassEntry): ClassStoreImpl {
  const { platform, clock } = ctx;
  const classId: ClassId = entry.classId;
  const state = new Store<ClassStoreState>({ classId, entry, status: 'loading', error: null, index: emptyIndex(), revision: 0, kinds: zeroKinds() });
  const listeners = new Set<{ kinds: Set<ChangeKind>; cb: (paths: ClassPath[]) => void }>();
  let gate: TrustGate = DEFAULT_GATE;
  let dirs: Dirs | null = null;
  const ownWrites = new Map<ClassPath, { size: number; mtimeMs: number }>();
  const lastTrusted = new Map<ClassPath, Loaded<unknown>>();
  let running: Promise<void> | null = null;
  let queued: { paths: Set<ClassPath>; rescan: boolean } | null = null;
  let timer: (() => void) | null = null;
  let safety: (() => void) | null = null;
  let stopped = false;

  const isNote = (p: ClassPath) => {
    if (!p.toLowerCase().endsWith('.md')) return false;
    const top = p.split('/')[0]!;
    return dirs ? top === dirs.notes : NOTES_NAMES.has(top);
  };

  function emit(byKind: Map<ChangeKind, ClassPath[]>) {
    if (byKind.size === 0) return;
    const cur = state.get();
    const kinds = { ...cur.kinds };
    for (const k of byKind.keys()) kinds[k] += 1;
    state.set({ ...cur, kinds, revision: cur.revision + 1 });
    for (const l of [...listeners]) {
      const paths = [...byKind].filter(([k]) => l.kinds.has(k)).flatMap(([, ps]) => ps);
      if (paths.length) {
        try {
          l.cb([...new Set(paths)]);
        } catch (e) {
          ctx.log('error', 'ClassStore listener failed', { error: String(e) });
        }
      }
    }
  }

  async function readManifestId(path: ClassPath): Promise<Ulid | null> {
    try {
      const raw = JSON.parse(new TextDecoder().decode(await platform.fs.read(classId, path))) as { id?: unknown };
      return isUlid(raw.id) ? raw.id : null;
    } catch {
      return null;
    }
  }

  /** Folder spec §5.3 over the two listings of architecture §12 rule 4. */
  async function discover(): Promise<ClassIndex> {
    const content = await platform.fs.list(classId, '', { recursive: true, maxDepth: 6 });
    let machineList: ClassFileEntry[] = [];
    try {
      machineList = await platform.fs.list(classId, '.tramado', { recursive: true, maxDepth: 6, includeTramado: true });
    } catch (e) {
      if (toPlatformError(e).code !== 'NOT_FOUND') throw e;
    }
    const filesByDir = new Map<string, ClassFileEntry[]>();
    for (const f of content) {
      if (f.isDir) continue;
      const d = dirOf(f.path);
      if (!filesByDir.has(d)) filesByDir.set(d, []);
      filesByDir.get(d)!.push(f);
    }
    const lectureDirs = new Map<string, ClassFileEntry>();
    const examDirs = new Map<string, ClassFileEntry>();
    const pendingDirs = new Set<string>();
    for (const [d, fs] of filesByDir) {
      const names = new Set(fs.map((f) => f.name));
      const lec = fs.find((f) => f.name === 'lecture.json');
      const exam = fs.find((f) => f.name === 'exam.json');
      if (lec) lectureDirs.set(d, lec);
      else if (exam) examDirs.set(d, exam);
      else if (['audio.webm', 'transcript.json', 'transcript.md', 'transcript.vtt'].some((n) => names.has(n))) pendingDirs.add(d);
    }
    // "Do not descend further": anything below a lecture, exam or pending directory is not discovered.
    const stops = [...lectureDirs.keys(), ...examDirs.keys(), ...pendingDirs].filter((d) => d !== '');
    const below = (p: string) => stops.some((d) => p.startsWith(`${d}/`) && dirOf(p) !== d);

    const pick = async (dirsMap: Map<string, ClassFileEntry>) => {
      const byId = new Map<Ulid, IndexedItem[]>();
      for (const [d, m] of dirsMap) {
        if (below(m.path)) continue;
        const id = await readManifestId(m.path);
        if (!id) continue;
        const item: IndexedItem = { id, dir: d, manifest: m.path, size: m.size, mtimeMs: m.mtimeMs };
        byId.set(id, [...(byId.get(id) ?? []), item]);
      }
      const chosen = new Map<Ulid, IndexedItem>();
      const dups: Array<{ id: Ulid; paths: ClassPath[] }> = [];
      for (const [id, items] of byId) {
        items.sort((a, b) => a.manifest.length - b.manifest.length || (a.manifest < b.manifest ? -1 : 1));
        chosen.set(id, items[0]!);
        if (items.length > 1) dups.push({ id, paths: items.map((i) => i.manifest) });
      }
      return { chosen, dups };
    };
    const lectures = await pick(lectureDirs);
    const exams = await pick(examDirs);
    const lectureOfDir = new Map([...lectures.chosen.values()].map((i) => [i.dir, i.id]));
    const examOfDir = new Map([...exams.chosen.values()].map((i) => [i.dir, i.id]));

    const documents: Array<ClassFileEntry & { lectureId?: Ulid; examId?: Ulid }> = [];
    const notes: ClassFileEntry[] = [];
    const conflicts: Array<{ path: ClassPath; of: ClassPath }> = [];
    for (const f of content) {
      if (f.isDir || below(f.path)) continue;
      const d = dirOf(f.path);
      if (pendingDirs.has(d)) continue;
      const info = classifyPath(f.path);
      if (info.kind === 'conflictCopy') {
        conflicts.push({ path: f.path, of: info.conflictOf! });
        continue;
      }
      if (info.kind === 'skipped' || info.kind === 'tramadoOther') continue;
      const lectureId = lectureOfDir.get(d);
      const examId = examOfDir.get(d);
      if (lectureId && info.kind !== 'content') continue;          // the lecture's own manifest, audio and transcripts
      if (examId && info.kind === 'examManifest') continue;
      if (lectureDirs.has(d) && !lectureId) continue;              // an unreadable lecture manifest: hide its folder
      if (examDirs.has(d) && !examId) continue;
      if (info.kind !== 'content') continue;
      if (!lectureId && !examId && isNote(f.path)) notes.push(f);
      else documents.push({ ...f, ...(lectureId ? { lectureId } : {}), ...(examId ? { examId } : {}) });
    }
    const machine = new Map<ClassPath, ClassFileEntry>();
    for (const f of machineList) if (!f.isDir) machine.set(f.path, f);
    return {
      lectures: lectures.chosen, exams: exams.chosen, documents, notes, machine, conflicts,
      duplicates: [...lectures.dups, ...exams.dups],
    };
  }

  function diffKinds(prev: ClassIndex, next: ClassIndex): Map<ChangeKind, ClassPath[]> {
    const out = new Map<ChangeKind, ClassPath[]>();
    const add = (k: ChangeKind, p: ClassPath) => out.set(k, [...(out.get(k) ?? []), p]);
    const cmpEntries = (a: readonly ClassFileEntry[], b: readonly ClassFileEntry[], k: ChangeKind) => {
      const am = new Map(a.map((e) => [e.path, e]));
      const bm = new Map(b.map((e) => [e.path, e]));
      for (const [p, e] of bm) { const o = am.get(p); if (!o || o.size !== e.size || o.mtimeMs !== e.mtimeMs) add(k, p); }
      for (const p of am.keys()) if (!bm.has(p)) add(k, p);
    };
    cmpEntries(prev.documents, next.documents, 'document');
    cmpEntries(prev.notes, next.notes, 'note');
    const items = (a: ReadonlyMap<Ulid, IndexedItem>, b: ReadonlyMap<Ulid, IndexedItem>, k: ChangeKind) => {
      for (const [id, e] of b) { const o = a.get(id); if (!o || o.manifest !== e.manifest || o.size !== e.size || o.mtimeMs !== e.mtimeMs) add(k, e.manifest); }
      for (const [id, e] of a) if (!b.has(id)) add(k, e.manifest);
    };
    items(prev.lectures, next.lectures, 'lecture');
    items(prev.exams, next.exams, 'exam');
    for (const [p, e] of next.machine) {
      const o = prev.machine.get(p);
      if (!o || o.size !== e.size || o.mtimeMs !== e.mtimeMs) { const k = changeKindOf(p, isNote); if (k) add(k, p); }
    }
    for (const p of prev.machine.keys()) if (!next.machine.has(p)) { const k = changeKindOf(p, isNote); if (k) add(k, p); }
    const pc = new Set(prev.conflicts.map((c) => c.path));
    const nc = new Set(next.conflicts.map((c) => c.path));
    for (const p of nc) if (!pc.has(p)) add('conflict', p);
    for (const p of pc) if (!nc.has(p)) add('conflict', p);
    return out;
  }

  async function load(paths: Set<ClassPath>, rescan: boolean): Promise<void> {
    if (stopped) return;
    const cur = state.get();
    try {
      const marker = await platform.fs.stat(classId, '.tramado/class.json').catch(() => null);
      const next = await discover();
      const changed = diffKinds(cur.index, next);
      // Paths reported but unchanged in listing terms (same size and mtime) still count when the event
      // carried them explicitly (an in-place rewrite within one mtime tick, transcripts, audio).
      if (!rescan) for (const p of paths) {
        const k = changeKindOf(p, isNote);
        if (k && !(changed.get(k) ?? []).includes(p)) changed.set(k, [...(changed.get(k) ?? []), p]);
      }
      state.set({ ...state.get(), index: next, status: marker ? 'ready' : 'missing', error: null });
      emit(changed);
    } catch (e) {
      const code: ErrorCode = toPlatformError(e).code;
      state.set({ ...state.get(), status: code === 'NOT_FOUND' ? 'missing' : 'error', error: code });
    }
  }

  function pump() {
    if (running || !queued || stopped) return;
    const job = queued;
    queued = null;
    running = load(job.paths, job.rescan).finally(() => {
      running = null;
      if (queued) schedule(0);
    });
  }
  function schedule(ms: number) {
    if (timer) return;
    timer = clock.setTimeout(() => {
      timer = null;
      pump();
    }, ms);
  }
  function request(paths: ClassPath[], rescan: boolean, ms = COALESCE_MS) {
    if (!queued) queued = { paths: new Set(), rescan: false };
    for (const p of paths) queued.paths.add(p);
    queued.rescan ||= rescan;
    schedule(ms);
  }

  async function afterOwnWrite(path: ClassPath, stamp: FileStamp, bytes: Uint8Array) {
    ownWrites.set(path, { size: stamp.size, mtimeMs: stamp.mtimeMs });
    gate.noteOwnWrite(path, bytes);
    request([path], false, 0);
  }

  const store: ClassStoreImpl = {
    state,
    async start() {
      stopped = false;
      const first = load(new Set(), true).finally(() => {
        if (running === first) running = null;
      });
      running = first;
      await first;
      const pass = () => {
        safety = clock.setTimeout(() => {
          request([], true, 0);
          pass();
        }, SAFETY_PASS_MS);
      };
      pass();
    },
    stop() {
      stopped = true;
      timer?.();
      timer = null;
      safety?.();
      safety = null;
    },
    setTrustGate(g) {
      gate = g;
    },
    setEntry(e) {
      const cur = state.get();
      if (e.classId === classId && JSON.stringify(e) !== JSON.stringify(cur.entry)) state.set({ ...cur, entry: e });
    },
    setDirs(d) {
      dirs = { ...d };
      request([], true, 0);
    },
    dir(key) {
      return (dirs ?? DIR_NAMES.en)[key];
    },
    onChange(kinds, cb) {
      const l = { kinds: new Set(kinds), cb };
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    async readBytes(path) {
      try {
        return await platform.fs.read(classId, path);
      } catch (e) {
        if (toPlatformError(e).code === 'NOT_FOUND') return null;
        throw e;
      }
    },
    async readJson<T>(path: ClassPath, parse: (raw: unknown) => Parsed<T>): Promise<Loaded<T> | null> {
      const bytes = await store.readBytes(path);
      if (!bytes) return null;
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        raw = undefined;
      }
      const parsed = raw === undefined ? null : parse(raw);
      const verdict = await gate.verify(path, bytes, parsed?.ok ? parsed.value : null);
      if (!parsed?.ok || parsed.value === null) return null;
      const stat = await platform.fs.stat(classId, path).catch(() => null);
      const loaded: Loaded<T> = { value: parsed.value, verdict, newer: parsed.newer, sha256: sha256Hex(bytes), size: bytes.length, mtimeMs: stat?.mtimeMs ?? 0 };
      if (verdict.kind === 'trusted' || verdict.kind === 'unverified') {
        lastTrusted.set(path, loaded as Loaded<unknown>);
        return loaded;
      }
      // Untrusted or pending: keep showing the last trusted version (architecture §12 rule 1).
      return (lastTrusted.get(path) as Loaded<T> | undefined) ?? null;
    },
    async readJsonl<T>(path: ClassPath, parse: (raw: unknown) => Parsed<T>, from?: { offset: number; prefixSha256: Hex64 }): Promise<LoadedLines<T>> {
      const bytes = (await store.readBytes(path)) ?? new Uint8Array();
      const verdict = await gate.verify(path, bytes, null);
      if (verdict.kind === 'untrusted') return { lines: [], consumed: from?.offset ?? 0, verdict, skipped: 0, newer: 0 };
      const limit = verdict.kind === 'prefix' ? Math.min(verdict.length, bytes.length) : bytes.length;
      const view = bytes.subarray(0, limit);
      let start = 0;
      if (from && from.offset <= view.length && sha256Hex(view.subarray(0, from.offset)) === from.prefixSha256) start = from.offset;
      const { lines, consumed } = parseJsonl(view, start);
      const out: Array<{ value: T; offset: number }> = [];
      let skipped = 0;
      let newer = 0;
      for (const l of lines) {
        if (l.error) {
          skipped++;
          continue;
        }
        const p = parse(l.value);
        if (!p.ok || p.value === null) skipped++;
        else if (p.newer) newer++;
        else out.push({ value: p.value, offset: l.offset });
      }
      return { lines: out, consumed, verdict, skipped, newer };
    },
    async writeJson(path, value, opts) {
      const text = opts.manifest ? manifestJson(value) : compactJson(value);
      const bytes = new TextEncoder().encode(text);
      const stamp = await platform.fs.write(classId, path, bytes, { own: opts.own });
      await afterOwnWrite(path, stamp, bytes);
      return stamp;
    },
    async writeText(path, text, opts) {
      const bytes = new TextEncoder().encode(text);
      const stamp = await platform.fs.write(classId, path, bytes, { own: opts.own });
      await afterOwnWrite(path, stamp, bytes);
      return stamp;
    },
    async writeBytes(path, bytes, opts) {
      const stamp = await platform.fs.write(classId, path, bytes, { own: opts.own });
      await afterOwnWrite(path, stamp, bytes);
      return stamp;
    },
    async appendLine(path, value) {
      const line = new TextEncoder().encode(jsonlLine(value));
      const stamp = await platform.fs.append(classId, path, line, { own: true });
      ownWrites.set(path, { size: stamp.size, mtimeMs: stamp.mtimeMs });
      request([path], false, 0);
      return stamp;
    },
    async remove(path, opts) {
      await platform.fs.remove(classId, path, opts);
      ownWrites.delete(path);
      lastTrusted.delete(path);
      request([path], false, 0);
    },
    async move(from, to) {
      await platform.fs.move(classId, from, to);
      request([from, to], false, 0);
    },
    async mkdir(path) {
      await platform.fs.mkdir(classId, path);
    },
    ingest(paths, opts) {
      if (stopped) return;
      if (opts.rescan) return request([], true);
      if (!opts.selfWrite) return request(paths, false);
      // An own write's echo: drop the paths whose size and mtime match what we wrote.
      void Promise.all(
        paths.map(async (p) => {
          const own = ownWrites.get(p);
          if (!own) return p;
          const s = await platform.fs.stat(classId, p).catch(() => null);
          return s && s.size === own.size && s.mtimeMs === own.mtimeMs ? null : p;
        }),
      ).then((left) => {
        const rest = left.filter((p): p is ClassPath => p !== null);
        if (rest.length) request(rest, false);
      });
    },
    async idle() {
      for (let i = 0; i < 50; i++) {
        if (timer && !running) {
          timer();
          timer = null;
          pump();
        }
        if (running) await running;
        else if (!queued) return;
        else pump();
        await Promise.resolve();
      }
    },
  };
  return store;
}

export { nameOf as baseNameOf };
