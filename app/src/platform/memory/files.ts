// The memory file system of every registered class: the same path rules as Rust (core/model/paths.ts,
// test-vectors/class-paths.json), atomic semantics, the append line rules, and `onClassChanged` with
// `selfWrite: true` after every write (architecture §10).
import { PlatformError } from '../../core/errors';
import { isSkippedName, parseConflictName, validateClassPath } from '../../core/model/paths';
import { sha256Hex } from '../../core/util/sha256';
import type { ClassId, ClassPath, ShortId } from '../../core/model/ids';
import type { ClassFileEntry, FileStamp } from '../types';
import type { MemoryEvents } from './events';

export interface MemFile { bytes: Uint8Array; mtimeMs: number; modifiedBy: ShortId }
export type WriteKind = 'write' | 'append' | 'remove' | 'move';
export type WriteHook = (classId: ClassId, path: ClassPath, bytes: Uint8Array | null, kind: WriteKind, from?: ClassPath) => void;

export interface ClassFiles {
  files: Map<ClassPath, MemFile>;
  dirs: Set<ClassPath>;
}

export function createFileStore(deps: { now: () => number; me: () => ShortId; events: MemoryEvents; exists: (classId: ClassId) => boolean }) {
  const classes = new Map<ClassId, ClassFiles>();
  const hooks = new Set<WriteHook>();

  const of = (classId: ClassId): ClassFiles => {
    if (!deps.exists(classId)) throw new PlatformError('NOT_FOUND', `class ${classId} is not registered`);
    let c = classes.get(classId);
    if (!c) {
      c = { files: new Map(), dirs: new Set() };
      classes.set(classId, c);
    }
    return c;
  };
  const path = (p: string) => validateClassPath(p);
  /** Remote writes and the demo hook may create names Tramado itself never writes (*.tmp, .st*): only the structure is checked. */
  const loosePath = (p: string) => {
    const n = p.normalize('NFC');
    if (!n || n.startsWith('/') || n.includes('\\') || n.includes('\u0000') || n.split('/').some((s) => s === '' || s === '.' || s === '..')) {
      throw new PlatformError('INVALID', `invalid class path: ${JSON.stringify(p)}`);
    }
    return n;
  };
  const addDirs = (c: ClassFiles, p: ClassPath) => {
    const segs = p.split('/');
    for (let i = 1; i < segs.length; i++) c.dirs.add(segs.slice(0, i).join('/'));
  };
  const changed = (classId: ClassId, paths: ClassPath[], selfWrite: boolean) =>
    deps.events.emitters.classChanged.emit({ classId, paths, selfWrite, rescan: false });
  const fire = (classId: ClassId, p: ClassPath, bytes: Uint8Array | null, kind: WriteKind, from?: ClassPath) => {
    for (const h of [...hooks]) h(classId, p, bytes, kind, from);
  };
  const stamp = (p: ClassPath, f: MemFile, withHash: boolean): FileStamp => ({
    path: p, size: f.bytes.length, mtimeMs: f.mtimeMs, sha256: withHash ? sha256Hex(f.bytes) : null,
  });
  const entry = (p: ClassPath, f: MemFile | null): ClassFileEntry => {
    const name = p.slice(p.lastIndexOf('/') + 1);
    const conflict = f ? parseConflictName(name) : null;
    return {
      path: p, name, isDir: f === null, size: f ? f.bytes.length : 0, mtimeMs: f ? f.mtimeMs : 0,
      conflictOf: conflict ? (p.includes('/') ? `${p.slice(0, p.lastIndexOf('/'))}/${conflict.original}` : conflict.original) : null,
    };
  };

  return {
    classes,
    onWrite(cb: WriteHook) {
      hooks.add(cb);
      return () => {
        hooks.delete(cb);
      };
    },
    drop(classId: ClassId) {
      classes.delete(classId);
    },
    raw: (classId: ClassId) => of(classId),

    /** As Syncthing would write: no onWrite echo; class:changed with selfWrite false. */
    applyRemote(classId: ClassId, p: ClassPath, bytes: Uint8Array | null, meta: { modifiedBy: ShortId; mtimeMs: number }) {
      const c = of(classId);
      const vp = loosePath(p);
      if (bytes === null) c.files.delete(vp);
      else {
        c.files.set(vp, { bytes: bytes.slice(), mtimeMs: meta.mtimeMs, modifiedBy: meta.modifiedBy });
        addDirs(c, vp);
      }
      changed(classId, [vp], false);
    },
    /** Demo hook: a file appears as if a person copied it in (no echo suppression). */
    addFile(classId: ClassId, p: ClassPath, bytes: Uint8Array) {
      const c = of(classId);
      const vp = loosePath(p);
      c.files.set(vp, { bytes: bytes.slice(), mtimeMs: deps.now(), modifiedBy: deps.me() });
      addDirs(c, vp);
      changed(classId, [vp], false);
    },

    async list(classId: ClassId, dir: ClassPath | '', opts: { recursive: boolean; maxDepth?: number; includeTramado?: boolean }): Promise<ClassFileEntry[]> {
      const c = of(classId);
      const base = dir === '' ? '' : path(dir);
      if (base && !c.dirs.has(base) && !c.files.has(base)) throw new PlatformError('NOT_FOUND', `no directory ${base}`);
      const maxDepth = Math.min(opts.recursive ? (opts.maxDepth ?? 16) : 1, 16);
      const prefix = base ? `${base}/` : '';
      const out = new Map<ClassPath, ClassFileEntry>();
      const consider = (p: ClassPath, f: MemFile | null) => {
        if (!p.startsWith(prefix)) return;
        const rel = p.slice(prefix.length).split('/');
        if (rel.length > maxDepth) return;
        const full = p.split('/');
        for (let i = 0; i < full.length; i++) {
          const s = full[i]!;
          if (s === '.tramado' && i === 0) {
            if (!opts.includeTramado) return;
            if (full[1] === 'tmp') return;
            continue;
          }
          if (isSkippedName(s)) return;
          if (s.startsWith('.') && !(opts.includeTramado && full[0] === '.tramado')) return;
        }
        out.set(p, entry(p, f));
      };
      for (const d of c.dirs) consider(d, null);
      for (const [p, f] of c.files) consider(p, f);
      if (out.size > 50_000) throw new PlatformError('INVALID', 'too many entries');
      return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    async stat(classId: ClassId, p: ClassPath): Promise<ClassFileEntry | null> {
      const c = of(classId);
      const vp = path(p);
      const f = c.files.get(vp);
      if (f) return entry(vp, f);
      return c.dirs.has(vp) ? entry(vp, null) : null;
    },
    async read(classId: ClassId, p: ClassPath): Promise<Uint8Array> {
      const f = of(classId).files.get(path(p));
      if (!f) throw new PlatformError('NOT_FOUND', `no file ${p}`);
      return f.bytes.slice();
    },
    async readRange(classId: ClassId, p: ClassPath, offset: number, length: number): Promise<Uint8Array> {
      const f = of(classId).files.get(path(p));
      if (!f) throw new PlatformError('NOT_FOUND', `no file ${p}`);
      return f.bytes.slice(offset, offset + length);
    },
    async write(classId: ClassId, p: ClassPath, bytes: Uint8Array, _opts: { own: boolean }): Promise<FileStamp> {
      const c = of(classId);
      const vp = path(p);
      if (c.dirs.has(vp)) throw new PlatformError('CONFLICT', `${vp} is a directory`);
      const f: MemFile = { bytes: bytes.slice(), mtimeMs: deps.now(), modifiedBy: deps.me() };
      c.files.set(vp, f);
      addDirs(c, vp);
      fire(classId, vp, f.bytes, 'write');
      changed(classId, [vp], true);
      return stamp(vp, f, true);
    },
    async append(classId: ClassId, p: ClassPath, line: Uint8Array, _opts: { own: boolean }): Promise<FileStamp> {
      const c = of(classId);
      const vp = path(p);
      const nl = line.indexOf(0x0a);
      if (line.length === 0 || nl !== line.length - 1) throw new PlatformError('INVALID', 'a line must end in one \\n and contain no other');
      if (line.length > 65_536) throw new PlatformError('INVALID', 'line longer than 65 536 bytes');
      const prev = c.files.get(vp)?.bytes ?? new Uint8Array();
      const next = new Uint8Array(prev.length + line.length);
      next.set(prev);
      next.set(line, prev.length);
      const f: MemFile = { bytes: next, mtimeMs: deps.now(), modifiedBy: deps.me() };
      c.files.set(vp, f);
      addDirs(c, vp);
      fire(classId, vp, line.slice(), 'append');
      changed(classId, [vp], true);
      return stamp(vp, f, false);
    },
    async mkdir(classId: ClassId, p: ClassPath): Promise<void> {
      const c = of(classId);
      const vp = path(p);
      if (c.files.has(vp)) throw new PlatformError('CONFLICT', `${vp} is a file`);
      c.dirs.add(vp);
      addDirs(c, vp);
    },
    async move(classId: ClassId, from: ClassPath, to: ClassPath): Promise<void> {
      const c = of(classId);
      const a = path(from);
      const b = path(to);
      if (c.files.has(b) || c.dirs.has(b)) throw new PlatformError('CONFLICT', `${b} exists`, { path: b });
      const moved: ClassPath[] = [];
      if (c.files.has(a)) {
        c.files.set(b, { ...c.files.get(a)!, modifiedBy: deps.me() });
        c.files.delete(a);
        moved.push(a, b);
        fire(classId, b, c.files.get(b)!.bytes, 'move', a);
      } else if (c.dirs.has(a)) {
        for (const [p, f] of [...c.files]) if (p.startsWith(`${a}/`)) {
          const np = b + p.slice(a.length);
          c.files.set(np, f);
          c.files.delete(p);
          moved.push(p, np);
          fire(classId, np, f.bytes, 'move', p);
        }
        for (const d of [...c.dirs]) if (d === a || d.startsWith(`${a}/`)) {
          c.dirs.delete(d);
          c.dirs.add(b + d.slice(a.length));
        }
      } else throw new PlatformError('NOT_FOUND', `no ${a}`);
      addDirs(c, b);
      changed(classId, moved.length ? moved : [a, b], true);
    },
    async remove(classId: ClassId, p: ClassPath, opts?: { recursive?: boolean }): Promise<void> {
      const c = of(classId);
      const vp = path(p);
      if (c.files.delete(vp)) {
        fire(classId, vp, null, 'remove');
        changed(classId, [vp], true);
        return;
      }
      if (!c.dirs.has(vp)) throw new PlatformError('NOT_FOUND', `no ${vp}`);
      const inside = [...c.files.keys()].filter((x) => x.startsWith(`${vp}/`));
      if (inside.length && !opts?.recursive) throw new PlatformError('CONFLICT', `${vp} is not empty`);
      for (const x of inside) {
        c.files.delete(x);
        fire(classId, x, null, 'remove');
      }
      for (const d of [...c.dirs]) if (d === vp || d.startsWith(`${vp}/`)) c.dirs.delete(d);
      changed(classId, inside.length ? inside : [vp], true);
    },
    async hash(classId: ClassId, p: ClassPath): Promise<string> {
      const f = of(classId).files.get(path(p));
      if (!f) throw new PlatformError('NOT_FOUND', `no file ${p}`);
      return sha256Hex(f.bytes);
    },
  };
}
export type FileStore = ReturnType<typeof createFileStore>;
