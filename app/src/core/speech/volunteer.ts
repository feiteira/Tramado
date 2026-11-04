// Who transcribes a lecture, and when (sync spec §14.2, §14.3): the eligibility of this device, the
// effective volunteering policy reported in the member file, the capability delays with jitter, and the
// "probably the same lecture" overlap rule. Pure; the TranscriptionQueue applies them.
import type { Hex64, Ulid } from '../model/ids';

/** Sync spec §14.1 (the parameters the queue needs; the claim engine has the rest). */
export const SLOW_MS = 120_000;
export const STALE_MS = 600_000;
export const UNCLAIMED_NUDGE_MS = 24 * 3_600_000;
export const FAIL_COOLDOWN_MS = 24 * 3_600_000;
export const JITTER_MAX_MS = 15_000;

export type VolunteerPref = 'off' | 'plugged' | 'always';
export type PowerSource = 'ac' | 'battery' | 'unknown';

/**
 * The policy the member file reports (`caps.volunteer`, sync spec §14.3): the preference, but `off` while
 * no local model is installed and automatic cloud use is off.
 */
export function effectiveVolunteer(pref: VolunteerPref, can: { localModel: boolean; cloud: boolean; cloudAuto: boolean }): VolunteerPref {
  if (pref === 'off') return 'off';
  if (can.localModel) return pref;
  return can.cloud && can.cloudAuto ? pref : 'off';
}

/**
 * The capability delay of an automatic claim (sync spec §14.3), without the jitter, or null when this
 * device does not volunteer for it now:
 * local model with speedRT ≥ 1.5 → 60 s, slower (or unmeasured) → 180 s; only cloud (with automatic cloud
 * use allowed) → 60 s + 120 s; `always` on battery → + 600 s; `plugged` on battery → never.
 */
export function volunteerDelayMs(input: {
  volunteer: VolunteerPref;               // effective
  power: PowerSource;
  localModel: { speedRT: number | null } | null;
  cloud: boolean; cloudAuto: boolean;
}): number | null {
  if (input.volunteer === 'off') return null;
  const onBattery = input.power === 'battery';
  if (onBattery && input.volunteer === 'plugged') return null;
  let delay: number;
  if (input.localModel) delay = (input.localModel.speedRT ?? 0) >= 1.5 ? 60_000 : 180_000;
  else if (input.cloud && input.cloudAuto) delay = 60_000 + 120_000;
  else return null;
  if (onBattery) delay += 600_000;
  return delay;
}

/** A random 0–15 s jitter (sync spec §14.3). */
export const jitterMs = (rand: () => number): number => Math.floor(rand() * (JITTER_MAX_MS + 1));

export interface TimeSpan { id: Ulid; startMs: number; durationMs: number }

/** The share of `a`'s duration that `b` covers (0..1). */
export function overlapShare(a: Omit<TimeSpan, 'id'>, b: Omit<TimeSpan, 'id'>): number {
  if (a.durationMs <= 0) return 0;
  const from = Math.max(a.startMs, b.startMs);
  const to = Math.min(a.startMs + a.durationMs, b.startMs + b.durationMs);
  return Math.max(0, to - from) / a.durationMs;
}

/**
 * "Probably the same lecture as …" (sync spec §14.3 duplicates): the other lecture of the class, with a
 * live or done claim (or a transcript), that covers more than half of this one. Volunteers skip it.
 */
export function probableDuplicate(lecture: TimeSpan, others: ReadonlyArray<TimeSpan & { covered: boolean }>): Ulid | null {
  let best: { id: Ulid; share: number } | null = null;
  for (const o of others) {
    if (o.id === lecture.id || !o.covered) continue;
    const share = overlapShare(lecture, o);
    if (share > 0.5 && (!best || share > best.share)) best = { id: o.id, share };
  }
  return best?.id ?? null;
}

export type IneligibleReason =
  | 'untrustedLecture' | 'noAudio' | 'notShared' | 'duplicate' | 'audioMissing' | 'audioArriving' | 'audioMismatch'
  | 'skipped' | 'transcribed' | 'untrustedTranscript' | 'noEngine' | 'cooldown' | 'newerFormat';

/** What this device knows about one lecture, for sync spec §14.2. */
export interface EligibilityFacts {
  lectureTrusted: boolean;
  newerFormat: boolean;
  audio: { shared: boolean; size: number; sha256: Hex64 } | null;
  iAmRecorder: boolean;
  duplicateOf: boolean;
  /** The local audio: complete and matching, still arriving, wrong bytes, absent, or skipped by this computer. */
  localAudio: 'match' | 'arriving' | 'mismatch' | 'missing' | 'skipped';
  /** The round a new claim would be for (R_max, or R_max + 1 for a re-transcription). */
  round: number;
  /** A trusted transcript.json of `round` made from this audio exists. */
  trustedTranscriptForRound: boolean;
  /** Some transcript.json (trusted or not) made from this audio exists. */
  anyTranscriptForAudio: boolean;
  engineReady: boolean;
  /** When this device last failed this lecture (epoch ms), if it did. */
  failedAtMs: number | null;
  nowMs: number;
}

/** Sync spec §14.2. `automatic` adds the volunteers' stricter rules (any transcript at all; the cool-down). */
export function eligibility(f: EligibilityFacts, mode: { automatic: boolean }): { eligible: true } | { eligible: false; reason: IneligibleReason } {
  const no = (reason: IneligibleReason) => ({ eligible: false as const, reason });
  if (!f.lectureTrusted) return no('untrustedLecture');
  if (f.newerFormat) return no('newerFormat');
  if (!f.audio) return no('noAudio');
  if (!f.audio.shared && !f.iAmRecorder) return no('notShared');
  if (f.duplicateOf) return no('duplicate');
  if (f.localAudio === 'skipped') return no('skipped');
  if (f.localAudio === 'missing') return no('audioMissing');
  if (f.localAudio === 'arriving') return no('audioArriving');
  if (f.localAudio === 'mismatch') return no('audioMismatch');
  if (f.trustedTranscriptForRound) return no('transcribed');
  if (mode.automatic && f.anyTranscriptForAudio) return no('untrustedTranscript');
  if (!f.engineReady) return no('noEngine');
  if (mode.automatic && f.failedAtMs !== null && f.nowMs - f.failedAtMs < FAIL_COOLDOWN_MS) return no('cooldown');
  return { eligible: true };
}
