// DemoKeys (architecture §11.6): the demo's short keys (UX §7.2: `law`, `l6`, `lf`, `freq`, …) → the ids the
// seed derived. Filled by demo/seed.ts; demo/boot.ts resolves `route=` and `dialog=` through it. A key the
// seed did not fill resolves to the Missing state. Frozen after M0.
import type { ClassId, ClassPath, DeviceId, MemberId, QuestionId, Ulid } from '../core/model/ids';

export type DemoClassKey = 'law' | 'bio' | 'stats' | 'hist';
export const DEMO_CLASS_KEYS: readonly DemoClassKey[] = ['law', 'bio', 'stats', 'hist'];

export interface DemoKeys {
  classes: Partial<Record<string, ClassId>>;
  lectures: Partial<Record<string, { classKey: string; lectureId: Ulid; citeAtMs?: number; citeSegmentId?: string; citeQuote?: string }>>;
  docs: Partial<Record<string, { classKey: string; relPath: ClassPath }>>;
  notes: Partial<Record<string, { classKey: string; relPath: ClassPath; private: boolean }>>;
  exams: Partial<Record<string, { classKey: string; examId: Ulid; questions: Partial<Record<string, QuestionId>> }>>;
  members: Partial<Record<string, { memberId: MemberId; deviceIds: DeviceId[] }>>;
}

export function emptyDemoKeys(): DemoKeys {
  return { classes: {}, lectures: {}, docs: {}, notes: {}, exams: {}, members: {} };
}

/** The id a route uses for a key the seed did not fill: no class has it, so the screen shows Missing. */
export const MISSING_ID = 'missing';
