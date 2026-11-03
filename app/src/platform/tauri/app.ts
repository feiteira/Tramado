// Bindings of architecture §6.1 (commands/app.rs).
import type { ClassId } from '../../core/model/ids';
import type { AppFileName, AppInfo, CacheKey, PersonInfo, PersonProof, Platform, StorageUsage } from '../types';
import { body, call, h, toBytes } from './index';

type Bin = ArrayBuffer | Uint8Array | number[];

export function createAppBindings(): Pick<Platform, 'info' | 'log' | 'appFiles' | 'privateFiles' | 'cache' | 'person' | 'storage'> {
  return {
    info: () => call<AppInfo>('app_info'),
    log(level, message, data) {
      void call('app_log', { level, message, ...(data ? { data } : {}) }).catch(() => undefined);
    },
    appFiles: {
      read: (name: AppFileName) => call<string | null>('app_file_read', { name }),
      write: (name: AppFileName, text: string) => call<void>('app_file_write', { name, text }),
    },
    privateFiles: {
      read: async (classId: ClassId, path: string) => {
        const r = await call<Bin | null>('private_read', { classId, path });
        return r === null ? null : toBytes(r);
      },
      write: (classId: ClassId, path: string, bytes: Uint8Array) => call<void>('private_write', body(bytes), { 'x-class': h(classId), 'x-path': h(path) }),
      append: (classId: ClassId, path: string, line: Uint8Array) => call<number>('private_append', body(line), { 'x-class': h(classId), 'x-path': h(path) }),
      list: (classId: ClassId, dir: string) => call<string[]>('private_list', { classId, dir }),
      remove: (classId: ClassId, path: string, recursive = false) => call<void>('private_remove', { classId, path, recursive }),
      purge: (classId: ClassId) => call<void>('private_purge', { classId }),
    },
    cache: {
      read: async (key: CacheKey) => {
        const r = await call<Bin | null>('cache_read', { key });
        return r === null ? null : toBytes(r);
      },
      write: (key: CacheKey, bytes: Uint8Array) => call<void>('cache_write', body(bytes), { 'x-name': h(key) }),
      remove: (key: CacheKey) => call<void>('cache_remove', { key }),
      clear: () => call<void>('cache_clear'),
    },
    person: {
      init: () => call<PersonInfo>('person_init'),
      prove: (classId: ClassId) => call<PersonProof>('person_prove', { classId }),
    },
    storage: {
      usage: () => call<StorageUsage>('storage_usage'),
      reveal: (which, classId) => call<void>('app_reveal', { which, ...(classId ? { classId } : {}) }),
    },
  };
}
