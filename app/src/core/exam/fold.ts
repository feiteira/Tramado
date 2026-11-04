// The exam-edit merge of folder spec §8.13: unfolded lines sorted by HLC; `set_*` are LWW per (question, field)
// against `fieldHlc` / `examFieldHlc`; `delete_question` is final (a deleted id never comes back; deleting a
// container deletes its children); `add_question` with an id already present is ignored. The importer folds the lines
// into exam.json (debounced 5 minutes); readers apply unfolded lines for display. Tramado 0.1 writes no such lines.
import type { ExamEditLine, ExamFile, Question } from '../model/files';
import type { DeviceId, Hlc, QuestionId } from '../model/ids';

export const EXAM_FIELDS = ['title', 'type', 'status', 'date', 'allDay', 'durationMin', 'room', 'weight', 'weightText', 'academicYear', 'covers', 'coversText', 'rules', 'scale', 'extraPoints'] as const;
export const QUESTION_FIELDS = ['number', 'parent', 'group', 'kind', 'text', 'points', 'options', 'choose', 'source', 'answerKey'] as const;
export const FOLD_DEBOUNCE_MS = 5 * 60_000;

export interface EditFrom { deviceId: DeviceId; line: ExamEditLine }
export interface FoldResult { exam: ExamFile; changed: boolean; applied: number }

const newer = (a: Hlc, b: Hlc | undefined) => b === undefined || a > b;

export function foldExamEdits(exam: ExamFile, lines: readonly EditFrom[]): FoldResult {
  const mine = lines.filter((l) => l.line.examId === exam.id);
  const deleted = new Set<QuestionId>(mine.filter((l) => l.line.op === 'delete_question' && l.line.questionId).map((l) => l.line.questionId!));
  const unfolded = mine
    .filter((l) => newer(l.line.hlc, exam.folded[l.deviceId]))
    .sort((a, b) => (a.line.hlc < b.line.hlc ? -1 : a.line.hlc > b.line.hlc ? 1 : a.deviceId < b.deviceId ? -1 : 1));
  if (!unfolded.length) return { exam, changed: false, applied: 0 };
  const out: ExamFile = structuredClone(exam);
  out.examFieldHlc = { ...(out.examFieldHlc ?? {}) };
  let qs: Question[] = out.questions.map((q) => ({ ...q, fieldHlc: { ...(q.fieldHlc ?? {}) } }));
  let applied = 0;
  const folded: Record<DeviceId, Hlc> = { ...out.folded };
  for (const { deviceId, line } of unfolded) {
    if (newer(line.hlc, folded[deviceId])) folded[deviceId] = line.hlc;
    switch (line.op) {
      case 'set_exam': {
        const f = line.field as (typeof EXAM_FIELDS)[number] | undefined;
        if (!f || !(EXAM_FIELDS as readonly string[]).includes(f)) break;
        if (!newer(line.hlc, out.examFieldHlc[f])) break;
        (out as unknown as Record<string, unknown>)[f] = line.value;
        out.examFieldHlc[f] = line.hlc;
        applied++;
        break;
      }
      case 'set_question': {
        const f = line.field as (typeof QUESTION_FIELDS)[number] | undefined;
        const q = qs.find((x) => x.id === line.questionId);
        if (!q || !f || !(QUESTION_FIELDS as readonly string[]).includes(f) || deleted.has(q.id)) break;
        if (!newer(line.hlc, q.fieldHlc![f])) break;
        (q as unknown as Record<string, unknown>)[f] = line.value;
        q.fieldHlc![f] = line.hlc;
        applied++;
        break;
      }
      case 'add_question': {
        const nq = line.question;
        if (!nq || qs.some((x) => x.id === nq.id) || deleted.has(nq.id)) break;
        const at = line.after === null || line.after === undefined ? (line.after === null ? 0 : qs.length) : qs.findIndex((x) => x.id === line.after) + 1 || qs.length;
        qs.splice(at, 0, { ...nq });
        applied++;
        break;
      }
      case 'delete_question': {
        const id = line.questionId;
        if (!id || !qs.some((x) => x.id === id)) break;
        const gone = new Set<QuestionId>([id]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const x of qs) if (x.parent && gone.has(x.parent) && !gone.has(x.id)) {
            gone.add(x.id);
            grew = true;
          }
        }
        qs = qs.filter((x) => !gone.has(x.id));
        applied++;
        break;
      }
    }
  }
  out.questions = qs.map((q) => {
    if (q.fieldHlc && Object.keys(q.fieldHlc).length === 0) {
      const { fieldHlc: _f, ...rest } = q;
      void _f;
      return rest;
    }
    return q;
  });
  if (Object.keys(out.examFieldHlc).length === 0) delete out.examFieldHlc;
  out.folded = folded;
  return { exam: out, changed: true, applied };
}
