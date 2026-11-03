// Bindings of architecture §6.2 (commands/classes.rs): the registry and the confined class files.
import type { ClassId, ClassPath } from '../../core/model/ids';
import type { AdoptedClass, ClassEntry, ClassesRoot, ClassFileEntry, CreatedClass, FileStamp, Platform, PickToken } from '../types';
import { body, call, h, toBytes } from './index';

type Bin = ArrayBuffer | Uint8Array | number[];

export function createClassesBindings(): Platform['classes'] {
  return {
    list: () => call<ClassEntry[]>('classes_list'),
    root: () => call<ClassesRoot>('classes_root'),
    setRoot: (pick: PickToken) => call<ClassesRoot>('classes_set_root', { pick }),
    create: (req) => call<CreatedClass>('class_create', { req }),
    adopt: (pick: PickToken) => call<AdoptedClass>('class_adopt', { pick }),
    fork: (classId: ClassId, newClassId: ClassId) => call<ClassEntry>('class_fork', { classId, newClassId }),
    update: (classId: ClassId, patch) => call<ClassEntry>('class_update', { classId, patch }),
    forget: (classId: ClassId) => call<void>('class_forget', { classId }),
    trash: (classId: ClassId) => call<void>('class_trash', { classId }),
    emptyTrash: (classId: ClassId) => call<void>('class_trash_empty', { classId }),
    reveal: (classId: ClassId, path?: ClassPath) => call<void>('class_reveal', { classId, ...(path !== undefined ? { path } : {}) }),
    open: (classId: ClassId, path: ClassPath) => call<void>('class_open', { classId, path }),
  };
}

export function createFsBindings(): Platform['fs'] {
  const own = (o: { own: boolean }) => (o.own ? '1' : '0');
  return {
    list: (classId, dir, opts) => call<ClassFileEntry[]>('class_list', { classId, dir, opts }),
    stat: (classId, path) => call<ClassFileEntry | null>('class_stat', { classId, path }),
    read: async (classId, path) => toBytes(await call<Bin>('class_read', { classId, path })),
    readRange: async (classId, path, offset, length) => toBytes(await call<Bin>('class_read_range', { classId, path, offset, length })),
    write: (classId, path, bytes, opts) => call<FileStamp>('class_write', body(bytes), { 'x-class': h(classId), 'x-path': h(path), 'x-own': own(opts) }),
    append: (classId, path, line, opts) => call<FileStamp>('class_append', body(line), { 'x-class': h(classId), 'x-path': h(path), 'x-own': own(opts) }),
    mkdir: (classId, path) => call<void>('class_mkdir', { classId, path }),
    move: (classId, from, to) => call<void>('class_move', { classId, from, to }),
    remove: (classId, path, opts) => call<void>('class_remove', { classId, path, recursive: opts?.recursive ?? false }),
    hash: (classId, path) => call<string>('class_hash', { classId, path }),
    importFile: (classId, pick, dest) => call<FileStamp>('class_import', { classId, pick, dest }),
    exportFile: (classId, path, pick) => call<void>('class_export', { classId, path, pick }),
  };
}
