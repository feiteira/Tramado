// A ClaimEngine test double (architecture §11.2; the real engine is T-SYNC's services/claims.ts). It decides
// claim rounds by script instead of by the §14.5 round, keeps ClaimViews per lecture, and — given a class
// store — writes this device's claim file like the real engine does (`claimed` → `working` on a win, the
// statuses TS writes, deletion), so tests can watch the order of writes.
import type { ClaimFile } from '../../core/model/files';
import type { DeviceId, Hex64, MemberId, Ulid } from '../../core/model/ids';
import { instant } from '../../core/model/time';
import { Store } from '../store';
import type { ClassServices, ClassStore } from '../types/common';
import type { ConsentInput } from '../types/class';
import type { ClaimEngine, ClaimView } from '../types/sync';

type Kind = 'transcribe' | 'fold';
type TryInput = Parameters<ClaimEngine['tryClaim']>[2];

export interface FakeClaimsOptions {
  /** What tryClaim answers (default 'won'); a function decides per call. */
  outcome?: 'won' | 'lost' | ((lectureId: Ulid, kind: Kind, input: TryInput) => 'won' | 'lost');
  /** When given, this device's claim files are written to the class like the real engine does. */
  store?: ClassStore;
  me?: { deviceId: DeviceId; memberId: MemberId; name?: string };
  now?: () => number;
}

export interface FakeClaims extends ClaimEngine {
  /** Lecture ids tryClaim was called for, in order (kept for the M0 shape). */
  tried: string[];
  calls: Array<{ lectureId: Ulid; kind: Kind; input: TryInput }>;
  statuses: Array<{ lectureId: Ulid; kind: Kind; patch: Parameters<ClaimEngine['setStatus']>[2] }>;
  removed: Array<{ lectureId: Ulid; kind: Kind }>;
  /** Replaces the claims other devices hold for a lecture (this device's own claim is kept). */
  setOthers(lectureId: Ulid, kind: Kind, views: ClaimView[]): void;
  /** This device's claim stops winning: fires the onLost callbacks (the job must be aborted). */
  lose(lectureId: Ulid): void;
  /** The round of this device's last claim per lecture. */
  rounds: Map<Ulid, number>;
  /** This device already holds a claim (as after a restart): no round is run. */
  restore(lectureId: Ulid, kind: Kind, status: ClaimFile['status'], round?: number): Promise<void>;
}

const RANK: Record<ClaimFile['status'], number> = { done: 0, working: 1, claimed: 2, released: 9, failed: 9 };

export function createFakeClaims(opts: FakeClaimsOptions | 'won' | 'lost' = 'won'): FakeClaims {
  const o: FakeClaimsOptions = typeof opts === 'string' ? { outcome: opts } : opts;
  const now = o.now ?? (() => 1_793_721_438_157);
  const stores = new Map<string, Store<ClaimView[]>>();
  const mine = new Map<string, { view: ClaimView; file: ClaimFile }>();
  const others = new Map<string, ClaimView[]>();
  const lost = new Map<Ulid, Set<() => void>>();
  const rounds = new Map<Ulid, number>();
  const key = (id: Ulid, kind: Kind) => `${id}/${kind}`;
  const storeOf = (id: Ulid, kind: Kind) => {
    const k = key(id, kind);
    if (!stores.has(k)) stores.set(k, new Store<ClaimView[]>([]));
    return stores.get(k)!;
  };
  const publish = (id: Ulid, kind: Kind) => {
    const k = key(id, kind);
    const own = mine.get(k);
    storeOf(id, kind).set([...(others.get(k) ?? []), ...(own ? [own.view] : [])]);
  };
  const path = (id: Ulid, kind: Kind) => `.tramado/claims/${id}${kind === 'fold' ? '.fold' : ''}/${o.me?.deviceId ?? 'ME'}.json`;
  const write = async (id: Ulid, kind: Kind) => {
    const own = mine.get(key(id, kind));
    if (o.store && o.me && own) await o.store.writeJson(path(id, kind), own.file, { own: true });
  };

  const fake: FakeClaims = {
    tried: [],
    calls: [],
    statuses: [],
    removed: [],
    rounds,
    claims: (id, kind) => storeOf(id, kind),
    winner(id, kind) {
      const all = storeOf(id, kind).get().filter((c) => c.health !== 'stale' && RANK[c.status] < 9);
      all.sort((a, b) => RANK[a.status] - RANK[b.status] || (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
      return all[0] ?? null;
    },
    async tryClaim(id, kind, input) {
      fake.tried.push(id);
      fake.calls.push({ lectureId: id, kind, input });
      const outcome = typeof o.outcome === 'function' ? o.outcome(id, kind, input) : (o.outcome ?? 'won');
      if (outcome === 'lost') return 'lost';
      const round = (rounds.get(id) ?? 1) + (input.newRound ? 1 : 0);
      rounds.set(id, round);
      const deviceId = o.me?.deviceId ?? 'ME';
      const file: ClaimFile = {
        format: 'tramado.claim', version: 1, kind, lectureId: id, round, deviceId, memberId: o.me?.memberId ?? '',
        claimedAt: now(), status: 'working', heartbeat: 1, updatedAt: instant(now()), audioSha256: input.audioSha256 as Hex64 | null,
        ...(input.engine ? { engine: input.engine } : {}),
      };
      mine.set(key(id, kind), { file, view: { deviceId, who: o.me?.name ?? 'me', status: 'working', progress: null, etaMs: null, health: 'healthy', sinceMs: 0, mine: true } });
      await write(id, kind);
      publish(id, kind);
      return 'won';
    },
    onLost(id, cb) {
      if (!lost.has(id)) lost.set(id, new Set());
      lost.get(id)!.add(cb);
      return () => {
        lost.get(id)?.delete(cb);
      };
    },
    async setStatus(id, kind, patch) {
      fake.statuses.push({ lectureId: id, kind, patch });
      const own = mine.get(key(id, kind));
      if (!own) return;
      own.file = { ...own.file, ...patch, heartbeat: own.file.heartbeat + 1, updatedAt: instant(now()) } as ClaimFile;
      own.view = { ...own.view, status: own.file.status, progress: own.file.progress ?? own.view.progress, etaMs: own.file.etaMs ?? own.view.etaMs };
      await write(id, kind);
      publish(id, kind);
    },
    async remove(id, kind) {
      fake.removed.push({ lectureId: id, kind });
      const had = mine.delete(key(id, kind));
      if (had && o.store && o.me) await o.store.remove(path(id, kind)).catch(() => undefined);
      publish(id, kind);
    },
    sweep: async () => undefined,
    setOthers(id, kind, views) {
      others.set(key(id, kind), views.map((v) => ({ ...v, mine: false })));
      publish(id, kind);
    },
    lose(id) {
      for (const cb of [...(lost.get(id) ?? [])]) cb();
    },
    async restore(id, kind, status, round = 1) {
      rounds.set(id, round);
      const deviceId = o.me?.deviceId ?? 'ME';
      const file: ClaimFile = {
        format: 'tramado.claim', version: 1, kind, lectureId: id, round, deviceId, memberId: o.me?.memberId ?? '', claimedAt: now(), status, heartbeat: 3,
        updatedAt: instant(now()), audioSha256: null,
      };
      mine.set(key(id, kind), { file, view: { deviceId, who: o.me?.name ?? 'me', status, progress: null, etaMs: null, health: 'healthy', sinceMs: 0, mine: true } });
      await write(id, kind);
      publish(id, kind);
    },
  };
  return fake;
}

/** A ClaimView of another device (tests). */
export function claimView(deviceId: DeviceId, over: Partial<ClaimView> = {}): ClaimView {
  return { deviceId, who: over.who ?? deviceId.slice(0, 7), status: 'working', progress: 0.4, etaMs: 1_500_000, health: 'healthy', sinceMs: 30_000, mine: false, ...over };
}


/**
 * Test support for the lecture services: installs `createFakeClaims` as the class's ClaimEngine and simple
 * fakes of ClassService.consent and PresenceService (T-SYNC's, still stubs in wave 1), recording what they get.
 */
export function installClassFakes(
  cs: ClassServices,
  opts: { me: { deviceId: DeviceId; memberId: MemberId; name?: string }; now?: () => number; outcome?: FakeClaimsOptions['outcome'] },
): { claims: FakeClaims; consent: Array<ConsentInput & { ref: { deviceId: DeviceId; id: Ulid } }>; activities: unknown[] } {
  const claims = createFakeClaims({ store: cs.store, me: opts.me, ...(opts.now ? { now: opts.now } : {}), ...(opts.outcome ? { outcome: opts.outcome } : {}) });
  const consent: Array<ConsentInput & { ref: { deviceId: DeviceId; id: Ulid } }> = [];
  const activities: unknown[] = [];
  let n = 0;
  (cs as { claims: ClaimEngine }).claims = claims;
  cs.info.consent = {
    async record(input) {
      const ref = { deviceId: opts.me.deviceId, id: `01JC00000000000000000000${String(++n).padStart(2, '0')}` };
      consent.push({ ...input, ref });
      return ref;
    },
    revoke: async () => undefined,
    active: () => [],
  };
  (cs as { presence: ClassServices['presence'] }).presence = {
    async setActivity(a) {
      activities.push(a);
    },
    others: new Store({}),
  };
  return { claims, consent, activities };
}
