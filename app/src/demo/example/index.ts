// The demo's classes in rail order (UX §7.3), and lookups by key.
import { BIO } from './bio';
import { HIST } from './hist';
import { LAW } from './law';
import { STATS } from './stats';
import { buildTranscript } from './fill';
import { B4_KEY, FILLER, L8_KEY } from './content/transcripts';
import type { DemoClass, DemoDoc, DemoExam, DemoLecture, DemoNote, DemoSegment, KeySegment } from './types';

export { PEOPLE, MEMBER_KEYS, UNVERIFIED_DEVICE } from './people';
export { demoPeaks, fillTranscript } from './fill';

export const CLASSES: readonly DemoClass[] = [LAW, BIO, STATS, HIST];

export function findLecture(key: string): { cls: DemoClass; lecture: DemoLecture } | null {
  for (const cls of CLASSES) for (const lecture of cls.lectures) if (lecture.key === key) return { cls, lecture };
  return null;
}
export function findDoc(key: string): { cls: DemoClass; doc: DemoDoc } | null {
  for (const cls of CLASSES) for (const doc of cls.documents) if (doc.key === key) return { cls, doc };
  return null;
}
export function findExam(key: string): { cls: DemoClass; exam: DemoExam } | null {
  for (const cls of CLASSES) for (const exam of cls.exams) if (exam.key === key) return { cls, exam };
  return null;
}
export function findNote(key: string): { cls: DemoClass; note: DemoNote } | null {
  for (const cls of CLASSES) for (const note of cls.notes) if (note.key === key) return { cls, note };
  return null;
}

/** Key segments and filler pool of the lectures the fixtures leave untranscribed (`l8`, `b4`). */
const SCRIPTED: Readonly<Record<string, { keys: readonly KeySegment[]; lang: 'pt' | 'en' | 'es'; seed: number }>> = {
  l8: { keys: L8_KEY, lang: 'pt', seed: 8 },
  b4: { keys: B4_KEY, lang: 'en', seed: 4 },
};

/**
 * The full transcript of a demo lecture, as `transcript.json` holds (or would hold) it: the seeded one for `l6`, `l7`
 * and `b3` (before pending corrections), the scripted one the speech fake delivers for `l8` and `b4`. Null for an
 * unknown key.
 */
export function demoTranscript(lectureKey: string): { speakers: Array<{ id: string; label: string }>; language: string; segments: DemoSegment[] } | null {
  const found = findLecture(lectureKey);
  if (!found) return null;
  const l = found.lecture;
  const speaker = l.speakers[0]?.id ?? 'lecture';
  const t = l.transcript;
  const src = t ? { keys: t.keySegments, lang: t.filler.lang, seed: t.filler.seed, filler: t.filler.speaker } : SCRIPTED[l.key] ? { ...SCRIPTED[l.key]!, filler: speaker } : null;
  if (!src) return null;
  const segments = buildTranscript({ key: l.key, durationMs: l.durationMs, keys: src.keys, speaker, fillerSpeaker: src.filler, sentences: FILLER[src.lang], seed: src.seed })
    .map((s) => (t?.original?.[s.id] !== undefined ? { ...s, text: t.original[s.id]! } : s));
  return { speakers: l.speakers, language: l.language, segments };
}
