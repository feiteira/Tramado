// Shared wording of exams (UX §3.9, §5.11): dates, countdowns (never red), points with their scale's unit, kinds.
import { DateTime } from 'luxon';
import type { ExamDateView, ExamPaperView, QuestionView } from '../../services/types/viewModels';
import type { I18n } from '../../ui/i18n';

export const KINDS = ['quiz', 'test', 'midterm', 'final', 'resit', 'special', 'oral', 'practice'] as const;
export const QUESTION_KINDS = ['case', 'essay', 'short', 'multiple_choice', 'true_false', 'comment', 'calculation', 'other'] as const;

/** "Thu 12 Nov, 10:00" (or "Thu 12 Nov" for an all-day date). */
export function examWhen(i18n: Pick<I18n, 'date' | 'time'>, at: string, allDay: boolean): string {
  const dt = DateTime.fromISO(at, { setZone: false });
  if (!dt.isValid) return at;
  const day = i18n.date(dt, 'weekday');
  return allDay ? day : `${day}, ${i18n.time(dt)}`;
}

/** Whole days from today to the exam's day (0 = today; negative = past). */
export function daysUntil(at: string, now: DateTime): number {
  const dt = DateTime.fromISO(at);
  return Math.round(dt.startOf('day').diff(now.startOf('day'), 'days').days);
}

/** "today", "tomorrow", "in 9 days". */
export function countdown(i18n: Pick<I18n, 't' | 'tp'>, days: number): string {
  if (days <= 0) return i18n.t('common.relative.today');
  if (days === 1) return i18n.t('common.relative.tomorrow');
  return i18n.tp('common.relative.inDays', days, { n: days });
}

/** "6 valores", "3 puntos", "2 points". */
export function pointsLabel(i18n: Pick<I18n, 'tp'>, scale: ExamPaperView['scale'], n: number): string {
  const v = Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
  return i18n.tp(`exams.points.${scale}`, n, { n: v });
}

/** The status of a question in the list (UX §3.9.8): ○ none · ✦ AI · ⚠ check · ✓ right · ~ partly · ✗ wrong · ? not sure. */
export type QuestionStatus = 'none' | 'ai' | 'warn' | 'right' | 'partly' | 'wrong' | 'unsure';
export function questionStatus(q: QuestionView): QuestionStatus {
  if (q.mine.mark) return q.mine.mark;
  if (!q.ai) return 'none';
  if (q.ai.unverified.length || q.ai.citations.some((c) => c.status === 'hallucinated')) return 'warn';
  return 'ai';
}

/** Splits a paper's meta line into its parts (an empty year is left out). */
export function paperMeta(i18n: Pick<I18n, 't' | 'tp'>, p: ExamPaperView): string {
  const n = p.questions.length;
  const a = p.questions.filter((q) => q.ai).length;
  const practised = p.questions.filter((q) => q.mine.practice.count > 0).length;
  const text = i18n.t('exams.tab.paperMeta', {
    kind: i18n.t(`exams.kinds.${p.kind}`), year: p.year ?? '', questions: i18n.tp('common.count.questions', n, { n }), a, n, p: practised,
  });
  return text.replace(/ · (?= · )/g, '').replace(/^ · | · $/g, '');
}
