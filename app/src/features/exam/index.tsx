// The exam paper flow (route `exam`, UX §3.9.5–§3.9.9): extracting → the mandatory review → answers → practice. A draft
// (an import still being read, or typed questions) is addressed by its draft id; a saved paper by its exam id. Without
// `mode` the screen follows the paper's state (a paper not reviewed yet opens the Review screen).
import React, { useEffect } from 'react';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { Missing } from '../../shell/Placeholder';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Spinner } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { classStyle } from '../../ui/classColor';
import { Answers } from './Answers';
import { DateView } from './DateView';
import { Extracting } from './Extracting';
import { PracticeSession } from './Practice';
import { Review } from './Review';
import './exam.css';

export default function ExamScreen({ route, services }: { route: Extract<Route, { name: 'exam' }>; services: AppServices }) {
  const { t } = useI18n();
  const { replace } = useRouter();
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === route.classId);
  if (!cls) return <Missing what="class" />;
  return <ExamFlow key={`${route.classId}:${route.examId}`} route={route} services={services} color={cls.color} replace={replace} loading={t('common.loading')} />;
}

function ExamFlow({ route, services, color, replace, loading }: { route: Extract<Route, { name: 'exam' }>; services: AppServices; color: string; replace(r: Route): void; loading: string }) {
  const exams = services.forClass(route.classId).exams;
  const paper = useStore(exams.open(route.examId));
  const draft = useStore(exams.draft(route.examId));
  const list = useStore(exams.list);
  const isDate = list.dates.some((d) => d.examId === route.examId);
  const [settled, setSettled] = React.useState(false);
  useEffect(() => {
    // The class store's first load: a paper or draft not found right away may still be loading.
    let live = true;
    void (exams as { idle?(): Promise<void> }).idle?.().then(() => live && setSettled(true));
    const id = window.setTimeout(() => live && setSettled(true), 1500);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [exams]);

  // A draft follows its step: extracting → review; a saved paper with no mode follows its state.
  let mode = route.mode ?? null;
  if (draft) {
    if (draft.step === 'review' || draft.step === 'saving') mode = 'review';
    else mode = 'extracting';
  } else if (!mode && paper) mode = paper.state === 'review' ? 'review' : 'answers';

  useEffect(() => {
    if (draft?.step === 'review' && route.mode === 'extracting') replace({ ...route, mode: 'review' });
  }, [draft?.step, route, replace]);

  const body = (() => {
    if (draft && mode === 'extracting') return <Extracting services={services} classId={route.classId} draftId={route.examId} />;
    if (draft && mode === 'review') return <Review services={services} classId={route.classId} draftId={route.examId} examId={null} />;
    if (mode === 'extracting' && (paper || isDate)) return <Extracting services={services} classId={route.classId} draftId={null} examId={route.examId} />;
    if (!paper && isDate) {
      if (mode === 'practice') return <PracticeSession services={services} classId={route.classId} examId={route.examId} />;
      return <DateView services={services} classId={route.classId} examId={route.examId} />;
    }
    if (!paper) {
      if (!settled) return <div className="exam-loading"><Spinner label={loading} /></div>;
      return <Missing what="exam" />;
    }
    if (mode === 'review') return <Review services={services} classId={route.classId} draftId={null} examId={route.examId} />;
    if (mode === 'practice') return <PracticeSession services={services} classId={route.classId} examId={route.examId} />;
    return <Answers services={services} classId={route.classId} examId={route.examId} questionId={route.questionId ?? null} />;
  })();
  return (
    <div className="exam-screen cls-scope" style={classStyle(color)} data-exam-id={route.examId}>
      {body}
    </div>
  );
}
