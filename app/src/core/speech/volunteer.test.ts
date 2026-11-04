import { describe, expect, it } from 'vitest';
import { effectiveVolunteer, eligibility, jitterMs, overlapShare, probableDuplicate, volunteerDelayMs, type EligibilityFacts } from './volunteer';

describe('volunteering (sync spec §14.3)', () => {
  it('is off in the member file until a local model (or automatic cloud use) exists', () => {
    expect(effectiveVolunteer('plugged', { localModel: false, cloud: false, cloudAuto: false })).toBe('off');
    expect(effectiveVolunteer('plugged', { localModel: true, cloud: false, cloudAuto: false })).toBe('plugged');
    expect(effectiveVolunteer('always', { localModel: false, cloud: true, cloudAuto: false })).toBe('off');
    expect(effectiveVolunteer('always', { localModel: false, cloud: true, cloudAuto: true })).toBe('always');
    expect(effectiveVolunteer('off', { localModel: true, cloud: true, cloudAuto: true })).toBe('off');
  });

  it('waits by capability', () => {
    const fast = { localModel: { speedRT: 2.7 }, cloud: false, cloudAuto: false };
    expect(volunteerDelayMs({ volunteer: 'plugged', power: 'ac', ...fast })).toBe(60_000);
    expect(volunteerDelayMs({ volunteer: 'plugged', power: 'unknown', ...fast })).toBe(60_000);
    expect(volunteerDelayMs({ volunteer: 'plugged', power: 'battery', ...fast })).toBeNull();
    expect(volunteerDelayMs({ volunteer: 'always', power: 'battery', ...fast })).toBe(660_000);
    expect(volunteerDelayMs({ volunteer: 'always', power: 'ac', localModel: { speedRT: 1.2 }, cloud: false, cloudAuto: false })).toBe(180_000);
    expect(volunteerDelayMs({ volunteer: 'always', power: 'ac', localModel: { speedRT: null }, cloud: false, cloudAuto: false })).toBe(180_000);
    expect(volunteerDelayMs({ volunteer: 'always', power: 'ac', localModel: null, cloud: true, cloudAuto: true })).toBe(180_000);
    expect(volunteerDelayMs({ volunteer: 'always', power: 'ac', localModel: null, cloud: true, cloudAuto: false })).toBeNull();
    expect(volunteerDelayMs({ volunteer: 'off', power: 'ac', ...fast })).toBeNull();
  });

  it('jitters within 0–15 s', () => {
    expect(jitterMs(() => 0)).toBe(0);
    expect(jitterMs(() => 0.999999)).toBe(15_000);
  });

  it('spots a backup recording of the same lecture', () => {
    expect(overlapShare({ startMs: 0, durationMs: 100 }, { startMs: 40, durationMs: 100 })).toBe(0.6);
    const me = { id: 'A', startMs: 1000, durationMs: 5_000_000 };
    expect(probableDuplicate(me, [{ id: 'B', startMs: 0, durationMs: 5_400_000, covered: true }])).toBe('B');
    expect(probableDuplicate(me, [{ id: 'B', startMs: 0, durationMs: 5_400_000, covered: false }])).toBeNull();
    expect(probableDuplicate(me, [{ id: 'B', startMs: 4_000_000, durationMs: 5_400_000, covered: true }])).toBeNull();
  });
});

describe('eligibility to claim (sync spec §14.2)', () => {
  const ok: EligibilityFacts = {
    lectureTrusted: true, newerFormat: false, audio: { shared: true, size: 10, sha256: 'a'.repeat(64) }, iAmRecorder: false, duplicateOf: false,
    localAudio: 'match', round: 1, trustedTranscriptForRound: false, anyTranscriptForAudio: false, engineReady: true, failedAtMs: null, nowMs: 100_000_000,
  };
  const why = (f: Partial<EligibilityFacts>, automatic = false) => {
    const r = eligibility({ ...ok, ...f }, { automatic });
    return r.eligible ? 'ok' : r.reason;
  };

  it('needs every condition', () => {
    expect(why({})).toBe('ok');
    expect(why({ lectureTrusted: false })).toBe('untrustedLecture');
    expect(why({ audio: null })).toBe('noAudio');
    expect(why({ audio: { ...ok.audio!, shared: false } })).toBe('notShared');
    expect(why({ audio: { ...ok.audio!, shared: false }, iAmRecorder: true })).toBe('ok');
    expect(why({ duplicateOf: true })).toBe('duplicate');
    expect(why({ localAudio: 'arriving' })).toBe('audioArriving');
    expect(why({ localAudio: 'mismatch' })).toBe('audioMismatch');
    expect(why({ localAudio: 'skipped' })).toBe('skipped');
    expect(why({ trustedTranscriptForRound: true })).toBe('transcribed');
    expect(why({ engineReady: false })).toBe('noEngine');
  });

  it('is stricter for automatic claims: any transcript of this audio, and the failure cool-down', () => {
    expect(why({ anyTranscriptForAudio: true })).toBe('ok');
    expect(why({ anyTranscriptForAudio: true }, true)).toBe('untrustedTranscript');
    expect(why({ failedAtMs: ok.nowMs - 3_600_000 })).toBe('ok');
    expect(why({ failedAtMs: ok.nowMs - 3_600_000 }, true)).toBe('cooldown');
    expect(why({ failedAtMs: ok.nowMs - 25 * 3_600_000 }, true)).toBe('ok');
  });
});
