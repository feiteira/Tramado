// The memory platform's sync without a mesh (architecture §10): the single-device browser demo and plain Vitest.
// Identity is this device; folder operations succeed locally; signatures are real (the test key pool). The demo
// modes of UX §7.2 live here: `fake` (Bruno and Jamie online), `offline` (no peers: my last message stays pending),
// `error` (SYNC_UNAVAILABLE) and `local` (the pill shows "Only on this computer"). `createDemoSyncControls` is the
// sync part of DemoControls: it writes chat lines and files as a member's device, so the real services pick them up.
// The memory mesh (mesh.ts) replaces this with a simulated Syncthing per device through `mem.setSync`.
import { PlatformError } from '../../core/errors';
import { fromBase64, toBase64 } from '../../core/bytes';
import { formatHlc } from '../../core/hlc';
import { newUlid } from '../../core/ids';
import { FORMATS } from '../../core/model/formats';
import { classifyPath } from '../../core/model/paths';
import { canonicalBytes, deviceIdChecks, personProofMessage, signedMessageFromCanonical, toBase64Url } from '../../core/model/sig';
import { memberIdOf } from '../../core/model/derive';
import { instant } from '../../core/model/time';
import { dashed, hlcNodeOf, shortIdOf, type ClassId, type ClassPath, type DeviceId, type MemberId } from '../../core/model/ids';
import { blocksHash, writerOf } from '../../core/sync/trust';
import { chatMonthOf, chatPath } from '../../core/sync/chat';
import type { ChatMessage, MemberFile } from '../../core/model/files';
import type { ClassPolicy, DeviceView, FileSyncInfo, FolderView, Platform, SyncEvent, SyncStatus } from '../types';
import type { MemoryClassRegistry } from './classes';
import { deviceIdentity, DEVICE_KEYS, personKeyIndex, poolKey } from './signer';

export interface LocalSyncDeps {
  deviceId: DeviceId;
  cert: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
  registry: MemoryClassRegistry;
  mode?: 'fake' | 'offline' | 'error' | 'local';
}

/** What the demo controls (and the mesh) reach behind a sync object created here. */
export interface LocalSyncInternals {
  deps: LocalSyncDeps;
  online: Set<DeviceId>;
  /** Known peer devices (from member files) with their display names. */
  peers: Map<DeviceId, { name: string; relay: boolean; lastSeen: number | null }>;
  policies: Map<ClassId, ClassPolicy>;
  joinRequests: Map<string, { classId: ClassId; deviceId: DeviceId; name: string; address: string; at: string }>;
  /** Installed by createDemoSyncControls: the class files (for fileInfo). */
  files: ((classId: ClassId) => Map<ClassPath, { bytes: Uint8Array; mtimeMs: number; modifiedBy: string }>) | null;
  emit: ((e: SyncEvent) => void) | null;
  now: () => number;
}

const INTERNALS = new WeakMap<object, LocalSyncInternals>();

/** The registry and demo state behind a sync object created by `createLocalSync` (mesh and demo controls). */
export function localSyncInternals(sync: Platform['sync']): LocalSyncInternals | undefined {
  return INTERNALS.get(sync);
}

const dec = new TextDecoder();

export function createLocalSync(deps: LocalSyncDeps): Platform['sync'] {
  const mode = deps.mode ?? 'local';
  const startedAt = instant(Date.now());
  const internals: LocalSyncInternals = {
    deps, online: new Set(), peers: new Map(), policies: new Map(), joinRequests: new Map(), files: null, emit: null, now: () => Date.now(),
  };
  const anyShared = () => [...deps.registry.entries.values()].some((e) => e.shared);
  const status = (): SyncStatus => ({
    state: mode === 'error' ? 'error' : (mode === 'fake' || mode === 'offline') && anyShared() ? 'running' : 'stopped',
    deviceId: deps.deviceId, version: mode === 'fake' || mode === 'offline' ? 'v2.1.7' : null, syncPort: null,
    localOnly: false, paused: false, startedAt: mode === 'fake' || mode === 'offline' ? startedAt : null, restarts: 0,
    error: mode === 'error' ? 'SYNC_UNAVAILABLE' : null,
  });
  const notHere = (name: string) => () => Promise.reject(new PlatformError(mode === 'error' ? 'SYNC_UNAVAILABLE' : 'NOT_IMPLEMENTED', `sync.${name} needs a peer (memory platform)`));
  const identity = { deviceId: deps.deviceId, shortId: shortIdOf(deps.deviceId), syncPort: 22100 };
  const sharedIds = () => [...deps.registry.entries.values()].filter((e) => e.shared).map((e) => e.classId);
  const folderView = (classId: ClassId): FolderView => {
    const e = deps.registry.get(classId);
    const files = internals.files?.(classId);
    const peers = [...internals.peers.keys()].filter((d) => d !== deps.deviceId);
    return {
      classId, label: e.dirName, path: e.path, paused: false, state: 'idle', globalFiles: files?.size ?? 0, inSyncFiles: files?.size ?? 0,
      needFiles: 0, needBytes: 0, pullErrors: 0, error: null, devices: [deps.deviceId, ...peers],
      completion: Object.fromEntries(peers.map((d) => [d, { completion: internals.online.has(d) ? 100 : 0, needItems: 0, remoteState: internals.online.has(d) ? 'valid' : 'unknown' }])),
    };
  };
  const deviceViews = (): DeviceView[] =>
    [...internals.peers].filter(([d]) => d !== deps.deviceId).map(([deviceId, p]) => ({
      deviceId, name: p.name, connected: internals.online.has(deviceId), relay: p.relay && internals.online.has(deviceId), address: null, paused: false,
      lastSeen: internals.online.has(deviceId) ? instant(internals.now()) : p.lastSeen === null ? null : instant(p.lastSeen), folders: sharedIds(), provisional: false, ignored: false,
    }));

  const sync: Platform['sync'] = {
    identity: async () => identity,
    resolveCopiedIdentity: async () => identity,
    start: async () => {
      if (mode === 'error') throw new PlatformError('SYNC_UNAVAILABLE', 'sharing is not available in this demo mode');
      return status();
    },
    restart: async () => status(),
    status: async () => status(),
    snapshot: async () => ({
      status: status(), folders: mode === 'fake' || mode === 'offline' ? sharedIds().map(folderView) : [], devices: deviceViews(),
      joinRequests: [...internals.joinRequests.values()], folderOffers: [], existing: { running: false, configFound: false },
    }),
    applySettings: async () => undefined,
    setPolicy: async (p) => {
      internals.policies.set(p.classId, p);
      for (const r of p.roster) if (r.deviceId !== deps.deviceId && !internals.peers.has(r.deviceId)) {
        internals.peers.set(r.deviceId, { name: `${r.name} (${r.deviceName})`, relay: false, lastSeen: null });
      }
    },
    async sign(classId: ClassId, path: ClassPath, canonical: Uint8Array) {
      // As Rust does: the message is prefix || classId || path || canonical (folder spec §6.6).
      return { cert: toBase64(deps.cert), value: toBase64(await deps.sign(signedMessageFromCanonical(classId, path, canonical))) };
    },
    async shareClass(classId: ClassId, _label: string) {
      if (mode === 'error') throw new PlatformError('SYNC_UNAVAILABLE', 'sharing is not available in this demo mode');
      const e = deps.registry.get(classId);
      if (e.shared) throw new PlatformError('CONFLICT', 'already shared');
      deps.registry.insert({ ...e, shared: true });
      return (await deps.registry.api.list()).find((x) => x.classId === classId)!;
    },
    joinClass: notHere('joinClass'),
    async cancelJoin(classId: ClassId) {
      deps.registry.entries.delete(classId);
    },
    acceptFolder: notHere('acceptFolder'),
    async leaveClass(classId: ClassId, opts) {
      const e = deps.registry.get(classId);
      // Nobody can receive the deletion here: the leave finishes at once (the memory platform has no peers).
      if (opts.afterwards === 'trash') {
        deps.registry.insert({ ...e, shared: false, leaving: null });
        await deps.registry.api.trash(classId);
      } else deps.registry.insert({ ...e, shared: false, leaving: null });
    },
    async admit(classId: ClassId, deviceId: DeviceId) {
      const key = `${classId}|${deviceId}`;
      const req = internals.joinRequests.get(key);
      if (!req) throw new PlatformError('PERMISSION_DENIED', 'no pending offer from that device');
      internals.joinRequests.delete(key);
      internals.peers.set(deviceId, { name: req.name, relay: false, lastSeen: internals.now() });
      internals.online.add(deviceId);
      internals.emit?.({ type: 'joinRequestGone', classId, deviceId });
      internals.emit?.({ type: 'admitted', classId, deviceId, name: req.name });
    },
    async decline(classId: ClassId, deviceId: DeviceId) {
      internals.joinRequests.delete(`${classId}|${deviceId}`);
      internals.emit?.({ type: 'joinRequestGone', classId, deviceId });
    },
    resolveMassDelete: async () => undefined,
    normalizeIds: async (ids) => ids.map((s) => {
      const d = dashed(s.trim());
      return deviceIdChecks(d) ? d : null;
    }),
    ownAddresses: async () => (mode === 'fake' || mode === 'offline' ? ['tcp://192.168.1.20:22100'] : []),
    async fileInfo(classId: ClassId, paths: ClassPath[]): Promise<FileSyncInfo[]> {
      if (!internals.files) throw new PlatformError('NOT_IMPLEMENTED', 'sync.fileInfo needs the demo controls (memory platform)');
      const files = internals.files(classId);
      return paths.map((path) => {
        const f = files.get(path);
        let writer: DeviceId | null = null;
        if (f) {
          let parsed: unknown = null;
          try {
            parsed = path.endsWith('.json') ? JSON.parse(dec.decode(f.bytes)) : null;
          } catch {
            parsed = null;
          }
          writer = writerOf(path, parsed);
        }
        // The demo pretends every machine file was made by its writer (Syncthing would say so).
        const by = writer ? shortIdOf(writer) : f?.modifiedBy ?? null;
        const mine = writer === deps.deviceId || (!writer && classifyPath(path).kind === 'content');
        const availability = mode === 'fake' && f ? [...internals.online].filter((d) => d !== (mine ? '' : writer)) : [];
        return {
          path, localModifiedBy: f ? by : null, localDeleted: !f, localSize: f ? f.bytes.length : null, localBlocksHash: f ? blocksHash(f.bytes) : null,
          localModified: f ? instant(f.mtimeMs) : null, localVersion: [], localSequence: null, globalModifiedBy: f ? by : null, globalDeleted: !f, availability,
        };
      });
    },
    waitAvailable: async () => mode === 'fake' && internals.online.size > 0,
    waitCaughtUp: async () => ({ complete: true, waitedMs: 0, pending: [] }),
    deviceStats: async () => Object.fromEntries([...internals.peers].map(([d, p]) => [d, {
      lastSeen: internals.online.has(d) ? instant(internals.now()) : p.lastSeen === null ? null : instant(p.lastSeen), lastConnectionDurationS: 0,
    }])),
    folderStatus: async (classId) => folderView(classId),
    versions: async () => [],
    restore: async () => undefined,
    folderErrors: async () => [],
    pauseClass: async () => undefined,
    scan: async () => undefined,
    diagnostics: async () => ({
      status: status(), ports: { sync: null, guiOpen: false }, listeners: {}, connections: internals.online.size, relayed: 0, lastErrors: [],
      logTail: [`memory platform sync (${mode})`],
    }),
    existing: async () => ({ running: false, configFound: false }),
  };
  INTERNALS.set(sync, internals);
  return sync;
}

// ── DemoControls.sync (UX §7.2) ──────────────────────────────────────────────────────────────────

/** The parts of the memory platform the controls use (structural, so the demo passes a MemoryPlatform). */
export interface DemoSyncPlatform {
  sync: Platform['sync'];
  mem: {
    deviceId: DeviceId;
    list(classId: ClassId): Map<ClassPath, { bytes: Uint8Array; mtimeMs: number; modifiedBy: string }>;
    applyRemote(classId: ClassId, path: ClassPath, bytes: Uint8Array | null, meta: { modifiedBy: string; mtimeMs: number }): void;
    emitSync(e: SyncEvent): void;
  };
}
export interface DemoSyncKeys {
  classes: Partial<Record<string, ClassId>>;
  members: Partial<Record<string, { memberId: MemberId; deviceIds: DeviceId[] }>>;
}
export interface DemoSyncControls {
  peerSays(classKey: string, memberKey: string, text: string): Promise<void>;
  peerAdds(classKey: string, memberKey: string, relPath: string, base64: string): Promise<void>;
  peerJoins(classKey: string, name: string, deviceName: string): Promise<void>;
  setOnline(memberKey: string, online: boolean): void;
}

/**
 * The sync part of DemoControls. `fake` starts with Bruno and Jamie online (UX §7.3), `offline` with nobody; the
 * controls write as the member's device (applyRemote + a `remoteChange` event), so the real services pick them up.
 * `join: 'ask'` queues Diogo Santos (UX §7.2) for `law`.
 */
export function createDemoSyncControls(
  platform: DemoSyncPlatform,
  keys: DemoSyncKeys,
  opts: { mode: 'fake' | 'offline' | 'error' | 'local'; now: () => number; join?: 'ask' | null; online?: string[] } = { mode: 'fake', now: () => Date.now() },
): DemoSyncControls {
  const internals = localSyncInternals(platform.sync);
  const emit = (e: SyncEvent) => platform.mem.emitSync(e);
  if (internals) {
    internals.files = (classId) => platform.mem.list(classId);
    internals.emit = emit;
    internals.now = opts.now;
    const online = opts.mode === 'fake' ? (opts.online ?? ['bruno', 'jamie']) : [];
    for (const [key, m] of Object.entries(keys.members)) {
      if (!m || key === 'ana') continue;
      for (const d of m.deviceIds) {
        internals.peers.set(d, { name: key, relay: key === 'bruno', lastSeen: opts.now() - 86_400_000 });
        if (online.includes(key)) internals.online.add(d);
      }
    }
    if (opts.join === 'ask') {
      const diogo = keys.members.diogo?.deviceIds[0];
      const law = keys.classes.law;
      if (diogo && law) {
        const request = { classId: law, deviceId: diogo, name: 'Diogo Santos (Diogo’s laptop)', address: '192.168.1.44:22100', at: instant(opts.now() - 120_000) };
        internals.joinRequests.set(`${law}|${diogo}`, request);
        emit({ type: 'joinRequest', request });
      }
    }
  }
  const classOf = (k: string) => {
    const id = keys.classes[k];
    if (!id) throw new PlatformError('NOT_FOUND', `unknown class key ${k}`);
    return id;
  };
  const deviceOf = (k: string) => {
    const d = keys.members[k]?.deviceIds[0];
    if (!d) throw new PlatformError('NOT_FOUND', `unknown member key ${k}`);
    return d;
  };
  const writeAs = (classId: ClassId, deviceId: DeviceId, path: ClassPath, bytes: Uint8Array) => {
    platform.mem.applyRemote(classId, path, bytes, { modifiedBy: shortIdOf(deviceId), mtimeMs: opts.now() });
    emit({ type: 'remoteChange', classId, path, action: 'modified', modifiedBy: shortIdOf(deviceId) });
  };
  let seq = 0;
  const rand = () => ((seq = (seq * 1103515245 + 12345) % 2147483648) / 2147483648);
  return {
    async peerSays(classKey, memberKey, text) {
      const classId = classOf(classKey);
      const deviceId = deviceOf(memberKey);
      const now = opts.now();
      const hlc = formatHlc({ ms: now, counter: seq++ % 1000, device: hlcNodeOf(deviceId) });
      const line: ChatMessage = {
        format: 'tramado.chat', version: 1, type: 'message', id: newUlid(now, rand), hlc, ms: now,
        memberId: keys.members[memberKey]!.memberId, text: text.slice(0, 8000),
      };
      const path = chatPath(deviceId, chatMonthOf(hlc));
      const prev = platform.mem.list(classId).get(path)?.bytes ?? new Uint8Array();
      const next = new TextEncoder().encode(JSON.stringify(line) + '\n');
      const all = new Uint8Array(prev.length + next.length);
      all.set(prev);
      all.set(next, prev.length);
      writeAs(classId, deviceId, path, all);
    },
    async peerAdds(classKey, memberKey, relPath, base64) {
      writeAs(classOf(classKey), deviceOf(memberKey), relPath, fromBase64(base64));
    },
    async peerJoins(classKey, name, deviceName) {
      const classId = classOf(classKey);
      // A fresh fictional device from the pool (slots 20–31 are unused by the demo seed).
      const used = new Set(Object.values(keys.members).flatMap((m) => m?.deviceIds ?? []));
      let index = 20;
      while (index < DEVICE_KEYS && used.has(deviceIdentity(index).deviceId)) index++;
      const id = deviceIdentity(index);
      const person = poolKey(personKeyIndex(index));
      const memberId = memberIdOf(person.pub);
      const fullName = `${name} (${deviceName})`;
      if (internals?.policies.get(classId)?.askBeforeAdmit) {
        internals.joinRequests.set(`${classId}|${id.deviceId}`, { classId, deviceId: id.deviceId, name: fullName, address: '192.168.1.50:22100', at: instant(opts.now()) });
        emit({ type: 'joinRequest', request: { classId, deviceId: id.deviceId, name: fullName, address: '192.168.1.50:22100', at: instant(opts.now()) } });
        return;
      }
      const path = `.tramado/members/${id.deviceId}.json`;
      const proof = await person.sign(personProofMessage(classId, id.deviceId, memberId));
      const rec: Omit<MemberFile, 'sig'> = {
        format: 'tramado.member', version: 1, deviceId: id.deviceId, memberId, name: name.slice(0, 64), deviceName: deviceName.slice(0, 64),
        joinedAt: instant(opts.now()), hlc: formatHlc({ ms: opts.now(), counter: 0, device: hlcNodeOf(id.deviceId) }), addresses: [],
        caps: { cpuOk: true, localModel: null, cloud: false, volunteer: 'off' }, person: { pub: toBase64Url(person.pub), sig: toBase64Url(proof) },
        vouches: [], formats: { ...FORMATS }, app: { name: 'Tramado', version: '0.1.0', platform: 'linux' },
      };
      const value = await id.key.sign(signedMessageFromCanonical(classId, path, canonicalBytes(rec as unknown as Record<string, unknown>)));
      const file: MemberFile = { ...(rec as MemberFile), sig: { cert: toBase64(id.cert), value: toBase64(value) } };
      if (internals) {
        internals.peers.set(id.deviceId, { name: fullName, relay: false, lastSeen: opts.now() });
        internals.online.add(id.deviceId);
      }
      writeAs(classId, id.deviceId, path, new TextEncoder().encode(JSON.stringify(file)));
      emit({ type: 'admitted', classId, deviceId: id.deviceId, name: fullName });
    },
    setOnline(memberKey, online) {
      const m = keys.members[memberKey];
      if (!internals || !m) return;
      for (const d of m.deviceIds) {
        if (online) internals.online.add(d);
        else {
          internals.online.delete(d);
          const p = internals.peers.get(d);
          if (p) p.lastSeen = opts.now();
        }
        emit({ type: 'connection', deviceId: d, connected: online, relay: online && (internals.peers.get(d)?.relay ?? false), address: null });
      }
    },
  };
}

