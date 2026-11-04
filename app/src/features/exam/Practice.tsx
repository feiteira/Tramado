// Practice (UX §3.9.9, `[exam-practice]`): a session queue (MVP; FSRS is v1.1) of the in-practice questions of a paper
// (exam mode `practice`) or of every paper of the class (route `practice`, this file's default export): never practised
// first, then last "again", then the oldest; "got it" within 20 h is left out; "Again" puts the question back 3 places
// later. Space shows the answer (my corrected answer, else my draft, else the AI answer with its sources); 1 = Again,
// 2 = Got it, ← = previous, Esc ends. The end and the empty queue say what comes next.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { ArrowLeft, CalendarClock, Check, Eye, FilePlus2, PartyPopper, RotateCcw, X } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import { practiceQueue } from '../../services/exams';
import type { AppServices } from '../../services/types/common';
import type { ExamPaperView, QuestionView } from '../../services/types/viewModels';
import type { Route } from '../../shell/routes';
import { Missing } from '../../shell/Placeholder';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { EmptyState, Kbd, ProgressBar } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { classStyle } from '../../ui/classColor';
import { isTextEntry, modalOpen } from '../../ui/focus';
import { MarkdownView } from '../../ui/tramado/MarkdownView';
import { AiAnswer } from '../ask/AiAnswer';
import { countdown, daysUntil, pointsLabel } from '../exams/format';
import './exam.css';

interface Item { paper: ExamPaperView; q: QuestionView }

/** The session order of UX §3.9.9 over several papers (the class route). */
export function sessionQueue(papers: readonly ExamPaperView[], nowMs: number, all = false): Item[] {
  if (all) return papers.flatMap((p) => p.questions.map((q) => ({ paper: p, q })));
  const items = papers.flatMap((p) => practiceQueue(p.questions, nowMs).map((q) => ({ paper: p, q })));
  const rank = (q: QuestionView) => (q.mine.practice.count === 0 ? 0 : q.mine.practice.lastResult === 'again' ? 1 : 2);
  return items.sort((a, b) => rank(a.q) - rank(b.q) || (a.q.mine.practice.lastAt ?? '').localeCompare(b.q.mine.practice.lastAt ?? ''));
}

/** "Again" puts the current question back `gap` places later in this session. */
export function requeue<T>(queue: readonly T[], at: number, gap = 3): T[] {
  const next = [...queue];
  const [item] = next.splice(at, 1);
  if (item === undefined) return next;
  next.splice(Math.min(next.length, at + gap), 0, item);
  return next;
}

/** Route `practice`: every paper of a class. */
export default function PracticeScreen({ route, services }: { route: Extract<Route, { name: 'practice' }>; services: AppServices }) {
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === route.classId);
  if (!cls) return <Missing what="class" />;
  return (
    <div className="exam-screen cls-scope" style={classStyle(cls.color)}>
      <PracticeSession services={services} classId={route.classId} examId={null} />
    </div>
  );
}

export function PracticeSession({ services, classId, examId }: { services: AppServices; classId: ClassId; examId: string | null }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { go, replace, back, canGoBack } = useRouter();
  const dialogs = useDialogs();
  const exams = services.forClass(classId).exams;
  const list = useStore(exams.list);
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === classId);
  const papers = useMemo(() => list.papers.filter((p) => p.state === 'ready' && (examId === null || p.examId === examId)), [list, examId]);
  const nowMs = services.ctx.clock.now();
  const [all, setAll] = useState(false);
  const [round, setRound] = useState(0);
  // The queue is fixed when the session starts (answers given during it do not reshuffle it).
  const [queue, setQueue] = useState<Array<{ examId: string; qid: string }>>([]);
  const [started, setStarted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void (exams as { idle?(): Promise<void> }).idle?.().then(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [exams]);
  useEffect(() => {
    if (started || (!papers.length && !loaded)) return;
    setQueue(sessionQueue(papers, nowMs, all).map((x) => ({ examId: x.paper.examId, qid: x.q.id })));
    setStarted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papers.length, started, round, loaded]);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const current = queue[i] ? papers.find((p) => p.examId === queue[i]!.examId)?.questions.find((q) => q.id === queue[i]!.qid) ?? null : null;
  const currentPaper = queue[i] ? papers.find((p) => p.examId === queue[i]!.examId) ?? null : null;
  const done = started && queue.length > 0 && i >= queue.length;
  const empty = started && queue.length === 0;
  const title = examId && papers[0] ? t('exams.practice.title', { title: papers[0].title, i: Math.min(i + 1, queue.length), n: queue.length }) : t('exams.practice.titleClass', { class: cls?.shortName ?? '', i: Math.min(i + 1, queue.length), n: queue.length });
  const inPractice = papers.reduce((n, p) => n + p.questions.filter((q) => q.mine.inPractice).length, 0);

  const restart = (everything: boolean) => {
    setAll(everything);
    setI(0);
    setRevealed(false);
    setQueue(sessionQueue(papers, services.ctx.clock.now(), everything).map((x) => ({ examId: x.paper.examId, qid: x.q.id })));
    setRound((r) => r + 1);
  };
  const end = useCallback(() => {
    if (examId) replace({ name: 'exam', classId, examId, mode: 'answers' });
    else if (canGoBack) back();
    else go({ name: 'class', classId, tab: 'exams' });
  }, [examId, classId, replace, back, canGoBack, go]);

  const grade = useCallback(async (result: 'again' | 'gotIt') => {
    if (!current || !queue[i] || busy) return;
    setBusy(true);
    try {
      await exams.practise(queue[i]!.examId, current.id, result);
    } finally {
      setBusy(false);
    }
    setRevealed(false);
    if (result === 'again') setQueue((qq) => requeue(qq, i));
    else setI((x) => x + 1);
    if (result === 'again' && i >= queue.length - 1) setI((x) => x);
  }, [current, queue, i, busy, exams]);

  // Space, 1, 2, ←, Esc (UX §3.9.9); never while typing or under a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target) || modalOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        end();
      } else if (done || empty || !current) {
        return;
      } else if (e.key === ' ' && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (e.key === '1' && revealed) {
        e.preventDefault();
        void grade('again');
      } else if (e.key === '2' && revealed) {
        e.preventDefault();
        void grade('gotIt');
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        setI((x) => x - 1);
        setRevealed(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, empty, current, revealed, i, grade, end]);

  if (!started) return <ScreenHeader title={t('exams.answers.practisePaper')} />;
  const nextExam = list.dates.filter((d) => daysUntil(d.at, DateTime.fromMillis(nowMs)) >= 0).sort((a, b) => a.at.localeCompare(b.at))[0];

  return (
    <>
      <ScreenHeader
        title={done || empty ? (examId && papers[0] ? papers[0].title : cls?.name ?? '') : title}
        backTo={t('classes.tabs.exams')}
        actions={<Button variant="ghost" icon={X} onClick={end} aria-keyshortcuts="Escape" data-testid="practice-end">{t('exams.practice.end')}</Button>}
      />
      <div className="practice" ref={root} data-testid="exam-practice">
        {!done && !empty && queue.length ? (
          <ProgressBar value={i} max={queue.length} label={title} className="practice__bar" data-testid="practice-progress" />
        ) : null}
        {empty && !papers.some((p) => p.questions.length) ? (
          // No paper with questions at all: "Practise all questions" would come back here, so guide to adding one.
          <EmptyState
            icon={FilePlus2}
            title={t('exams.practice.noPapers')}
            data-testid="practice-empty"
            actions={<Button variant="primary" icon={FilePlus2} onClick={() => dialogs.open('exam-paper', { classId })} data-testid="practice-add-paper">{t('exams.tab.empty.addPaper')}</Button>}
          >
            {t('exams.practice.noPapersBody')}
          </EmptyState>
        ) : empty ? (
          <EmptyState
            icon={CalendarClock}
            title={t('exams.practice.nothing')}
            data-testid="practice-empty"
            actions={<Button variant="primary" icon={RotateCcw} onClick={() => restart(true)} data-testid="practice-again-all">{t('exams.practice.all')}</Button>}
          >
            {inPractice ? tp('exams.practice.nothingBody', inPractice, { n: inPractice }) : t('exams.practice.nothingNone')}
          </EmptyState>
        ) : done ? (
          <EmptyState
            icon={PartyPopper}
            title={tp('exams.practice.done', inPractice, { n: inPractice })}
            data-testid="practice-done"
            actions={
              <>
                <Button variant="primary" icon={RotateCcw} onClick={() => restart(true)} data-testid="practice-again-all">{t('exams.practice.practiseAgain')}</Button>
                <Button onClick={end} data-testid="practice-back">{t('exams.practice.backToExam')}</Button>
              </>
            }
          >
            {nextExam ? t('exams.practice.doneExam', { exam: nextExam.title, when: countdown(i18n, daysUntil(nextExam.at, DateTime.fromMillis(nowMs))) }) : null}
          </EmptyState>
        ) : current && currentPaper ? (
          <section className="practice__card" data-testid="practice-question" data-question-id={current.id} aria-live="polite">
            <p className="practice__eyebrow">
              {current.number}
              {current.points !== null ? ` · ${pointsLabel(i18n, currentPaper.scale, current.points)}` : ''}
              {!examId ? ` · ${currentPaper.title}` : ''}
            </p>
            <h2 className="practice__question">{current.text}</h2>
            {!revealed ? (
              <div className="practice__reveal">
                <Button variant="primary" size="lg" icon={Eye} onClick={() => setRevealed(true)} aria-keyshortcuts="Space" data-testid="practice-reveal">
                  {t('exams.practice.reveal')} <Kbd>{t('exams.practice.space')}</Kbd>
                </Button>
              </div>
            ) : (
              <div className="practice__answer" data-testid="practice-answer">
                <Revealed services={services} classId={classId} q={current} />
                <div className="practice__how">
                  <span className="practice__how-label">{t('exams.practice.how')}</span>
                  <Button icon={RotateCcw} onClick={() => void grade('again')} aria-keyshortcuts="1" disabled={busy} data-testid="practice-again">
                    {t('exams.practice.again')} <Kbd>1</Kbd>
                  </Button>
                  <Button variant="primary" icon={Check} onClick={() => void grade('gotIt')} aria-keyshortcuts="2" disabled={busy} data-testid="practice-got-it">
                    {t('exams.practice.gotIt')} <Kbd>2</Kbd>
                  </Button>
                </div>
              </div>
            )}
            <div className="practice__nav">
              <Button size="sm" variant="ghost" icon={ArrowLeft} disabled={i === 0} onClick={() => { setI((x) => x - 1); setRevealed(false); }} aria-keyshortcuts="ArrowLeft" data-testid="practice-prev">
                {t('exams.practice.prev')}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

/** The revealed answer: my corrected answer, else my draft, else the AI answer with its sources. */
function Revealed({ services, classId, q }: { services: AppServices; classId: ClassId; q: QuestionView }) {
  const { t } = useI18n();
  if (q.mine.correct.trim()) {
    return (
      <div className="practice__mine">
        <h3 className="practice__label">{t('exams.practice.yourCorrect')}</h3>
        <MarkdownView source={q.mine.correct} links="internal-only" className="reading" />
      </div>
    );
  }
  if (q.mine.draft.trim()) {
    return (
      <div className="practice__mine">
        <h3 className="practice__label">{t('exams.practice.yourAnswer')}</h3>
        <MarkdownView source={q.mine.draft} links="internal-only" className="reading" />
      </div>
    );
  }
  if (q.ai) return <AiAnswer services={services} view={q.ai} classId={classId} data-testid="practice-ai" />;
  return <p className="t-muted">{t('exams.practice.noAnswer')}</p>;
}
