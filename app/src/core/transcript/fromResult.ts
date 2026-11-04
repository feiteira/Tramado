// A finished transcription job (`TranscriptionResult`, architecture §9) → `transcript.json` (folder spec
// §8.8). Segment ids are random `s_` + base62 and unique; a split (stereo online) recording's two tracks
// are interleaved by time after dropping what the microphone picked up from the speakers (`dropEcho`);
// speakers follow the lecture's `channels`.
import { newSegmentId } from '../ids';
import { isLang, type DeviceId, type Instant, type Lang, type MemberId, type ModelId } from '../model/ids';
import type { LectureFile, Segment, TranscriptFile } from '../model/files';
import { dropEcho } from '../speech/transcript';
import type { SpeechSegment } from '../speech/types';
import { speakerLabel } from './labels';

/** What the result does not carry: who writes the transcript, for which round, and how ids are drawn. */
export interface FromResultContext {
  lecture: Pick<LectureFile, 'id' | 'language' | 'channels' | 'audio' | 'recordedBy'>;
  round: number;
  writer: { deviceId: DeviceId; memberId: MemberId; name: string };
  at: Instant;
  rand: () => number;
  /** The registry id of the local model that ran (folder spec §8.8 `engine.modelId`, local only). */
  modelId?: ModelId | null;
}

type ResultLike = {
  lectureId: string; durationMs: number; language: string;
  engine: { kind: 'local' | 'cloud'; name: string; version?: string; model?: string; modelSha256?: string; vad?: string };
  tracks: Array<{ speaker: 'lecture' | 'me' | 'class'; segments: Array<{ startMs: number; endMs: number; text: string;
                  words?: Array<{ startMs: number; endMs: number; text: string; p: number }> }> }>;
};

type RawSeg = ResultLike['tracks'][number]['segments'][number];
type Tagged = SpeechSegment & { raw: RawSeg; speaker: string };

const ms = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The transcript's language: the lecture's own tag when the engine heard the same language, else what it heard. */
export function transcriptLanguage(lectureLang: Lang | 'auto', heard: string | null | undefined): Lang {
  const h = heard && isLang(heard) ? heard : null;
  if (lectureLang !== 'auto' && isLang(lectureLang)) {
    if (!h) return lectureLang;
    const [a, b] = [lectureLang.toLowerCase().split('-')[0], h.toLowerCase().split('-')[0]];
    return a === b ? lectureLang : h;
  }
  return h ?? 'en';
}

function toSegment(t: Tagged, id: string): Segment {
  const startMs = ms(t.raw.startMs);
  const endMs = Math.max(startMs, ms(t.raw.endMs));
  const seg: Segment = { id, startMs, endMs, speaker: t.speaker, text: clean(t.raw.text) };
  const words = (t.raw.words ?? [])
    .map((w) => ({ startMs: ms(w.startMs), endMs: Math.max(ms(w.startMs), ms(w.endMs)), text: w.text.trim(), p: Math.min(1, Math.max(0, Number.isFinite(w.p) ? w.p : 0)) }))
    .filter((w) => w.text !== '');
  if (words.length) seg.words = words;
  return seg;
}

/** Builds revision 1 of `transcript.json` for `ctx.round` from a transcription result. */
export function fromResult(result: ResultLike, ctx: FromResultContext): TranscriptFile {
  const tag = (speaker: string) => (raw: RawSeg): Tagged => ({ start: raw.startMs, end: raw.endMs, text: raw.text, raw, speaker });
  const tracks = result.tracks.filter((t) => t.segments.length > 0);
  let tagged: Tagged[];
  const mic = tracks.find((t) => t.speaker === 'me');
  const other = tracks.find((t) => t.speaker !== 'me');
  if (tracks.length >= 2 && mic && other) {
    // Split recording (online, "also record me"): the microphone also hears the call through the
    // speakers when there are no headphones; keep only what the student said themselves.
    const m = mic.segments.map(tag('me'));
    const o = tracks.filter((t) => t !== mic).flatMap((t) => t.segments.map(tag(t.speaker)));
    tagged = [...(dropEcho(m, o) as Tagged[]), ...o];
  } else {
    tagged = tracks.flatMap((t) => t.segments.map(tag(t.speaker)));
  }
  tagged = tagged.filter((t) => clean(t.raw.text) !== '');
  tagged.sort((a, b) => ms(a.raw.startMs) - ms(b.raw.startMs) || ms(a.raw.endMs) - ms(b.raw.endMs));

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
  const segments = tagged.map((t) => toSegment(t, nextId()));

  const language = transcriptLanguage(ctx.lecture.language, result.language);
  // Speakers: the lecture's channels first (their order), then any other speaker a track named.
  const ids: string[] = [];
  for (const c of [...ctx.lecture.channels].sort((a, b) => a.index - b.index)) if (!ids.includes(c.speaker)) ids.push(c.speaker);
  for (const s of segments) if (!ids.includes(s.speaker)) ids.push(s.speaker);
  if (ids.length === 0) ids.push('lecture');
  const speakers = ids.map((id) => ({ id, label: speakerLabel(id, language, ctx.lecture.recordedBy.name) }));

  const e = result.engine;
  const engine: TranscriptFile['engine'] = { kind: e.kind, name: e.name };
  if (e.version) engine.version = e.version;
  if (e.model) engine.model = e.model;
  if (e.kind === 'local' && ctx.modelId) engine.modelId = ctx.modelId;
  if (e.modelSha256) engine.modelSha256 = e.modelSha256;
  if (e.vad) engine.vad = e.vad;

  return {
    format: 'tramado.transcript',
    version: 1,
    lectureId: ctx.lecture.id,
    round: ctx.round,
    revision: 1,
    audioSha256: ctx.lecture.audio?.sha256 ?? null,
    language,
    writer: { deviceId: ctx.writer.deviceId, memberId: ctx.writer.memberId },
    transcribedBy: { deviceId: ctx.writer.deviceId, memberId: ctx.writer.memberId, name: ctx.writer.name, at: ctx.at },
    engine,
    speakers,
    segments,
    folded: {},
    updatedAt: ctx.at,
  };
}
