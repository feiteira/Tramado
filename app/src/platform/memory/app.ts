// App files, private data, cache, person key and storage of the memory platform (architecture §6.1).
import { PlatformError } from '../../core/errors';
import { memberIdOf } from '../../core/model/derive';
import { validateClassPath } from '../../core/model/paths';
import { personProofMessage, toBase64Url } from '../../core/model/sig';
import type { ClassId, DeviceId } from '../../core/model/ids';
import type { AppFileName, AppInfo, CacheKey, PersonInfo, PersonProof, StorageUsage } from '../types';
import type { PoolKey } from './signer';

const CACHE_KEY = /^(text\/[0-9a-f]{64}\.json|peaks\/[0-9a-f]{64}-\d{2,5}\.json|models-catalog\.json|ocr\/[0-9a-f]{64}\.json)$/;
const APP_FILES: readonly AppFileName[] = ['prefs.json', 'identity.json', 'hlc.json'];

export function createAppParts(deps: { info: AppInfo; person: PoolKey; deviceId: () => DeviceId; classBytes: () => number; log: (level: string, message: string, data?: object) => void }) {
  const appFiles = new Map<AppFileName, string>();
  const privateFiles = new Map<ClassId, Map<string, Uint8Array>>();
  const cache = new Map<CacheKey, Uint8Array>();
  let personMade = false;

  const priv = (classId: ClassId) => {
    let m = privateFiles.get(classId);
    if (!m) {
      m = new Map();
      privateFiles.set(classId, m);
    }
    return m;
  };
  const privPath = (p: string) => {
    const v = validateClassPath(p);
    if (v === 'mirror' || v.startsWith('mirror/')) throw new PlatformError('INVALID', 'mirror/ is Rust-only');
    return v;
  };
  const cacheKey = (k: string) => {
    if (!CACHE_KEY.test(k)) throw new PlatformError('INVALID', `bad cache key ${k}`);
    return k;
  };
  const sizeOf = (m: Map<string, Uint8Array>) => [...m.values()].reduce((n, b) => n + b.length, 0);

  return {
    appFiles,
    privateFiles,
    cache,
    api: {
      info: async (): Promise<AppInfo> => deps.info,
      log: (level: 'error' | 'warn' | 'info', message: string, data?: object) => deps.log(level, message, data),
      appFiles: {
        async read(name: AppFileName): Promise<string | null> {
          if (!APP_FILES.includes(name)) throw new PlatformError('INVALID', `unknown app file ${name}`);
          return appFiles.get(name) ?? null;
        },
        async write(name: AppFileName, text: string): Promise<void> {
          if (!APP_FILES.includes(name)) throw new PlatformError('INVALID', `unknown app file ${name}`);
          appFiles.set(name, text);
        },
      },
      privateFiles: {
        async read(classId: ClassId, path: string) {
          return priv(classId).get(privPath(path))?.slice() ?? null;
        },
        async write(classId: ClassId, path: string, bytes: Uint8Array) {
          priv(classId).set(privPath(path), bytes.slice());
        },
        async append(classId: ClassId, path: string, line: Uint8Array) {
          const p = privPath(path);
          if (line.length === 0 || line.indexOf(0x0a) !== line.length - 1 || line.length > 65_536) throw new PlatformError('INVALID', 'bad line');
          const prev = priv(classId).get(p) ?? new Uint8Array();
          const next = new Uint8Array(prev.length + line.length);
          next.set(prev);
          next.set(line, prev.length);
          priv(classId).set(p, next);
          return next.length;
        },
        async list(classId: ClassId, dir: string) {
          const prefix = dir ? `${privPath(dir)}/` : '';
          return [...priv(classId).keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort();
        },
        async remove(classId: ClassId, path: string, recursive?: boolean) {
          const p = privPath(path);
          const m = priv(classId);
          if (m.delete(p)) return;
          if (recursive) for (const k of [...m.keys()]) if (k.startsWith(`${p}/`)) m.delete(k);
        },
        async purge(classId: ClassId) {
          privateFiles.delete(classId);
        },
      },
      cache: {
        async read(key: CacheKey) {
          return cache.get(cacheKey(key))?.slice() ?? null;
        },
        async write(key: CacheKey, bytes: Uint8Array) {
          cache.set(cacheKey(key), bytes.slice());
        },
        async remove(key: CacheKey) {
          cache.delete(cacheKey(key));
        },
        async clear() {
          for (const k of [...cache.keys()]) if (k !== 'models-catalog.json') cache.delete(k);
        },
      },
      person: {
        async init(): Promise<PersonInfo> {
          personMade = true;
          return { memberId: memberIdOf(deps.person.pub), pub: toBase64Url(deps.person.pub) };
        },
        async prove(classId: ClassId): Promise<PersonProof> {
          if (!personMade) personMade = true;
          const memberId = memberIdOf(deps.person.pub);
          const sig = await deps.person.sign(personProofMessage(classId, deps.deviceId(), memberId));
          return { pub: toBase64Url(deps.person.pub), sig: toBase64Url(sig) };
        },
      },
      storage: {
        async usage(): Promise<StorageUsage> {
          return {
            classes: [],
            models: 0,
            cache: sizeOf(cache),
            privateData: [...privateFiles.values()].reduce((n, m) => n + sizeOf(m), 0) + deps.classBytes() * 0,
          };
        },
        async reveal(_which: 'classesRoot' | 'private' | 'models' | 'cache', _classId?: ClassId): Promise<void> {},
      },
    },
  };
}
