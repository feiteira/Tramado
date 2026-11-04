import { describe, expect, it } from 'vitest';
import type { ClaimFile } from '../model/files';
import {
  autoDelayMs, claimPath, effectiveVolunteer, firstHeartbeat, health, nextClaimedAt, overlapFraction, ownerGone, reevaluateAt, rMax, seedChangedAt,
  shouldDelete, STALE_MS, staleOthers, winner, type ClaimObservation,
} from './claims';

const D = (c: string) => `${c.repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`;
const L = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';
const claim = (dev: string, over: Partial<ClaimFile> = {}): ClaimFile => ({
  format: 'tramado.claim', version: 1, kind: 'transcribe', lectureId: L, round: 1, deviceId: dev, memberId: 'm', claimedAt: 1000,
  status: 'claimed', heartbeat: 0, updatedAt: '', audioSha256: null, ...over,
});
const obs = (c: ClaimFile, over: Partial<ClaimObservation> = {}): ClaimObservation => ({ claim: c, trusted: true, changedAt: 0, missingSince: null, inCluster: false, ...over });

describe('ranking (sync spec §14.4)', () => {
  it('done < working < claimed, then claimedAt, then device ID', () => {
    const w = winner({ observations: [obs(claim(D('C'), { claimedAt: 5 })), obs(claim(D('B'), { claimedAt: 5 })), obs(claim(D('A'), { claimedAt: 9, status: 'working' }))], transcriptRound: null, now: 0 });
    expect(w?.claim.deviceId).toBe(D('A'));
    const t = winner({ observations: [obs(claim(D('C'), { claimedAt: 5 })), obs(claim(D('B'), { claimedAt: 5 }))], transcriptRound: null, now: 0 });
    expect(t?.claim.deviceId).toBe(D('B'));
  });

  it('stale, superseded, untrusted, older-round and released claims are not eligible', () => {
    const stale = obs(claim(D('A'), { status: 'working', heartbeat: 3 }), { changedAt: 0 });
    const taker = obs(claim(D('B'), { claimedAt: 2000, supersedes: [{ deviceId: D('A'), heartbeat: 3 }] }), { changedAt: STALE_MS });
    expect(winner({ observations: [stale, taker], transcriptRound: null, now: STALE_MS })?.claim.deviceId).toBe(D('B'));
    // A comes back with a newer heartbeat before seeing the take-over: no longer superseded, and outranks B
    const back = obs(claim(D('A'), { status: 'working', heartbeat: 4 }), { changedAt: STALE_MS });
    expect(winner({ observations: [back, taker], transcriptRound: null, now: STALE_MS })?.claim.deviceId).toBe(D('A'));
    expect(winner({ observations: [obs(claim(D('A')), { trusted: false })], transcriptRound: null, now: 0 })).toBeNull();
    expect(winner({ observations: [obs(claim(D('A'), { round: 1 })), obs(claim(D('B'), { round: 2 }))], transcriptRound: null, now: 0 })?.claim.deviceId).toBe(D('B'));
    expect(winner({ observations: [obs(claim(D('A'), { status: 'released' }))], transcriptRound: null, now: 0 })).toBeNull();
    expect(rMax([obs(claim(D('A'), { round: 3 }), { trusted: false })], 2)).toBe(2);
  });

  it('a done claim whose transcript is missing for an hour is ignored unless the cluster has it', () => {
    const done = claim(D('A'), { status: 'done' });
    expect(winner({ observations: [obs(done, { missingSince: 0 })], transcriptRound: 1, now: 3_600_000 })).toBeNull();
    expect(winner({ observations: [obs(done, { missingSince: 0, inCluster: true })], transcriptRound: 1, now: 3_600_000 })).not.toBeNull();
    expect(winner({ observations: [obs(done, { missingSince: 0 })], transcriptRound: 1, now: 3_599_999 })).not.toBeNull();
  });

  it('a newer-version claim counts as a live working claim', () => {
    const w = winner({ observations: [obs(claim(D('A'), { claimedAt: 1 })), obs(claim(D('B'), { claimedAt: 9 }), { newer: true })], transcriptRound: null, now: 0 });
    expect(w?.claim.deviceId).toBe(D('B'));
  });

  it('a fresh claim starts above any supersedes entry naming its device', () => {
    const taker = obs(claim(D('B'), { supersedes: [{ deviceId: D('A'), heartbeat: 13 }] }));
    expect(firstHeartbeat([taker], D('A'))).toBe(14);
    expect(firstHeartbeat([taker], D('C'))).toBe(0);
  });

  it('lists the stale claims of others', () => {
    const o = [obs(claim(D('A'), { status: 'working', heartbeat: 7 }), { changedAt: 0 }), obs(claim(D('B')), { changedAt: STALE_MS })];
    expect(staleOthers({ observations: o, transcriptRound: null, now: STALE_MS }, D('C'))).toEqual([{ deviceId: D('A'), heartbeat: 7 }]);
  });
});

describe('timing (sync spec §14.3–§14.6)', () => {
  it('health, re-evaluation, claimedAt, seeding', () => {
    expect(health(60_000)).toBe('healthy');
    expect(health(130_000)).toBe('slow');
    expect(health(600_000)).toBe('stale');
    expect(reevaluateAt(1000)).toEqual({ stale: 1000 + STALE_MS + 1000, slow: 121_000 });
    expect(nextClaimedAt(100, [50, 200])).toBe(201);
    expect(nextClaimedAt(300, [50, 200])).toBe(300);
    expect(seedChangedAt(1_000_000, 5_000_000, true, null)).toBe(1_000_000);
    expect(seedChangedAt(1_000_000, 5_000_000, false, 4_900_000)).toBe(900_000);
    expect(seedChangedAt(1_000_000, 5_000_000, false, 0)).toBe(1_000_000 - STALE_MS);
  });

  it('capability delays (§14.3)', () => {
    const base = { volunteer: 'plugged' as const, power: 'ac' as const, localModel: { speedRT: 2.7 }, cloud: false, cloudAuto: false, jitter: 0 };
    expect(autoDelayMs(base)).toBe(60_000);
    expect(autoDelayMs({ ...base, localModel: { speedRT: 1.2 } })).toBe(180_000);
    expect(autoDelayMs({ ...base, power: 'battery' })).toBeNull();
    expect(autoDelayMs({ ...base, volunteer: 'always', power: 'battery' })).toBe(660_000);
    expect(autoDelayMs({ ...base, localModel: null, cloud: true, cloudAuto: true })).toBe(180_000);
    expect(autoDelayMs({ ...base, localModel: null, cloud: true, cloudAuto: false })).toBeNull();
    expect(autoDelayMs({ ...base, volunteer: 'off' })).toBeNull();
    expect(autoDelayMs({ ...base, jitter: 1 })).toBe(75_000);
    expect(effectiveVolunteer('plugged', false, false)).toBe('off');
    expect(effectiveVolunteer('always', true, false)).toBe('always');
  });

  it('overlap rule, retention, paths, owner hand-over trigger', () => {
    expect(overlapFraction({ startMs: 0, durationMs: 100 }, { startMs: 40, durationMs: 100 })).toBe(0.6);
    expect(overlapFraction({ startMs: 0, durationMs: 100 }, { startMs: 60, durationMs: 100 })).toBe(0.4);
    expect(shouldDelete(claim(D('A'), { status: 'failed' }), { nowMs: 86_400_000, updatedMs: 0, isCurrentOwnerDone: false })).toBe(true);
    expect(shouldDelete(claim(D('A'), { status: 'done' }), { nowMs: 8 * 86_400_000, updatedMs: 0, isCurrentOwnerDone: true })).toBe(false);
    expect(shouldDelete(claim(D('A'), { status: 'done' }), { nowMs: 8 * 86_400_000, updatedMs: 0, isCurrentOwnerDone: false })).toBe(true);
    expect(claimPath(L, 'fold', D('A'))).toBe(`.tramado/claims/${L}.fold/${D('A')}.json`);
    expect(ownerGone({ hasMemberFile: false, connected: false, lastSeenMs: null, nowMs: 0 })).toBe(true);
    expect(ownerGone({ hasMemberFile: true, connected: false, lastSeenMs: 0, nowMs: 8 * 86_400_000 })).toBe(true);
    expect(ownerGone({ hasMemberFile: true, connected: true, lastSeenMs: 0, nowMs: 8 * 86_400_000 })).toBe(false);
  });
});
