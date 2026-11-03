// PLACEHOLDER (M0) → UI-DOCS builds the document view in wave 2 (UX §3.7.2).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { PlaceholderScreen } from '../placeholder';

export default function DocumentScreen({ route, services }: { route: Extract<Route, { name: 'document' }>; services: AppServices }) {
  void services;
  const name = route.relPath.slice(route.relPath.lastIndexOf('/') + 1);
  return <PlaceholderScreen testid="screen-document" title={name} data={{ relPath: route.relPath, page: route.page ?? null, quote: route.quote ?? null }} />;
}
