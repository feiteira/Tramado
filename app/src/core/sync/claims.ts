// "Only one person transcribes" (sync spec §14) and fold claims (§14.8): the parameters, ranking, liveness,
// supersession, the winner rule, staleness by the reader's own monotonic clock, re-evaluation times, capability
// delays with the overlap rule, and `claimedAt`. Pure: every input is what one reader observes.
import { isDeviceId, isUlid, type DeviceId } from '../model/ids';
import type { ClaimFile } from '../model/files';

export const SETTLE_MS = 12_000;
export const COMPLETION_WAIT_MAX_MS = 60_000;
export const HEARTBEAT_MS = 60_000;
export const SLOW_MS = 120_000;
export const STALE_MS = 600_000;
export const DONE_TRUST_MS = 3_600_000;
export const DONE_RETENTION_MS = 7 * 86_400_000;
export const FAILED_RETENTION_MS = 86_400_000;
export const UNCLAIMED_NUDGE_MS = 86_400_000;
export const FAIL_COOLDOWN_MS = 86_400_000;
/** §14.8: the owner is gone when it has no member file or was last seen more than 7 days ago; checked hourly. */
export const OWNER_ABSENT_MS = 7 * 86_400_000;
export const FOLD_CHECK_MS = 3_600_000;
export const JITTER_MAX_MS = 15_000;

export type ClaimKind = ClaimFile['kind'];
export type ClaimStatus = ClaimFile['status'];

export const rank = (s: ClaimStatus): number => (s === 'done' ? 0 : s === 'working' ? 1 : s === 'claimed' ? 2 : 9);

/** Shape check of a claim file as read (a newer version counts as a live `working` claim, folder spec §7.3). */
export function claimShapeOk(c: unknown): c is ClaimFile {
  if (typeof c !== 'object' || c === null) return false;
  const o = c as Record<string, unknown>;
  return (o.kind === 'transcribe' || o.kind === 'fold') && isUlid(o.lectureId) && typeof o.round === 'number' && o.round >= 1
    && isDeviceId(o.deviceId) && typeof o.claimedAt === 'number' && typeof o.heartbeat === 'number'
    && ['claimed', 'working', 'done', 'released', 'failed'].includes(o.status as string);
}

/** A claim as one reader observes it. */
export interface ClaimObservation {
  claim: ClaimFile;
  trusted: boolean;
  /** Reader's monotonic time of the last content change it saw (seeded at start-up, §14.4). */
  changedAt: number;
  /** For `done`: since when (monotonic) this reader has seen the transcript missing or mismatched; null when present. */
  missingSince: number | null;
  /** For `done`: the cluster's global index has the claimant's transcript (§14.4 `in_cluster`). */
  inCluster: boolean;
  /** Newer `version`: counts as a live `working` claim of that device (§7.3). */
  newer?: boolean;
}

export interface RankInput {
  observations: readonly ClaimObservation[];
  /** Round of the trusted transcript.json (null when none). */
  transcriptRound: number | null;
  now: number;  // reader's monotonic clock
}

/** `R_max` (§14.4): the greatest round among trusted claims and the trusted transcript; default 1. */
export function rMax(obs: readonly ClaimObservation[], transcriptRound: number | null): number {
  let r = transcriptRound ?? 1;
  for (const o of obs) if (o.trusted && o.claim.round > r) r = o.claim.round;
  return r;
}

export const locallyStale = (o: ClaimObservation, now: number): boolean => now - o.changedAt >= STALE_MS;

const effStatus = (o: ClaimObservation): ClaimStatus => (o.newer ? 'working' : o.claim.status);

export function isLive(o: ClaimObservation, R: number, now: number): boolean {
  if (!o.trusted || o.claim.round !== R) return false;
  const s = effStatus(o);
  if (s !== 'claimed' && s !== 'working' && s !== 'done') return false;
  if ((s === 'claimed' || s === 'working') && locallyStale(o, now)) return false;
  if (s === 'done' && o.missingSince !== null && now - o.missingSince >= DONE_TRUST_MS && !o.inCluster) return false;
  return true;
}

export function isSuperseded(o: ClaimObservation, all: readonly ClaimObservation[], R: number, now: number): boolean {
  return all.some((s) => s !== o && s.claim.deviceId !== o.claim.deviceId && isLive(s, R, now)
    && (s.claim.supersedes ?? []).some((x) => x && x.deviceId === o.claim.deviceId && o.claim.heartbeat <= x.heartbeat));
}

const cmpClaims = (a: ClaimObservation, b: ClaimObservation): number =>
  rank(effStatus(a)) - rank(effStatus(b)) || a.claim.claimedAt - b.claim.claimedAt
  || (a.claim.deviceId < b.claim.deviceId ? -1 : a.claim.deviceId > b.claim.deviceId ? 1 : 0);

/** The eligible claims in winner order (§14.4): smallest (rank, claimedAt, deviceId) first. */
export function eligibleClaims(input: RankInput): ClaimObservation[] {
  const R = rMax(input.observations, input.transcriptRound);
  return input.observations
    .filter((o) => isLive(o, R, input.now) && !isSuperseded(o, input.observations, R, input.now))
    .sort(cmpClaims);
}

export const winner = (input: RankInput): ClaimObservation | null => eligibleClaims(input)[0] ?? null;

/** Claims of other devices that are claimed/working and locally stale (the `supersedes` list of a new claim). */
export function staleOthers(input: RankInput, me: DeviceId): Array<{ deviceId: DeviceId; heartbeat: number }> {
  return input.observations
    .filter((o) => o.trusted && o.claim.deviceId !== me && (o.claim.status === 'claimed' || o.claim.status === 'working') && locallyStale(o, input.now))
    .map((o) => ({ deviceId: o.claim.deviceId, heartbeat: o.claim.heartbeat }));
}

/** UI health by the reader's clock (§14.6): healthy < 2 min, slow 2–10 min, stale ≥ 10 min. */
export function health(sinceChangeMs: number): 'healthy' | 'slow' | 'stale' {
  return sinceChangeMs >= STALE_MS ? 'stale' : sinceChangeMs >= SLOW_MS ? 'slow' : 'healthy';
}

/** When the winner's claim would go stale (§14.3): last change seen + STALE_MS + 1 s (and + SLOW_MS for the UI). */
export function reevaluateAt(winnerChangedAt: number): { stale: number; slow: number } {
  return { stale: winnerChangedAt + STALE_MS + 1000, slow: winnerChangedAt + SLOW_MS };
}

/** `claimedAt = max(local now, greatest claimedAt seen for this lecture + 1)` (§14.5). */
export function nextClaimedAt(nowMs: number, seen: Iterable<number>): number {
  let m = nowMs;
  for (const s of seen) if (s + 1 > m) m = s + 1;
  return m;
}

/** The seed of `changedAt` for a claim first seen at start-up (§14.4). */
export function seedChangedAt(nowMono: number, nowWall: number, connected: boolean, lastSeenWall: number | null): number {
  if (connected) return nowMono;
  const ago = lastSeenWall === null ? STALE_MS : Math.min(STALE_MS, Math.max(0, nowWall - lastSeenWall));
  return nowMono - ago;
}

export interface DelayInput {
  /** effective `caps.volunteer` of this device */
  volunteer: 'off' | 'plugged' | 'always';
  power: 'ac' | 'battery' | 'unknown';
  localModel: { speedRT: number } | null;
  cloud: boolean;
  cloudAuto: boolean;
  /** 0..1 */
  jitter: number;
}

/**
 * The automatic capability delay of a volunteer (§14.3), or null when this device never claims automatically.
 * Unknown power counts as mains (desktops report no battery).
 */
export function autoDelayMs(d: DelayInput): number | null {
  if (d.volunteer === 'off') return null;
  const onAc = d.power !== 'battery';
  if (d.volunteer === 'plugged' && !onAc) return null;
  let base: number;
  if (d.localModel) base = d.localModel.speedRT >= 1.5 ? 60_000 : 180_000;
  else if (d.cloud && d.cloudAuto) base = 60_000 + 120_000;
  else return null;
  if (!onAc) base += 600_000;
  return base + Math.floor(Math.max(0, Math.min(1, d.jitter)) * JITTER_MAX_MS);
}

/** The effective `caps.volunteer` the member file reports (§14.3 "Default volunteering"). */
export function effectiveVolunteer(pref: 'off' | 'plugged' | 'always', localModelReady: boolean, cloudAuto: boolean): 'off' | 'plugged' | 'always' {
  return localModelReady || cloudAuto ? pref : 'off';
}

/** Fraction of `a`'s time range covered by `b` (§14.3 duplicates: > 0.5 = probably the same lecture). */
export function overlapFraction(a: { startMs: number; durationMs: number }, b: { startMs: number; durationMs: number }): number {
  if (a.durationMs <= 0) return 0;
  const lo = Math.max(a.startMs, b.startMs);
  const hi = Math.min(a.startMs + a.durationMs, b.startMs + b.durationMs);
  return Math.max(0, hi - lo) / a.durationMs;
}

/** §8.10 retention: whether a claim file of this device should be deleted now. */
export function shouldDelete(c: ClaimFile, ctx: { nowMs: number; updatedMs: number; isCurrentOwnerDone: boolean }): boolean {
  if (c.status === 'failed' || c.status === 'released') return ctx.nowMs - ctx.updatedMs >= FAILED_RETENTION_MS;
  if (c.status === 'done') return !ctx.isCurrentOwnerDone && ctx.nowMs - ctx.updatedMs >= DONE_RETENTION_MS;
  return false;
}

/** The claim path of a device (§8.10). */
export const claimPath = (lectureId: string, kind: ClaimKind, deviceId: DeviceId): string =>
  `.tramado/claims/${lectureId}${kind === 'fold' ? '.fold' : ''}/${deviceId}.json`;

export const claimDir = (lectureId: string, kind: ClaimKind): string => `.tramado/claims/${lectureId}${kind === 'fold' ? '.fold' : ''}`;

/** §14.8 fold trigger: the owner has no member file, or was last seen more than 7 days ago. */
export function ownerGone(o: { hasMemberFile: boolean; connected: boolean; lastSeenMs: number | null; nowMs: number }): boolean {
  if (!o.hasMemberFile) return true;
  if (o.connected) return false;
  return o.lastSeenMs !== null && o.nowMs - o.lastSeenMs > OWNER_ABSENT_MS;
}

