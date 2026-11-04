// createMemoryMesh(): the multi-device test harness (D56, sync spec §24; architecture §10). N devices, each a
// MemoryPlatform whose `sync` is a simulated Syncthing: folders with configured devices, version vectors per file,
// last-writer-wins by version vector with Syncthing's conflict copies, deletions as tombstones, per-device trashcan
// (versions/restore), `modifiedBy`, `blocksHash`, availability, `remoteChange` events (optionally lagging the bytes,
// `eventLag`), admission by the same `decide()` as Rust from each device's last policy, roster reconciliation with
// `left()`, bans, folder offers, leaving as a background state, partitions, crashes and fake clocks with skew.
// Built on the frozen `mem` hooks only; the class registry is reached through `localSyncInternals`.
import { PlatformError } from '../../core/errors';
import { toBase64 } from '../../core/bytes';
import { mulberry32 } from '../../core/util/prng';
import { instant } from '../../core/model/time';
import { classifyPath, isValidClassPath } from '../../core/model/paths';
import { dashed, shortIdOf, type ClassId, type ClassPath, type DeviceId, type MemberId, type ShortId } from '../../core/model/ids';
import { deviceIdChecks } from '../../core/model/sig';
import { decide } from '../../core/sync/admission';
import { decodeInvite } from '../../core/sync/invite';
import { blocksHash, writerOf } from '../../core/sync/trust';
import type {
  CaughtUp, ClassEntry, ClassPolicy, DeviceView, FileSyncInfo, FolderOfferView, FolderView, JoinRequestView, Platform, SyncEvent, SyncStatus,
  VersionEntry,
} from '../types';
import { createMemoryPlatform, type MemoryPlatform } from './index';
import { deviceIdentity, DEVICE_KEYS } from './signer';
import { localSyncInternals } from './sync';
import type { MemoryClassRegistry } from './classes';

export interface MeshOptions { seed: number; clockSkewMs?: Record<string, number>; autoFlush?: boolean; eventLag?: number; startMs?: number }

/** The services' Clock shape (structural: platform cannot import services). */
export interface MeshClock { now(): number; mono(): number; setTimeout(f: () => void, ms: number): () => void }

export interface MemoryMesh {
  device(name: string, opts?: { deviceId?: DeviceId; memberId?: MemberId; speech?: Platform['speech'] }): MemoryPlatform;   // creates a device (G1: `speech`, a fake speech platform)
  flush(): Promise<void>;              // propagate every pending change between connected devices sharing a folder (one round)
  settle(maxRounds?: number): Promise<void>;   // flush until quiescent
  partition(...groups: string[][]): void;      // devices in different groups cannot exchange
  heal(): void;
  crash(name: string): void; restart(name: string): MemoryPlatform;   // drop in-memory services, keep files
  advance(ms: number): Promise<void>;          // fake clocks (monotonic + wall, per-device skew)
  forge(by: string, owner: string, classId: ClassId, path: ClassPath, bytes: Uint8Array): void;  // foreign write (critique V3)
  files(name: string, classId: ClassId): Map<ClassPath, Uint8Array>;
  // ── additive (T-SYNC) ──
  /** The device's Clock (wall time with its skew, the mesh's monotonic time, timers driven by `advance`). */
  clock(name: string): MeshClock;
  names(): string[];
  isUp(name: string): boolean;
  /** Whether two devices can exchange now (both up, same partition group). */
  connected(a: string, b: string): boolean;
  /** Bytes of paths starting with `prefix` stop reaching `name` (the index still does: `global*` in fileInfo). */
  holdBytes(name: string, classId: ClassId, prefix: string | null): void;
  /** The device's folder devices of a class (the simulated Syncthing config). */
  folderDevices(name: string, classId: ClassId): DeviceId[];
  /** The last policy a device pushed for a class. */
  policy(name: string, classId: ClassId): ClassPolicy | null;
  /** Lets the wall clock of one device jump (a wrong clock). */
  setSkew(name: string, ms: number): void;
  /** A foreign write by `by` whose `modifiedBy` claims device `as` (a modified Syncthing, folder spec §6.5). */
  forgeAs(by: string, as: string, classId: ClassId, path: ClassPath, bytes: Uint8Array): void;
  /** Turns the simulated Rust self-heal (§12.3) of a device off or on (default on). */
  setSelfHeal(name: string, on: boolean): void;
}

type VV = Record<ShortId, number>;
interface Meta { version: VV; deleted: boolean; modifiedBy: ShortId; mtimeMs: number; size: number; blocksHash: string | null; sequence: number }
interface Folder {
  classId: ClassId;
  label: string;
  devices: Set<DeviceId>;
  paused: boolean;
  files: Map<ClassPath, Meta>;
  /** What fileInfo reports (lags `files` by `eventLag` flushes for remote changes). */
  db: Map<ClassPath, Meta>;
  global: Map<ClassPath, Meta>;
  versions: Array<{ path: ClassPath; versionTime: number; modTime: number; bytes: Uint8Array }>;
  leaving: { since: number; afterwards: 'keepLocal' | 'trash' } | null;
  queued: Map<DeviceId, JoinRequestView>;
  refused: Set<DeviceId>;
  seenMember: Set<DeviceId>;
  admittedBy: Set<DeviceId>;
  hold: string | null;
}
interface Waiter { check(): boolean; done(): void }
interface Device {
  name: string;
  index: number;
  deviceId: DeviceId;
  short: ShortId;
  platform: MemoryPlatform;
  registry: MemoryClassRegistry;
  up: boolean;
  group: number;
  skew: number;
  seq: number;
  folders: Map<ClassId, Folder>;
  policies: Map<ClassId, ClassPolicy>;
  leftClasses: Set<ClassId>;
  offers: Map<string, FolderOfferView>;
  lastSeen: Map<DeviceId, number>;
  pendingEvents: Array<{ due: number; e: SyncEvent; db?: { classId: ClassId; path: ClassPath; meta: Meta } }>;
  waiters: Set<Waiter>;
  paused: boolean;
  startedAt: number;
  applying: boolean;
  /** Rust's private mirror of my own machine files ≤ 1 MiB except transcript.* (sync spec §12.3). */
  mirror: Map<string, Uint8Array | null>;
  healOff: boolean;
}

const sum = (v: VV) => Object.values(v).reduce((a, b) => Math.max(a, b), 0);
function cmpVV(a: VV, b: VV): 'equal' | 'greater' | 'less' | 'concurrent' {
  let gt = false;
  let lt = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x > y) gt = true;
    if (x < y) lt = true;
  }
  return gt && lt ? 'concurrent' : gt ? 'greater' : lt ? 'less' : 'equal';
}
const mergeVV = (a: VV, b: VV): VV => {
  const out: VV = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
};
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `<base>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ShortId>.<ext>` (folder spec §8.21). */
export function conflictName(path: ClassPath, mtimeMs: number, by: ShortId): ClassPath {
  const d = new Date(mtimeMs);
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  return `${dir}${base}.sync-conflict-${stamp}-${by}${ext}`;
}

const syncable = (p: ClassPath) => {
  if (!isValidClassPath(p)) return false;
  const k = classifyPath(p).kind;
  return k !== 'skipped';
};

export function createMemoryMesh(opts: MeshOptions): MemoryMesh {
  const rand = mulberry32(opts.seed);
  const eventLag = opts.eventLag ?? 0;
  const startMs = opts.startMs ?? 1_793_721_438_157;
  let mono = 0;
  let timerSeq = 0;
  const timers = new Map<number, { at: number; f: () => void; owner: string }>();
  const devices = new Map<string, Device>();
  let flushRound = 0;
  let autoScheduled = false;

  const wall = (d: Device) => startMs + mono + d.skew;
  const dev = (name: string) => {
    const d = devices.get(name);
    if (!d) throw new Error(`mesh: no device ${name}`);
    return d;
  };
  const byId = (id: DeviceId) => [...devices.values()].find((d) => d.deviceId === id);
  const linked = (a: Device, b: Device) => a !== b && a.up && b.up && a.group === b.group;
  const emit = (d: Device, e: SyncEvent) => {
    if (d.up) d.platform.mem.emitSync(e);
  };
  const scheduleAuto = () => {
    if (!opts.autoFlush || autoScheduled) return;
    autoScheduled = true;
    queueMicrotask(() => {
      autoScheduled = false;
      void mesh.flush();
    });
  };
  const wake = (d: Device) => {
    for (const w of [...d.waiters]) if (w.check()) {
      d.waiters.delete(w);
      w.done();
    }
  };

  function folderOf(d: Device, classId: ClassId): Folder {
    const f = d.folders.get(classId);
    if (!f) throw new PlatformError('NOT_FOUND', `folder ${classId} is not shared on ${d.name}`);
    return f;
  }
  function newFolder(classId: ClassId, label: string, devs: DeviceId[]): Folder {
    return {
      classId, label, devices: new Set(devs), paused: false, files: new Map(), db: new Map(), global: new Map(), versions: [], leaving: null,
      queued: new Map(), refused: new Set(), seenMember: new Set(), admittedBy: new Set(), hold: null,
    };
  }
  /** Initial scan: every existing file becomes a local version of this device. */
  function scan(d: Device, f: Folder) {
    for (const [p, file] of d.platform.mem.list(f.classId)) {
      if (!syncable(p) || f.files.has(p)) continue;
      const m: Meta = { version: { [d.short]: 1 }, deleted: false, modifiedBy: file.modifiedBy, mtimeMs: file.mtimeMs, size: file.bytes.length, blocksHash: blocksHash(file.bytes), sequence: ++d.seq };
      f.files.set(p, m);
      f.db.set(p, m);
      f.global.set(p, m);
      if (isOwn(d, f.classId, p, file.bytes)) d.mirror.set(`${f.classId}|${p}`, file.bytes.slice());
    }
  }
  function localChange(d: Device, classId: ClassId, path: ClassPath, bytes: Uint8Array | null, by: ShortId = d.short) {
    const f = d.folders.get(classId);
    if (!f || !syncable(path)) return;
    const prev = f.files.get(path);
    if (!prev && bytes === null) return;
    const version: VV = { ...(prev?.version ?? {}), [d.short]: sum(prev?.version ?? {}) + 1 };
    const full = bytes === null ? null : d.platform.mem.list(classId).get(path)?.bytes ?? bytes;
    const m: Meta = {
      version, deleted: full === null, modifiedBy: by, mtimeMs: wall(d), size: full?.length ?? 0, blocksHash: full ? blocksHash(full) : null, sequence: ++d.seq,
    };
    f.files.set(path, m);
    f.db.set(path, m);
    f.global.set(path, m);
    if (by === d.short && isOwn(d, classId, path, full)) d.mirror.set(`${classId}|${path}`, full ? full.slice() : null);
    scheduleAuto();
  }

  /** Whether a machine file is this device's own (its writer), for the self-heal mirror. */
  function isOwn(d: Device, classId: ClassId, path: ClassPath, bytes: Uint8Array | null): boolean {
    const kind = classifyPath(path).kind;
    if (kind === 'transcriptJson' || kind === 'transcriptMd' || kind === 'transcriptVtt' || kind === 'audio' || kind === 'content' || kind === 'conflictCopy' || kind === 'skipped') return false;
    if (bytes && bytes.length > 1024 * 1024) return false;
    let parsed: unknown = null;
    const b = bytes ?? d.platform.mem.list(classId).get(path)?.bytes ?? null;
    if (b && path.endsWith('.json')) {
      try {
        parsed = JSON.parse(new TextDecoder().decode(b));
      } catch {
        parsed = null;
      }
    }
    const w = writerOf(path, parsed) ?? classifyPath(path).deviceId ?? null;
    return w === d.deviceId || (w === null && d.mirror.has(`${classId}|${path}`));
  }

  /** §12.3: a foreign write to (or deletion of) one of my files is rewritten from the mirror. */
  function selfHeal(d: Device, f: Folder, path: ClassPath, m: Meta) {
    if (m.modifiedBy === d.short) return;
    const key = `${f.classId}|${path}`;
    if (!d.mirror.has(key)) return;
    const mine = d.mirror.get(key)!;
    const cur = bytesOf(d, f.classId, path);
    if (mine === null || (cur && toBase64(cur) === toBase64(mine))) return;
    d.applying = true;
    try {
      d.platform.mem.applyRemote(f.classId, path, mine, { modifiedBy: d.short, mtimeMs: wall(d) });
    } finally {
      d.applying = false;
    }
    localChange(d, f.classId, path, mine);
    emit(d, { type: 'foreignWrite', classId: f.classId, path, modifiedBy: m.modifiedBy, healed: true });
  }

  // ── exchange ──────────────────────────────────────────────────────────────────────────────────
  function bytesOf(d: Device, classId: ClassId, path: ClassPath): Uint8Array | null {
    return d.platform.mem.list(classId).get(path)?.bytes ?? null;
  }
  function receive(to: Device, from: Device, f: Folder, path: ClassPath, m: Meta, changed: { any: boolean; deletions: Map<ShortId, ClassPath[]> }) {
    const cur = f.files.get(path);
    const bytes = m.deleted ? null : bytesOf(from, f.classId, path);
    if (!m.deleted && !bytes) return;   // the sender lost the bytes; wait
    const local = bytesOf(to, f.classId, path);
    if (local && (m.deleted || !bytes || toBase64(local) !== toBase64(bytes))) {
      f.versions.push({ path, versionTime: wall(to), modTime: cur?.mtimeMs ?? wall(to), bytes: local });   // trashcan (§6.2)
    }
    const meta: Meta = { ...m, sequence: ++to.seq };
    f.files.set(path, meta);
    f.global.set(path, meta);
    if (m.deleted && !local) {
      f.db.set(path, meta);
      return;
    }
    to.applying = true;
    try {
      to.platform.mem.applyRemote(f.classId, path, bytes, { modifiedBy: m.modifiedBy, mtimeMs: m.mtimeMs });
    } finally {
      to.applying = false;
    }
    changed.any = true;
    if (m.deleted) changed.deletions.set(m.modifiedBy, [...(changed.deletions.get(m.modifiedBy) ?? []), path]);
    const e: SyncEvent = { type: 'remoteChange', classId: f.classId, path, action: m.deleted ? 'deleted' : 'modified', modifiedBy: m.modifiedBy };
    if (eventLag > 0) to.pendingEvents.push({ due: flushRound + eventLag, e, db: { classId: f.classId, path, meta } });
    else {
      f.db.set(path, meta);
      emit(to, e);
    }
    if (to.up && !to.healOff) selfHeal(to, f, path, meta);
  }
  /** Concurrent versions: the older modification (equal: the larger device ID) becomes the conflict copy (Syncthing). */
  function resolveConflict(a: Device, b: Device, fa: Folder, fb: Folder, path: ClassPath, ma: Meta, mb: Meta, ca: Changed, cb: Changed) {
    let winner: [Device, Folder, Meta, Changed];
    let loser: [Device, Folder, Meta, Changed];
    const aWins = ma.deleted !== mb.deleted ? !ma.deleted : ma.mtimeMs !== mb.mtimeMs ? ma.mtimeMs > mb.mtimeMs : ma.modifiedBy < mb.modifiedBy;
    if (aWins) [winner, loser] = [[a, fa, ma, ca], [b, fb, mb, cb]];
    else [winner, loser] = [[b, fb, mb, cb], [a, fa, ma, ca]];
    const [L, fl, ml, cl] = loser;
    const [W, , mw] = winner;
    const merged: Meta = { ...mw, version: mergeVV(mw.version, ml.version) };
    if (!ml.deleted) {
      const old = bytesOf(L, fl.classId, path);
      if (old) {
        const copy = conflictName(path, ml.mtimeMs, ml.modifiedBy);
        L.applying = true;
        try {
          L.platform.mem.applyRemote(fl.classId, copy, old, { modifiedBy: L.short, mtimeMs: wall(L) });
        } finally {
          L.applying = false;
        }
        localChange(L, fl.classId, copy, old);
      }
    }
    receive(L, W, fl, path, merged, cl);
    // The winner learns the merged version (same bytes).
    const fw = W.folders.get(fl.classId);
    if (fw) {
      fw.files.set(path, { ...merged, sequence: ++W.seq });
      fw.db.set(path, fw.files.get(path)!);
      fw.global.set(path, fw.files.get(path)!);
    }
  }
  type Changed = { any: boolean; deletions: Map<ShortId, ClassPath[]> };

  function exchange(a: Device, b: Device, changes: Map<Device, Map<ClassId, Changed>>): boolean {
    let moved = false;
    for (const [classId, fa] of a.folders) {
      const fb = b.folders.get(classId);
      if (!fb || fa.paused || fb.paused || a.paused || b.paused) continue;
      if (!fa.devices.has(b.deviceId) || !fb.devices.has(a.deviceId)) continue;
      const ch = (d: Device) => {
        let m = changes.get(d);
        if (!m) changes.set(d, (m = new Map()));
        let c = m.get(classId);
        if (!c) m.set(classId, (c = { any: false, deletions: new Map() }));
        return c;
      };
      const ca = ch(a);
      const cb = ch(b);
      for (const path of new Set([...fa.files.keys(), ...fb.files.keys()])) {
        const ma = fa.files.get(path);
        const mb = fb.files.get(path);
        const rel = ma && mb ? cmpVV(ma.version, mb.version) : ma ? 'greater' : 'less';
        if (rel === 'equal') continue;
        moved = true;
        if (rel === 'greater') {
          fb.global.set(path, ma!);
          if (fb.hold !== null && path.startsWith(fb.hold)) continue;
          if (!mb && ma!.deleted) {
            fb.files.set(path, { ...ma!, sequence: ++b.seq });
            fb.db.set(path, fb.files.get(path)!);
            continue;
          }
          receive(b, a, fb, path, ma!, cb);
          ca.any = true;
        } else if (rel === 'less') {
          fa.global.set(path, mb!);
          if (fa.hold !== null && path.startsWith(fa.hold)) continue;
          if (!ma && mb!.deleted) {
            fa.files.set(path, { ...mb!, sequence: ++a.seq });
            fa.db.set(path, fa.files.get(path)!);
            continue;
          }
          receive(a, b, fa, path, mb!, ca);
          cb.any = true;
        } else {
          if ((fa.hold !== null && path.startsWith(fa.hold)) || (fb.hold !== null && path.startsWith(fb.hold))) continue;
          resolveConflict(a, b, fa, fb, path, ma!, mb!, ca, cb);
          ca.any = cb.any = true;
        }
      }
    }
    return moved;
  }

  // ── admission, offers, reconciliation, leaving ───────────────────────────────────────────────
  function admission(m: Device, j: Device) {
    for (const [classId, fj] of j.folders) {
      if (!fj.devices.has(m.deviceId)) continue;
      const fm = m.folders.get(classId);
      if (!fm) {
        if (m.leftClasses.has(classId) || fj.leaving) continue;
        const key = `${classId}|${j.deviceId}`;
        if (!m.offers.has(key)) {
          const offer: FolderOfferView = { folderId: classId, label: fj.label, offeredBy: j.deviceId, offeredByName: j.name, at: instant(wall(m)) };
          m.offers.set(key, offer);
          emit(m, { type: 'folderOffer', offer });
        }
        continue;
      }
      if (fm.devices.has(j.deviceId) || fm.refused.has(j.deviceId) || fm.leaving) continue;
      const policy = m.policies.get(classId);
      if (!policy) continue;                                    // start-up rule: no policy yet → defer (§9.2)
      const decision = decide({ [classId]: policy }, { ownDevices: [], pairingOpenUntil: null }, { folderId: classId, deviceId: j.deviceId, inFolder: false }, wall(m));
      if (decision === 'share') share(m, fm, j.deviceId, `${j.name}`);
      else if (decision === 'queue' && !fm.queued.has(j.deviceId)) {
        const request: JoinRequestView = { classId, deviceId: j.deviceId, name: j.name, address: `127.0.0.1:${22100 + j.index}`, at: instant(wall(m)) };
        fm.queued.set(j.deviceId, request);
        emit(m, { type: 'joinRequest', request });
      } else if (decision === 'ban') fm.refused.add(j.deviceId);
    }
  }
  function share(m: Device, fm: Folder, deviceId: DeviceId, name: string) {
    fm.devices.add(deviceId);
    if (fm.queued.delete(deviceId)) emit(m, { type: 'joinRequestGone', classId: fm.classId, deviceId });
    emit(m, { type: 'admitted', classId: fm.classId, deviceId, name });
  }
  function reconcile(d: Device, f: Folder) {
    const policy = d.policies.get(f.classId);
    if (!policy || f.leaving) return;
    const banned = new Set(policy.bannedDevices);
    const roster = new Set<DeviceId>();
    for (const r of policy.roster) {
      if (r.deviceId === d.deviceId || banned.has(r.deviceId)) continue;
      // §9.5: Rust re-checks the member file's modifiedBy itself.
      const m = f.db.get(`.tramado/members/${r.deviceId}.json`);
      if (m && !m.deleted && m.modifiedBy === shortIdOf(r.deviceId)) roster.add(r.deviceId);
    }
    for (const r of roster) f.seenMember.add(r);
    const keep = new Set<DeviceId>([d.deviceId]);
    for (const x of f.devices) {
      if (x === d.deviceId || banned.has(x)) continue;
      if (roster.has(x)) keep.add(x);
      else if (left(f, x)) continue;
      else keep.add(x);
    }
    for (const r of roster) keep.add(r);
    f.devices = keep;
    for (const b of banned) f.refused.add(b);
    for (const r of roster) f.refused.delete(r);
  }
  function left(f: Folder, x: DeviceId): boolean {
    const m = f.global.get(`.tramado/members/${x}.json`);
    return f.seenMember.has(x) && !!m && m.deleted && m.modifiedBy === shortIdOf(x);
  }
  function finishLeaving(d: Device) {
    for (const [classId, f] of [...d.folders]) {
      if (!f.leaving) continue;
      const mine = f.files.get(`.tramado/members/${d.deviceId}.json`);
      const held = !!mine && mine.deleted && [...devices.values()].some((o) => linked(d, o) && cmpVV(o.folders.get(classId)?.files.get(`.tramado/members/${d.deviceId}.json`)?.version ?? {}, mine.version) === 'equal');
      if (!held && wall(d) - f.leaving.since < 30 * 86_400_000) continue;
      d.folders.delete(classId);
      d.leftClasses.add(classId);
      const e = d.registry.entries.get(classId);
      if (e) {
        d.registry.insert({ ...e, shared: false, joining: false, leaving: null });
        if (f.leaving.afterwards === 'trash') void d.registry.api.trash(classId).catch(() => undefined);
      }
      emit(d, { type: 'status', status: statusOf(d) });
      // The `left` event Rust emits when finish_leaving ran (sync spec §17).
      emit(d, { type: 'left', classId, afterwards: f.leaving.afterwards });
    }
  }

  // ── views ─────────────────────────────────────────────────────────────────────────────────────
  function statusOf(d: Device): SyncStatus {
    return {
      state: 'running', deviceId: d.deviceId, version: 'v2.1.7', syncPort: 22100 + d.index, localOnly: false, paused: d.paused,
      startedAt: instant(d.startedAt), restarts: 0, error: null,
    };
  }
  function needOf(f: Folder): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;
    for (const [p, g] of f.global) {
      const l = f.files.get(p);
      if (!l || cmpVV(g.version, l.version) === 'greater') {
        files++;
        bytes += g.size;
      }
    }
    return { files, bytes };
  }
  function folderView(d: Device, f: Folder): FolderView {
    const need = needOf(f);
    const entry = d.registry.entries.get(f.classId);
    const completion: FolderView['completion'] = {};
    for (const x of f.devices) {
      if (x === d.deviceId) continue;
      const o = byId(x);
      const of = o?.folders.get(f.classId);
      const ok = !!o && linked(d, o) && !!of && of.devices.has(d.deviceId);
      completion[x] = { completion: ok ? 100 : 0, needItems: 0, remoteState: ok ? 'valid' : of ? 'notSharing' : 'unknown' };
    }
    return {
      classId: f.classId, label: f.label, path: entry?.path ?? '', paused: f.paused || d.paused, state: need.files ? 'syncing' : 'idle',
      globalFiles: [...f.global.values()].filter((m) => !m.deleted).length, inSyncFiles: [...f.files.values()].filter((m) => !m.deleted).length - 0,
      needFiles: need.files, needBytes: need.bytes, pullErrors: 0, error: null, devices: [...f.devices], completion,
    };
  }
  function deviceViews(d: Device): DeviceView[] {
    const ids = new Set<DeviceId>();
    for (const f of d.folders.values()) for (const x of f.devices) if (x !== d.deviceId) ids.add(x);
    return [...ids].map((x) => {
      const o = byId(x);
      const connected = !!o && linked(d, o) && [...d.folders.values()].some((f) => f.devices.has(x) && o.folders.get(f.classId)?.devices.has(d.deviceId));
      const seen = d.lastSeen.get(x);
      return {
        deviceId: x, name: o?.name ?? x.slice(0, 7), connected, relay: false, address: connected ? `127.0.0.1:${22100 + (o?.index ?? 0)}` : null, paused: false,
        lastSeen: connected ? instant(wall(d)) : seen === undefined ? null : instant(seen), folders: [...d.folders.values()].filter((f) => f.devices.has(x)).map((f) => f.classId),
        provisional: false, ignored: false,
      };
    });
  }
  function availability(d: Device, f: Folder, path: ClassPath, m: Meta | undefined): DeviceId[] {
    if (!m) return [];
    const out: DeviceId[] = [];
    for (const o of devices.values()) {
      if (!linked(d, o)) continue;
      const of = o.folders.get(f.classId);
      if (!of || !of.devices.has(d.deviceId) || !f.devices.has(o.deviceId)) continue;
      const om = of.files.get(path);
      if (om && cmpVV(om.version, m.version) === 'equal') out.push(o.deviceId);
    }
    return out;
  }
  function caughtUp(d: Device, f: Folder): DeviceId[] {
    const pending: DeviceId[] = [];
    for (const o of devices.values()) {
      if (!linked(d, o)) continue;
      const of = o.folders.get(f.classId);
      if (!of || !of.devices.has(d.deviceId) || !f.devices.has(o.deviceId)) continue;
      for (const [p, om] of of.files) {
        const m = f.files.get(p);
        if (!m || cmpVV(om.version, m.version) === 'greater') {
          pending.push(o.deviceId);
          break;
        }
      }
    }
    return pending;
  }
  function wait(d: Device, check: () => boolean, timeoutMs: number): Promise<boolean> {
    if (check()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let cancel: (() => void) | null = null;
      const w: Waiter = { check, done: () => { cancel?.(); resolve(true); } };
      d.waiters.add(w);
      cancel = clockOf(d).setTimeout(() => {
        if (d.waiters.delete(w)) resolve(check());
      }, timeoutMs);
    });
  }

  // ── the simulated Syncthing of one device ──────────────────────────────────────────────────────
  function syncFor(d: Device, local: Platform['sync']): Platform['sync'] {
    const entryOf = async (classId: ClassId): Promise<ClassEntry> => {
      const e = (await d.registry.api.list()).find((x) => x.classId === classId);
      if (!e) throw new PlatformError('NOT_FOUND', `class ${classId} is not registered`);
      return e;
    };
    return {
      identity: async () => ({ deviceId: d.deviceId, shortId: d.short, syncPort: 22100 + d.index }),
      resolveCopiedIdentity: async () => ({ deviceId: d.deviceId, shortId: d.short, syncPort: 22100 + d.index }),
      start: async () => statusOf(d),
      restart: async () => statusOf(d),
      status: async () => statusOf(d),
      snapshot: async () => ({
        status: statusOf(d), folders: [...d.folders.values()].map((f) => folderView(d, f)), devices: deviceViews(d),
        joinRequests: [...d.folders.values()].flatMap((f) => [...f.queued.values()]), folderOffers: [...d.offers.values()],
        existing: { running: false, configFound: false },
      }),
      applySettings: async (s) => {
        d.paused = s.paused;
      },
      setPolicy: async (p) => {
        d.policies.set(p.classId, p);
        const f = d.folders.get(p.classId);
        if (f) {
          f.label = p.label;
          reconcile(d, f);
        }
        scheduleAuto();
      },
      sign: local.sign,
      async shareClass(classId, label) {
        const e = d.registry.get(classId);
        if (e.shared || d.folders.has(classId)) throw new PlatformError('CONFLICT', 'already shared');
        d.leftClasses.delete(classId);
        const f = newFolder(classId, label, [d.deviceId]);
        d.folders.set(classId, f);
        scan(d, f);
        d.registry.insert({ ...e, shared: true });
        scheduleAuto();
        return entryOf(classId);
      },
      async joinClass(req) {
        let decoded;
        try {
          decoded = decodeInvite(req.code, Math.floor(wall(d) / 1000));
        } catch (problem) {
          throw new PlatformError(problem === 'newer' ? 'NEWER_FORMAT' : 'SYNC_INVITE_INVALID', 'invite');
        }
        const classId = decoded.invite.f;
        if (d.folders.has(classId) || d.registry.entries.has(classId)) throw new PlatformError('CONFLICT', 'already have this class');
        const devs = decoded.devices.map((x) => x.deviceId).filter((x) => x !== d.deviceId);
        if (devs.length === 0) throw new PlatformError('SYNC_INVITE_INVALID', 'own invite');
        const root = await d.registry.api.root();
        d.registry.insert({
          classId, path: `${root.path}/${req.dirName}`, dirName: req.dirName, shared: true, joining: true, archived: false, skipAudio: !req.includeAudio,
          aliases: [], localIgnores: [], addedAt: instant(wall(d)), leaving: null,
        });
        await d.platform.fs.mkdir(classId, '.tramado');
        d.leftClasses.delete(classId);
        d.folders.set(classId, newFolder(classId, decoded.invite.l, [d.deviceId, ...devs]));
        scheduleAuto();
        queueMicrotask(notifyConnections);   // the invite's devices dial in (connection events, sync spec §8)
        return entryOf(classId);
      },
      async cancelJoin(classId) {
        d.folders.delete(classId);
        const e = d.registry.entries.get(classId);
        if (e) {
          d.registry.insert({ ...e, shared: false, joining: false });
          await d.registry.api.trash(classId);
        }
      },
      async acceptFolder(req) {
        const key = `${req.folderId}|${req.offeredBy}`;
        if (!d.offers.has(key)) throw new PlatformError('PERMISSION_DENIED', 'no such offer');
        d.offers.delete(key);
        const root = await d.registry.api.root();
        d.registry.insert({
          classId: req.folderId, path: `${root.path}/${req.dirName}`, dirName: req.dirName, shared: true, joining: true, archived: false,
          skipAudio: !req.includeAudio, aliases: [], localIgnores: [], addedAt: instant(wall(d)), leaving: null,
        });
        await d.platform.fs.mkdir(req.folderId, '.tramado');
        d.folders.set(req.folderId, newFolder(req.folderId, req.label, [d.deviceId, req.offeredBy]));
        scheduleAuto();
        return entryOf(req.folderId);
      },
      async leaveClass(classId, o) {
        const f = folderOf(d, classId);
        f.leaving = { since: wall(d), afterwards: o.afterwards };
        const e = d.registry.get(classId);
        d.registry.insert({ ...e, leaving: { since: instant(wall(d)), afterwards: o.afterwards } });
        scheduleAuto();
      },
      async admit(classId, deviceId) {
        const f = folderOf(d, classId);
        const q = f.queued.get(deviceId);
        if (!q) throw new PlatformError('PERMISSION_DENIED', 'the device has no pending offer of this class');
        share(d, f, deviceId, q.name);
        scheduleAuto();
      },
      async decline(classId, deviceId) {
        const f = folderOf(d, classId);
        if (f.queued.delete(deviceId)) emit(d, { type: 'joinRequestGone', classId, deviceId });
        f.refused.add(deviceId);
      },
      resolveMassDelete: async () => undefined,
      normalizeIds: async (ids) => ids.map((s) => {
        const x = dashed(s.trim());
        return deviceIdChecks(x) ? x : null;
      }),
      ownAddresses: async () => [`tcp://127.0.0.1:${22100 + d.index}`],
      async fileInfo(classId, paths): Promise<FileSyncInfo[]> {
        const f = folderOf(d, classId);
        return paths.map((path) => {
          const m = f.db.get(path);
          const g = f.global.get(path);
          return {
            path, localModifiedBy: m?.modifiedBy ?? null, localDeleted: m?.deleted ?? true, localSize: m && !m.deleted ? m.size : null,
            localBlocksHash: m && !m.deleted ? m.blocksHash : null, localModified: m ? instant(m.mtimeMs) : null,
            localVersion: m ? Object.entries(m.version).map(([k, v]) => `${k}:${v}`) : [], localSequence: m?.sequence ?? null,
            globalModifiedBy: g?.modifiedBy ?? null, globalDeleted: g?.deleted ?? true, availability: availability(d, f, path, f.files.get(path)),
          };
        });
      },
      async waitAvailable(classId, path, minDevices, timeoutMs) {
        const f = folderOf(d, classId);
        return wait(d, () => availability(d, f, path, f.files.get(path)).length >= minDevices, timeoutMs);
      },
      async waitCaughtUp(classId, timeoutMs): Promise<CaughtUp> {
        const f = folderOf(d, classId);
        const t0 = mono;
        await wait(d, () => caughtUp(d, f).length === 0, timeoutMs);
        const pending = caughtUp(d, f);
        return { complete: pending.length === 0, waitedMs: mono - t0, pending };
      },
      deviceStats: async () => Object.fromEntries(deviceViews(d).map((v) => [v.deviceId, { lastSeen: v.lastSeen, lastConnectionDurationS: 0 }])),
      folderStatus: async (classId) => folderView(d, folderOf(d, classId)),
      async versions(classId): Promise<VersionEntry[]> {
        return folderOf(d, classId).versions.map((v) => ({ path: v.path, versionTime: instant(v.versionTime), modTime: instant(v.modTime), size: v.bytes.length }));
      },
      async restore(classId, items) {
        const f = folderOf(d, classId);
        for (const it of items) {
          const i = f.versions.findIndex((v) => v.path === it.path && instant(v.versionTime) === it.versionTime);
          if (i < 0) throw new PlatformError('NOT_FOUND', `no version of ${it.path}`);
          const v = f.versions[i]!;
          f.versions.splice(i, 1);
          d.applying = true;
          try {
            d.platform.mem.applyRemote(classId, v.path, v.bytes, { modifiedBy: d.short, mtimeMs: wall(d) });
          } finally {
            d.applying = false;
          }
          localChange(d, classId, v.path, v.bytes);
        }
      },
      folderErrors: async () => [],
      pauseClass: async (classId, paused) => {
        folderOf(d, classId).paused = paused;
      },
      scan: async () => undefined,
      diagnostics: async () => ({
        status: statusOf(d), ports: { sync: 22100 + d.index, guiOpen: false }, listeners: {}, connections: deviceViews(d).filter((v) => v.connected).length,
        relayed: 0, lastErrors: [], logTail: [`mesh device ${d.name}`],
      }),
      existing: async () => ({ running: false, configFound: false }),
    };
  }

  const clocks = new Map<string, MeshClock>();
  function clockOf(d: Device): MeshClock {
    let c = clocks.get(d.name);
    if (!c) {
      c = {
        now: () => wall(d),
        mono: () => mono,
        setTimeout(f, ms) {
          const id = ++timerSeq;
          timers.set(id, { at: mono + Math.max(0, ms), f, owner: d.name });
          return () => timers.delete(id);
        },
      };
      clocks.set(d.name, c);
    }
    return c;
  }

  const drain = async () => {
    for (let i = 0; i < 3; i++) await new Promise<void>((r) => setTimeout(r, 0));
  };

  const mesh: MemoryMesh = {
    device(name, o = {}) {
      if (devices.has(name)) throw new Error(`mesh: device ${name} exists`);
      let index = devices.size;
      if (o.deviceId) {
        index = -1;
        for (let i = 0; i < DEVICE_KEYS; i++) if (deviceIdentity(i).deviceId === o.deviceId) index = i;
        if (index < 0) throw new Error('mesh: the device ID is not in the memory key pool');
      }
      if (index >= DEVICE_KEYS) throw new Error('mesh: at most 32 devices');
      const d = { name, index, up: true, group: 0, skew: opts.clockSkewMs?.[name] ?? 0, seq: 0, folders: new Map(), policies: new Map(), leftClasses: new Set(),
        offers: new Map(), lastSeen: new Map(), pendingEvents: [], waiters: new Set(), paused: false, startedAt: startMs, applying: false, mirror: new Map(), healOff: false } as unknown as Device;
      devices.set(name, d);
      const platform = createMemoryPlatform({ kind: 'test', deviceIndex: index, clock: { now: () => wall(d) }, rand: mulberry32(opts.seed * 31 + index), root: `/home/${name}/Tramado`, ...(o.speech ? { speech: o.speech } : {}) });
      const internals = localSyncInternals(platform.sync);
      if (!internals) throw new Error('mesh: the memory platform has no local sync');
      Object.assign(d, { platform, registry: internals.deps.registry, deviceId: platform.mem.deviceId, short: shortIdOf(platform.mem.deviceId) });
      d.startedAt = wall(d);
      platform.mem.setSync(syncFor(d, platform.sync));
      platform.mem.onWrite((classId, path, bytes, kind, from) => {
        if (d.applying) return;
        if (kind === 'move' && from) localChange(d, classId, from, null);
        localChange(d, classId, path, kind === 'remove' ? null : bytes);
      });
      void o.memberId;
      return platform;
    },
    async flush() {
      flushRound++;
      const wasJoining = new Map([...devices.values()].map((d) => [d, new Set([...d.registry.entries.values()].filter((e) => e.joining).map((e) => e.classId))]));
      // Lagging events and database entries of the previous rounds.
      for (const d of devices.values()) {
        const due = d.pendingEvents.filter((p) => p.due <= flushRound);
        d.pendingEvents = d.pendingEvents.filter((p) => p.due > flushRound);
        for (const p of due) {
          if (p.db) d.folders.get(p.db.classId)?.db.set(p.db.path, p.db.meta);
          emit(d, p.e);
        }
      }
      const list = [...devices.values()];
      for (const a of list) for (const b of list) if (linked(a, b)) {
        a.lastSeen.set(b.deviceId, wall(a));
        admission(a, b);
      }
      const changes = new Map<Device, Map<ClassId, Changed>>();
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (linked(list[i]!, list[j]!)) exchange(list[i]!, list[j]!, changes);
      for (const [d, byClass] of changes) for (const [classId, c] of byClass) {
        if (!c.any) continue;
        emit(d, { type: 'indexUpdated', classId, remote: true });
        for (const [by, paths] of c.deletions) if (paths.length > 20 && by !== d.short) {
          emit(d, { type: 'massDeleteRemote', classId, by, count: paths.length, sample: paths.slice(0, 10) });
        }
        const e = d.registry.entries.get(classId);
        if (e?.joining && d.platform.mem.list(classId).has('.tramado/class.json')) d.registry.insert({ ...e, joining: false });
      }
      for (const j of list) for (const [classId, f] of j.folders) for (const x of f.devices) {
        const m = byId(x);
        if (!m || !linked(m, j) || f.admittedBy.has(x)) continue;
        if (m.folders.get(classId)?.devices.has(j.deviceId)) {
          f.admittedBy.add(x);
          if (f.admittedBy.size === 1 && (j.registry.entries.get(classId)?.joining || wasJoining.get(j)?.has(classId))) emit(j, { type: 'admittedMe', classId, byDevice: x });
        }
      }
      for (const d of list) {
        if (!d.up) continue;
        for (const f of d.folders.values()) reconcile(d, f);
        finishLeaving(d);
        wake(d);
      }
      await drain();
    },
    async settle(maxRounds = 30) {
      for (let i = 0; i < maxRounds; i++) {
        const before = JSON.stringify([...devices.values()].map((d) => [...d.folders.values()].map((f) => [f.devices.size, [...f.files.values()].map((m) => m.sequence)])));
        await mesh.flush();
        const after = JSON.stringify([...devices.values()].map((d) => [...d.folders.values()].map((f) => [f.devices.size, [...f.files.values()].map((m) => m.sequence)])));
        if (before === after && [...devices.values()].every((d) => d.pendingEvents.length === 0)) return;
      }
    },
    partition(...groups) {
      for (const d of devices.values()) d.group = -1 - Math.floor(rand() * 1e9);   // alone unless listed
      groups.forEach((g, i) => g.forEach((n) => (dev(n).group = i)));
      notifyConnections();
    },
    heal() {
      for (const d of devices.values()) d.group = 0;
      notifyConnections();
    },
    crash(name) {
      const d = dev(name);
      d.up = false;
      for (const [id, t] of timers) if (t.owner === name) timers.delete(id);
      d.waiters.clear();
      d.pendingEvents = [];
      notifyConnections();
    },
    restart(name) {
      const d = dev(name);
      d.up = true;
      d.startedAt = wall(d);
      notifyConnections();
      return d.platform;
    },
    async advance(ms) {
      const end = mono + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        mono = Math.max(mono, due[1].at);
        try {
          due[1].f();
        } catch (e) {
          console.error(e);
        }
        await drain();
      }
      mono = end;
      await drain();
    },
    forge(by, owner, classId, path, bytes) {
      const d = dev(by);
      void owner;
      d.applying = true;
      try {
        d.platform.mem.applyRemote(classId, path, bytes.length ? bytes : null, { modifiedBy: d.short, mtimeMs: wall(d) });
      } finally {
        d.applying = false;
      }
      localChange(d, classId, path, bytes.length ? bytes : null);
    },
    forgeAs(by, as, classId, path, bytes) {
      const d = dev(by);
      const claimed = dev(as).short;
      d.applying = true;
      try {
        d.platform.mem.applyRemote(classId, path, bytes.length ? bytes : null, { modifiedBy: claimed, mtimeMs: wall(d) });
      } finally {
        d.applying = false;
      }
      localChange(d, classId, path, bytes.length ? bytes : null, claimed);
    },
    files(name, classId) {
      return new Map([...dev(name).platform.mem.list(classId)].map(([p, f]) => [p, f.bytes]));
    },
    clock: (name) => clockOf(dev(name)),
    names: () => [...devices.keys()],
    isUp: (name) => dev(name).up,
    connected: (a, b) => linked(dev(a), dev(b)),
    holdBytes(name, classId, prefix) {
      folderOf(dev(name), classId).hold = prefix;
    },
    folderDevices: (name, classId) => [...(dev(name).folders.get(classId)?.devices ?? [])].sort(),
    policy: (name, classId) => dev(name).policies.get(classId) ?? null,
    setSkew(name, ms) {
      dev(name).skew = ms;
    },
    setSelfHeal(name, on) {
      dev(name).healOff = !on;
    },
  };

  const connState = new Map<string, boolean>();
  function notifyConnections() {
    const list = [...devices.values()];
    for (const a of list) for (const b of list) {
      if (a === b) continue;
      const shares = [...a.folders.values()].some((f) => f.devices.has(b.deviceId));
      if (!shares) continue;
      const key = `${a.name}>${b.name}`;
      const now = linked(a, b);
      if (connState.get(key) === now) continue;
      connState.set(key, now);
      if (!now) a.lastSeen.set(b.deviceId, wall(a));
      emit(a, { type: 'connection', deviceId: b.deviceId, connected: now, relay: false, address: now ? `127.0.0.1:${22100 + b.index}` : null });
    }
  }

  return mesh;
}
