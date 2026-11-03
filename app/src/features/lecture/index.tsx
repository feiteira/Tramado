// PLACEHOLDER (M0) → UI-LECTURES builds the lecture view in wave 2 (UX §3.5).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { useI18n } from '../../ui/i18n';
import { PlaceholderScreen, safe, useStoreSafe } from '../placeholder';

export default function LectureScreen({ route, services }: { route: Extract<Route, { name: 'lecture' }>; services: AppServices }) {
  const { t } = useI18n();
  const detail = useStoreSafe(() => services.forClass(route.classId).lectures.open(route.lectureId));
  const segments = typeof detail === 'string' ? detail : (detail?.transcript?.segments.length ?? null);
  void safe;
  return (
    <PlaceholderScreen testid="screen-lecture" title={typeof detail === 'object' && detail ? detail.view.title : t('classes.tabs.lectures')} data={{ lectureId: route.lectureId, at: route.at ?? null, segments }}>
      <div data-testid="lecture-transcript" />
    </PlaceholderScreen>
  );
}
