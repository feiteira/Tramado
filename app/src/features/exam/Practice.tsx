// PLACEHOLDER (M0) → UI-EXAMS: practising every paper of a class (route `practice`, UX §3.9.9).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { useI18n } from '../../ui/i18n';
import { PlaceholderScreen, useStoreSafe } from '../placeholder';

export default function PracticeScreen({ route, services }: { route: Extract<Route, { name: 'practice' }>; services: AppServices }) {
  const { t } = useI18n();
  const list = useStoreSafe(() => services.forClass(route.classId).exams.list);
  return <PlaceholderScreen testid="exam-practice" title={t('classes.tabs.exams')} data={{ classId: route.classId, papers: typeof list === 'string' ? list : list.papers.length }} />;
}
