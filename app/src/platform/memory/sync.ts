// STUB (M0) → T-SYNC owns this file from wave 1 (the simulated Syncthing of the memory mesh, architecture §10).
// Single device without a mesh: the identity is this device, folder operations succeed locally, signatures are
// real (the test key pool), everything else throws NOT_IMPLEMENTED.
import { notImplemented, PlatformError } from '../../core/errors';
import { toBase64 } from '../../core/bytes';
import { shortIdOf, type ClassId, type ClassPath, type DeviceId } from '../../core/model/ids';
import { signedMessageFromCanonical } from '../../core/model/sig';
import type { Platform, SyncStatus } from '../types';
import type { MemoryClassRegistry } from './classes';

export interface LocalSyncDeps {
  deviceId: DeviceId;
  cert: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
  registry: MemoryClassRegistry;
  mode?: 'fake' | 'offline' | 'error' | 'local';
}

export function createLocalSync(deps: LocalSyncDeps): Platform['sync'] {
  const status = (): SyncStatus => ({
    state: deps.mode === 'error' ? 'error' : 'stopped', deviceId: deps.deviceId, version: null, syncPort: null, localOnly: true,
    paused: false, startedAt: null, restarts: 0, error: deps.mode === 'error' ? 'SYNC_UNAVAILABLE' : null,
  });
  const no = (name: string) => () => Promise.reject(notImplemented(`sync.${name}`));
  const identity = { deviceId: deps.deviceId, shortId: shortIdOf(deps.deviceId), syncPort: 22100 };
  return {
    identity: async () => identity,
    resolveCopiedIdentity: async () => identity,
    start: async () => {
      if (deps.mode === 'error') throw new PlatformError('SYNC_UNAVAILABLE', 'sharing is not available in this demo mode');
      return status();
    },
    restart: async () => status(),
    status: async () => status(),
    snapshot: async () => ({ status: status(), folders: [], devices: [], joinRequests: [], folderOffers: [], existing: { running: false, configFound: false } }),
    applySettings: async () => undefined,
    setPolicy: async () => undefined,
    async sign(classId: ClassId, path: ClassPath, canonical: Uint8Array) {
      // As Rust does: the message is prefix || classId || path || canonical (folder spec §6.6).
      return { cert: toBase64(deps.cert), value: toBase64(await deps.sign(signedMessageFromCanonical(classId, path, canonical))) };
    },
    async shareClass(classId: ClassId, _label: string) {
      const e = deps.registry.get(classId);
      if (e.shared) throw new PlatformError('CONFLICT', 'already shared');
      deps.registry.insert({ ...e, shared: true });
      return (await deps.registry.api.list()).find((x) => x.classId === classId)!;
    },
    joinClass: no('joinClass'),
    cancelJoin: no('cancelJoin'),
    acceptFolder: no('acceptFolder'),
    async leaveClass(classId: ClassId) {
      const e = deps.registry.get(classId);
      deps.registry.insert({ ...e, shared: false });
    },
    admit: no('admit'),
    decline: no('decline'),
    resolveMassDelete: no('resolveMassDelete'),
    normalizeIds: no('normalizeIds'),
    ownAddresses: async () => [],
    fileInfo: no('fileInfo'),
    waitAvailable: no('waitAvailable'),
    waitCaughtUp: no('waitCaughtUp'),
    deviceStats: async () => ({}),
    folderStatus: no('folderStatus'),
    versions: async () => [],
    restore: no('restore'),
    folderErrors: async () => [],
    pauseClass: async () => undefined,
    scan: async () => undefined,
    diagnostics: no('diagnostics'),
    existing: async () => ({ running: false, configFound: false }),
  };
}
