import { describe, expect, it } from 'vitest';
import { DAY_MS, expiredAudio, retentionDays } from './retention';

const ME = 'AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2';
const BRUNO = 'P56IOI7-MZJNU2Y-IQGDREY-DM2MGTI-MGL3BXN-PQ6W5BM-TBBZ4TJ-XZWICQ2';
const NOW = Date.parse('2026-11-03T15:30:00Z');
const SHA = 'c'.repeat(64);

type R = Parameters<typeof expiredAudio>[0] extends Iterable<infer X> ? X : never;
const rec = (id: string, over: { by?: string; audio?: boolean; round?: number; tRound?: number; tSha?: string; at?: number; transcript?: boolean } = {}): R => ({
  id, round: over.round ?? 1, lectureNewer: false, transcriptNewer: false,
  lecture: {
    recordedBy: { deviceId: over.by ?? ME, memberId: 'm', name: 'Ana' },
    audio: over.audio === false ? null : { file: 'audio.webm', shared: true, codec: 'opus', container: 'webm', sampleRate: 16000, channels: 1, bitrate: 24000, size: 9, sha256: SHA },
  } as R['lecture'],
  transcript: over.transcript === false ? null : ({
    round: over.tRound ?? 1, audioSha256: over.tSha ?? SHA, transcribedBy: { at: new Date(over.at ?? NOW - 40 * DAY_MS).toISOString() },
  } as R['transcript']),
});

describe('audio retention (privacy.deleteAudioAfterDays, UX §3.14.7)', () => {
  it('reads the pref', () => {
    expect([retentionDays('0'), retentionDays('30'), retentionDays('90'), retentionDays('7'), retentionDays(undefined)]).toEqual([0, 30, 90, 0, 0]);
  });

  it('removes only my recordings transcribed long enough ago', () => {
    const records = [
      rec('old'),                                      // mine, transcribed 40 days ago → due at 30
      rec('young', { at: NOW - 10 * DAY_MS }),         // too recent
      rec('bruno', { by: BRUNO }),                     // someone else's recording
      rec('gone', { audio: false }),                   // already removed
      rec('none', { transcript: false }),              // not transcribed yet
      rec('stale', { tSha: 'd'.repeat(64) }),          // the transcript is of another audio
      rec('redo', { round: 2, tRound: 1 }),            // re-transcription pending
    ];
    expect(expiredAudio(records, { me: ME, days: 30, now: NOW })).toEqual(['old']);
    expect(expiredAudio(records, { me: ME, days: 90, now: NOW })).toEqual([]);
    expect(expiredAudio(records, { me: ME, days: 0, now: NOW })).toEqual([]);
  });
});
