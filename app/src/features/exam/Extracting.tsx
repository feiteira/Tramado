// Extracting (UX §3.9.5, `[exam-extracting]`): "Finding the questions in “{title}”" with ProgressSteps — Reading page
// {i} of {n} (with {model}) · Finding the questions · Ready to check — and [Cancel]. A failed step stops with the AI
// error copy and [Try again] / [Type the questions instead]. Leaving does not cancel. For a saved paper the steps are
// its finished extraction, with [Check the questions]; an exam date without a paper offers to add one.
import React from 'react';
import { ClipboardType, FilePlus2, ListChecks, X } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Store } from '../../services/store';
import type { ExamDraft } from '../../services/types/exams';
import { Button } from '../../ui/components/Button';
import { EmptyState, Notice } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { ProgressSteps } from '../../ui/tramado/ProgressSteps';
import { AiErrorNotice, useAiErrorText } from '../ask/AiErrorNotice';

type Step = { label: string; state: 'todo' | 'doing' | 'done' | 'failed' };
const NO_DRAFT = new Store<ExamDraft | null>(null);

/** The steps of a draft (UX §3.9.5); OCR pages are listed one by one. A failure before any text was read is a reading failure. */
export function draftSteps(d: Pick<ExamDraft, 'step' | 'pages' | 'ocrDone' | 'text'>, label: { reading(i: number, n: number): string; read: string; finding: string; ready: string }): Step[] {
  const failed = d.step === 'failed';
  const readingFailed = failed && !d.text;
  const steps: Step[] = [];
  if ((d.ocrDone > 0 || d.step === 'ocr') && d.pages > 0) {
    const n = Math.min(d.pages, 40);
    for (let i = 1; i <= n; i++) {
      const state: Step['state'] = i <= d.ocrDone ? 'done'
        : i === d.ocrDone + 1 ? (d.step === 'ocr' ? 'doing' : readingFailed ? 'failed' : 'done')
        : d.step === 'ocr' || readingFailed ? 'todo' : 'done';
      steps.push({ label: label.reading(i, d.pages), state });
    }
  } else {
    steps.push({ label: label.read, state: d.step === 'ocr' ? 'doing' : readingFailed ? 'failed' : 'done' });
  }
  const done = d.step === 'review' || d.step === 'saving';
  steps.push({ label: label.finding, state: d.step === 'presplit' || d.step === 'extracting' ? 'doing' : done ? 'done' : failed && !readingFailed ? 'failed' : 'todo' });
  steps.push({ label: label.ready, state: done ? 'done' : 'todo' });
  return steps;
}

export function Extracting({ services, classId, draftId, examId }: { services: AppServices; classId: ClassId; draftId: string | null; examId?: string }) {
  const { t, tp } = useI18n();
  const { go, replace } = useRouter();
  const dialogs = useDialogs();
  const exams = services.forClass(classId).exams;
  const draft = useStore(draftId ? exams.draft(draftId) : NO_DRAFT);
  const list = useStore(exams.list);
  const settings = useStore(services.ai.settings);
  const errorText = useAiErrorText(services);
  const view = list.papers.find((p) => p.examId === (draftId ?? examId));
  const date = !draftId ? list.dates.find((d) => d.examId === examId) : undefined;
  const raw = !draftId && examId ? exams.raw(examId) : null;
  const title = draft?.meta.title ?? view?.title ?? raw?.title ?? date?.title ?? '';
  const model = services.ai.label(draft?.model ?? raw?.extraction?.model ?? settings.chain[0] ?? settings.model).label;
  const labels = {
    reading: (i: number, n: number) => t('exams.extracting.readingPage', { i, n, model }),
    read: t('exams.extracting.reading'),
    finding: t('exams.extracting.finding'),
    ready: t('exams.extracting.ready'),
  };

  if (!draft && date && !raw?.questions.length) {
    return (
      <>
        <ScreenHeader title={t('exams.extracting.title', { title })} />
        <div className="exam-extracting" data-testid="exam-extracting">
          <EmptyState
            icon={FilePlus2}
            title={t('exams.extracting.noPaper')}
            data-testid="exam-extracting-nopaper"
            actions={<Button variant="primary" icon={FilePlus2} onClick={() => dialogs.open('exam-paper', { classId })} data-testid="exam-extracting-add">{t('exams.tab.dateMenu.addPaper')}</Button>}
          >
            {t('exams.extracting.noPaperBody', { title })}
          </EmptyState>
        </div>
      </>
    );
  }

  const steps: Step[] = draft
    ? draftSteps(draft, labels)
    : [
      { label: raw?.files.some((f) => f.pages) ? labels.reading(raw.files[0]?.pages ?? 1, raw.files[0]?.pages ?? 1) : labels.read, state: 'done' },
      { label: labels.finding, state: 'done' },
      { label: labels.ready, state: 'done' },
    ];
  const failed = draft?.step === 'failed';
  const cancel = () => {
    if (draftId) exams.cancelDraft(draftId);
    go({ name: 'class', classId, tab: 'exams' });
  };
  const typeInstead = async () => {
    const text = draft?.text ?? '';
    if (draftId) exams.cancelDraft(draftId);
    const id = await exams.startTyped(text, draft?.meta ?? {});
    replace({ name: 'exam', classId, examId: id, mode: 'review' });
  };

  return (
    <>
      <ScreenHeader title={t('exams.extracting.title', { title })} subtitle={draft ? t('exams.extracting.keepsGoing') : undefined} />
      <div className="exam-extracting" data-testid="exam-extracting" data-step={draft?.step ?? 'done'}>
        <div className="exam-extracting__card">
          <ProgressSteps steps={steps} data-testid="exam-steps" />
          {draft && draft.cost.requests ? <p className="t-small t-muted" data-testid="exam-extracting-cost">{tp('exams.extracting.used', draft.cost.requests, { n: draft.cost.requests })}</p> : null}
          {failed && draft?.error ? (
            draft.error.startsWith('AI_') ? (
              <AiErrorNotice services={services} code={draft.error} data-testid="exam-extracting-error" />
            ) : (
              <Notice tone="danger" data-testid="exam-extracting-error">{errorText(draft.error)}</Notice>
            )
          ) : null}
          <div className="exam-extracting__actions">
            {failed ? (
              <>
                <Button variant="primary" onClick={() => draftId && void exams.retryDraft(draftId)} data-testid="exam-extracting-retry">{t('ai.recovery.tryAgain')}</Button>
                <Button icon={ClipboardType} onClick={() => void typeInstead()} data-testid="exam-extracting-type">{t('exams.extracting.typeInstead')}</Button>
              </>
            ) : null}
            {draft ? (
              <Button variant={failed ? 'ghost' : 'secondary'} icon={X} onClick={cancel} data-testid="exam-extracting-cancel">{t('common.cancel')}</Button>
            ) : (
              <Button variant="primary" icon={ListChecks} onClick={() => replace({ name: 'exam', classId, examId: examId!, mode: 'review' })} data-testid="exam-extracting-check">{t('exams.paper.check')}</Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
