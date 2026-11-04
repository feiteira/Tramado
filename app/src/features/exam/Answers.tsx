// The answers view (UX §3.9.8, `[exam-answers]`, ready marker `[question-list]`): the question list (number circles in
// the class colour, an excerpt and the status ○ ✦ ⚠ ✓ ~ ✗ ?, "Answer 2 of 3" groups, the batch status "Answering… {i} of
// {n}" with [Cancel]) and the detail — eyebrow and question, Your answer (private, autosaved), with "try first" the
// [Show the AI's answer] / [Give me a hint] buttons (the AI card is NOT rendered until revealed), the AI answer card with
// chips, Grounded meter, [Deep answer] [Try again] [Copy to my answer], unverified and insufficient notices, SOURCES,
// "Is this right?" marks, the correct answer and Add to practice. ↑/↓ in the list, Alt+↑/↓ anywhere, Ctrl/⌘+Enter reveals.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { CircleDashed, ClipboardCopy, Dumbbell, FilePen, FileText, Lightbulb, ListRestart, MoreHorizontal, RefreshCw, Settings2, Sparkles, Telescope, Trash2, X } from 'lucide-react';
import type { ErrorCode } from '../../core/errors';
import type { ClassId, QuestionId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { ExamPaperView, QuestionView } from '../../services/types/viewModels';
import type { ReadableStore } from '../../services/store';
import { Store } from '../../services/store';
import { useKeyLabel } from '../../shell/keys';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Checkbox, RadioGroup } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { Notice } from '../../ui/components/Feedback';
import { TextArea } from '../../ui/components/Field';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';
import { AiCard } from '../../ui/tramado/AiCard';
import { CostLine, costBlocked } from '../../ui/tramado/CostLine';
import { AiAnswer } from '../ask/AiAnswer';
import { AiErrorNotice, useErrorMessage } from '../ask/AiErrorNotice';
import { copyWithSources } from '../ask/turns';
import { useQuota } from '../ask/useQuota';
import { pointsLabel, questionStatus, type QuestionStatus } from '../exams/format';
import { examMarkdown } from './markdown';

type Progress = { done: number; total: number; current: QuestionId | null; error: ErrorCode | null };
const IDLE = new Store<Progress | null>(null);
const STATUS_GLYPH: Record<QuestionStatus, string> = { none: '○', ai: '✦', warn: '⚠', right: '✓', partly: '~', wrong: '✗', unsure: '?' };

/** The question shown first: the route's, else the first not revealed yet (where the student left off), else the first. */
export function firstQuestion(p: Pick<ExamPaperView, 'questions'>, wanted: string | null): string | null {
  if (wanted && p.questions.some((q) => q.id === wanted)) return wanted;
  return (p.questions.find((q) => !q.mine.revealed && !q.mine.mark) ?? p.questions[0])?.id ?? null;
}

const integrityKey = (examId: string) => `tramado.examIntegrity.${examId}`;
const readFlag = (k: string) => {
  try {
    return window.localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};
const writeFlag = (k: string) => {
  try {
    window.localStorage.setItem(k, '1');
  } catch {
    // private mode: the notice comes back next time
  }
};

export function Answers({ services, classId, examId, questionId }: { services: AppServices; classId: ClassId; examId: string; questionId: string | null }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { go, replace, route } = useRouter();
  const dialogs = useDialogs();
  const confirm = useConfirm();
  const toast = useToast();
  const errorMessage = useErrorMessage(services);
  const exams = services.forClass(classId).exams;
  const paper = useStore(exams.open(examId))!;
  const settings = useStore(services.ai.settings);
  const prefs = useStore(services.ctx.prefs.store);
  const aiOn = settings.enabled && (settings.key.set || !!settings.customHost);
  useQuota(services, aiOn);
  const [progressStore, setProgressStore] = useState<ReadableStore<Progress | null>>(() => exams.progress(examId) ?? IDLE);
  const progress = useStore(progressStore);
  // A batch started elsewhere (Answer settings, the dock) is followed as soon as it runs.
  const runningIds = useStore(exams.running);
  useEffect(() => {
    const live = runningIds.includes(examId) ? exams.progress(examId) : null;
    if (live && live !== progressStore) setProgressStore(live as ReadableStore<Progress | null>);
  }, [runningIds, examId, exams, progressStore]);
  const [selected, setSelected] = useState<string | null>(() => (paper ? firstQuestion(paper, questionId) : null));
  const [integrity, setIntegrity] = useState(() => !readFlag(integrityKey(examId)));
  const list = useRef<HTMLOListElement>(null);
  const tryFirst = (prefs['exam.tryFirst'] ?? '1') !== '0';
  const me = services.ctx.device.get()?.deviceId ?? null;
  const importer = exams.importer(examId);
  const isImporter = !!importer && importer.deviceId === me;

  useEffect(() => {
    if (questionId && questionId !== selected && paper?.questions.some((q) => q.id === questionId)) setSelected(questionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  const select = useCallback((id: string, focusList = false) => {
    setSelected(id);
    if (route.name === 'exam') replace({ ...route, questionId: id });
    if (focusList) list.current?.querySelector<HTMLElement>(`[data-question-id="${id}"] button`)?.focus();
  }, [route, replace]);

  // Alt+↑/↓ from anywhere on the screen (UX §3.9.8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !paper) return;
      const i = paper.questions.findIndex((q) => q.id === selected);
      const next = paper.questions[Math.max(0, Math.min(paper.questions.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        e.preventDefault();
        select(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paper, selected, select]);

  const startBatch = useCallback((qids: QuestionId[], mode: 'quick' | 'deep' = 'quick', opts: { busyFallback?: boolean } = {}) => {
    const scope = settings.generalDefault ? 'materials+general' : 'materials';
    const st = exams.answer(examId, qids, mode, scope, opts);
    setProgressStore(st as ReadableStore<Progress | null>);
  }, [exams, examId, settings.generalDefault]);

  if (!paper) return null;
  const q = paper.questions.find((x) => x.id === selected) ?? paper.questions[0] ?? null;
  const unanswered = paper.questions.filter((x) => !x.ai).map((x) => x.id);
  const running = !!progress && progress.current !== null;
  const batchError = progress && progress.current === null && progress.error && progress.error !== 'CANCELLED' ? progress.error : null;

  const more: MenuEntry[] = [
    { id: 'edit', label: t('exams.answers.more.edit'), icon: FilePen, disabled: !isImporter || paper.newerFormat, onSelect: () => replace({ name: 'exam', classId, examId, mode: 'review' }), testId: 'exam-more-edit' },
    { id: 'again', label: t('exams.answers.more.again'), icon: ListRestart, disabled: !aiOn, onSelect: () => dialogs.open('answer-settings', { classId, examId, qids: paper.questions.map((x) => x.id) }), testId: 'exam-more-again' },
    ...(paper.sourceRelPath ? [{ id: 'original', label: t('exams.answers.more.original'), icon: FileText, onSelect: () => go({ name: 'document', classId, relPath: paper.sourceRelPath! }), testId: 'exam-more-original' }] : []),
    {
      id: 'copy', label: t('exams.answers.more.copyAll'), icon: ClipboardCopy, testId: 'exam-more-copy',
      onSelect: async () => {
        try {
          await navigator.clipboard.writeText(examMarkdown(paper, i18n));
          toast.show(t('common.copied'));
        } catch {
          toast.show(t('errors.IO_ERROR'));
        }
      },
    },
    { kind: 'separator' },
    {
      id: 'delete', label: t('exams.answers.more.delete'), icon: Trash2, danger: true, disabled: !isImporter, testId: 'exam-more-delete',
      onSelect: async () => {
        const cls = services.library.classes.get().find((c) => c.id === classId);
        const ok = await confirm({
          title: t('exams.deleteConfirm.title', { title: paper.title, class: cls?.shortName ?? '' }),
          body: cls?.shared ? t('exams.deleteConfirm.body') : t('exams.deleteConfirm.bodyLocal'),
          confirmLabel: t('exams.deleteConfirm.confirm'), danger: true, 'data-testid': 'exam-delete-confirm',
        });
        if (!ok) return;
        try {
          await exams.remove(examId);
          go({ name: 'class', classId, tab: 'exams' });
          toast.show(t('exams.deleted', { title: paper.title }));
        } catch (e) {
          toast.show(errorMessage(e));
        }
      },
    },
  ];

  const subtitle = [t(`exams.kinds.${paper.kind}`), paper.year, tp('common.count.questions', paper.questions.length, { n: paper.questions.length })].filter(Boolean).join(' · ');
  const groupsSeen = new Set<string>();

  return (
    <>
      <ScreenHeader
        title={paper.title}
        subtitle={subtitle}
        backTo={t('classes.tabs.exams')}
        actions={
          <Button variant="primary" icon={Dumbbell} onClick={() => replace({ name: 'exam', classId, examId, mode: 'practice' })} data-testid="exam-practise">{t('exams.answers.practisePaper')}</Button>
        }
        more={<MenuButton items={more} label={t('common.more')} iconOnly icon={MoreHorizontal} variant="ghost" align="end" data-testid="exam-more" />}
      />
      <div className="exam-answers" data-testid="exam-answers">
        <aside className="qlist" aria-label={t('exams.answers.list')}>
          <h2 className="qlist__title">{t('exams.answers.list')}</h2>
          <ol
            className="qlist__items"
            ref={list}
            data-testid="question-list"
            onKeyDown={(e) => {
              if (e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              const i = paper.questions.findIndex((x) => x.id === q?.id);
              const next = paper.questions[Math.max(0, Math.min(paper.questions.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
              if (next) {
                e.preventDefault();
                select(next.id, true);
              }
            }}
          >
            {paper.questions.map((x, i) => {
              const status = questionStatus(x);
              const groupHead = x.group && !groupsSeen.has(x.group.id);
              if (x.group) groupsSeen.add(x.group.id);
              const size = x.group ? paper.questions.filter((y) => y.group?.id === x.group!.id).length : 0;
              return (
                <li key={x.id} className={cx('qitem', x.id === q?.id && 'qitem--current', x.group && 'qitem--grouped')} data-testid="question-item" data-question-id={x.id} data-status={status}>
                  {groupHead ? <span className="qitem__group">{t('exams.answers.group', { n: x.group!.choose, of: size })}</span> : null}
                  <button type="button" className="qitem__btn" aria-current={x.id === q?.id || undefined} tabIndex={x.id === q?.id ? 0 : -1} onClick={() => select(x.id)}>
                    <span className="qitem__num" aria-hidden>{i + 1}</span>
                    <span className="qitem__label">{x.number}</span>
                    <span className="qitem__text">{x.text}</span>
                    <span className={cx('qitem__status', `qitem__status--${status}`)} title={t(`exams.answers.status.${status}`)}>
                      <span aria-hidden>{progress?.current === x.id ? '◐' : STATUS_GLYPH[status]}</span>
                      <span className="visually-hidden">{t(`exams.answers.status.${status}`)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="qlist__foot">
            {running ? (
              <div className="answer-progress" role="status" data-testid="answer-progress">
                <span>{t('exams.answers.progress', { i: Math.min(progress!.done + 1, progress!.total), n: progress!.total })}</span>
                <Button size="sm" variant="ghost" icon={X} onClick={() => exams.cancelAnswers(examId)} data-testid="answer-cancel">{t('common.cancel')}</Button>
              </div>
            ) : batchError ? (
              <AiErrorNotice services={services} code={batchError} onRetry={() => startBatch(unanswered)} onBusyFallback={() => startBatch(unanswered, 'quick', { busyFallback: true })} data-testid="answer-error" />
            ) : aiOn && unanswered.length ? (
              <Button icon={Sparkles} onClick={() => dialogs.open('answer-settings', { classId, examId, qids: unanswered })} data-testid="exam-answer-all">
                {tp('exams.answers.answerMissing', unanswered.length, { n: unanswered.length })}
              </Button>
            ) : null}
          </div>
        </aside>
        <section className="qdetail" aria-label={q ? t('exams.answers.eyebrow', { number: q.number, points: '', kind: '' }).replace(/[ ·]+$/, '') : undefined}>
          {integrity ? (
            <Notice
              tone="info"
              data-testid="exam-integrity"
              actions={<Button size="sm" variant="ghost" onClick={() => { writeFlag(integrityKey(examId)); setIntegrity(false); }} data-testid="exam-integrity-dismiss">{t('common.dismiss')}</Button>}
            >
              {t('exams.tab.integrity')}
            </Notice>
          ) : null}
          {paper.newerFormat ? <Notice tone="info">{t('exams.answers.newer')}</Notice> : null}
          {q ? (
            <QuestionDetail
              key={q.id}
              services={services}
              classId={classId}
              paper={paper}
              q={q}
              aiOn={aiOn}
              tryFirst={tryFirst}
              answering={progress?.current === q.id || (running && !q.ai && (exams.progress(examId) !== null))}
              batchError={batchError}
              onAnswer={(mode, opts) => startBatch([q.id], mode, opts)}
            />
          ) : null}
        </section>
      </div>
    </>
  );
}

interface DetailProps {
  services: AppServices;
  classId: ClassId;
  paper: ExamPaperView;
  q: QuestionView;
  aiOn: boolean;
  tryFirst: boolean;
  answering: boolean;
  batchError: ErrorCode | null;
  onAnswer(mode: 'quick' | 'deep', opts?: { busyFallback?: boolean }): void;
}

function QuestionDetail({ services, classId, paper, q, aiOn, tryFirst, answering, batchError, onAnswer }: DetailProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const toast = useToast();
  const key = useKeyLabel();
  const settings = useStore(services.ai.settings);
  const exams = services.forClass(classId).exams;
  const [draft, setDraft] = useState(q.mine.draft);
  const [correct, setCorrect] = useState(q.mine.correct);
  const [showCorrect, setShowCorrect] = useState(!!q.mine.correct);
  const [hinting, setHinting] = useState(false);
  const [hintError, setHintError] = useState<ErrorCode | null>(null);
  const saveTimer = useRef<number | null>(null);
  const correctTimer = useRef<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const revealed = !tryFirst || q.mine.revealed;
  const model = services.ai.label(settings.chain[0] ?? settings.model);

  // Autosave the private answer (1 s after the last keystroke, and when leaving the question).
  useEffect(() => () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      void exams.setMyAnswer(paper.examId, q.id, draftRef.current).catch(() => undefined);
    }
  }, [exams, paper.examId, q.id]);
  const onDraft = (v: string) => {
    setDraft(v);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void exams.setMyAnswer(paper.examId, q.id, v).catch(() => undefined);
    }, 1000);
  };
  const onCorrect = (v: string) => {
    setCorrect(v);
    if (correctTimer.current !== null) window.clearTimeout(correctTimer.current);
    correctTimer.current = window.setTimeout(() => {
      correctTimer.current = null;
      void exams.setCorrect(paper.examId, q.id, v).catch(() => undefined);
    }, 800);
  };

  const reveal = async () => {
    await exams.reveal(paper.examId, q.id).catch(() => undefined);
    if (!q.ai && aiOn) onAnswer('quick');
  };
  const hint = async () => {
    setHinting(true);
    setHintError(null);
    try {
      await exams.hint(paper.examId, q.id);
    } catch (e) {
      setHintError(((e as { code?: ErrorCode }).code ?? 'AI_UPSTREAM') as ErrorCode);
    } finally {
      setHinting(false);
    }
  };
  const copyToMine = () => {
    if (!q.ai) return;
    const before = draft;
    const text = `${t('exams.answers.fromAi')}\n${copyWithSources(q.ai, i18n)}`;
    const next = draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text;
    onDraft(next);
    toast.show({ message: t('exams.answers.copiedToMine'), action: { label: t('common.undo'), run: () => onDraft(before), testId: 'ai-copy-undo' } });
  };

  const eyebrow = t('exams.answers.eyebrow', {
    number: q.number, points: q.points !== null ? pointsLabel(i18n, paper.scale, q.points) : '', kind: t(`exams.questionKinds.${q.kind}`),
  }).replace(/ ·  · /, ' · ');
  const group = q.group ? paper.questions.filter((x) => x.group?.id === q.group!.id).map((x) => x.number) : [];
  const deepWanted = !!q.ai && !q.ai.insufficient && (q.ai.grounded < 0.5 || (settings.quota?.limit ?? 0) >= 1000);
  const blocked = costBlocked(settings.quota, model);

  return (
    <article className="qd" data-testid="question-detail" data-question-id={q.id}>
      <header className="qd__head">
        <p className="qd__eyebrow">{eyebrow}</p>
        {q.group ? <p className="qd__group">{t('exams.review.group', { n: q.group.choose, list: group.join(', ') })}</p> : null}
        <h2 className="qd__question">{q.text}</h2>
      </header>

      <TextArea
        label={t('exams.answers.mine')}
        value={draft}
        onChange={onDraft}
        placeholder={t('exams.answers.minePlaceholder')}
        reading
        autoGrow
        minHeight={96}
        maxHeight={420}
        fieldClassName="qd__mine"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && aiOn && !revealed) {
            e.preventDefault();
            void reveal();
          }
        }}
        data-testid="my-answer"
      />

      {!aiOn ? (
        <Notice tone="info" data-testid="exam-ai-off" actions={<Button size="sm" icon={Settings2} onClick={() => go({ name: 'settings', section: 'ai' })} data-testid="exam-ai-setup">{t('ai.recovery.setUp')}</Button>}>
          {t('exams.answers.aiOff')}
        </Notice>
      ) : null}

      {aiOn && !revealed ? (
        <div className="qd__try">
          <Button variant="primary" icon={Sparkles} onClick={() => void reveal()} aria-keyshortcuts="Control+Enter Meta+Enter" data-testid="reveal-answer">
            {t('exams.answers.reveal')}
          </Button>
          {!q.hint ? (
            <Button icon={Lightbulb} busy={hinting} onClick={() => void hint()} data-testid="hint">{t('exams.answers.hint')}</Button>
          ) : null}
          <span className="qd__kbd t-small">{t('exams.answers.revealKey', { key: key('Enter') })}</span>
        </div>
      ) : null}

      {aiOn && !revealed && hintError ? <AiErrorNotice services={services} code={hintError} onRetry={() => void hint()} data-testid="hint-error" /> : null}
      {!revealed && q.hint ? (
        <AiAnswer
          services={services}
          view={q.hint}
          classId={classId}
          title={t('exams.answers.hintTitle')}
          grounded={false}
          sources={false}
          extra={
            <p className="qd__stuck t-small">
              {t('exams.answers.stillStuck')}{' '}
              <button type="button" className="qd__linkbtn" onClick={() => void reveal()} data-testid="hint-reveal">{t('exams.answers.reveal')}</button>
            </p>
          }
          data-testid="ai-hint"
        />
      ) : null}

      {revealed ? (
        q.ai ? (
          <>
            <AiAnswer
              services={services}
              view={q.ai}
              classId={classId}
              state={answering ? 'streaming' : 'done'}
              actions={
                aiOn ? (
                  <>
                    {deepWanted ? <Button size="sm" variant="ghost" icon={Telescope} onClick={() => onAnswer('deep')} disabled={answering || blocked} data-testid="ai-deep-footer">{t('ai.card.deep')}</Button> : null}
                    <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => onAnswer('quick')} disabled={answering || blocked} data-testid="ai-retry">{t('ai.card.retry')}</Button>
                    <Button size="sm" variant="ghost" icon={ClipboardCopy} onClick={copyToMine} data-testid="ai-copy">{t('exams.answers.copyToMine')}</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" icon={ClipboardCopy} onClick={copyToMine} data-testid="ai-copy">{t('exams.answers.copyToMine')}</Button>
                )
              }
            />
            {q.ai.insufficient && aiOn ? (
              <Notice tone="info" data-testid="ai-insufficient" actions={<Button size="sm" icon={Telescope} onClick={() => onAnswer('deep')} disabled={answering || blocked} data-testid="ai-deep">{t('ai.card.deepCost', { min: 4, max: 8 })}</Button>}>
                {t('exams.answers.insufficient')}
              </Notice>
            ) : null}
          </>
        ) : answering ? (
          <AiCard title={t('ai.card.streaming')} model={model} state="streaming" data-testid="ai-answer">{null}</AiCard>
        ) : batchError && aiOn ? (
          <AiErrorNotice services={services} code={batchError} onRetry={() => onAnswer('quick')} onBusyFallback={() => onAnswer('quick', { busyFallback: true })} data-testid="ai-error" />
        ) : aiOn ? (
          <div className="qd__ask">
            <Button variant="primary" icon={Sparkles} onClick={() => onAnswer('quick')} disabled={blocked} data-testid="ai-answer-one">{t('exams.answers.answerOne')}</Button>
            <CostLine requests={2} quota={settings.quota} model={model} data-testid="ai-answer-cost" />
          </div>
        ) : (
          <p className="qd__none t-muted" data-testid="ai-none"><CircleDashed size={14} aria-hidden /> {t('exams.answers.status.none')}</p>
        )
      ) : null}

      {revealed || !aiOn ? (
        <section className="qd__mark" aria-label={t('exams.answers.mark')}>
          <RadioGroup
            label={t('exams.answers.mark')}
            variant="segmented"
            value={(q.mine.mark ?? '') as 'right'}
            onChange={(v) => void exams.setMark(paper.examId, q.id, v)}
            options={(['right', 'partly', 'wrong', 'unsure'] as const).map((m) => ({ value: m, label: `${STATUS_GLYPH[m]} ${t(`exams.answers.marks.${m}`)}` }))}
            data-testid="mark"
          />
          <div className="qd__mark-row">
            {!showCorrect ? <Button size="sm" variant="ghost" onClick={() => setShowCorrect(true)} data-testid="mark-correct">{t('exams.answers.correct')}</Button> : null}
            <Checkbox checked={q.mine.inPractice} onChange={(on) => void exams.setInPractice(paper.examId, q.id, on)} label={t('exams.answers.addToPractice')} data-testid="mark-practice" />
          </div>
          {showCorrect ? (
            <TextArea label={t('exams.answers.correctLabel')} value={correct} onChange={onCorrect} reading autoGrow minHeight={72} maxHeight={320} data-autofocus data-testid="mark-correct-text" />
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
