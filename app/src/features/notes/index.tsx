// PLACEHOLDER (M0) → UI-DOCS builds the note editor in wave 2 (UX §3.8, route `note`).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { useI18n } from '../../ui/i18n';
import { PlaceholderScreen } from '../placeholder';

export default function NoteScreen({ route, services }: { route: Extract<Route, { name: 'note' }>; services: AppServices }) {
  void services;
  const { t } = useI18n();
  const title = route.relPath.slice(route.relPath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  return <PlaceholderScreen testid="screen-note" title={title} subtitle={route.private ? t('notes.subtitleMine') : undefined} data={{ relPath: route.relPath, private: route.private }} />;
}
