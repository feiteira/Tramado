// Subtitles that came with an imported recording (UX §3.6.6 "use “aula.vtt” as the transcript") → revision 1 of
// `transcript.json` (folder spec §8.8, engine `{ kind: 'import', name: 'vtt' }`). One segment per cue; a cue's
// voice (`<v Name>`, "Name: …") becomes a speaker `spk_<n>` labelled with that name, and cues without a voice
// are the lecture's. The audio hash is the imported recording's: the subtitles were made for it.
import { newSegmentId } from '../ids';
import type { DeviceId, Instant, Lang, MemberId } from '../model/ids';
import type { LectureFile, Segment, TranscriptFile } from '../model/files';
import type { Cue } from '../import/transcript';
import { speakerLabel } from './labels';
import { transcriptLanguage } from './fromResult';

export interface FromCuesContext {
  lecture: Pick<LectureFile, 'id' | 'language' | 'audio' | 'recordedBy'>;
  writer: { deviceId: DeviceId; memberId: MemberId; name: string };
  at: Instant;
  rand: () => number;
  /** The subtitle file's own language, when it names one (default: the lecture's). */
  language?: Lang | null;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const ms = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/** Builds `transcript.json` (round 1, revision 1) from subtitle cues; null when no cue has text. */
export function transcriptFromCues(cues: readonly Cue[], ctx: FromCuesContext): TranscriptFile | null {
  const kept = cues
    .map((c) => ({ start: ms(c.start), end: Math.max(ms(c.start), ms(c.end)), speaker: c.speaker ? clean(c.speaker).slice(0, 40) : null, text: clean(c.text) }))
    .filter((c) => c.text !== '')
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (kept.length === 0) return null;
  const language = transcriptLanguage(ctx.lecture.language, ctx.language ?? null);
  const names: string[] = [];
  for (const c of kept) if (c.speaker && !names.includes(c.speaker)) names.push(c.speaker);
  const idOf = (name: string | null) => (name ? `spk_${names.indexOf(name) + 1}` : 'lecture');
  const used = new Set<string>();
  const nextId = () => {
    for (;;) {
      const id = newSegmentId(ctx.rand);
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
  const segments: Segment[] = kept.map((c) => ({ id: nextId(), startMs: c.start, endMs: c.end, speaker: idOf(c.speaker), text: c.text }));
  const speakers: TranscriptFile['speakers'] = [];
  if (kept.some((c) => !c.speaker)) speakers.push({ id: 'lecture', label: speakerLabel('lecture', language, ctx.lecture.recordedBy.name) });
  names.forEach((n, i) => speakers.push({ id: `spk_${i + 1}`, label: n }));
  return {
    format: 'tramado.transcript',
    version: 1,
    lectureId: ctx.lecture.id,
    round: 1,
    revision: 1,
    audioSha256: ctx.lecture.audio?.sha256 ?? null,
    language,
    writer: { deviceId: ctx.writer.deviceId, memberId: ctx.writer.memberId },
    transcribedBy: { deviceId: ctx.writer.deviceId, memberId: ctx.writer.memberId, name: ctx.writer.name, at: ctx.at },
    engine: { kind: 'import', name: 'vtt' },
    speakers,
    segments,
    folded: {},
    updatedAt: ctx.at,
  };
}
