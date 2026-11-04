// "Remove recordings I made, once transcribed" (Settings › Storage, prefs `privacy.deleteAudioAfterDays`, UX §3.14.7):
// a recording this device made whose transcript (of the current round, for this very audio) is older than the chosen
// number of days loses its audio — `LectureService.deleteAudio`, i.e. `audio.webm` deleted for everyone and
// `lecture.json` rewritten with `audio: null, audioDeletedAt` (folder spec §9.1). The transcript stays. The
// TranscriptionQueue runs the sweep at start and every hour.
import { parseRfc3339 } from '../core/model/time';
import type { DeviceId, Ulid } from '../core/model/ids';
import type { LectureRecord } from './lectures';

export const DAY_MS = 86_400_000;

/** The days of the pref (0 = never). */
export function retentionDays(pref: string | undefined): number {
  const n = Number(pref);
  return n === 30 || n === 90 ? n : 0;
}

/** The lectures whose audio is due for removal now. */
export function expiredAudio(
  records: Iterable<Pick<LectureRecord, 'id' | 'lecture' | 'transcript' | 'round' | 'lectureNewer' | 'transcriptNewer'>>,
  opts: { me: DeviceId; days: number; now: number },
): Ulid[] {
  if (opts.days <= 0 || !opts.me) return [];
  const out: Ulid[] = [];
  for (const r of records) {
    const audio = r.lecture.audio;
    const t = r.transcript;
    if (!audio || r.lectureNewer || r.transcriptNewer || r.lecture.recordedBy.deviceId !== opts.me) continue;
    // Transcribed: the current round, made from this audio (a stale transcript keeps the recording).
    if (!t || t.round < r.round || t.audioSha256 !== audio.sha256) continue;
    const at = parseRfc3339(t.transcribedBy.at);
    if (at === null || opts.now - at < opts.days * DAY_MS) continue;
    out.push(r.id);
  }
  return out;
}
