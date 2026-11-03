// PLACEHOLDER (M0) → UI-EXAMS builds the exam paper flow in wave 2 (UX §3.9.5–§3.9.9): extracting,
// review, answers (question list) and practice.
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { useI18n } from '../../ui/i18n';
import { PlaceholderScreen, useStoreSafe } from '../placeholder';

const ROOT = { extracting: 'exam-extracting', review: 'exam-review', answers: 'exam-answers', practice: 'exam-practice' } as const;

export default function ExamScreen({ route, services }: { route: Extract<Route, { name: 'exam' }>; services: AppServices }) {
  const { t } = useI18n();
  const paper = useStoreSafe(() => services.forClass(route.classId).exams.open(route.examId));
  const mode = route.mode ?? 'answers';
  const questions = typeof paper === 'string' ? paper : (paper?.questions.length ?? null);
  return (
    <PlaceholderScreen testid={ROOT[mode]} title={typeof paper === 'object' && paper ? paper.title : t('classes.tabs.exams')} data={{ examId: route.examId, mode, questions }}>
      {mode === 'answers' ? <div data-testid="question-list" /> : null}
    </PlaceholderScreen>
  );
}
