// The memory platform (architecture §10): every Platform member over Maps, for the browser demo and
// Vitest. Frozen in wave 1; T-SYNC builds the memory mesh on the `mem` hooks, T-AI and T-LECTURES fill
// the fakes (ai.ts, speech.ts) and T-SYNC the simulated Syncthing (sync.ts).
import { PlatformError } from '../../core/errors';
import { mulberry32 } from '../../core/util/prng';
import { shortIdOf, type ClassId, type ClassPath, type DeviceId, type ShortId } from '../../core/model/ids';
import type { AppInfo, ClassChangedEvent, Platform, Power, SyncEvent, Unsubscribe } from '../types';
import { createAppParts } from './app';
import { createClassRegistry } from './classes';
import { createDialogs, type DialogAnswer } from './dialogs';
import { createEvents } from './events';
import { createFileStore, type WriteKind } from './files';
import { createFakeAi } from './ai';
import { createMedia } from './media';
import { createSecrets } from './secrets';
import { deviceIdentity, personKeyIndex, poolKey } from './signer';
import { createLocalSync } from './sync';
import { createSystem } from './system';
import { createWindow } from './window';

export type { DialogAnswer };

/** The part of services' Clock the memory platform needs (structural; platform cannot import services). */
export interface MemoryClock { now(): number }

export interface MemoryPlatform extends Platform {
  mem: {
    deviceId: DeviceId;                         // a valid canonical ID derived from a generated Ed25519 "cert" (WebCrypto)
    signer: { cert: Uint8Array; sign(message: Uint8Array): Promise<Uint8Array> };   // backs sync.sign() (folder spec §6.6)
    onWrite(cb: (classId: ClassId, path: ClassPath, bytes: Uint8Array | null,
                 kind: 'write' | 'append' | 'remove' | 'move', from?: ClassPath) => void): Unsubscribe;
    applyRemote(classId: ClassId, path: ClassPath, bytes: Uint8Array | null,
                meta: { modifiedBy: ShortId; mtimeMs: number }): void;     // as Syncthing would: no onWrite echo, emits class:changed
    list(classId: ClassId): Map<ClassPath, { bytes: Uint8Array; mtimeMs: number; modifiedBy: ShortId }>;
    setSync(impl: Platform['sync']): void;      // the mesh installs its simulated Syncthing here
    emitSync(e: SyncEvent): void;
    emitClassChanged(e: ClassChangedEvent): void;
    addFile(classId: ClassId, path: ClassPath, bytes: Uint8Array): void;   // demo hook (DemoControls.files.addFile)
    queueDialog(a: DialogAnswer): void;
    setClock(c: MemoryClock): void;
    /** G1: the private ("transcript only") WebM of a recording, as Rust keeps it under data/recordings (null removes it). */
    putRecording(recordingId: string, bytes: Uint8Array | null): void;
    /** G1: a stored secret's value (the demo's `?ai=real` reads the session-only key; the real platform never returns it). */
    peekSecret(name: Parameters<Platform['secrets']['status']>[0]): string | null;
    /** INT: what `storage.diskFree()` answers (bytes; null = unknown). */
    setDiskFree(bytes: number | null): void;
    /** INT: files dragged over the window (`app:drag`), as the desktop shell reports them. */
    emitDrag(e: { state: 'enter' | 'leave'; names: string[] }): void;
  };
}

export interface MemoryPlatformOptions {
  kind?: 'demo' | 'test';
  /** Slot of the test key pool (0–31): different devices of one test must use different slots. */
  deviceIndex?: number;
  clock?: MemoryClock;
  rand?: () => number;
  /** Where new classes are created ("/home/demo/Tramado"). */
  root?: string;
  os?: AppInfo['os'];
  power?: Power;
  version?: string;
  ai?: Platform['ai'];
  speech?: Platform['speech'];
  syncMode?: 'fake' | 'offline' | 'error' | 'local';
  selftestUrl?: string;
  pendingLinks?: string[];
  /** INT: bytes free on the disk (`storage.diskFree()`); default 41 GB. */
  diskFree?: number | null;
  log?: (level: 'error' | 'warn' | 'info', message: string, data?: object) => void;
}

export function createMemoryPlatform(opts: MemoryPlatformOptions = {}): MemoryPlatform {
  let clock: MemoryClock = opts.clock ?? { now: () => Date.now() };
  const rand = opts.rand ?? mulberry32(0x7a3a);
  const index = opts.deviceIndex ?? 0;
  const device = deviceIdentity(index);
  const person = poolKey(personKeyIndex(index));
  const version = opts.version ?? '0.1.0';
  const events = createEvents();
  const dialogs = createDialogs(rand);
  const recordings = new Map<string, Uint8Array>();
  let diskFree: number | null = opts.diskFree === undefined ? 41_000_000_000 : opts.diskFree;
  const logs: Array<{ level: string; message: string; data?: object }> = [];
  // eslint-disable-next-line prefer-const
  let files: ReturnType<typeof createFileStore>;
  const registry = createClassRegistry({ now: () => clock.now(), root: opts.root ?? '/home/demo/Tramado', files: () => files, dialogs });
  files = createFileStore({ now: () => clock.now(), me: () => shortIdOf(device.deviceId), events, exists: (id) => registry.has(id) });
  const info: AppInfo = {
    version, os: opts.os ?? 'web', arch: 'web', webview: null, devIsolated: false, e2e: false, startedHidden: false, mediaBase: 'blob:',
    paths: { config: '/home/demo/.config/tramado', data: '/home/demo/.local/share/tramado', cache: '/home/demo/.cache/tramado' },
  };
  const app = createAppParts({
    info, person, deviceId: () => device.deviceId, classBytes: () => 0,
    log: (level, message, data) => {
      logs.push({ level, message, ...(data ? { data } : {}) });
      opts.log?.(level as 'info', message, data);
    },
  });
  const secrets = createSecrets();
  const media = createMedia({ files: () => files, recordings, selftestUrl: opts.selftestUrl ?? '/demo/lecture.webm' });
  const win = createWindow();
  const system = createSystem({ power: opts.power ?? { source: 'unknown', percent: null }, version, pendingLinks: opts.pendingLinks ?? [] });
  let sync: Platform['sync'] = createLocalSync({
    deviceId: device.deviceId, cert: device.cert, sign: (m) => device.key.sign(m), registry, ...(opts.syncMode ? { mode: opts.syncMode } : {}),
  });

  const platform: MemoryPlatform = {
    kind: opts.kind ?? 'test',
    info: app.api.info,
    log: app.api.log,
    appFiles: app.api.appFiles,
    privateFiles: app.api.privateFiles,
    cache: app.api.cache,
    person: app.api.person,
    storage: {
      async usage() {
        const base = await app.api.storage.usage();
        const classes = [...registry.entries.keys()].map((classId) => {
          let total = 0;
          let audio = 0;
          try {
            for (const [p, f] of files.raw(classId).files) {
              total += f.bytes.length;
              if (p.endsWith('/audio.webm')) audio += f.bytes.length;
            }
          } catch {
            // an unregistered class has no files
          }
          return { classId, total, audio, trash: 0 };
        });
        return { ...base, classes };
      },
      reveal: app.api.storage.reveal,
      async diskFree() {
        return diskFree;
      },
    },
    classes: registry.api,
    fs: {
      list: files.list,
      stat: files.stat,
      read: files.read,
      readRange: files.readRange,
      write: files.write,
      append: files.append,
      mkdir: files.mkdir,
      move: files.move,
      remove: files.remove,
      hash: files.hash,
      async importFile(classId, pick, dest) {
        const p = dialogs.resolve(pick, 'open');
        if (!p.bytes) throw new PlatformError('INVALID', 'not a file');
        if ((await files.stat(classId, dest)) !== null) throw new PlatformError('CONFLICT', `${dest} exists`, { path: dest });
        return files.write(classId, dest, p.bytes, { own: false });
      },
      async exportFile(classId, path, pick) {
        dialogs.resolve(pick, 'save');
        await files.read(classId, path);
      },
    },
    dialogs: dialogs.api,
    secrets: secrets.api,
    ai: opts.ai ?? createFakeAi(),
    get sync() {
      return sync;
    },
    ...(opts.speech ? { speech: opts.speech } : {}),
    media: { url: media.url, blobUrl: media.blobUrl },
    notifications: {
      async show(n) {
        logs.push({ level: 'info', message: `notification: ${n.title}`, data: n });
      },
    },
    window: win.api,
    system: system.api,
    events: events.api,
    mem: {
      deviceId: device.deviceId,
      signer: { cert: device.cert, sign: (m) => device.key.sign(m) },
      onWrite: (cb) => files.onWrite((c, p, b, k: WriteKind, from) => cb(c, p, b, k, from)),
      applyRemote: (classId, path, bytes, meta) => files.applyRemote(classId, path, bytes, meta),
      list: (classId) => new Map([...files.raw(classId).files].map(([p, f]) => [p, { bytes: f.bytes, mtimeMs: f.mtimeMs, modifiedBy: f.modifiedBy }])),
      setSync(impl) {
        sync = impl;
      },
      emitSync: (e) => events.emitters.sync.emit(e),
      emitClassChanged: (e) => events.emitters.classChanged.emit(e),
      setDiskFree: (bytes) => {
        diskFree = bytes;
      },
      emitDrag: (e) => events.emitters.drag.emit(e),
      addFile: (classId, path, bytes) => files.addFile(classId, path, bytes),
      queueDialog: (a) => dialogs.queue(a),
      setClock(c) {
        clock = c;
      },
      peekSecret: (name) => secrets.peek(name),
      putRecording(recordingId, bytes) {
        if (bytes) recordings.set(recordingId, bytes);
        else recordings.delete(recordingId);
      },
    },
  };
  return platform;
}
