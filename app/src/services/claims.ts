// The claim engine of a class (sync spec §14, folder spec §8.10): observes every claim file (staleness on this
// device's monotonic clock, seeded at start-up), ranks them with core/sync/claims.ts, runs the §14.5 round (write
// `claimed`, settle 12 s, wait until every connected member holds my claim, decide), writes `working`, `released`,
// `done`/`failed` and deletes; while working it watches for losing (onLost), applies the owner rules after done,
// resumes my claims after a restart (§14.5 "on app start"), re-evaluates stale winners (§14.3) and keeps the §8.10
// retention. Fold claims (`kind: "fold"`, §14.8) use the same machinery; `foldTrigger` is the hand-over condition.
// Heartbeats of a running job are Rust's (TranscribeRequest.claim); TS writes only the transitions.
import { PlatformError } from '../core/errors';
import { mergeUnknown, parserFor } from '../core/model/parse';
import { classifyPath } from '../core/model/paths';
import { instant, parseRfc3339 } from '../core/model/time';
import { shortIdOf, type ClassId, type ClassPath, type DeviceId, type Ulid } from '../core/model/ids';
import type { ClaimFile, TranscriptFile } from '../core/model/files';
import {
  claimDir, claimPath, claimShapeOk, COMPLETION_WAIT_MAX_MS, eligibleClaims, firstHeartbeat, health, isLive, nextClaimedAt, ownerGone, reevaluateAt, rMax,
  SETTLE_MS, seedChangedAt, shouldDelete, staleOthers, type ClaimKind, type ClaimObservation, type RankInput,
} from '../core/sync/claims';
import { sha256Hex } from '../core/util/sha256';
import type { ClassServiceImpl } from './class';
import type { ClassEntry } from '../platform/types';
import type { AppContext } from './context';
import { Store, type ReadableStore } from './store';
import type { SyncServiceImpl } from './sync';
import type { AppServices, ClassStore } from './types/common';
import type { ClaimEngine, ClaimView } from './types/sync';

interface Obs { claim: ClaimFile; trusted: boolean; changedAt: number; sha: string; newer: boolean; lectureId: Ulid; kind: ClaimKind }

/** Additive (T-SYNC): what TrustService, the transcription queue and SyncService.leave use. */
export interface ClaimEngineImpl extends ClaimEngine {
  /** A trusted claim of a device, or null. */
  trustedClaim(lectureId: Ulid, kind: ClaimKind, deviceId: DeviceId): Promise<ClaimFile | null>;
  /** The device whose fold claim wins (§14.8), or null. */
  foldWinner(lectureId: Ulid): Promise<DeviceId | null>;
  /** §14.8 trigger: the transcript owner has no member file or was last seen more than 7 days ago. */
  foldTrigger(lectureId: Ulid): Promise<boolean>;
  /** Fires when a winner's claim goes stale (volunteers restart their delays, §14.3). */
  onReevaluate(cb: (lectureId: Ulid, kind: ClaimKind) => void): () => void;
  /** Sets every claimed/working claim of mine to `released` (leaving, §17; "Stop and let someone else do it", §14.8). */
  releaseAll(): Promise<void>;
  /** Resolves once the first load of the claim files finished. */
  ready(): Promise<void>;
}

export function createClaimEngine(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): ClaimEngineImpl {
  const { platform, clock } = ctx;
  const { store, classId } = cls;
  const liveEntry = () => (app().library as unknown as { entry?(id: string): ClassEntry | null }).entry?.(classId) ?? cls.store.state.get().entry;
  const obs = new Map<ClassPath, Obs>();
  const transcripts = new Map<Ulid, { round: number; writer: DeviceId } | null>();
  const missingSince = new Map<ClassPath, number>();
  const inCluster = new Map<ClassPath, boolean>();
  const views = new Map<string, Store<ClaimView[]>>();
  const lostCbs = new Map<Ulid, Set<() => void>>();
  const reevalCbs = new Set<(lectureId: Ulid, kind: ClaimKind) => void>();
  const settling = new Set<string>();
  const timers = new Map<string, () => void>();
  const maxSeen = new Map<string, number>();
  let seeded = false;
  let loading: Promise<void> | null = null;
  let again = false;
  let readyResolve: () => void = () => undefined;
  const readyP = new Promise<void>((r) => (readyResolve = r));
  const me = () => ctx.device.get()?.deviceId ?? '';
  const info = () => app().forClass(classId).info as ClassServiceImpl;
  const key = (lectureId: Ulid, kind: ClaimKind) => `${lectureId}|${kind}`;

  async function readTranscript(lectureId: Ulid) {
    const item = store.state.get().index.lectures.get(lectureId);
    if (!item) {
      transcripts.set(lectureId, null);
      return;
    }
    const loaded = await store.readJson(`${item.dir}/transcript.json`, parserFor('tramado.transcript')).catch(() => null);
    const t = loaded && (loaded.verdict.kind === 'trusted' || loaded.verdict.kind === 'unverified') ? (loaded.value as TranscriptFile) : null;
    transcripts.set(lectureId, t ? { round: typeof t.round === 'number' ? t.round : 1, writer: t.writer?.deviceId ?? '' } : null);
  }

  async function load(changed: ClassPath[] | null) {
    const index = store.state.get().index;
    const paths = new Set<ClassPath>();
    for (const p of index.machine.keys()) if (classifyPath(p).kind === 'claims') paths.add(p);
    const toRead = changed === null ? [...paths, ...[...obs.keys()].filter((p) => !paths.has(p))] : changed.filter((p) => classifyPath(p).kind === 'claims');
    let stats: Record<DeviceId, { lastSeen: string | null }> | null = null;
    for (const path of toRead) {
      const i = classifyPath(path);
      if (i.kind !== 'claims' || !i.objectId || !i.deviceId) continue;
      if (!paths.has(path)) {
        obs.delete(path);
        continue;
      }
      const loaded = await store.readJson(path, parserFor('tramado.claim')).catch(() => null);
      const value = loaded?.value;
      if (!value || !claimShapeOk(value) || value.deviceId !== i.deviceId || value.lectureId !== i.objectId) {
        obs.delete(path);
        continue;
      }
      const sha = sha256Hex(JSON.stringify(value));
      const prev = obs.get(path);
      let changedAt = prev?.changedAt ?? clock.mono();
      if (!prev) {
        if (!seeded && value.deviceId !== me()) {
          stats ??= await platform.sync.deviceStats().catch(() => ({}));
          const conn = (app().sync as SyncServiceImpl).connectionOf?.(value.deviceId);
          const ls = stats[value.deviceId]?.lastSeen ?? conn?.lastSeen ?? null;
          changedAt = seedChangedAt(clock.mono(), clock.now(), !!conn?.connected, ls ? parseRfc3339(ls) : null);
        }
      } else if (prev.sha !== sha) changedAt = clock.mono();
      const kind: ClaimKind = i.fold ? 'fold' : 'transcribe';
      const trusted = !!loaded && (loaded.verdict.kind === 'trusted' || loaded.verdict.kind === 'unverified');
      obs.set(path, { claim: value, trusted, changedAt, sha, newer: !!loaded?.newer, lectureId: value.lectureId, kind });
      const k = key(value.lectureId, kind);
      maxSeen.set(k, Math.max(maxSeen.get(k) ?? 0, value.claimedAt));
    }
    const lectures = new Set([...obs.values()].map((o) => o.lectureId));
    for (const l of lectures) await readTranscript(l);
    // in_cluster for done claims whose transcript is missing here (§14.4)
    for (const [path, o] of obs) {
      if (o.claim.status !== 'done') continue;
      const t = transcripts.get(o.lectureId);
      if (t && t.writer === o.claim.deviceId && t.round === o.claim.round) {
        missingSince.delete(path);
        continue;
      }
      if (!missingSince.has(path)) missingSince.set(path, clock.mono());
      const item = store.state.get().index.lectures.get(o.lectureId);
      if (!item || !liveEntry().shared) continue;
      try {
        const [fi] = await platform.sync.fileInfo(classId, [`${item.dir}/transcript.json`]);
        inCluster.set(path, !!fi && !fi.globalDeleted && fi.globalModifiedBy === shortIdOf(o.claim.deviceId));
      } catch {
        inCluster.set(path, false);
      }
    }
    seeded = true;
    const resumeList = changed === null && !resumed ? [...obs.values()].filter((o) => o.claim.deviceId === me() && (o.claim.status === 'claimed' || o.claim.status === 'working')) : [];
    recompute();
    readyResolve();
    if (resumeList.length) {
      resumed = true;
      void resume(resumeList);
    } else if (changed === null) resumed = true;
  }
  let resumed = false;

  function reload(changed: ClassPath[] | null): Promise<void> {
    if (loading) {
      again = true;
      pendingChanged = changed === null || pendingChanged === null ? null : [...pendingChanged, ...changed];
      return loading;
    }
    loading = (async () => {
      try {
        let c = changed;
        do {
          again = false;
          await load(c);
          c = pendingChanged;
          pendingChanged = [];
        } while (again);
      } catch (e) {
        ctx.log('warn', 'claims failed to load', { classId, error: String(e) });
        readyResolve();
      } finally {
        loading = null;
      }
    })();
    return loading;
  }
  let pendingChanged: ClassPath[] | null = [];

  function rankInput(lectureId: Ulid, kind: ClaimKind): RankInput {
    const observations: ClaimObservation[] = [];
    for (const [path, o] of obs) {
      if (o.lectureId !== lectureId || o.kind !== kind) continue;
      observations.push({ claim: o.claim, trusted: o.trusted, changedAt: o.changedAt, missingSince: missingSince.get(path) ?? null, inCluster: inCluster.get(path) ?? false, newer: o.newer });
    }
    return { observations, transcriptRound: transcripts.get(lectureId)?.round ?? null, now: clock.mono() };
  }
  const winnerObs = (lectureId: Ulid, kind: ClaimKind) => eligibleClaims(rankInput(lectureId, kind))[0] ?? null;

  function toView(o: ClaimObservation): ClaimView {
    const since = clock.mono() - o.changedAt;
    let who = o.claim.deviceId.slice(0, 7);
    try {
      who = info().nameOf(o.claim.deviceId);
    } catch {
      // the class service is gone
    }
    return {
      deviceId: o.claim.deviceId, who, status: o.claim.status, progress: typeof o.claim.progress === 'number' ? o.claim.progress : null,
      etaMs: typeof o.claim.etaMs === 'number' ? o.claim.etaMs : null, health: health(since), sinceMs: since, mine: o.claim.deviceId === me(),
    };
  }

  function viewOf(lectureId: Ulid, kind: ClaimKind): ClaimView[] {
    const input = rankInput(lectureId, kind);
    const R = rMax(input.observations, input.transcriptRound);
    const eligible = eligibleClaims(input);
    const rest = input.observations.filter((o) => o.trusted && o.claim.round === R && !eligible.includes(o)
      && (o.claim.status === 'failed' || o.claim.status === 'released' || !isLive(o, R, input.now)));
    return [...eligible, ...rest].map(toView);
  }

  function recompute() {
    const lectures = new Set<string>();
    for (const o of obs.values()) lectures.add(key(o.lectureId, o.kind));
    for (const k of views.keys()) lectures.add(k);
    for (const k of lectures) {
      const [lectureId, kind] = k.split('|') as [Ulid, ClaimKind];
      const v = viewOf(lectureId, kind);
      const s = views.get(k);
      if (s && JSON.stringify(s.get()) !== JSON.stringify(v)) s.set(v);
      if (!settling.has(k)) void ownerRules(lectureId, kind);
      armTimers(lectureId, kind);
    }
  }

  /** While working, losing means: abort, delete my claim (§14.5); after done: a losing done claim is deleted. */
  async function ownerRules(lectureId: Ulid, kind: ClaimKind) {
    const mine = obs.get(claimPath(lectureId, kind, me()));
    if (!mine) return;
    const s = mine.claim.status;
    if (s !== 'claimed' && s !== 'working' && s !== 'done') return;
    const input = rankInput(lectureId, kind);
    if (mine.claim.round < rMax(input.observations, input.transcriptRound)) {
      // A re-transcription (§14.7) started a newer round: a running claim of mine stops; old done claims age out (§8.10).
      if (s !== 'done') await removeMine(lectureId, kind, true);
      return;
    }
    const w = winnerObs(lectureId, kind);
    if (!w || w.claim.deviceId === me()) return;
    await removeMine(lectureId, kind, s !== 'done');
  }

  async function removeMine(lectureId: Ulid, kind: ClaimKind, fireLost: boolean) {
    const path = claimPath(lectureId, kind, me());
    if (!obs.has(path)) return;
    obs.delete(path);
    await store.remove(path).catch(() => undefined);
    await platform.sync.scan(classId, claimDir(lectureId, kind)).catch(() => undefined);
    if (fireLost) for (const cb of [...(lostCbs.get(lectureId) ?? [])]) {
      try {
        cb();
      } catch (e) {
        ctx.log('error', 'onLost callback failed', { error: String(e) });
      }
    }
    recompute();
  }

  function armTimers(lectureId: Ulid, kind: ClaimKind) {
    const k = key(lectureId, kind);
    timers.get(k)?.();
    timers.delete(k);
    const w = winnerObs(lectureId, kind);
    if (!w || (w.claim.status !== 'claimed' && w.claim.status !== 'working')) return;
    const at = reevaluateAt(w.changedAt);
    const now = clock.mono();
    const next = at.slow > now ? at.slow : at.stale > now ? at.stale : null;
    if (next === null) return;
    timers.set(k, clock.setTimeout(() => {
      timers.delete(k);
      recompute();
      if (clock.mono() >= at.stale) for (const cb of [...reevalCbs]) cb(lectureId, kind);
    }, next - now));
  }

  async function writeMine(lectureId: Ulid, kind: ClaimKind, claim: ClaimFile) {
    const path = claimPath(lectureId, kind, me());
    const prev = obs.get(path)?.claim ?? null;
    const value = mergeUnknown(prev, claim);
    await store.writeJson(path, value, { own: true });
    obs.set(path, { claim: value, trusted: true, changedAt: clock.mono(), sha: sha256Hex(JSON.stringify(value)), newer: false, lectureId, kind });
    maxSeen.set(key(lectureId, kind), Math.max(maxSeen.get(key(lectureId, kind)) ?? 0, value.claimedAt));
    await platform.sync.scan(classId, claimDir(lectureId, kind)).catch(() => undefined);
  }

  const sleep = (ms: number) => new Promise<void>((r) => clock.setTimeout(r, ms));

  /** §14.5 "on app start": wait until caught up (≤ 60 s), then yield to another live claim or heartbeat at once. */
  async function resume(list: Obs[]) {
    if (liveEntry().shared) await platform.sync.waitCaughtUp(classId, 60_000).catch(() => undefined);
    await reload(null);
    for (const o of list) {
      const input = rankInput(o.lectureId, o.kind);
      const R = rMax(input.observations, input.transcriptRound);
      const other = input.observations.some((x) => x.claim.deviceId !== me() && isLive(x, R, input.now));
      if (other) await removeMine(o.lectureId, o.kind, true);
      else {
        const cur = obs.get(claimPath(o.lectureId, o.kind, me()));
        if (cur) await writeMine(o.lectureId, o.kind, { ...cur.claim, heartbeat: cur.claim.heartbeat + 1, updatedAt: instant(clock.now()) });
      }
    }
    recompute();
  }

  store.onChange(['claims'], (paths) => void reload(paths));
  store.onChange(['transcript', 'lecture'], () => void reload(null));
  store.state.subscribe(() => {
    if (store.state.get().status === 'ready' && !seeded && !loading) void reload(null);
  });

  const engine: ClaimEngineImpl = {
    claims(lectureId, kind) {
      const k = key(lectureId, kind);
      let s = views.get(k);
      if (!s) {
        s = new Store<ClaimView[]>(viewOf(lectureId, kind));
        views.set(k, s);
      }
      return s as ReadableStore<ClaimView[]>;
    },
    winner(lectureId, kind) {
      const w = winnerObs(lectureId, kind);
      return w ? toView(w) : null;
    },
    async tryClaim(lectureId, kind, input) {
      const deviceId = me();
      const memberId = ctx.identity.get()?.memberId;
      if (!deviceId || !memberId) throw new PlatformError('INVALID', 'no identity');
      await engine.ready();
      await reload(null);
      const k = key(lectureId, kind);
      const r0 = rankInput(lectureId, kind);
      const R = rMax(r0.observations, r0.transcriptRound) + (input.newRound ? 1 : 0);
      const W = winnerObs(lectureId, kind);
      if (!input.newRound && W && W.claim.deviceId !== deviceId) return 'lost';
      if (!input.newRound && W && W.claim.deviceId === deviceId && W.claim.status !== 'claimed') return 'won';
      const claim: ClaimFile = {
        format: 'tramado.claim', version: 1, kind, lectureId, round: R, deviceId, memberId,
        claimedAt: nextClaimedAt(clock.now(), [...r0.observations.map((o) => o.claim.claimedAt), maxSeen.get(k) ?? 0]),
        status: 'claimed', heartbeat: firstHeartbeat(r0.observations, deviceId), updatedAt: instant(clock.now()), audioSha256: input.audioSha256,
        ...(input.engine ? { engine: input.engine } : {}),
        supersedes: staleOthers(r0, deviceId),
      };
      settling.add(k);
      try {
        await writeMine(lectureId, kind, claim);
        recompute();
        if (liveEntry().shared) {
          await sleep(SETTLE_MS);
          const connected = Object.entries((app().sync as SyncServiceImpl).connections?.get() ?? {}).filter(([d, c]) => c.connected && d !== deviceId).length;
          if (connected > 0) {
            await platform.sync.waitAvailable(classId, claimPath(lectureId, kind, deviceId), connected, COMPLETION_WAIT_MAX_MS).catch(() => false);
          }
          await reload(null);
        }
        const w = winnerObs(lectureId, kind);
        if (w && w.claim.deviceId === deviceId) {
          const cur = obs.get(claimPath(lectureId, kind, deviceId))!.claim;
          await writeMine(lectureId, kind, { ...cur, status: 'working', heartbeat: cur.heartbeat + 1, updatedAt: instant(clock.now()) });
          return 'won';
        }
        await removeMine(lectureId, kind, false);
        return 'lost';
      } finally {
        settling.delete(k);
        recompute();
      }
    },
    onLost(lectureId, cb) {
      if (!lostCbs.has(lectureId)) lostCbs.set(lectureId, new Set());
      lostCbs.get(lectureId)!.add(cb);
      return () => {
        lostCbs.get(lectureId)?.delete(cb);
      };
    },
    async setStatus(lectureId, kind, patch) {
      const path = claimPath(lectureId, kind, me());
      const cur = obs.get(path)?.claim;
      if (!cur) throw new PlatformError('NOT_FOUND', 'no claim of mine for this lecture');
      const status = patch.status ?? cur.status;
      const beat = status === 'claimed' || status === 'working' || cur.status === 'claimed' || cur.status === 'working';
      const next: ClaimFile = {
        ...cur, ...patch, status, heartbeat: beat ? cur.heartbeat + 1 : cur.heartbeat, updatedAt: instant(clock.now()),
        ...(status === 'done' && !patch.finishedAt ? { finishedAt: instant(clock.now()) } : {}),
      };
      await writeMine(lectureId, kind, next);
      recompute();
    },
    async remove(lectureId, kind) {
      await removeMine(lectureId, kind, false);
    },
    async sweep() {
      await reload(null);
      const now = clock.now();
      for (const o of [...obs.values()]) {
        if (o.claim.deviceId !== me()) continue;
        const t = transcripts.get(o.lectureId);
        const isCurrentOwnerDone = o.claim.status === 'done' && !!t && t.writer === me() && t.round === o.claim.round;
        const updated = parseRfc3339(o.claim.updatedAt) ?? 0;
        if (shouldDelete(o.claim, { nowMs: now, updatedMs: updated, isCurrentOwnerDone })) await removeMine(o.lectureId, o.kind, false);
      }
    },
    async trustedClaim(lectureId, kind, deviceId) {
      await engine.ready();
      const o = obs.get(claimPath(lectureId, kind, deviceId));
      if (o) return o.trusted ? o.claim : null;
      // Not loaded yet (the transcript arrived first): read it now.
      const loaded = await store.readJson(claimPath(lectureId, kind, deviceId), parserFor('tramado.claim')).catch(() => null);
      return loaded && loaded.verdict.kind === 'trusted' && claimShapeOk(loaded.value) ? loaded.value : null;
    },
    async foldWinner(lectureId) {
      await engine.ready();
      return winnerObs(lectureId, 'fold')?.claim.deviceId ?? null;
    },
    async foldTrigger(lectureId) {
      const t = transcripts.get(lectureId) ?? (await readTranscript(lectureId), transcripts.get(lectureId));
      if (!t?.writer) return false;
      const model = info().model.get();
      const conn = (app().sync as SyncServiceImpl).connectionOf?.(t.writer) ?? null;
      let lastSeenMs: number | null = conn?.lastSeen ? parseRfc3339(conn.lastSeen) : null;
      try {
        const stats = await platform.sync.deviceStats();
        const ls = stats[t.writer]?.lastSeen;
        if (ls) lastSeenMs = parseRfc3339(ls);
      } catch {
        // keep the connection's view
      }
      return ownerGone({ hasMemberFile: model.members.has(t.writer), connected: !!conn?.connected, lastSeenMs, nowMs: clock.now() });
    },
    onReevaluate(cb) {
      reevalCbs.add(cb);
      return () => {
        reevalCbs.delete(cb);
      };
    },
    async releaseAll() {
      for (const o of [...obs.values()]) {
        if (o.claim.deviceId !== me() || (o.claim.status !== 'claimed' && o.claim.status !== 'working')) continue;
        await engine.setStatus(o.lectureId, o.kind, { status: 'released' });
        for (const cb of [...(lostCbs.get(o.lectureId) ?? [])]) cb();
      }
    },
    ready: () => readyP,
  };
  return engine;
}
