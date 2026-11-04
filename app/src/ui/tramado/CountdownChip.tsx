// CountdownChip (UX §2.11, §3.3.2): the class colour and a calendar icon, never red. "{title} · today, 10:00",
// "· tomorrow, 10:00", "· in {n} days" (fewer than 14) or "· {date}"; within 3 days a 1.5 px class-bar border and
// weight 650. Props frozen since M0.
import React from 'react';
import { CalendarClock } from 'lucide-react';
import { DateTime } from 'luxon';
import type { ExamDateView } from '../../services/types/viewModels';
import { useI18n, type I18n } from '../i18n';
import { cx } from '../cx';

export interface CountdownChipProps {
  exam: ExamDateView;
  now: DateTime;
  onClick?(): void;
  className?: string;
  'data-testid'?: string;
}

/** The chip's words (pure over an I18n). */
export function countdownLabel(exam: ExamDateView, now: DateTime, i18n: Pick<I18n, 't' | 'tp' | 'time' | 'date'>): { label: string; soon: boolean } {
  const at = DateTime.fromISO(exam.at, { zone: now.zone });
  const days = Math.round(at.startOf('day').diff(now.startOf('day'), 'days').days);
  const time = exam.allDay ? '' : i18n.time(at);
  const soon = days >= 0 && days <= 3;
  if (days <= 0) return { label: exam.allDay ? `${exam.title} · ${i18n.t('common.relative.today')}` : i18n.t('classes.countdown.today', { title: exam.title, time }), soon };
  if (days === 1) return { label: exam.allDay ? `${exam.title} · ${i18n.t('common.relative.tomorrow')}` : i18n.t('classes.countdown.tomorrow', { title: exam.title, time }), soon };
  if (days < 14) return { label: i18n.tp('classes.countdown.inDays', days, { title: exam.title, n: days }), soon };
  return { label: i18n.t('classes.countdown.onDate', { title: exam.title, date: i18n.date(at, 'medium') }), soon };
}

export function CountdownChip({ exam, now, onClick, className, ...rest }: CountdownChipProps) {
  const i18n = useI18n();
  const { label, soon } = countdownLabel(exam, now, i18n);
  const body = (
    <>
      <CalendarClock size={14} strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
    </>
  );
  const cls = cx('countdown-chip', soon && 'countdown-chip--soon', className);
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} data-testid={rest['data-testid']} data-exam-id={exam.examId} data-soon={soon ? 'true' : undefined}>
      {body}
    </button>
  ) : (
    <span className={cls} data-testid={rest['data-testid']} data-exam-id={exam.examId} data-soon={soon ? 'true' : undefined}>
      {body}
    </span>
  );
}
