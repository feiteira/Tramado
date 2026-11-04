// The app-level sync service (architecture §11.2, §4.4, §12 rule 5): boot (snapshot, trust pass, policy push for
// every shared class), routing of `sync:event`, sharing, invites (sync spec §7), joining (§8), leaving with the
// background state and the fork (§17), admission answers (§9.3), bans (§18.1), folder offers, settings, "Recently
// deleted" (§22.1), the mass-delete guards (§22.2) and diagnostics. No rotation, pairing or relocate (v1.1).
import { PlatformError, toPlatformError } from '../core/errors';
import { classIdOf, newNonce } from '../core/model/derive';
import { classifyPath } from '../core/model/paths';
import { sanitize, unique } from '../core/model/sanitize';
import { dashless, shortIdOf, type ClassId, type ClassPath, type DeviceId, type ShortId } from '../core/model/ids';
import type { InviteV1 } from '../core/model/files';
import { checkWords } from '../core/sync/checkWords';
import {
  chooseInviteDevices, decodeInvite, encodeInvite, inviteFileName, inviteLink, inviteWeb, qrText, reduceInvite, selectInviteAddresses,
} from '../core/sync/invite';
import type { ClassEntry, FolderView, SyncEvent, SyncSettings } from '../platform/types';
import type { ClassServiceImpl } from './class';
import type { AppContext } from './context';
import { Store, type ReadableStore } from './store';
import type { TrustServiceImpl } from './trust';
import type { AppServices } from './types/common';
import type { InvitePreview, SyncService, SyncUiState } from './types/sync';

export const EMPTY_SYNC_STATE: SyncUiState = {
  status: null, folders: {}, joinRequests: [], offers: [], massDelete: [], massDeleteRemote: [], foreignWrites: 0, markerMissing: [],
  identityCopied: false, joinStalled: [],
};

export interface ConnectionState { connected: boolean; relay: boolean; lastSeen: string | null }

/** What other services reach behind SyncService (additive, T-SYNC). */
export interface SyncServiceImpl extends SyncService {
  /** Peer devices: connected, relay, last seen (from the snapshot, `connection` events and deviceStats). */
  connections: ReadableStore<Record<DeviceId, ConnectionState>>;
  connectionOf(deviceId: DeviceId): ConnectionState | null;
  /** `indexUpdated` events per class (chat delivery ticks, sync spec §15). */
  onIndexUpdated(cb: (classId: ClassId) => void): () => void;
  noteForeignWrite(classId: ClassId, path: ClassPath): void;
  /** Forks a class kept after leaving or adopted with foreign member files (sync spec §17). */
  fork(classId: ClassId): Promise<ClassId>;
  /** Finishes the forks of classes left with "keep a copy" once Rust finished leaving them. */
  completeForks(): Promise<void>;
}

const JOIN_STALL_MS = 90_000;
const ADDRESS_REFRESH_MS = 5 * 60_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
/** The second line of a .tramado-invite file (UX §3.12.2). Requested catalog key: members.invite.fileSentence. */
const FILE_SENTENCE = 'Open this file with Tramado to join {class}.';

export function createSyncService(ctx: AppContext, app: () => AppServices): SyncServiceImpl {
  const { platform, clock } = ctx;
  const state = new Store<SyncUiState>(EMPTY_SYNC_STATE);
  const connections = new Store<Record<DeviceId, ConnectionState>>({});
  const indexListeners = new Set<(classId: ClassId) => void>();
  const joinTimers = new Map<ClassId, () => void>();
  let booted = false;
  let addressTimer: (() => void) | null = null;
  const patch = (p: Partial<SyncUiState>) => state.set({ ...state.get(), ...p });
  const classOf = (classId: ClassId) => app().forClass(classId);
  const info = (classId: ClassId) => classOf(classId).info as ClassServiceImpl;
  const entries = async () => platform.classes.list();
  const shared = async () => (await entries()).filter((e) => e.shared && !e.leaving);
  const className = (classId: ClassId) => {
    try {
      return info(classId).detail.get().meta.name || classId;
    } catch {
      return classId;
    }
  };
  const notify = (kind: Parameters<AppServices['notifications']['notify']>[0], key: string, vars: Record<string, string | number>, tag?: string) =>
    void app().notifications.notify(kind, key, vars, tag).catch(() => undefined);

  function setConnection(deviceId: DeviceId, c: Partial<ConnectionState>) {
    const cur = connections.get()[deviceId] ?? { connected: false, relay: false, lastSeen: null };
    const next = { ...cur, ...c };
    if (JSON.stringify(next) !== JSON.stringify(cur)) connections.set({ ...connections.get(), [deviceId]: next });
  }

  async function snapshot() {
    try {
      const s = await platform.sync.snapshot();
      const folders: Record<ClassId, FolderView> = {};
      for (const f of s.folders) folders[f.classId] = f;
      patch({ status: s.status, folders, joinRequests: s.joinRequests, offers: s.folderOffers });
      const conn: Record<DeviceId, ConnectionState> = {};
      for (const d of s.devices) conn[d.deviceId] = { connected: d.connected, relay: d.relay, lastSeen: d.lastSeen };
      connections.set(conn);
    } catch (e) {
      const code = toPlatformError(e).code;
      if (code === 'SYNC_IDENTITY_COPIED') patch({ identityCopied: true });
      try {
        patch({ status: await platform.sync.status() });
      } catch {
        // no sharing on this platform
      }
    }
  }

  async function startClasses(): Promise<void> {
    for (const e of await shared()) {
      try {
        const c = classOf(e.classId);
        c.store.setTrustGate(c.trust);
        const t = c.trust as TrustServiceImpl;
        await (c.info as ClassServiceImpl).ready();
        await t.pass();
        await (c.info as ClassServiceImpl).reload();
      } catch (err) {
        ctx.log('warn', 'class start failed', { classId: e.classId, error: String(err) });
      }
    }
  }

  function route(e: SyncEvent) {
    switch (e.type) {
      case 'status':
        patch({ status: e.status });
        void service.completeForks();
        break;
      case 'gap':
        void snapshot().then(startClasses);
        break;
      case 'folder':
        patch({ folders: { ...state.get().folders, [e.folder.classId]: e.folder } });
        if (e.folder.error && /marker/i.test(e.folder.error)) patch({ markerMissing: [...new Set([...state.get().markerMissing, e.folder.classId])] });
        break;
      case 'completion': {
        const f = state.get().folders[e.classId];
        if (f) patch({ folders: { ...state.get().folders, [e.classId]: { ...f, completion: { ...f.completion, [e.deviceId]: { completion: e.completion, needItems: e.needItems, remoteState: e.remoteState } } } } });
        if (e.remoteState === 'valid') clearStall(e.classId);
        break;
      }
      case 'indexUpdated':
        for (const l of [...indexListeners]) l(e.classId);
        break;
      case 'connection':
        setConnection(e.deviceId, { connected: e.connected, relay: e.relay, ...(e.connected ? {} : { lastSeen: new Date(clock.now()).toISOString() }) });
        break;
      case 'joinRequest':
        if (!state.get().joinRequests.some((r) => r.classId === e.request.classId && r.deviceId === e.request.deviceId)) {
          patch({ joinRequests: [...state.get().joinRequests, e.request] });
          notify('join', 'notify.wantsToJoin', { name: e.request.name, class: className(e.request.classId), classId: e.request.classId }, `join-${e.request.deviceId}`);
        }
        break;
      case 'joinRequestGone':
        patch({ joinRequests: state.get().joinRequests.filter((r) => !(r.classId === e.classId && r.deviceId === e.deviceId)) });
        break;
      case 'admitted':
        patch({ joinRequests: state.get().joinRequests.filter((r) => !(r.classId === e.classId && r.deviceId === e.deviceId)) });
        notify('join', 'notify.joined', { name: e.name, class: className(e.classId), classId: e.classId }, `joined-${e.deviceId}`);
        break;
      case 'admittedMe':
        clearStall(e.classId);
        void app().library.load();
        break;
      case 'folderOffer':
        if (!state.get().offers.some((o) => o.folderId === e.offer.folderId && o.offeredBy === e.offer.offeredBy)) patch({ offers: [...state.get().offers, e.offer] });
        break;
      case 'foreignWrite':
        patch({ foreignWrites: state.get().foreignWrites + 1 });
        break;
      case 'massDelete':
        patch({ massDelete: [...state.get().massDelete.filter((m) => m.classId !== e.classId), { classId: e.classId, count: e.count, sample: e.sample }] });
        break;
      case 'massDeleteRemote': {
        const byName = nameOfShort(e.classId, e.by);
        patch({ massDeleteRemote: [...state.get().massDeleteRemote.filter((m) => !(m.classId === e.classId && m.by === e.by)), { classId: e.classId, by: e.by, byName, count: e.count, sample: e.sample }] });
        notify('sync', 'notify.massDelete', { name: byName, n: e.count, class: className(e.classId), classId: e.classId });
        break;
      }
      case 'folderErrors': {
        const f = state.get().folders[e.classId];
        if (f) patch({ folders: { ...state.get().folders, [e.classId]: { ...f, pullErrors: e.errors.length } } });
        break;
      }
      case 'markerMissing':
        patch({ markerMissing: [...new Set([...state.get().markerMissing, e.classId])] });
        notify('sync', 'notify.folderMissing', { class: className(e.classId), classId: e.classId });
        break;
      case 'listenAddresses':
        addressTimer?.();
        addressTimer = clock.setTimeout(() => {
          addressTimer = null;
          void shared().then((list) => list.forEach((c) => void info(c.classId).refreshOwnMemberFile().catch(() => undefined)));
        }, ADDRESS_REFRESH_MS);
        break;
      case 'remoteChange':
        break;   // services/index.ts routes it to the class store and the trust service
    }
  }

  function nameOfShort(classId: ClassId, by: ShortId): string {
    try {
      const m = info(classId).model.get();
      for (const d of m.members.keys()) if (shortIdOf(d) === by) return info(classId).nameOf(d);
    } catch {
      // unknown class
    }
    return by;
  }

  function clearStall(classId: ClassId) {
    joinTimers.get(classId)?.();
    joinTimers.delete(classId);
    if (state.get().joinStalled.includes(classId)) patch({ joinStalled: state.get().joinStalled.filter((c) => c !== classId) });
  }

  async function dirNameFor(label: string): Promise<string> {
    const root = await platform.classes.root();
    return unique(root.names, sanitize(label, 'Class'));
  }

  const service: SyncServiceImpl = {
    state,
    connections,
    connectionOf: (d) => connections.get()[d] ?? null,
    onIndexUpdated(cb) {
      indexListeners.add(cb);
      return () => {
        indexListeners.delete(cb);
      };
    },
    noteForeignWrite() {
      patch({ foreignWrites: state.get().foreignWrites + 1 });
    },
    async boot() {
      if (booted) return;
      booted = true;
      platform.events.onSync(route);
      await snapshot();
      try {
        const stats = await platform.sync.deviceStats();
        for (const [d, s] of Object.entries(stats)) if (!connections.get()[d]?.connected) setConnection(d, { lastSeen: s.lastSeen });
      } catch {
        // no stats on this platform
      }
      await service.completeForks();
      await startClasses();
    },
    async ensureStarted() {
      patch({ status: await platform.sync.start() });
    },
    async restart() {
      patch({ status: await platform.sync.restart() });
      await snapshot();
    },
    async share(classId) {
      await service.ensureStarted().catch((e: unknown) => {
        throw toPlatformError(e);
      });
      const c = classOf(classId);
      const ci = c.info as ClassServiceImpl;
      await ci.ready();
      await platform.sync.shareClass(classId, ci.detail.get().meta.name);
      await app().library.load();
      c.store.setTrustGate(c.trust);
      await ci.refreshOwnMemberFile();
      await ci.reload();
      if (!booted) await service.boot();
    },
    async invite(classId, opts) {
      const ci = info(classId);
      await ci.ready();
      const d = ci.detail.get();
      const identity = ctx.identity.get();
      const me = ctx.device.get()?.deviceId ?? (await platform.sync.identity()).deviceId;
      if (!identity) throw new PlatformError('INVALID', 'no identity');
      const m = ci.model.get();
      let stats: Record<DeviceId, { lastSeen: string | null }> = {};
      try {
        stats = await platform.sync.deviceStats();
      } catch {
        stats = {};
      }
      const own = await platform.sync.ownAddresses().catch(() => [] as string[]);
      const others = [...m.members].filter(([dev]) => dev !== me && m.bindings.bound.has(dev) && !m.bans.bannedDevices.has(dev)).map(([dev, x]) => ({
        deviceId: dev, addresses: x.file.addresses ?? [], connected: !!connections.get()[dev]?.connected,
        organiser: m.organisers.organisers.has(m.bindings.bound.get(dev)!), lastSeenMs: stats[dev]?.lastSeen ? Date.parse(stats[dev]!.lastSeen!) : null,
      }));
      const chosen = chooseInviteDevices({ deviceId: me, addresses: own, connected: true, organiser: false, lastSeenMs: null }, others);
      const inv: InviteV1 = {
        v: 1, f: classId, l: d.meta.name.slice(0, 120), ...(d.meta.shortName ? { s: d.meta.shortName.slice(0, 12) } : {}), c: d.meta.colour, i: d.meta.icon,
        ...(d.meta.lecturer ? { lt: d.meta.lecturer.slice(0, 80) } : {}), ...(d.meta.term ? { tm: d.meta.term.slice(0, 40) } : {}),
        ...(d.meta.language !== 'auto' ? { lg: d.meta.language } : {}), m: identity.memberId, n: identity.name.slice(0, 64),
        d: chosen.map((c) => ({ id: dashless(c.deviceId), a: selectInviteAddresses(c.addresses) })),
        t: Math.floor(clock.now() / 1000), ...(opts?.expiresAt ? { x: Math.floor(opts.expiresAt / 1000) } : {}),
      };
      const reduced = reduceInvite(inv);
      const code = encodeInvite(reduced);
      const link = inviteLink(code);
      return {
        code, link, web: inviteWeb(code), qrText: qrText(reduced), fileName: sanitize(inviteFileName(reduced), 'invite.tramado-invite'),
        fileText: `${link}\n${FILE_SENTENCE.replace('{class}', d.meta.name)}`,
      };
    },
    async parseCode(text) {
      let decoded;
      try {
        decoded = decodeInvite(text, Math.floor(clock.now() / 1000));
      } catch (problem) {
        if (problem === 'pair') throw new PlatformError('NEWER_FORMAT', 'pairing codes need a newer Tramado', { pair: true });
        if (problem === 'newer') throw new PlatformError('NEWER_FORMAT', 'invite made by a newer Tramado');
        throw new PlatformError('SYNC_INVITE_INVALID', 'not a Tramado invite');
      }
      const me = ctx.device.get()?.deviceId ?? (await platform.sync.identity()).deviceId;
      const warnings: InvitePreview['warnings'] = [];
      if (decoded.old) warnings.push('old');
      if (decoded.devices.some((x) => x.deviceId === me)) warnings.push('ownInvite');
      if ((await entries()).some((e) => e.classId === decoded.invite.f || e.aliases.includes(decoded.invite.f))) warnings.push('alreadyMember');
      return {
        code: decoded.code, invite: decoded.invite, classId: decoded.invite.f, checkWords: checkWords(me), warnings,
        devices: decoded.devices.map((x, i) => ({ deviceId: x.deviceId, name: i === 0 ? decoded.invite.n : '', addresses: x.addresses })),
      };
    },
    async join(preview, opts) {
      if (preview.warnings.includes('ownInvite')) throw new PlatformError('SYNC_INVITE_INVALID', 'this is your own invite');
      await service.ensureStarted();
      const dirName = await dirNameFor(preview.invite.l);
      const entry: ClassEntry = await platform.sync.joinClass({ code: preview.code, dirName, includeAudio: opts.includeAudio, ...(opts.parent ? { parent: opts.parent.token } : {}) });
      await app().library.load();
      const c = classOf(entry.classId);
      c.store.setTrustGate(c.trust);
      await (c.info as ClassServiceImpl).refreshOwnMemberFile();
      joinTimers.set(entry.classId, clock.setTimeout(() => {
        joinTimers.delete(entry.classId);
        patch({ joinStalled: [...new Set([...state.get().joinStalled, entry.classId])] });
      }, JOIN_STALL_MS));
      if (!booted) await service.boot();
      return entry.classId;
    },
    async cancelJoin(classId) {
      clearStall(classId);
      await platform.sync.cancelJoin(classId);
      await app().library.load();
    },
    async leave(classId, opts) {
      const c = classOf(classId);
      const claims = c.claims as unknown as { releaseAll?(): Promise<void> };
      await claims.releaseAll?.().catch(() => undefined);
      await (c.info as ClassServiceImpl).removeOwnFiles();
      await platform.sync.leaveClass(classId, { afterwards: opts.afterwards });
      if (opts.deleteMyNotes) await platform.privateFiles.purge(classId);
      if (opts.afterwards === 'keepLocal') await platform.privateFiles.write(classId, 'fork.json', enc.encode(JSON.stringify({ format: 'tramado.pending-fork', version: 1, from: classId })));
      await app().library.load();
      await service.completeForks();
    },
    async admit(classId, deviceId) {
      await platform.sync.admit(classId, deviceId);
      patch({ joinRequests: state.get().joinRequests.filter((r) => !(r.classId === classId && r.deviceId === deviceId)) });
    },
    async decline(classId, deviceId) {
      const ci = info(classId);
      await ci.ready();
      if (ci.detail.get().me.isOrganiser) await ci.writeBan({ deviceId }, 'banned');
      await platform.sync.decline(classId, deviceId);
      patch({ joinRequests: state.get().joinRequests.filter((r) => !(r.classId === classId && r.deviceId === deviceId)) });
    },
    async ban(classId, target, reason) {
      const ci = info(classId);
      await ci.ready();
      if (!ci.detail.get().me.isOrganiser) throw new PlatformError('PERMISSION_DENIED', 'only organisers can remove people');
      await ci.writeBan(target, 'banned', reason);
      if (!ci.detail.get().meta.askBeforeAdmit) await ci.setMeta({ askBeforeAdmit: true });
      await platform.sync.scan(classId, '.tramado').catch(() => undefined);
    },
    async unban(classId, target) {
      const ci = info(classId);
      await ci.ready();
      await ci.writeBan(target, 'unbanned');
    },
    async answerOffer(offer, accept) {
      patch({ offers: state.get().offers.filter((o) => !(o.folderId === offer.folderId && o.offeredBy === offer.offeredBy)) });
      if (!accept) return;
      const dirName = await dirNameFor(offer.label);
      const entry = await platform.sync.acceptFolder({ folderId: offer.folderId, offeredBy: offer.offeredBy, label: offer.label, dirName, includeAudio: true });
      await app().library.load();
      const c = classOf(entry.classId);
      c.store.setTrustGate(c.trust);
      await (c.info as ClassServiceImpl).refreshOwnMemberFile();
    },
    async applySettings(s) {
      const cur: SyncSettings = {
        localOnly: ctx.prefs.get('sync.localOnly') === '1', paused: ctx.prefs.get('sync.paused') === '1',
        maxSendKbps: Number(ctx.prefs.get('sync.maxSendKbps')) || 0, maxRecvKbps: Number(ctx.prefs.get('sync.maxRecvKbps')) || 0,
        deviceName: (() => {
          const i = ctx.identity.get();
          return i ? `${i.name} (${i.deviceName})`.slice(0, 64) : 'Tramado';
        })(),
      };
      const next = { ...cur, ...s };
      await platform.sync.applySettings(next);
      await ctx.prefs.set('sync.localOnly', next.localOnly ? '1' : '0');
      await ctx.prefs.set('sync.paused', next.paused ? '1' : '0');
      await ctx.prefs.set('sync.maxSendKbps', String(Math.max(0, Math.floor(next.maxSendKbps))));
      await ctx.prefs.set('sync.maxRecvKbps', String(Math.max(0, Math.floor(next.maxRecvKbps))));
      patch({ status: await platform.sync.status() });
    },
    async versions(classId) {
      const all = await platform.sync.versions(classId);
      const candidates = all.filter((v) => {
        if (v.path.startsWith('.tramado/')) return false;
        const k = classifyPath(v.path).kind;
        return k !== 'transcriptMd' && k !== 'transcriptVtt' && k !== 'conflictCopy' && k !== 'skipped';
      });
      if (!candidates.length) return [];
      const infos = await platform.sync.fileInfo(classId, [...new Set(candidates.map((v) => v.path))]);
      const gone = new Set(infos.filter((i) => i.globalDeleted || i.localDeleted).map((i) => i.path));
      return candidates.filter((v) => gone.has(v.path)).sort((a, b) => (a.versionTime < b.versionTime ? 1 : -1));
    },
    restore: (classId, items) => platform.sync.restore(classId, items),
    async resolveMassDelete(classId, action) {
      await platform.sync.resolveMassDelete(classId, action);
      patch({ massDelete: state.get().massDelete.filter((m) => m.classId !== classId) });
    },
    async resolveRemoteMassDelete(classId, by, action) {
      const entry = state.get().massDeleteRemote.find((m) => m.classId === classId && m.by === by);
      patch({ massDeleteRemote: state.get().massDeleteRemote.filter((m) => !(m.classId === classId && m.by === by)) });
      if (action !== 'restore' || !entry) return;
      const versions = await service.versions(classId);
      const latest = new Map<ClassPath, string>();
      for (const v of versions) if (!latest.has(v.path)) latest.set(v.path, v.versionTime);
      await platform.sync.restore(classId, [...latest].map(([path, versionTime]) => ({ path, versionTime })));
    },
    async resolveCopiedIdentity(action) {
      await platform.sync.resolveCopiedIdentity(action);
      patch({ identityCopied: false });
      await snapshot();
    },
    async diagnosticsText() {
      const d = await platform.sync.diagnostics();
      const short = (s: string) => s.replace(/\b([A-Z2-7]{7})(-[A-Z2-7]{7}){7}\b/g, '$1');
      const lines = [
        `Tramado ${ctx.info.version} (${ctx.info.os})`,
        `Sharing: ${d.status.state}${d.status.version ? ` · Syncthing ${d.status.version}` : ''}${d.status.paused ? ' · paused' : ''}${d.status.localOnly ? ' · local network only' : ''}`,
        `This computer: ${d.status.deviceId ? shortIdOf(d.status.deviceId) : '—'} · sync port ${d.ports.sync ?? '—'}`,
        `Connections: ${d.connections} (${d.relayed} through a relay)`,
        `Classes: ${Object.keys(state.get().folders).length} shared · ${state.get().foreignWrites} foreign writes`,
        ...d.lastErrors.map((e) => `Error ${e.when}: ${short(e.message)}`),
        ...d.logTail.map(short),
      ];
      return short(lines.join('\n'));
    },
    async fork(classId) {
      const me = ctx.device.get()?.deviceId ?? (await platform.sync.identity()).deviceId;
      const ci = info(classId);
      await ci.ready();
      const nonce = newNonce(ctx.rand);
      const newId = classIdOf(me, nonce);
      await platform.classes.fork(classId, newId);
      await ci.writeFork(newId, nonce);
      await platform.privateFiles.remove(newId, 'fork.json').catch(() => undefined);
      await app().library.load();
      return newId;
    },
    async completeForks() {
      let list: ClassEntry[];
      try {
        list = await entries();
      } catch {
        return;
      }
      for (const e of list) {
        if (e.shared || e.leaving) continue;
        const pending = await platform.privateFiles.read(e.classId, 'fork.json').catch(() => null);
        if (!pending) continue;
        try {
          const p = JSON.parse(dec.decode(pending)) as { from?: string };
          if (p.from === e.classId) await service.fork(e.classId);
        } catch (err) {
          ctx.log('warn', 'fork failed', { classId: e.classId, error: String(err) });
        }
      }
    },
  };
  return service;
}
