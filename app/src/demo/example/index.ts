// The demo's classes in rail order (UX §7.3), and lookups by key.
import { BIO } from './bio';
import { HIST } from './hist';
import { LAW } from './law';
import { STATS } from './stats';
import type { DemoClass, DemoDoc, DemoExam, DemoLecture, DemoNote } from './types';

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
