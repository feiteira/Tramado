// The Exams tab (UX §3.9.2, `[class-exams]`, ready marker `[exam-list]`): [＋ Add ▾] (an upcoming test or exam · an exam
// paper or practice questions), [Practise {class} ({n})], COMING UP dates with a countdown in the class colour (never
// red) and their ⋯ menu, EXAM PAPERS with their meta line ("Midterm · 2026 · 5 questions · AI answers 4/5 · Practised
// 3 · ✓1 ~1") or "finding questions…", and the collapsed PAST DATES. Empty: `[exams-empty]`.
import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { CalendarClock, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Dumbbell, FilePlus2, MoreHorizontal, Plus } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import { practiceQueue } from '../../services/exams';
import type { AppServices } from '../../services/types/common';
import type { ExamDateView, ExamPaperView } from '../../services/types/viewModels';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Badge, EmptyState, Spinner } from '../../ui/components/Feedback';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';
import { useErrorMessage } from '../ask/AiErrorNotice';
import { countdown, daysUntil, examWhen, paperMeta } from './format';
import './exams.css';

const MARKS = ['right', 'partly', 'wrong'] as const;

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const dialogs = useDialogs();
  const confirm = useConfirm();
  const toast = useToast();
  const errorMessage = useErrorMessage(services);
  const exams = services.forClass(classId).exams;
  const list = useStore(exams.list);
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === classId);
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const [pastOpen, setPastOpen] = useState(false);
  const upcoming = list.dates.filter((d) => daysUntil(d.at, now) >= 0);
  const past = list.dates.filter((d) => daysUntil(d.at, now) < 0).reverse();
  const queue = useMemo(() => list.papers.flatMap((p) => practiceQueue(p.questions, now.toMillis())), [list, now.toMillis()]);
  const me = services.ctx.device.get()?.deviceId ?? null;

  const addItems: MenuEntry[] = [
    { id: 'date', label: t('exams.tab.addDate'), icon: CalendarDays, onSelect: () => dialogs.open('exam-date', { classId }), testId: 'exam-add-date' },
    { id: 'paper', label: t('exams.tab.addPaper'), icon: FilePlus2, onSelect: () => dialogs.open('exam-paper', { classId }), testId: 'exam-add-paper' },
  ];

  const dateMenu = (d: ExamDateView): MenuEntry[] => {
    const by = exams.importer(d.examId);
    const mine = !!by && by.deviceId === me;
    const only = by ? t('exams.date.onlyImporter', { name: by.memberName || by.deviceName }) : undefined;
    return [
      { id: 'edit', label: t('exams.tab.dateMenu.edit'), disabled: !mine, ...(only && !mine ? { hint: only } : {}), onSelect: () => dialogs.open('exam-date', { classId, examId: d.examId }), testId: 'exam-date-edit' },
      { id: 'paper', label: t('exams.tab.dateMenu.addPaper'), onSelect: () => dialogs.open('exam-paper', { classId }), testId: 'exam-date-add-paper' },
      { kind: 'separator' },
      {
        id: 'delete', label: t('exams.tab.dateMenu.delete'), danger: true, disabled: !mine, testId: 'exam-date-delete',
        onSelect: async () => {
          const ok = await confirm({
            title: t('exams.deleteConfirm.title', { title: d.title, class: cls?.shortName ?? '' }),
            body: cls?.shared ? t('exams.deleteConfirm.body') : t('exams.deleteConfirm.bodyLocal'),
            confirmLabel: t('exams.deleteConfirm.confirm'), danger: true, 'data-testid': 'exam-delete-confirm',
          });
          if (!ok) return;
          try {
            await exams.remove(d.examId);
            toast.show(t('exams.deleted', { title: d.title }));
          } catch (e) {
            toast.show(errorMessage(e));
          }
        },
      },
    ];
  };

  const empty = !list.dates.length && !list.papers.length;

  return (
    <section className="exams-tab" data-testid="class-exams" aria-label={t('classes.tabs.exams')}>
      <div className="exams-tab__bar">
        <MenuButton items={addItems} label={t('exams.tab.add')} icon={Plus} variant="secondary" data-testid="exam-add" />
        <span className="exams-tab__spacer" />
        {queue.length ? (
          <Button variant="primary" icon={Dumbbell} onClick={() => go({ name: 'practice', classId })} data-testid="exam-practise-class">
            {t('exams.tab.practiseClass', { class: cls?.shortName ?? '', n: queue.length })}
          </Button>
        ) : null}
      </div>
      <div className="exams-tab__list" data-testid="exam-list">
        {empty ? (
          <EmptyState
            icon={CalendarClock}
            title={t('exams.tab.empty.title')}
            data-testid="exams-empty"
            actions={
              <>
                <Button variant="primary" icon={CalendarDays} onClick={() => dialogs.open('exam-date', { classId })} data-testid="exams-empty-date">{t('exams.tab.empty.addDate')}</Button>
                <Button icon={FilePlus2} onClick={() => dialogs.open('exam-paper', { classId })} data-testid="exams-empty-paper">{t('exams.tab.empty.addPaper')}</Button>
              </>
            }
          >
            {t('exams.tab.empty.body')}
          </EmptyState>
        ) : null}
        {upcoming.length ? (
          <section className="exams-group" aria-labelledby="exams-coming">
            <h2 className="exams-group__title" id="exams-coming">{t('exams.tab.comingUp')}</h2>
            <ul className="exams-rows">
              {upcoming.map((d) => <DateRow key={d.examId} d={d} now={now} menu={dateMenu(d)} />)}
            </ul>
          </section>
        ) : null}
        {list.papers.length ? (
          <section className="exams-group" aria-labelledby="exams-papers">
            <h2 className="exams-group__title" id="exams-papers">{t('exams.tab.papers')}</h2>
            <ul className="exams-rows">
              {list.papers.map((p) => (
                <PaperRow key={p.examId} p={p} onOpen={() => go({ name: 'exam', classId, examId: p.examId })} onPractise={() => go({ name: 'exam', classId, examId: p.examId, mode: 'practice' })} />
              ))}
            </ul>
          </section>
        ) : null}
        {past.length ? (
          <section className="exams-group">
            <button type="button" className="exams-group__toggle" aria-expanded={pastOpen} onClick={() => setPastOpen((v) => !v)} data-testid="exams-past-toggle">
              {pastOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              {t('exams.tab.pastDates')} <span className="t-muted">({past.length})</span>
            </button>
            {pastOpen ? (
              <ul className="exams-rows exams-rows--past">
                {past.map((d) => <DateRow key={d.examId} d={d} now={now} menu={dateMenu(d)} past />)}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}

function DateRow({ d, now: n, menu, past: isPast = false }: { d: ExamDateView; now: DateTime; menu: MenuEntry[]; past?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const days = daysUntil(d.at, n);
  const meta = [examWhen(i18n, d.at, d.allDay), d.room, d.weight].filter(Boolean).join(' · ');
  return (
    <li className={cx('exam-row', 'exam-row--date', isPast && 'exam-row--past')} data-testid="exam-date-item" data-exam-id={d.examId}>
      <span className="exam-row__icon exam-row__icon--date" aria-hidden><CalendarDays size={18} strokeWidth={1.75} /></span>
      <div className="exam-row__main">
        <p className="exam-row__title">
          <span>{d.title}</span>
          {d.title !== t(`exams.kinds.${d.kind}`) ? <span className="exam-row__kind">({t(`exams.kinds.${d.kind}`)})</span> : null}
        </p>
        <p className="exam-row__meta">{meta}</p>
        {d.covers ? <p className="exam-row__covers">{t('exams.tab.covers', { text: d.covers })}</p> : null}
      </div>
      {!isPast ? (
        <span className="exam-when" data-testid="exam-countdown" data-days={days}>
          <CalendarClock size={14} strokeWidth={1.75} aria-hidden /> {countdown(i18n, days)}
        </span>
      ) : null}
      <MenuButton items={menu} label={t('common.more')} iconOnly icon={MoreHorizontal} variant="ghost" size="sm" align="end" data-testid="exam-date-more" />
    </li>
  );
}

function PaperRow({ p, onOpen, onPractise }: { p: ExamPaperView; onOpen(): void; onPractise(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const finding = p.state === 'extracting';
  const marks = { right: 0, partly: 0, wrong: 0 };
  for (const q of p.questions) if (q.mine.mark === 'right' || q.mine.mark === 'partly' || q.mine.mark === 'wrong') marks[q.mine.mark]++;
  const inPractice = p.questions.some((q) => q.mine.inPractice);
  return (
    <li className="exam-row exam-row--paper" data-testid="exam-paper-item" data-exam-id={p.examId}>
      <span className="exam-row__icon" aria-hidden><ClipboardList size={18} strokeWidth={1.75} /></span>
      <button type="button" className="exam-row__open" onClick={onOpen} data-testid="exam-paper-open">
        <span className="exam-row__title">{p.title || t('common.untitled')}</span>
        <span className="exam-row__meta">
          {finding ? (
            <>{t(`exams.kinds.${p.kind}`)}{p.year ? ` · ${p.year}` : ''} · {t('exams.tab.finding')}</>
          ) : p.state === 'review' ? (
            <>{t(`exams.kinds.${p.kind}`)}{p.year ? ` · ${p.year}` : ''} · <Badge tone="warning">{t('exams.tab.toReview')}</Badge></>
          ) : (
            <>
              {paperMeta(i18n, p)}
              {MARKS.map((m) => (marks[m] ? (
                <span key={m} className={`exam-mark exam-mark--${m}`}>
                  {m === MARKS.find((x) => marks[x]) ? ' · ' : ' '}
                  <span aria-hidden>{{ right: '✓', partly: '~', wrong: '✗' }[m]}</span>{marks[m]}
                  <span className="visually-hidden"> {t(`exams.answers.status.${m}`)}</span>
                </span>
              ) : null))}
            </>
          )}
        </span>
      </button>
      {finding ? (
        <Spinner size={18} label={t('exams.tab.finding')} />
      ) : p.state === 'ready' && inPractice ? (
        <Button size="sm" iconEnd={ChevronRight} onClick={onPractise} data-testid="exam-paper-practise">{t('exams.tab.practise')}</Button>
      ) : null}
    </li>
  );
}
