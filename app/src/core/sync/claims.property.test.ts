// Property (sync spec §14.9, §24): devices run the claim protocol of §14.5 over a simulated folder with random
// partitions, ±10 min clock skew, crashes and heals. Invariants: at most one `working` device per connected component
// (checked after every step, once the files of that step have spread), and after a final heal exactly one `done`
// claim and one transcript writer, the same on every device. The protocol code is the pure core of claims.ts.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ClaimFile } from '../model/files';
import { mulberry32 } from '../util/prng';
import {
  autoDelayMs, firstHeartbeat, HEARTBEAT_MS, isLive, nextClaimedAt, rMax, SETTLE_MS, seedChangedAt, staleOthers, winner, type ClaimObservation, type RankInput,
} from './claims';

const RUNS = Number(process.env.TRAMADO_PROPERTY_RUNS) || 30;
const STEP = 10_000;
const LECTURE = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';
const JOB_MS = 20 * 60_000;

interface Transcript { writer: string; round: number }
type Content = { kind: 'claim'; claim: ClaimFile } | { kind: 'transcript'; t: Transcript } | null;
interface Entry { content: Content; version: number }

interface Dev {
  id: string;
  skew: number;
  up: boolean;
  group: number;
  view: Map<string, Entry>;
  changedAt: Map<string, number>;
  missingSince: Map<string, number>;
  state: 'idle' | 'settling' | 'working' | 'done';
  delayUntil: number | null;
  settleUntil: number;
  nextHb: number;
  jobLeft: number;
  jobStarted: number;
  resume: boolean;
}

function simulate(seed: number): void {
  const r = mulberry32(seed);
  const n = 2 + Math.floor(r() * 4);
  let version = 0;
  const lastSeen = new Map<string, number>();
  const devs: Dev[] = Array.from({ length: n }, (_, i) => ({
    id: `${String.fromCharCode(65 + i).repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`,
    skew: Math.floor((r() * 2 - 1) * 600_000), up: true, group: 0, view: new Map(), changedAt: new Map(), missingSince: new Map(),
    state: 'idle', delayUntil: null, settleUntil: 0, nextHb: 0, jobLeft: JOB_MS, jobStarted: 0, resume: false,
  }));
  const claimPath = (d: Dev) => `claims/${d.id}`;
  const write = (d: Dev, path: string, content: Content, t: number) => {
    d.view.set(path, { content, version: ++version });
    d.changedAt.set(path, t);
  };
  const myClaim = (d: Dev): ClaimFile | null => {
    const e = d.view.get(claimPath(d))?.content;
    return e?.kind === 'claim' ? e.claim : null;
  };
  const transcriptOf = (d: Dev): Transcript | null => {
    const e = d.view.get('transcript')?.content;
    return e?.kind === 'transcript' ? e.t : null;
  };
  const rankInput = (d: Dev, t: number): RankInput => {
    const tr = transcriptOf(d);
    const observations: ClaimObservation[] = [];
    for (const [path, e] of d.view) {
      if (!path.startsWith('claims/') || e.content?.kind !== 'claim') continue;
      const c = e.content.claim;
      let missing: number | null = null;
      if (c.status === 'done' && (!tr || tr.writer !== c.deviceId)) {
        if (!d.missingSince.has(path)) d.missingSince.set(path, t);
        missing = d.missingSince.get(path)!;
      } else d.missingSince.delete(path);
      observations.push({ claim: c, trusted: true, changedAt: d.changedAt.get(path) ?? t, missingSince: missing, inCluster: false });
    }
    return { observations, transcriptRound: tr ? tr.round : null, now: t };
  };
  const setClaim = (d: Dev, t: number, patch: Partial<ClaimFile>) => {
    const c = myClaim(d)!;
    write(d, claimPath(d), { kind: 'claim', claim: { ...c, ...patch, heartbeat: c.heartbeat + 1 } }, t);
  };
  const remove = (d: Dev, t: number) => write(d, claimPath(d), null, t);

  const spread = (t: number) => {
    const groups = new Map<number, Dev[]>();
    for (const d of devs) if (d.up) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    for (const members of groups.values()) {
      for (const d of members) for (const o of members) if (o !== d) lastSeen.set(`${d.id}>${o.id}`, t);
      const best = new Map<string, Entry>();
      for (const d of members) for (const [p, e] of d.view) if (!best.has(p) || best.get(p)!.version < e.version) best.set(p, e);
      for (const d of members) for (const [p, e] of best) {
        const cur = d.view.get(p);
        if (!cur || cur.version < e.version) {
          d.view.set(p, e);
          d.changedAt.set(p, t);
        }
      }
    }
  };

  const act = (d: Dev, t: number) => {
    const wall = t + d.skew;
    const input = rankInput(d, t);
    const W = winner(input);
    const iWin = W?.claim.deviceId === d.id;
    const tr = transcriptOf(d);
    if (d.resume) {
      // §14.5 resume after a restart: another live claim → abort; else heartbeat at once and continue.
      d.resume = false;
      const mine = myClaim(d);
      if (mine && (mine.status === 'claimed' || mine.status === 'working')) {
        const R = rMax(input.observations, input.transcriptRound);
        const others = input.observations.some((o) => o.claim.deviceId !== d.id && isLive(o, R, t));
        if (others) {
          remove(d, t);
          d.state = 'idle';
          d.delayUntil = null;
        } else {
          setClaim(d, t, { status: 'working' });
          d.state = 'working';
          d.nextHb = t + HEARTBEAT_MS;
          d.jobStarted = t;
        }
        return;
      }
    }
    switch (d.state) {
      case 'idle': {
        if (tr || (W && !iWin)) {
          d.delayUntil = null;
          return;
        }
        d.delayUntil ??= t + (autoDelayMs({ volunteer: 'always', power: 'ac', localModel: { speedRT: 2 }, cloud: false, cloudAuto: false, jitter: r() }) ?? 0);
        if (t < d.delayUntil) return;
        d.delayUntil = null;
        const seen = input.observations.map((o) => o.claim.claimedAt);
        write(d, claimPath(d), {
          kind: 'claim', claim: {
            format: 'tramado.claim', version: 1, kind: 'transcribe', lectureId: LECTURE, round: 1, deviceId: d.id, memberId: 'm',
            claimedAt: nextClaimedAt(wall, seen), status: 'claimed', heartbeat: firstHeartbeat(input.observations, d.id), updatedAt: '', audioSha256: null,
            supersedes: staleOthers(input, d.id),
          },
        }, t);
        d.state = 'settling';
        d.settleUntil = t + SETTLE_MS;
        return;
      }
      case 'settling':
        if (t < d.settleUntil) return;
        if (iWin) {
          setClaim(d, t, { status: 'working' });
          d.state = 'working';
          d.nextHb = t + HEARTBEAT_MS;
          d.jobStarted = t;
        } else {
          remove(d, t);
          d.state = 'idle';
        }
        return;
      case 'working': {
        if (!iWin) {
          d.jobLeft = Math.max(0, d.jobLeft - (t - d.jobStarted));
          remove(d, t);
          d.state = 'idle';
          return;
        }
        if (t - d.jobStarted >= d.jobLeft) {
          d.jobLeft = 0;
          write(d, 'transcript', { kind: 'transcript', t: { writer: d.id, round: 1 } }, t);
          setClaim(d, t, { status: 'done' });
          d.state = 'done';
          return;
        }
        if (t >= d.nextHb) {
          setClaim(d, t, {});
          d.nextHb = t + HEARTBEAT_MS;
        }
        return;
      }
      case 'done':
        if (!iWin) {
          remove(d, t);
          d.state = 'idle';
        } else if (!tr || tr.writer !== d.id) write(d, 'transcript', { kind: 'transcript', t: { writer: d.id, round: 1 } }, t);
    }
  };

  const assertComponents = (t: number) => {
    const working = new Map<number, string[]>();
    for (const d of devs) if (d.up && d.state === 'working') working.set(d.group, [...(working.get(d.group) ?? []), d.id]);
    for (const [g, ws] of working) if (ws.length > 1) throw new Error(`t=${t}: ${ws.length} working in component ${g}`);
  };

  const chaos = 3 * 3_600_000;
  for (let t = 0; t < chaos; t += STEP) {
    if (r() < 0.01) for (const d of devs) d.group = Math.floor(r() * 3);
    if (r() < 0.01) for (const d of devs) d.group = 0;
    if (r() < 0.006) {
      const d = devs[Math.floor(r() * n)]!;
      if (d.up) {
        d.up = false;
        if (d.state === 'working') d.jobLeft = Math.max(0, d.jobLeft - (t - d.jobStarted));
      }
    }
    for (const d of devs) {
      if (!d.up && r() < 0.01) {
        d.up = true;
        // Monotonic clocks restart: every claim counts as "possibly stale" (§14.4 seeding, §14.5 app start).
        for (const p of d.view.keys()) {
          const owner = p.slice('claims/'.length);
          const peer = devs.find((x) => x.id === owner);
          const connected = !!peer && peer.up && peer.group === d.group && peer !== d;
          d.changedAt.set(p, seedChangedAt(t, t, connected, lastSeen.get(`${d.id}>${owner}`) ?? null));
        }
        d.resume = d.state === 'working' || d.state === 'settling';
        if (d.state === 'settling') d.state = 'working';
      }
    }
    spread(t);
    for (const d of devs) if (d.up) act(d, t);
    spread(t);
    for (const d of devs) if (d.up) act(d, t);   // the losers react to what the winners just wrote
    assertComponents(t);
  }
  // Heal: everyone up and connected, then let it settle.
  for (const d of devs) {
    d.group = 0;
    if (!d.up) {
      d.up = true;
      d.resume = d.state === 'working' || d.state === 'settling';
      if (d.state === 'settling') d.state = 'working';
    }
  }
  for (let t = chaos; t < chaos + 3 * 3_600_000; t += STEP) {
    spread(t);
    for (const d of devs) act(d, t);
    spread(t);
    for (const d of devs) act(d, t);
    assertComponents(t);
  }
  spread(chaos * 2 + STEP);
  for (const d of devs) {
    const done = [...d.view.values()].filter((e) => e.content?.kind === 'claim' && e.content.claim.status === 'done');
    expect(done).toHaveLength(1);
    const tr = transcriptOf(d);
    expect(tr?.writer).toBe((done[0]!.content as { claim: ClaimFile }).claim.deviceId);
    expect(devs.filter((x) => x.state === 'working')).toHaveLength(0);
  }
}

// About 25 ms a run on the reference machine: 2000 runs (test:property) take ~50 s alone, more beside other test files,
// so the limit grows with the runs instead of the global 60 s.
const TIMEOUT_MS = Math.max(60_000, RUNS * 100);

describe('claims property (sync spec §14.9)', () => {
  it('at most one working per component; eventually one done claim and one transcript writer', () => {
    fc.assert(fc.property(fc.integer(), (seed) => simulate(seed)), { numRuns: RUNS });
  }, TIMEOUT_MS);
});
