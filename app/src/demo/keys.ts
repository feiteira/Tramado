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

/**
 * The demo join (UX §7.2 `code=demo`, §7.4 `join` shot): a fictional invite from Bruno Costa's demo device to
 * "Microeconomia I", whose class ID derives from that device and `DEMO_JOIN_NONCE` (platform/memory/sync.ts), so the
 * demo admits the joiner. Made 2026-11-03 10:00 UTC (`t`), with no expiry.
 */
export const DEMO_JOIN_CODE =
  'tri1_eyJ2IjoxLCJmIjoidHJhbWFkby1lb2dqeTRkYW1rYmFtYnlnNGR1NWFmbDJzayIsImwiOiJNaWNyb2Vjb25vbWlhIEkiLCJzIjoiTWljcm8gSSIsImMiOiIjZDk3NzA2IiwiaSI6ImNoYXJ0LWxpbmUiLCJsdCI6IlByb2YuIFJ1aSBUYXZhcmVzIiwidG0iOiIyMDI2LzI3IMK3IDEuwrogc2VtZXN0cmUiLCJsZyI6InB0LVBUIiwibSI6InB5M2xuNnp2YjJmZWE1YzdwNmJwbmtlbXJmIiwibiI6IkJydW5vIENvc3RhIiwiZCI6W3siaWQiOiI0UTNYSUZRMkVWQlkzR1Q0VUhDQU02NFNFVkZTUjdDQTJYREhBNk9WR1lJQ0NNRlozTUdUQkdRRiIsImEiOlsidGNwOi8vMTkyLjE2OC4xLjIxOjIyMTAwIl19XSwidCI6MTc5MzcwMDAwMH0';
