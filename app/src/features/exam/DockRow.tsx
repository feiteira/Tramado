// The exams' dock row (UX §3.9.5 "Leaving the screen does not cancel; the dock shows the job", §3.9.8 "Answering… {i}
// of {n}"): one line per exam being read or answered in any class, with [Open] and [Cancel]. Renders null when no job
// runs. Needs its entry in `DOCK_ROWS` (features/registry.tsx, integrator; requested by UI-EXAMS).
import React from 'react';
import { ClipboardList, X } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { useI18n } from '../../ui/i18n';
import { Store } from '../../services/store';
import './exam.css';

const NONE = new Store<{ done: number; total: number; current: string | null; error: unknown } | null>(null);

export default function ExamDockRow({ services }: { services: AppServices }) {
  const classes = useStore(services.library.classes);
  const live = classes.filter((c) => !c.archived);
  return <>{live.map((c) => <ClassJobs key={c.id} services={services} classId={c.id} />)}</>;
}

function ClassJobs({ services, classId }: { services: AppServices; classId: ClassId }) {
  const exams = services.forClass(classId).exams;
  const list = useStore(exams.list);
  const running = useStore(exams.running);
  const drafts = list.papers.filter((p) => p.state === 'extracting');
  if (!drafts.length && !running.length) return null;
  return (
    <>
      {drafts.map((d) => <Job key={d.examId} services={services} classId={classId} examId={d.examId} title={d.title} kind="reading" />)}
      {running.map((id) => <Job key={id} services={services} classId={classId} examId={id} title={list.papers.find((p) => p.examId === id)?.title ?? ''} kind="answering" />)}
    </>
  );
}

function Job({ services, classId, examId, title, kind }: { services: AppServices; classId: ClassId; examId: string; title: string; kind: 'reading' | 'answering' }) {
  const { t } = useI18n();
  const { route, go } = useRouter();
  const exams = services.forClass(classId).exams;
  const progress = useStore(kind === 'answering' ? exams.progress(examId) ?? NONE : NONE);
  const here = route.name === 'exam' && route.examId === examId;
  if (here) return null;
  const text = kind === 'reading'
    ? t('exams.extracting.title', { title })
    : `${title} · ${t('exams.answers.progress', { i: Math.min((progress?.done ?? 0) + 1, progress?.total ?? 1), n: progress?.total ?? 1 })}`;
  return (
    <div className="dock-job" role="status" data-testid="exam-dock-row" data-exam-id={examId}>
      <ClipboardList size={16} strokeWidth={1.75} aria-hidden />
      <span className="dock-job__text">{text}</span>
      <Button size="sm" variant="ghost" onClick={() => go({ name: 'exam', classId, examId, ...(kind === 'reading' ? { mode: 'extracting' as const } : {}) })} data-testid="exam-dock-open">{t('common.open')}</Button>
      <Button size="sm" variant="ghost" icon={X} onClick={() => (kind === 'reading' ? exams.cancelDraft(examId) : exams.cancelAnswers(examId))} data-testid="exam-dock-cancel">{t('common.cancel')}</Button>
    </div>
  );
}
