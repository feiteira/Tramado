// Today (UX §3.2): the greeting and date, the welcome checklist, exams coming up, transcriptions, recent lectures
// and unread chat, over every non-archived class. No digest (v1.1). Two columns (60/40) when main is at least
// 1180 px wide, else one column. Sync problems are the pill's job: no special state here.
import React, { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  AudioLines, CalendarClock, Check, CircleCheck, CircleDot, FileAudio, GraduationCap, LogIn, MessagesSquare, Plus, Radio, Sparkles, Sun, X,
} from 'lucide-react';
import { toPlatformError } from '../../core/errors';
import type { AppServices } from '../../services/types/common';
import type { ClassView, LectureView } from '../../services/types/viewModels';
import type { Route } from '../../shell/routes';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useAppState } from '../../shell/AppState';
import { ACTIONS } from '../registry';
import { Button, IconButton } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Badge, EmptyState, ProgressBar } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { classStyle } from '../../ui/classColor';
import { formatDuration } from '../../ui/format';
import { useI18n, type I18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';
import { firstName } from '../onboarding/cloud';
import { checklist, comingUp, greetingPart, recentLectures, SOON_DAYS, transcriptions, unread, type ClassData } from './model';
import './today.css';

/** Follows every non-archived class's lectures, exam dates, documents and chat (and whether they have loaded). */
function useClassData(services: AppServices, classes: readonly ClassView[]): { data: ClassData[]; loading: boolean } {
  const [state, setState] = useState<{ data: ClassData[]; loading: boolean }>({ data: [], loading: true });
  const active = classes.filter((c) => !c.archived && c.sync.kind !== 'missingFolder');
  const key = active.map((c) => c.id).join(',');
  useEffect(() => {
    const per = active.flatMap((cls) => {
      try {
        return [{ id: cls.id, s: services.forClass(cls.id) }];
      } catch {
        return [];
      }
    });
    const read = () => {
      const views = services.library.classes.get();
      const data: ClassData[] = [];
      let loading = false;
      for (const { id, s } of per) {
        const cls = views.find((c) => c.id === id);
        if (!cls) continue;
        if (s.store.state.get().status === 'loading') loading = true;
        let dates: ClassData['dates'] = [];
        try {
          dates = s.exams.list.get().dates;
        } catch {
          dates = [];
        }
        const chat = s.chat.view.get();
        data.push({ cls, lectures: s.lectures.list.get(), dates, documents: s.documents.list.get().filter((d) => !d.lectureId && !d.examId).length, chat: { items: chat.items, unread: chat.unread, mentions: chat.mentions } });
      }
      setState({ data, loading });
    };
    read();
    const offs = per.flatMap(({ s }) => {
      const list = [s.lectures.list.subscribe(read), s.chat.view.subscribe(read), s.documents.list.subscribe(read), s.store.state.subscribe(read)];
      try {
        list.push(s.exams.list.subscribe(read));
      } catch {
        // exams not available
      }
      return list;
    });
    offs.push(services.library.classes.subscribe(read));
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, key]);
  return state;
}

export default function Today({ route, services }: { route: Extract<Route, { name: 'today' }>; services: AppServices }) {
  void route;
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const dialogs = useDialogs();
  const app = useAppState();
  const classes = useStore(services.library.classes);
  const me = useStore(services.ctx.identity);
  const queue = useStore(services.transcription.state);
  const prefs = useStore(services.ctx.prefs.store);
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const first = firstName(me?.name ?? '');
  const { data, loading } = useClassData(services, classes);
  const active = classes.filter((c) => !c.archived);
  const [picker, setPicker] = useState<null | 'lecture' | 'document' | 'exam'>(null);

  const ticks = checklist(data);
  const dismissed = (prefs['today.checklistDismissed'] ?? '0') === '1';
  const showChecklist = !dismissed && !(ticks.classes && ticks.lecture && ticks.document && ticks.exam);
  const exams = useMemo(() => comingUp(data, now), [data, now.toMillis()]); // eslint-disable-line react-hooks/exhaustive-deps
  const lectures = useMemo(() => recentLectures(data, now), [data, now.toMillis()]); // eslint-disable-line react-hooks/exhaustive-deps
  const trans = useMemo(() => transcriptions(data), [data]);
  const unreadRows = useMemo(() => unread(data, me?.memberId ?? null), [data, me?.memberId]);
  const anyShared = active.some((c) => c.shared);
  const showTranscriptions = anyShared || !!queue.job;

  const header = (
    <ScreenHeader
      title={t(`today.greeting.${greetingPart(now)}`, { name: first })}
      actions={<span className="today__date" data-testid="today-date">{i18n.date(now, 'long')}</span>}
    />
  );

  if (active.length === 0) {
    return (
      <>
        {header}
        <div className="today today--empty" data-testid="screen-today">
          <EmptyState
            icon={Sun}
            title={t('today.empty.title', { name: first })}
            data-testid="today-empty"
            actions={
              <>
                <Button variant="primary" icon={Plus} onClick={() => dialogs.open('new-class', {})} data-testid="today-empty-create">
                  {t('today.empty.create')}
                </Button>
                <Button icon={LogIn} onClick={() => dialogs.open('join', {})} data-testid="today-empty-join">
                  {t('today.empty.join')}
                </Button>
              </>
            }
          >
            {t('today.empty.body')}
          </EmptyState>
        </div>
      </>
    );
  }

  // The checklist acts in the most recently opened class, or asks which.
  const lastClass = active.find((c) => c.id === prefs['classes.last']) ?? (active.length === 1 ? active[0] : undefined);
  const act = (what: 'lecture' | 'document' | 'exam', classId?: string) => {
    const id = classId ?? lastClass?.id;
    if (!id) {
      setPicker(what);
      return;
    }
    if (what === 'lecture') dialogs.open('record', { classId: id });
    else if (what === 'exam') dialogs.open('exam-date', { classId: id });
    else void ACTIONS.importDocuments().then((m) => m.default(services, id)).catch(() => go({ name: 'class', classId: id, tab: 'documents' }));
  };

  const everythingEmpty = !showChecklist && exams.length === 0 && lectures.length === 0 && unreadRows.length === 0 && !queue.job && trans.others.length === 0 && trans.waiting.length === 0;
  const busy = loading && data.every((d) => d.lectures.length === 0);

  const left = (
    <>
      {exams.length ? <ComingUp rows={exams} now={now} /> : null}
      {lectures.length ? <RecentLectures rows={lectures} now={now} /> : null}
    </>
  );
  const right = (
    <>
      {showTranscriptions && (queue.job || trans.others.length || trans.waiting.length) ? <Transcriptions services={services} job={queue.job} others={trans.others} waiting={trans.waiting} /> : null}
      {unreadRows.length ? <Unread rows={unreadRows} /> : null}
    </>
  );

  return (
    <>
      {header}
      <div className="today" data-testid="screen-today">
        {showChecklist ? (
          <section className="today-card today-checklist" aria-labelledby="today-checklist-title" data-testid="today-checklist">
            <div className="today-card__head">
              <h2 className="today-card__title" id="today-checklist-title">{t('today.checklist.title')}</h2>
              <IconButton icon={X} size="sm" label={t('today.checklist.dismiss')} onClick={() => void app.setPref('today.checklistDismissed', '1')} data-testid="today-checklist-dismiss" />
            </div>
            <ul className="today-checklist__items">
              {(
                [
                  ['classes', ticks.classes, () => dialogs.open('new-class', {})],
                  ['lecture', ticks.lecture, () => act('lecture')],
                  ['document', ticks.document, () => act('document')],
                  ['exam', ticks.exam, () => act('exam')],
                ] as const
              ).map(([id, done, run]) => (
                <li key={id}>
                  <button type="button" className={cx('today-check', done && 'today-check--done')} onClick={done ? undefined : run} aria-disabled={done || undefined} data-testid="today-check" data-item={id} data-done={done ? 'true' : 'false'}>
                    <span className="today-check__box" aria-hidden>{done ? <Check size={13} strokeWidth={2.5} /> : null}</span>
                    <span>{t(`today.checklist.${id}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {busy ? (
          <div className="today__grid" aria-busy="true" data-testid="today-loading">
            <div className="today__col">
              <Skeleton />
              <Skeleton />
            </div>
            <div className="today__col">
              <Skeleton />
            </div>
          </div>
        ) : everythingEmpty ? (
          <EmptyState icon={CircleCheck} title={t('today.clear.title')} data-testid="today-clear">
            {t('today.clear.body')}
          </EmptyState>
        ) : (
          <div className="today__grid">
            <div className="today__col today__col--main">{left}</div>
            <div className="today__col today__col--side">{right}</div>
          </div>
        )}
      </div>
      {picker ? (
        <PickClass
          classes={active}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            const what = picker;
            setPicker(null);
            act(what, id);
          }}
        />
      ) : null}
    </>
  );
}

function Skeleton() {
  return (
    <div className="today-card today-skeleton" aria-hidden>
      <span className="today-skeleton__bar today-skeleton__bar--short" />
      <span className="today-skeleton__bar" />
      <span className="today-skeleton__bar" />
    </div>
  );
}

function SectionCard({ id, title, icon: Icon, children, testid }: { id: string; title: string; icon: typeof Sun; children: React.ReactNode; testid: string }) {
  return (
    <section className="today-card" aria-labelledby={`today-${id}-title`} data-testid={testid}>
      <div className="today-card__head">
        <h2 className="today-card__title" id={`today-${id}-title`}>
          <Icon size={15} strokeWidth={1.75} aria-hidden />
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function whenLabel(days: number, at: DateTime, i18n: I18n, allDay: boolean): string {
  const { t, tp } = i18n;
  const time = i18n.time(at);
  if (days === 0) return allDay ? t('common.relative.today') : t('today.exams.today', { time });
  if (days === 1) return allDay ? t('common.relative.tomorrow') : t('today.exams.tomorrow', { time });
  const date = `${i18n.date(at, 'weekday')}${allDay ? '' : `, ${time}`}`;
  return tp('today.exams.inDays', days, { n: days, date });
}

function ComingUp({ rows, now }: { rows: ReturnType<typeof comingUp>; now: DateTime }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  return (
    <SectionCard id="exams" title={t('today.exams.title')} icon={CalendarClock} testid="today-exams">
      <ul className="today-list">
        {rows.map(({ cls, exam, days }) => {
          const at = DateTime.fromISO(exam.at, { zone: now.zone });
          const soon = days <= SOON_DAYS;
          return (
            <li key={exam.examId} className={cx('today-exam cls-scope', soon && 'today-exam--soon')} style={classStyle(cls.color)} data-testid="today-exam" data-exam-id={exam.examId} data-class-id={cls.id}>
              <button type="button" className="today-row__main" onClick={() => go({ name: 'class', classId: cls.id, tab: 'exams' })}>
                <ClassTab color={cls.color} icon={cls.icon} size="sm" />
                <span className="today-row__text">
                  <span className="today-row__title">
                    <span className="today-row__eyebrow">{cls.shortName}</span>
                    <span className="today-row__sep" aria-hidden>·</span>
                    {exam.title}
                  </span>
                  {exam.room ? <span className="today-row__meta">{exam.room}</span> : null}
                </span>
                <span className={cx('today-exam__when', soon && 'today-exam__when--soon')}>{whenLabel(days, at, i18n, exam.allDay)}</span>
              </button>
              {exam.practiceCount > 0 ? (
                <Button size="sm" variant="secondary" icon={GraduationCap} onClick={() => go({ name: 'practice', classId: cls.id })} data-testid="today-practise">
                  {t('today.exams.practise', { n: exam.practiceCount })}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function lectureStatus(l: LectureView, t: I18n['t']): { text: string; tone: 'done' | 'busy' | 'wait' | 'fail' } {
  const s = l.transcription;
  switch (s.kind) {
    case 'done':
      return { text: t('lectures.transcription.chip.done'), tone: 'done' };
    case 'claimed':
      return s.health === 'stale' ? { text: t('lectures.transcription.chip.stale'), tone: 'wait' } : { text: t('lectures.transcription.chip.claimed', { percent: Math.round(s.percent) }), tone: 'busy' };
    case 'local':
      return { text: t('lectures.transcription.chip.local', { percent: Math.round(s.percent) }), tone: 'busy' };
    case 'waitingAudio':
    case 'arriving':
      return { text: t('lectures.transcription.chip.waitingAudio'), tone: 'wait' };
    case 'failed':
      return { text: t('lectures.transcription.chip.failed'), tone: 'fail' };
    default:
      return { text: t('lectures.transcription.chip.none'), tone: 'wait' };
  }
}

function RecentLectures({ rows, now }: { rows: ReturnType<typeof recentLectures>; now: DateTime }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  return (
    <SectionCard id="lectures" title={t('today.lectures.title')} icon={AudioLines} testid="today-lectures">
      <ul className="today-list">
        {rows.map(({ cls, lecture }) => {
          const at = DateTime.fromISO(lecture.startedAt, { zone: now.zone });
          const days = Math.round(now.startOf('day').diff(at.startOf('day'), 'days').days);
          const date = days === 0 ? `${capital(t('common.relative.today'))} ${i18n.time(at)}` : days === 1 ? `${capital(t('common.relative.yesterday'))} ${i18n.time(at)}` : i18n.date(at, 'weekday');
          const st = lectureStatus(lecture, t);
          const Icon = lecture.mode === 'import' ? FileAudio : lecture.mode === 'online' ? Radio : AudioLines;
          return (
            <li key={lecture.id} className="today-lecture" data-testid="today-lecture" data-lecture-id={lecture.id} data-class-id={cls.id}>
              <button type="button" className="today-row__main" onClick={() => go({ name: 'lecture', classId: cls.id, lectureId: lecture.id })}>
                <ClassTab color={cls.color} icon={cls.icon} size="sm" />
                <span className="today-row__text">
                  <span className="today-row__title">{lecture.title}</span>
                  <span className="today-row__meta">
                    <Icon size={12} strokeWidth={1.75} aria-hidden />
                    {`${cls.shortName} · ${date} · ${formatDuration(t, lecture.durationMs)}`}
                  </span>
                </span>
                <span className={cx('today-status', `today-status--${st.tone}`)}>
                  {st.tone === 'done' ? <CircleCheck size={13} strokeWidth={2} aria-hidden /> : st.tone === 'busy' ? <CircleDot size={13} strokeWidth={2} aria-hidden /> : null}
                  {st.text}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

const capital = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

function Transcriptions({
  services, job, others, waiting,
}: {
  services: AppServices;
  job: { title: string; progress: number; classId: string } | null;
  others: ReturnType<typeof transcriptions>['others'];
  waiting: ReturnType<typeof transcriptions>['waiting'];
}) {
  const { t, tp } = useI18n();
  const dialogs = useDialogs();
  const toast = useToast();
  const models = useStore(services.models.models);
  const [busy, setBusy] = useState(false);
  const oldest = waiting[0];
  const here = async () => {
    if (!oldest) return;
    const ready = models.some((m) => m.state === 'ready');
    if (!ready) {
      dialogs.open('model', { classId: oldest.cls.id, lectureId: oldest.lecture.id });
      return;
    }
    setBusy(true);
    try {
      const r = await services.transcription.claim(oldest.cls.id, oldest.lecture.id, 'local');
      if (r === 'ineligible') dialogs.open('model', { classId: oldest.cls.id, lectureId: oldest.lecture.id });
    } catch (e) {
      toast.error(toPlatformError(e));
    } finally {
      setBusy(false);
    }
  };
  const percent = job ? Math.round(job.progress * (job.progress <= 1 ? 100 : 1)) : 0;
  return (
    <SectionCard id="transcriptions" title={t('today.transcriptions.title')} icon={Sparkles} testid="today-transcriptions">
      <ul className="today-list today-list--plain">
        <li className="today-trans" data-testid="today-transcription-local">
          {job ? (
            <>
              <span className="today-trans__line">{t('today.transcriptions.local', { lecture: job.title, percent })}</span>
              <ProgressBar value={percent} max={100} label={t('today.transcriptions.local', { lecture: job.title, percent })} className="today-trans__bar" />
            </>
          ) : (
            <span className="today-trans__line t-muted">{t('today.transcriptions.idle')}</span>
          )}
        </li>
        {others.map((o) => (
          <li key={o.lecture.id} className="today-trans" data-testid="today-transcription-other" data-lecture-id={o.lecture.id}>
            <span className="today-trans__line">
              <span className="today-trans__dot" aria-hidden />
              {t('today.transcriptions.other', { device: o.device, lecture: o.lecture.title, percent: o.percent })}
            </span>
            <ProgressBar value={o.percent} max={100} label={t('today.transcriptions.other', { device: o.device, lecture: o.lecture.title, percent: o.percent })} className="today-trans__bar" />
          </li>
        ))}
        {waiting.length ? (
          <li className="today-trans today-trans--waiting" data-testid="today-transcription-waiting">
            <span className="today-trans__line">{tp('today.transcriptions.waiting', waiting.length)}</span>
            <Button size="sm" busy={busy} onClick={() => void here()} data-testid="today-transcribe-here">
              {t('today.transcriptions.here')}
            </Button>
          </li>
        ) : null}
      </ul>
    </SectionCard>
  );
}

function Unread({ rows }: { rows: ReturnType<typeof unread> }) {
  const { t, tp } = useI18n();
  const { go } = useRouter();
  return (
    <SectionCard id="unread" title={t('today.unread.title')} icon={MessagesSquare} testid="today-unread">
      <ul className="today-list">
        {rows.map((r) => (
          <li key={r.cls.id} data-testid="today-unread-class" data-class-id={r.cls.id}>
            <button type="button" className="today-row__main today-unread" onClick={() => go({ name: 'class', classId: r.cls.id, tab: 'chat' })}>
              <ClassTab color={r.cls.color} icon={r.cls.icon} size="sm" />
              <span className="today-row__text">
                <span className="today-row__title">
                  <span className="today-row__eyebrow">{r.cls.shortName}</span>
                  <span className="today-unread__counts">
                    {r.unread > 0 ? tp('today.unread.summary', r.unread) : null}
                    {r.mentions > 0 ? (
                      <Badge tone="info">{tp('today.unread.mentions', r.mentions)}</Badge>
                    ) : null}
                  </span>
                </span>
                {r.excerpt ? (
                  <span className="today-row__meta today-unread__excerpt">
                    {r.from ? <b>{r.from}:</b> : null} “{r.excerpt}”
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** "In which class?" for the checklist when no class was opened recently. */
function PickClass({ classes, onPick, onClose }: { classes: readonly ClassView[]; onPick(id: string): void; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog open onClose={onClose} title={t('today.checklist.whichClass')} size="sm" data-testid="today-pick-class">
      <ul className="today-pick">
        {classes.map((c) => (
          <li key={c.id}>
            <button type="button" className="today-pick__item" onClick={() => onPick(c.id)} data-testid="today-pick-class-item" data-class-id={c.id}>
              <ClassTab color={c.color} icon={c.icon} size="md" />
              <span>{c.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
