// CountdownChip (UX §2.11, §3.3): class colour and a calendar icon, never red.
import React from 'react';
import { CalendarClock } from 'lucide-react';
import { DateTime } from 'luxon';
import type { ExamDateView } from '../../services/types/viewModels';
import { useI18n } from '../i18n';
import { cx } from '../cx';

export interface CountdownChipProps {
  exam: ExamDateView;
  now: DateTime;
  onClick?(): void;
  className?: string;
  'data-testid'?: string;
}

export function CountdownChip({ exam, now, onClick, className, ...rest }: CountdownChipProps) {
  const { tp, t, meta } = useI18n();
  const days = Math.round(DateTime.fromISO(exam.at).startOf('day').diff(now.startOf('day'), 'days').days);
  const when = days <= 0 ? t('common.relative.today') : days === 1 ? t('common.relative.tomorrow') : tp('common.relative.inDays', days, { n: days });
  const label = `${exam.title} · ${when}`;
  const body = (
    <>
      <CalendarClock size={14} strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
    </>
  );
  void meta;
  return onClick ? (
    <button type="button" className={cx('countdown-chip', className)} onClick={onClick} data-testid={rest['data-testid']} data-exam-id={exam.examId}>
      {body}
    </button>
  ) : (
    <span className={cx('countdown-chip', className)} data-testid={rest['data-testid']} data-exam-id={exam.examId}>
      {body}
    </span>
  );
}
