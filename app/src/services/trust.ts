// The trust gate of a shared class (folder spec §6, sync spec §12, architecture §12 rule 1): a machine file's new
// content is exposed only when Syncthing says its writer made the version of the bytes read (`localModifiedBy` and
// `localBlocksHash`), or the bytes equal / keep the prefix of the last trusted content. Signed records also need a
// valid signature and no rollback, manifests a valid derived ID, transcripts a valid writer change. Pending
// verdicts re-check every 200 ms for up to 3 s (the database or the event may lag the bytes). The trust cache is
// `private/<classId>/trust.json`; signed records keep their last trusted bytes in `private/<classId>/trusted/`.
import { classIdOf, itemIdMatches } from '../core/model/derive';
import { classifyPath } from '../core/model/paths';
import { isHlc, shortIdOf, type ClassId, type ClassPath, type DeviceId, type Hlc, type MemberId, type ShortId, type Ulid } from '../core/model/ids';
import { verifySig } from '../core/model/sig';
import { instant, parseRfc3339 } from '../core/model/time';
import { sha256Hex } from '../core/util/sha256';
import type { TrustCacheEntry, TrustCacheFile } from '../core/model/files';
import {
  cacheEntry, deletionHonoured, isMachinePath, judge, KEPT_KINDS, NO_ROLLBACK_KINDS, SIGNED_FILE_KINDS, writerOf, type JudgeExtras,
  type LocalVersionInfo,
} from '../core/sync/trust';
import type { FileSyncInfo } from '../platform/types';
import type { AppContext } from './context';
import type { AppServices, ClassStore, TrustVerdict } from './types/common';
import type { FormerEntry, TrustService } from './types/sync';

export const PENDING_RETRY_MS = 200;
export const PENDING_MAX_MS = 3000;
const REMOTE_MEMORY_MS = 10 * 60_000;
const KEEP_DELETED_MS = 31 * 86_400_000;
const KEPT_MAX_BYTES = 64 * 1024;

export type { FormerEntry };

/** What other services of the class reach behind the TrustGate (additive, T-SYNC). */
export type TrustServiceImpl = TrustService;   // T-SYNC's extras are part of TrustService since G1

const enc = new TextEncoder();
const dec = new TextDecoder();
const emptyCache = (): TrustCacheFile => ({ format: 'tramado.trust-cache', version: 1, files: {}, pinnedTranscriptWriters: {}, left: {}, vacated: [] });

export function createTrustService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): TrustServiceImpl {
  const { platform, clock } = ctx;
  const classId = cls.classId;
  let cache: TrustCacheFile = emptyCache();
  let loaded: Promise<void> | null = null;
  let dirty = false;
  let saveTimer: (() => void) | null = null;
  let foreign = 0;
  const remote = new Map<ClassPath, { by: ShortId; mono: number }>();
  const retries = new Map<ClassPath, { since: number; cancel: () => void }>();
  const sigCache = new Map<string, boolean>();
  const counted = new Set<string>();

  const load = () => (loaded ??= (async () => {
    try {
      const raw = await platform.privateFiles.read(classId, 'trust.json');
      if (raw) {
        const f = JSON.parse(dec.decode(raw)) as Partial<TrustCacheFile>;
        if (f.format === 'tramado.trust-cache') cache = { ...emptyCache(), ...f, files: f.files ?? {}, left: f.left ?? {}, vacated: f.vacated ?? [], pinnedTranscriptWriters: f.pinnedTranscriptWriters ?? {} };
      }
    } catch {
      cache = emptyCache();
    }
    // Entries of deleted files are kept 31 days (folder spec §6.2 rule 1).
    const now = clock.now();
    for (const [p, e] of Object.entries(cache.files)) {
      const at = e.deletedAt ? parseRfc3339(e.deletedAt) : null;
      if (at !== null && now - at > KEEP_DELETED_MS) delete cache.files[p];
    }
  })());

  const persist = () => {
    dirty = true;
    if (saveTimer) return;
    saveTimer = clock.setTimeout(() => {
      saveTimer = null;
      void flush();
    }, 1000);
  };
  async function flush() {
    if (!dirty) return;
    dirty = false;
    await platform.privateFiles.write(classId, 'trust.json', enc.encode(JSON.stringify(cache)));
  }

  async function fileInfo(path: ClassPath): Promise<FileSyncInfo | null> {
    try {
      const [info] = await platform.sync.fileInfo(classId, [path]);
      return info ?? null;
    } catch {
      return null;   // no Syncthing holds this class here (memory platform, local fallback): signatures only (§6.3)
    }
  }
  const asLocal = (i: FileSyncInfo | null): LocalVersionInfo | null =>
    i ? { localModifiedBy: i.localModifiedBy, localBlocksHash: i.localBlocksHash, localDeleted: i.localDeleted } : null;

  // Whole-file records verify under this class ID only (a fork is a new class, sync spec §17); lines of a
  // rotation chain (v1.1) are checked by their readers.
  const classIds = (): ClassId[] => [classId];

  async function sigOk(path: ClassPath, parsed: unknown, writer: DeviceId | null): Promise<boolean> {
    if (!writer || typeof parsed !== 'object' || parsed === null) return false;
    const key = `${path}|${sha256Hex(JSON.stringify(parsed))}`;
    const hit = sigCache.get(key);
    if (hit !== undefined) return hit;
    const ok = await verifySig(parsed as Record<string, unknown>, classIds(), path, writer);
    if (sigCache.size > 2000) sigCache.clear();
    sigCache.set(key, ok);
    return ok;
  }

  /** Transcript writer rule (folder spec §6.2 rule 3, sync spec §14.7–§14.8). */
  async function writerChangeOk(parsed: Record<string, unknown>, writer: DeviceId | null): Promise<boolean> {
    const lectureId = typeof parsed.lectureId === 'string' ? parsed.lectureId : null;
    if (!lectureId || !writer) return false;
    const pinned = cache.pinnedTranscriptWriters[lectureId];
    if (!pinned || pinned.deviceId === writer) return true;
    const round = typeof parsed.round === 'number' ? parsed.round : 0;
    const claims = app().forClass(classId).claims as unknown as {
      trustedClaim?(lectureId: Ulid, kind: 'transcribe' | 'fold', deviceId: DeviceId): Promise<{ round: number; status: string } | null>;
      foldTrigger?(lectureId: Ulid): Promise<boolean>;
      foldWinner?(lectureId: Ulid): Promise<DeviceId | null>;
    };
    if (round > pinned.round) {
      const c = await claims.trustedClaim?.(lectureId, 'transcribe', writer);
      if (c && c.round === round) return true;
    }
    // Same round, both sides of a partition finished (sync spec §14.5 owner duties): the writer whose done claim
    // wins the round replaces the other one. (Requested addition to folder spec §6.2 rule 3.)
    if (round === pinned.round) {
      const w = (app().forClass(classId).claims as unknown as { winner(l: Ulid, k: 'transcribe'): { deviceId: DeviceId; status: string } | null }).winner(lectureId, 'transcribe');
      const c = await claims.trustedClaim?.(lectureId, 'transcribe', writer);
      if (w && w.deviceId === writer && w.status === 'done' && c && c.round === round) return true;
    }
    const foldWinner = await claims.foldWinner?.(lectureId);
    if (foldWinner === writer && (await claims.foldTrigger?.(lectureId))) return true;
    return false;
  }

  function scheduleRecheck(path: ClassPath) {
    const cur = retries.get(path);
    const since = cur?.since ?? clock.mono();
    cur?.cancel();
    if (clock.mono() - since >= PENDING_MAX_MS) {
      retries.delete(path);
      return;
    }
    const cancel = clock.setTimeout(() => {
      (cls.store as ClassStore & { ingest?(paths: ClassPath[], o: { selfWrite: boolean; rescan: boolean }): void }).ingest?.([path], { selfWrite: false, rescan: false });
    }, PENDING_RETRY_MS);
    retries.set(path, { since, cancel });
  }

  async function keep(path: ClassPath, bytes: Uint8Array) {
    if (!KEPT_KINDS.has(classifyPath(path).kind) || bytes.length > KEPT_MAX_BYTES) return;
    await platform.privateFiles.write(classId, `trusted/${path}`, bytes);
  }

  async function verify(path: ClassPath, bytes: Uint8Array, parsedIn: unknown | null): Promise<TrustVerdict> {
    await load();
    if (!isMachinePath(path)) return { kind: 'trusted' };
    if (bytes.length === 0) return { kind: 'untrusted', reason: 'pending' };   // an empty machine file is absent (§12.1)
    const info = classifyPath(path);
    let parsed = parsedIn;
    if (parsed === null && path.endsWith('.json')) {
      try {
        parsed = JSON.parse(dec.decode(bytes));
      } catch {
        parsed = null;
      }
    }
    let writer = writerOf(path, parsed);
    if ((info.kind === 'transcriptMd' || info.kind === 'transcriptVtt') && writer === null) {
      // Tramado reads only transcript.json; the generated siblings follow its pinned writer.
      return { kind: 'trusted' };
    }
    const entry = cache.files[path];
    const extras: JudgeExtras = {};
    const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
    if (SIGNED_FILE_KINDS.has(info.kind)) extras.sigOk = await sigOk(path, parsed, writer);
    if (NO_ROLLBACK_KINDS.has(info.kind)) extras.noRollback = !entry?.hlc || (isHlc(record.hlc) && record.hlc >= entry.hlc);
    if (info.kind === 'classFile') {
      const createdBy = record.createdBy as { deviceId?: string } | undefined;
      extras.derivedOk = typeof record.idNonce === 'string' && typeof createdBy?.deviceId === 'string'
        && classIds().includes(classIdOf(createdBy.deviceId, record.idNonce)) && record.classId === classIdOf(createdBy.deviceId, record.idNonce);
      // §6.2 rule 7: any other version of class.json is ignored (forks and rotations change the class ID).
      if (entry && entry.sha256 !== sha256Hex(bytes)) extras.noRollback = false;
    }
    if (info.kind === 'lectureManifest' || info.kind === 'examManifest') {
      extras.derivedOk = typeof record.id === 'string' && typeof record.idNonce === 'string' && !!writer && itemIdMatches(record.id, writer, record.idNonce);
    }
    if (info.kind === 'transcriptJson') extras.writerChangeOk = await writerChangeOk(record, writer);
    if (!writer && info.deviceId) writer = info.deviceId;
    const result = judge({ path, bytes, info: asLocal(await fileInfo(path)), writer, cache: entry, extras });
    switch (result.kind) {
      case 'trusted': {
        retries.get(path)?.cancel();
        retries.delete(path);
        const stat = await platform.fs.stat(classId, path).catch(() => null);
        const next = cacheEntry(bytes, { size: bytes.length, mtimeMs: stat?.mtimeMs ?? 0, ...(isHlc(record.hlc) ? { hlc: record.hlc } : {}) });
        if (!entry || entry.sha256 !== next.sha256 || entry.deletedAt) {
          cache.files[path] = next;
          if (info.kind === 'transcriptJson' && typeof record.lectureId === 'string' && writer) {
            const round = typeof record.round === 'number' ? record.round : 1;
            cache.pinnedTranscriptWriters[record.lectureId] = { deviceId: writer, round };
          }
          persist();
          await keep(path, bytes);
        }
        return { kind: 'trusted' };
      }
      case 'prefix':
        return { kind: 'prefix', length: result.length };
      case 'pending':
        scheduleRecheck(path);
        return { kind: 'untrusted', reason: 'pending' };
      case 'untrusted': {
        if (result.reason === 'writer-changed') scheduleRecheck(path);   // the claims that allow it may arrive just after
        const seen = `${path}|${sha256Hex(bytes)}`;
        if (counted.has(seen)) return { kind: 'untrusted', reason: result.reason === 'writer-changed' ? 'writer-changed' : 'foreign-write' };
        counted.add(seen);
        foreign++;
        const sync = app().sync as unknown as { noteForeignWrite?(classId: ClassId, path: ClassPath): void };
        sync.noteForeignWrite?.(classId, path);
        ctx.log('warn', 'SYNC_FOREIGN_WRITE', { classId, path: path.replace(/[A-Z2-7]{7}(-[A-Z2-7]{7}){7}/g, (d) => shortIdOf(d)), reason: result.reason });
        return { kind: 'untrusted', reason: result.reason === 'writer-changed' ? 'writer-changed' : 'foreign-write' };
      }
    }
  }

  const service: TrustServiceImpl = {
    verify,
    noteOwnWrite(path, bytes) {
      // My own write is trusted by construction; the cache follows it so a foreign rewrite can be compared.
      if (!isMachinePath(path)) return;
      let hlc: string | undefined;
      try {
        const parsed = path.endsWith('.json') ? (JSON.parse(dec.decode(bytes)) as { hlc?: unknown }) : null;
        if (parsed && isHlc(parsed.hlc)) hlc = parsed.hlc;
      } catch {
        hlc = undefined;
      }
      void load().then(async () => {
        cache.files[path] = cacheEntry(bytes, { size: bytes.length, ...(hlc ? { hlc } : {}) });
        persist();
        await keep(path, bytes);
      });
    },
    async pass() {
      await load();
      const index = cls.store.state.get().index;
      let checked = 0;
      let untrusted = 0;
      for (const [path, e] of index.machine) {
        const c = cache.files[path];
        if (c && c.size === e.size && c.mtimeMs === e.mtimeMs) continue;
        const bytes = await cls.store.readBytes(path);
        if (!bytes) continue;
        checked++;
        const v = await verify(path, bytes, null);
        if (v.kind === 'untrusted') untrusted++;
      }
      return { checked, untrusted };
    },
    noteRemote(path, modifiedBy, mono) {
      remote.set(path, { by: modifiedBy, mono });
      for (const [p, r] of remote) if (mono - r.mono > REMOTE_MEMORY_MS) remote.delete(p);
    },
    ready: () => load(),
    keptPaths: () => Object.keys(cache.files).filter((p) => KEPT_KINDS.has(classifyPath(p).kind)),
    async kept(path) {
      await load();
      return platform.privateFiles.read(classId, `trusted/${path}`);
    },
    async deletionHonoured(path, writer) {
      await load();
      return deletionHonoured(path, writer, asLocal(await fileInfo(path)));
    },
    async dropKept(path) {
      await load();
      const e = cache.files[path];
      if (e) cache.files[path] = { ...e, deletedAt: instant(clock.now()) };
      persist();
      await platform.privateFiles.remove(classId, `trusted/${path}`).catch(() => undefined);
    },
    left: () => new Map(Object.entries(cache.left).map(([d, v]) => {
      const x = v as { memberId?: string; name?: string; deviceName?: string; hlc: Hlc };
      return [d, { memberId: x.memberId ?? '', leftHlc: x.hlc, name: x.name ?? '', deviceName: x.deviceName ?? '' }];
    })),
    noteLeft(deviceId, memberId, hlc, names) {
      if (cache.left[deviceId]) return;
      (cache.left as Record<string, { at: string; hlc: Hlc; memberId?: MemberId; name?: string; deviceName?: string }>)[deviceId] = {
        at: instant(clock.now()), hlc, memberId, ...(names ? { name: names.name, deviceName: names.deviceName } : {}),
      };
      persist();
    },
    vacated: () => new Set(cache.vacated),
    addVacated(ids) {
      const set = new Set(cache.vacated);
      let changed = false;
      for (const id of ids) if (!set.has(id)) {
        set.add(id);
        changed = true;
      }
      if (changed) {
        cache.vacated = [...set].sort();
        persist();
      }
    },
    pinnedWriter: (lectureId) => cache.pinnedTranscriptWriters[lectureId] ?? null,
    foreignWrites: () => foreign,
    recentRemote: (path) => remote.get(path)?.by ?? null,
    flush,
  };
  return service;
}

export type { TrustCacheEntry };
