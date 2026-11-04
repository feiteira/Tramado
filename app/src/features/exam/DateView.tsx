// The exam route for an exam DATE (no paper yet, UX §3.9.2–§3.9.3): the date, the countdown in the class colour,
// the room and what it covers, and the way to add its paper. It keeps the answers view's ids (`[exam-answers]`, an
// empty `[question-list]`) so links to any exam land on the same screen family.
import React from 'react';
import { DateTime } from 'luxon';
import { CalendarClock, CalendarDays, FilePlus2, Pencil } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { EmptyState } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { countdown, daysUntil, examWhen } from '../exams/format';
import '../exams/exams.css';

export function DateView({ services, classId, examId }: { services: AppServices; classId: ClassId; examId: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const dialogs = useDialogs();
  const exams = services.forClass(classId).exams;
  const list = useStore(exams.list);
  const d = list.dates.find((x) => x.examId === examId);
  if (!d) return null;
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const days = daysUntil(d.at, now);
  const by = exams.importer(examId);
  const mine = !!by && by.deviceId === services.ctx.device.get()?.deviceId;
  const meta = [examWhen(i18n, d.at, d.allDay), d.room, d.weight].filter(Boolean).join(' · ');
  return (
    <>
      <ScreenHeader
        title={d.title}
        subtitle={meta}
        backTo={t('classes.tabs.exams')}
        actions={mine ? <Button icon={Pencil} onClick={() => dialogs.open('exam-date', { classId, examId })} data-testid="exam-date-edit-open">{t('exams.tab.dateMenu.edit')}</Button> : undefined}
      />
      <div className="exam-date-view" data-testid="exam-answers" data-exam-id={examId}>
        <div className="exam-date-view__facts">
          <span className="exam-when" data-testid="exam-countdown" data-days={days}>
            <CalendarClock size={14} strokeWidth={1.75} aria-hidden /> {days >= 0 ? countdown(i18n, days) : examWhen(i18n, d.at, d.allDay)}
          </span>
          <span className="exam-date-view__kind"><CalendarDays size={14} aria-hidden /> {t(`exams.kinds.${d.kind}`)}</span>
          {d.covers ? <p className="exam-date-view__covers">{t('exams.tab.covers', { text: d.covers })}</p> : null}
        </div>
        <ol className="visually-hidden" data-testid="question-list" aria-label={t('exams.answers.list')} />
        <EmptyState
          icon={FilePlus2}
          title={t('exams.extracting.noPaper')}
          data-testid="exam-date-nopaper"
          actions={<Button variant="primary" icon={FilePlus2} onClick={() => dialogs.open('exam-paper', { classId })} data-testid="exam-date-add-paper">{t('exams.tab.dateMenu.addPaper')}</Button>}
        >
          {t('exams.extracting.noPaperBody', { title: d.title })}
        </EmptyState>
      </div>
    </>
  );
}
