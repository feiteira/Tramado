// DocumentService (architecture §11.2; folder spec §5, §8.21, §9.1, §11.2; UX §3.7.1): the class's
// documents with their text state, imports (sanitised unique names, duplicates found by SHA-256
// before anything reaches the class), removal "for everyone" or "from this computer only"
// (a per-device ignore line first, then the local delete), rename and move.
//
// Imports are staged in `.tramado/tmp/<random>.part` (ignored by Syncthing, folder spec §4.4) and
// only moved into place when they are not duplicates, so a skipped duplicate never syncs.
import { PlatformError, toPlatformError, type ErrorCode } from '../core/errors';
import { TEXT_KINDS, docKindOf } from '../core/import/extract';
import type { ClassId, ClassPath, Hex64 } from '../core/model/ids';
import { classifyPath, dirOf, joinClassPath, validateClassPath } from '../core/model/paths';
import { fitClassPath, sanitize, unique } from '../core/model/sanitize';
import type { Picked } from '../platform/types';
import type { AppContext } from './context';
import { hashMemo } from './extraction';
import { Store } from './store';
import type { AppServices, ClassStore } from './types/common';
import type { DocSummary, DocumentService, RemovedDoc } from './types/documents';

/** Undo keeps the bytes of a deleted file up to this size (larger files rely on Syncthing's versions). */
const UNDO_MAX_BYTES = 64 * 1024 * 1024;

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const extOf = (n: string) => (n.lastIndexOf('.') > 0 ? n.slice(n.lastIndexOf('.')) : '');

export interface DocumentServiceImpl extends DocumentService {
  /** Resolves once the list reflects the store and every listed file has a hash (tests). */
  idle(): Promise<void>;
  dispose(): void;
}

export function createDocumentService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): DocumentServiceImpl {
  const { platform } = ctx;
  const { store, classId } = cls;
  const memo = hashMemo(ctx);
  const list = new Store<DocSummary[]>([]);
  const folders = new Store<ClassPath[]>([]);
  /** This device's local ignore lines (class paths): files kept private or removed from this computer only. */
  let ignores = new Set<ClassPath>();
  /** "Added by" per path (Syncthing's modifiedBy → member), filled after the list (UX §3.7.1). */
  const addedBy = new Map<ClassPath, { sig: string; who: { name: string; self: boolean } | null }>();
  let hashing: Promise<void> | null = null;
  let again = false;
  let started = false;
  const offs: Array<() => void> = [];

  const isNotePath = (p: ClassPath) => p.toLowerCase().endsWith('.md') && p.split('/')[0] === store.dir('notes');

  /** Builds the list from the store's index, the hash memo and the extraction status. */
  function compute(): DocSummary[] {
    const s = store.state.get();
    const status = app().extraction.status.get();
    const fromChatDir = joinClassPath(store.dir('documents'), store.dir('fromChat'));
    const entries: Array<{ path: ClassPath; size: number; mtimeMs: number; lectureId?: string; examId?: string; conflictOf: ClassPath | null }> = [
      ...s.index.documents.map((d) => ({ path: d.path, size: d.size, mtimeMs: d.mtimeMs, ...(d.lectureId ? { lectureId: d.lectureId } : {}), ...(d.examId ? { examId: d.examId } : {}), conflictOf: null })),
    ];
    // Conflict copies of documents are shown next to them; those of notes and machine files are not.
    for (const c of s.index.conflicts) {
      if (isNotePath(c.of) || classifyPath(c.of).kind !== 'content') continue;
      const doc = s.index.documents.find((d) => d.path === c.of);
      entries.push({ path: c.path, size: 0, mtimeMs: 0, ...(doc?.lectureId ? { lectureId: doc.lectureId } : {}), conflictOf: c.of });
    }
    const firstBySha = new Map<Hex64, { path: ClassPath; mtimeMs: number }>();
    const shaOf = new Map<ClassPath, Hex64 | null>();
    for (const e of entries) {
      const sha = memo.known(classId, e.path, e.size, e.mtimeMs);
      shaOf.set(e.path, sha);
      if (!sha || e.conflictOf) continue;
      const prev = firstBySha.get(sha);
      if (!prev || e.mtimeMs < prev.mtimeMs || (e.mtimeMs === prev.mtimeMs && e.path < prev.path)) firstBySha.set(sha, { path: e.path, mtimeMs: e.mtimeMs });
    }
    return entries.map((e) => {
      const kind = docKindOf(e.path);
      const sha = shaOf.get(e.path) ?? null;
      const state = !TEXT_KINDS.has(kind) ? 'unsupported' : sha ? (status.bySha[sha] ?? 'pending') : 'pending';
      const first = sha ? firstBySha.get(sha) : undefined;
      const who = addedBy.get(e.path);
      const localOnly = ignores.has(e.path);
      return {
        path: e.path, name: nameOf(e.path), dir: dirOf(e.path), size: e.size, mtimeMs: e.mtimeMs, sha256: sha, kind,
        extraction: state, pages: sha ? (status.pages?.[sha] ?? null) : null,
        ...(sha && state === 'ready' && (status.imagePages?.[sha] ?? 0) > 0 ? { imagePages: status.imagePages![sha]! } : {}),
        lectureId: e.lectureId ?? null, examId: e.examId ?? null, conflictOf: e.conflictOf,
        duplicateOf: first && first.path !== e.path ? first.path : null,
        fromChat: e.path.startsWith(`${fromChatDir}/`),
        ...(localOnly ? { localOnly: true } : {}),
        ...(localOnly ? { addedBy: { name: '', self: true } } : who && who.sig === `${e.size}:${e.mtimeMs}` ? { addedBy: who.who } : {}),
      };
    }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  const same = (a: DocSummary[], b: DocSummary[]) => a.length === b.length && a.every((x, i) => {
    const y = b[i]!;
    return x.path === y.path && x.size === y.size && x.mtimeMs === y.mtimeMs && x.sha256 === y.sha256 && x.extraction === y.extraction
      && x.pages === y.pages && x.duplicateOf === y.duplicateOf && x.conflictOf === y.conflictOf
      && !!x.localOnly === !!y.localOnly && JSON.stringify(x.addedBy) === JSON.stringify(y.addedBy) && x.imagePages === y.imagePages;
  });
  const refresh = () => {
    const next = compute();
    if (!same(next, list.get())) list.set(next);
  };

  /** Hashes every listed file not hashed yet (one at a time), then refreshes. */
  function hashAll(): Promise<void> {
    if (hashing) {
      again = true;
      return hashing;
    }
    hashing = (async () => {
      await memo.load(classId);
      refresh();
      const docs = store.state.get().index.documents;
      for (const d of docs) {
        if (memo.known(classId, d.path, d.size, d.mtimeMs)) continue;
        await memo.hash(classId, d.path).catch(() => null);
      }
      if (store.state.get().status === 'ready') memo.retain(classId, [...store.state.get().index.documents.map((d) => d.path), ...store.state.get().index.notes.map((n) => n.path)]);
      refresh();
      await whoAdded();
    })().finally(() => {
      hashing = null;
      if (again) {
        again = false;
        void hashAll();
      }
    });
    return hashing;
  }

  /** "Added by" for the listed files whose (size, mtime) changed since the last look (one fileInfo batch). */
  async function whoAdded(): Promise<void> {
    const shared = store.state.get().entry.shared;
    const want = store.state.get().index.documents.filter((d) => addedBy.get(d.path)?.sig !== `${d.size}:${d.mtimeMs}`);
    if (!want.length) return;
    const meName = () => ctx.identity.get()?.name ?? '';
    if (!shared) {
      // Nobody else has a local class: whatever is in it was added on this computer.
      for (const d of want) addedBy.set(d.path, { sig: `${d.size}:${d.mtimeMs}`, who: { name: meName(), self: true } });
      refresh();
      return;
    }
    let infos: Awaited<ReturnType<typeof platform.sync.fileInfo>> = [];
    try {
      infos = await platform.sync.fileInfo(classId, want.map((d) => d.path));
    } catch {
      infos = [];
    }
    const myShort = ctx.device.get()?.shortId ?? '';
    let people: Array<{ name: string; isMe: boolean; devices: Array<{ deviceId: string }> }> = [];
    try {
      people = app().forClass(classId).info.detail.get().people;
    } catch {
      people = [];
    }
    for (const d of want) {
      const by = infos.find((i) => i.path === d.path)?.localModifiedBy ?? null;
      let who: { name: string; self: boolean } | null = null;
      if (by && myShort && by === myShort) who = { name: meName(), self: true };
      else if (by) {
        const p = people.find((x) => x.devices.some((dev) => dev.deviceId.startsWith(by)));
        if (p) who = { name: p.name, self: p.isMe };
      }
      addedBy.set(d.path, { sig: `${d.size}:${d.mtimeMs}`, who });
    }
    refresh();
  }

  async function loadIgnores(): Promise<void> {
    const entry = (await platform.classes.list().catch(() => [])).find((e) => e.classId === classId);
    const next = new Set(entry?.localIgnores ?? store.state.get().entry.localIgnores ?? []);
    if (next.size !== ignores.size || [...next].some((p) => !ignores.has(p))) {
      ignores = next;
      refresh();
    }
  }
  async function setIgnores(f: (cur: ClassPath[]) => ClassPath[]): Promise<void> {
    const entry = (await platform.classes.list()).find((e) => e.classId === classId);
    if (!entry) throw new PlatformError('NOT_FOUND', `class ${classId}`);
    const next = f(entry.localIgnores);
    const updated = await platform.classes.update(classId, { localIgnores: next });
    ignores = new Set(updated.localIgnores);
  }

  /** Folders under the documents directory (also the empty ones the index does not show). */
  async function listFolders(): Promise<void> {
    const root = store.dir('documents');
    let dirs: ClassPath[] = [];
    try {
      dirs = (await platform.fs.list(classId, root, { recursive: true, maxDepth: 6 })).filter((f) => f.isDir && classifyPath(f.path).kind === 'content').map((f) => f.path);
    } catch {
      dirs = [];
    }
    // Directories that hold listed files (an index may know a file before a listing shows its folder).
    for (const d of store.state.get().index.documents) {
      let dir = dirOf(d.path);
      while (dir && dir !== root && dir.startsWith(`${root}/`)) {
        dirs.push(dir);
        dir = dirOf(dir);
      }
    }
    const next = [...new Set(dirs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const cur = folders.get();
    if (next.length !== cur.length || next.some((p, i) => p !== cur[i])) folders.set(next);
  }
  let foldersRunning: Promise<void> | null = null;
  let foldersAgain = false;
  function refreshFolders(): Promise<void> {
    if (foldersRunning) {
      foldersAgain = true;
      return foldersRunning;
    }
    foldersRunning = listFolders().finally(() => {
      foldersRunning = null;
      if (foldersAgain) {
        foldersAgain = false;
        void refreshFolders();
      }
    });
    return foldersRunning;
  }

  function start() {
    if (started) return;
    started = true;
    offs.push(store.state.subscribe(() => {
      refresh();
      void hashAll();
      void refreshFolders();
    }));
    offs.push(app().extraction.status.subscribe(refresh));
    try {
      offs.push(app().forClass(classId).info.detail.subscribe(() => {
        // Names of people bound later (a member file that arrived): look again at the unknown ones.
        let changed = false;
        for (const [p, v] of addedBy) if (v.who === null) {
          addedBy.delete(p);
          changed = true;
        }
        if (changed) void whoAdded();
      }));
    } catch {
      // no class service (tests that build only this service)
    }
    void loadIgnores();
    refresh();
    void hashAll();
    void refreshFolders();
    // The search service extracts and indexes the class's documents (text states follow).
    void app().search.ensure(classId).catch((e: unknown) => ctx.log('warn', 'documents: search index failed', { classId, error: String(e) }));
  }

  const lazyList = {
    get: () => {
      start();
      return list.get();
    },
    subscribe: (l: () => void) => {
      start();
      return list.subscribe(l);
    },
  };
  const lazyFolders = {
    get: () => {
      start();
      return folders.get();
    },
    subscribe: (l: () => void) => {
      start();
      return folders.subscribe(l);
    },
  };

  /** Names already used in a directory (NFC + case-folded by `unique`). */
  async function siblings(dir: ClassPath): Promise<string[]> {
    try {
      return (await platform.fs.list(classId, dir, { recursive: false })).map((e) => e.name);
    } catch (e) {
      if (toPlatformError(e).code === 'NOT_FOUND') return [];
      throw e;
    }
  }

  async function placeName(dir: ClassPath, wanted: string, taken: string[]): Promise<ClassPath> {
    const name = unique(taken, sanitize(wanted, 'Untitled'));
    const path = fitClassPath(dir, name);
    if (!path) throw new PlatformError('INVALID', `the path for ${name} is too long`);
    return validateClassPath(path);
  }

  const randomPart = () => Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(ctx.rand() * 36)]).join('');

  /** Class files that may be duplicates: content files (not machine files), oldest first. */
  async function contentFiles(): Promise<Array<{ path: ClassPath; size: number; mtimeMs: number }>> {
    const all = await platform.fs.list(classId, '', { recursive: true, maxDepth: 6 }).catch(() => []);
    return all.filter((f) => !f.isDir && classifyPath(f.path).kind === 'content')
      .map((f) => ({ path: f.path, size: f.size, mtimeMs: f.mtimeMs }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs || (a.path < b.path ? -1 : 1));
  }

  /** The file with this content among `files` (only same-size files are hashed). */
  async function duplicateOf(files: ReadonlyArray<{ path: ClassPath; size: number; mtimeMs: number }>, sha: Hex64, size: number): Promise<ClassPath | null> {
    for (const d of files) {
      if (d.size !== size) continue;
      const h = memo.known(classId, d.path, d.size, d.mtimeMs) ?? (await memo.hash(classId, d.path).catch(() => null));
      if (h === sha) return d.path;
    }
    return null;
  }

  const scan = async (path: ClassPath) => {
    if (!store.state.get().entry.shared) return;
    await platform.sync.scan(classId, dirOf(path) || undefined).catch(() => undefined);
  };

  const service: DocumentServiceImpl = {
    list: lazyList,
    folders: lazyFolders,
    async mkdir(name, parent) {
      const dir = parent ?? store.dir('documents');
      if (dir) validateClassPath(dir);
      const path = await placeName(dir, name, await siblings(dir));
      await platform.fs.mkdir(classId, path);
      await refreshFolders();
      return path;
    },
    async keepPrivate(path) {
      validateClassPath(path);
      const st = await platform.fs.stat(classId, path);
      if (!st || st.isDir) throw new PlatformError('NOT_FOUND', `no file ${path}`);
      if (store.state.get().entry.shared && !ignores.has(path)) {
        // Deleted for everyone first (the deletion must reach the index before the ignore line hides the path)…
        const bytes = await platform.fs.read(classId, path);
        await store.remove(path);
        await scan(path);
        // …then ignored here and written back: Syncthing never announces it again (folder spec §11.2).
        await setIgnores((cur) => (cur.includes(path) ? cur : [...cur, path]));
        await platform.fs.write(classId, path, bytes, { own: false });
      } else {
        await setIgnores((cur) => (cur.includes(path) ? cur : [...cur, path]));
      }
      refresh();
    },
    async share(path) {
      validateClassPath(path);
      await setIgnores((cur) => cur.filter((p) => p !== path));
      refresh();
      await scan(path);
    },
    async removeForUndo(path) {
      validateClassPath(path);
      const st = await platform.fs.stat(classId, path);
      if (!st) throw new PlatformError('NOT_FOUND', `no ${path}`);
      const bytes = !st.isDir && st.size <= UNDO_MAX_BYTES ? await platform.fs.read(classId, path).catch(() => null) : null;
      const at = ctx.clock.now();
      await service.remove(path, 'everyone');
      return { path, at, bytes };
    },
    async restore(removed: RemovedDoc) {
      const { path } = removed;
      if (await platform.fs.stat(classId, path).catch(() => null)) return;   // already back (a classmate restored it)
      if (store.state.get().entry.shared) {
        try {
          const versions = (await platform.sync.versions(classId)).filter((v) => v.path === path).sort((a, b) => (a.versionTime < b.versionTime ? 1 : -1));
          if (versions[0]) {
            await platform.sync.restore(classId, [{ path, versionTime: versions[0].versionTime }]);
            if (await platform.fs.stat(classId, path).catch(() => null)) return;
          }
        } catch {
          // no version kept on this computer: the bytes below
        }
      }
      if (!removed.bytes) throw new PlatformError('NOT_FOUND', `no copy of ${path} to restore`);
      const dir = dirOf(path);
      if (dir) await platform.fs.mkdir(classId, dir).catch(() => undefined);
      await platform.fs.write(classId, path, removed.bytes, { own: false });
      await scan(path);
    },
    async import(picks: Picked[], destDir?: ClassPath, opts: { allowDuplicate?: boolean } = {}) {
      const dir = destDir ?? store.dir('documents');
      if (dir) validateClassPath(dir);
      const taken = await siblings(dir);
      // The class as it is on disk now (the store's index may not show a file imported a moment ago).
      const existing = await contentFiles();
      const out: Array<{ name: string; path?: ClassPath; error?: ErrorCode; duplicateOf?: ClassPath }> = [];
      if (picks.length) await platform.fs.mkdir(classId, '.tramado/tmp').catch(() => undefined);
      for (const pick of picks) {
        if (pick.isDir) {
          out.push({ name: pick.name, error: 'INVALID' });
          continue;
        }
        const staged = `.tramado/tmp/${randomPart()}.part`;
        let stagedOk = false;
        try {
          const stamp = await platform.fs.importFile(classId, pick.token, staged);
          stagedOk = true;
          const sha = stamp.sha256 ?? (await platform.fs.hash(classId, staged));
          const dup = await duplicateOf(existing, sha, stamp.size);
          if (dup && !opts.allowDuplicate) {
            await platform.fs.remove(classId, staged);
            stagedOk = false;
            out.push({ name: pick.name, duplicateOf: dup });
            continue;
          }
          const path = await placeName(dir, pick.name, taken);
          if (dir) await platform.fs.mkdir(classId, dir).catch(() => undefined);
          await store.move(staged, path);
          stagedOk = false;
          taken.push(nameOf(path));
          const placed = await platform.fs.stat(classId, path).catch(() => null);
          if (placed) existing.push({ path, size: placed.size, mtimeMs: placed.mtimeMs });
          out.push({ name: pick.name, path, ...(dup ? { duplicateOf: dup } : {}) });
        } catch (e) {
          if (stagedOk) await platform.fs.remove(classId, staged).catch(() => undefined);
          out.push({ name: pick.name, error: toPlatformError(e).code });
        }
      }
      return out;
    },
    async remove(path, mode) {
      validateClassPath(path);
      if (mode === 'thisComputer') {
        // The ignore line first (folder spec §9.1, §11.2): the local delete must not propagate.
        const entry = (await platform.classes.list()).find((e) => e.classId === classId);
        if (!entry) throw new PlatformError('NOT_FOUND', `class ${classId}`);
        if (!entry.localIgnores.includes(path)) ignores = new Set((await platform.classes.update(classId, { localIgnores: [...entry.localIgnores, path] })).localIgnores);
      }
      const st = await platform.fs.stat(classId, path);
      if (!st) throw new PlatformError('NOT_FOUND', `no ${path}`);
      await store.remove(path, { recursive: st.isDir });
    },
    async rename(path, name) {
      validateClassPath(path);
      const dir = dirOf(path);
      const oldName = nameOf(path);
      let wanted = name.trim();
      // A name typed without its extension keeps the file's extension.
      if (extOf(oldName) && !extOf(wanted)) wanted += extOf(oldName);
      const sanitized = sanitize(wanted, oldName);
      if (sanitized === oldName) return path;
      const taken = (await siblings(dir)).filter((n) => n !== oldName);
      const target = await placeName(dir, sanitized, taken);
      await store.move(path, target);
      return target;
    },
    async move(path, destDir) {
      validateClassPath(path);
      if (destDir) validateClassPath(destDir);
      if (dirOf(path) === destDir) return path;
      if (destDir === path || destDir.startsWith(`${path}/`)) throw new PlatformError('INVALID', 'cannot move a folder into itself');
      const target = await placeName(destDir, nameOf(path), await siblings(destDir));
      if (destDir) await platform.fs.mkdir(classId, destDir).catch(() => undefined);
      await store.move(path, target);
      return target;
    },
    text: (path) => app().extraction.ensure(classId, path),
    url: (path) => platform.media.url({ kind: 'file', classId, path }),
    reveal: (path) => platform.classes.reveal(classId, path),
    open: (path) => platform.classes.open(classId, path),
    async idle() {
      start();
      for (let i = 0; i < 20 && (hashing || again || foldersRunning); i++) {
        await hashing;
        await foldersRunning;
      }
      await loadIgnores();
      refresh();
    },
    dispose() {
      for (const off of offs.splice(0)) off();
      started = false;
    },
  };
  return service;
}
