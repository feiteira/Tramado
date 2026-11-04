// The class registry (config/classes.json in Rust) of the memory platform.
import { PlatformError } from '../../core/errors';
import { isClassId, type ClassId, type ClassPath } from '../../core/model/ids';
import { instant } from '../../core/model/time';
import type { AdoptedClass, ClassEntry, ClassesRoot, CreatedClass, PickToken } from '../types';
import type { FileStore } from './files';
import type { MemoryDialogs } from './dialogs';

export function createClassRegistry(deps: { now: () => number; root: string; files: () => FileStore; dialogs: MemoryDialogs; onOpen?: (classId: ClassId, path?: ClassPath) => void }) {
  const entries = new Map<ClassId, Omit<ClassEntry, 'available'>>();
  let root = deps.root;

  const view = (e: Omit<ClassEntry, 'available'>): ClassEntry => {
    let available = false;
    try {
      available = deps.files().raw(e.classId).files.has('.tramado/class.json');
    } catch {
      available = false;
    }
    return { ...e, available };
  };
  const get = (classId: ClassId) => {
    const e = entries.get(classId) ?? [...entries.values()].find((x) => x.aliases.includes(classId));
    if (!e) throw new PlatformError('NOT_FOUND', `class ${classId} is not registered`);
    return e;
  };
  const names = () => [...entries.values()].map((e) => e.dirName);

  return {
    entries,
    has: (classId: ClassId) => entries.has(classId),
    get,
    /** Registers a class directly (seed and mesh helpers). */
    insert(e: Omit<ClassEntry, 'available'>) {
      entries.set(e.classId, e);
    },
    api: {
      async list(): Promise<ClassEntry[]> {
        return [...entries.values()].map(view);
      },
      async root(): Promise<ClassesRoot> {
        return { path: root, names: names() };
      },
      async setRoot(pick: PickToken): Promise<ClassesRoot> {
        const p = deps.dialogs.resolve(pick, 'folder');
        root = `/home/demo/${p.name}`;
        return { path: root, names: names() };
      },
      async create(req: { classId: ClassId; dirName: string; parent?: PickToken }): Promise<CreatedClass> {
        if (!isClassId(req.classId)) throw new PlatformError('INVALID', 'bad class id');
        if (entries.has(req.classId)) throw new PlatformError('CONFLICT', 'class already registered');
        if (names().some((n) => n.normalize('NFC').toLowerCase() === req.dirName.normalize('NFC').toLowerCase())) throw new PlatformError('CONFLICT', 'directory exists');
        const e = {
          classId: req.classId, path: `${root}/${req.dirName}`, dirName: req.dirName, shared: false, joining: false, archived: false,
          skipAudio: false, aliases: [], localIgnores: [], addedAt: instant(deps.now()), leaving: null,
        };
        entries.set(req.classId, e);
        await deps.files().mkdir(req.classId, '.tramado');
        return { entry: view(e), warnings: [] };
      },
      async adopt(pick: PickToken): Promise<AdoptedClass> {
        deps.dialogs.resolve(pick, 'folder');
        throw new PlatformError('NOT_FOUND', 'the chosen folder has no .tramado/class.json');
      },
      async fork(classId: ClassId, newClassId: ClassId): Promise<ClassEntry> {
        const e = get(classId);
        if (e.shared) throw new PlatformError('CONFLICT', 'still shared');
        const files = deps.files();
        const old = files.raw(classId);
        // As Rust (architecture §6.2): the forked class.json must already carry the new ID.
        const classFile = old.files.get('.tramado/class.json');
        let carried: unknown = null;
        try {
          carried = classFile ? (JSON.parse(new TextDecoder().decode(classFile.bytes)) as { classId?: unknown }).classId : null;
        } catch {
          carried = null;
        }
        if (carried !== newClassId) throw new PlatformError('CONFLICT', 'class.json does not carry the new class id');
        entries.delete(classId);
        const next = { ...e, classId: newClassId, aliases: [...e.aliases, classId] };
        entries.set(newClassId, next);
        const fresh = files.raw(newClassId);
        for (const [p, f] of old.files) fresh.files.set(p, f);
        for (const d of old.dirs) fresh.dirs.add(d);
        files.drop(classId);
        return view(next);
      },
      async update(classId: ClassId, patch: { archived?: boolean; skipAudio?: boolean; localIgnores?: ClassPath[] }): Promise<ClassEntry> {
        const e = get(classId);
        const next = { ...e, ...patch };
        entries.set(e.classId, next);
        return view(next);
      },
      async forget(classId: ClassId): Promise<void> {
        const e = get(classId);
        if (e.shared) throw new PlatformError('CONFLICT', 'leave the class first');
        entries.delete(e.classId);
      },
      async trash(classId: ClassId): Promise<void> {
        const e = get(classId);
        if (e.shared) throw new PlatformError('CONFLICT', 'leave the class first');
        entries.delete(e.classId);
        deps.files().drop(e.classId);
      },
      async emptyTrash(classId: ClassId): Promise<void> {
        get(classId);
      },
      async reveal(classId: ClassId, path?: ClassPath): Promise<void> {
        get(classId);
        deps.onOpen?.(classId, path);
      },
      async open(classId: ClassId, path: ClassPath): Promise<void> {
        get(classId);
        deps.onOpen?.(classId, path);
      },
    },
  };
}
export type MemoryClassRegistry = ReturnType<typeof createClassRegistry>;
