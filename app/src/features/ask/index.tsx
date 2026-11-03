// PLACEHOLDER (M0) → UI-EXAMS: Ask across all classes (route `ask`, UX §3.11).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { useI18n } from '../../ui/i18n';
import { PlaceholderScreen } from '../placeholder';

export default function AskScreen({ route, services }: { route: Extract<Route, { name: 'ask' }>; services: AppServices }) {
  const { t } = useI18n();
  return <PlaceholderScreen testid="screen-ask" title={t('classes.tabs.ask')} data={{ threadId: route.threadId ?? null, query: route.query ?? null, classes: services.library.classes.get().length }} />;
}
