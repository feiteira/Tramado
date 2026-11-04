// The dock frame (UX §2.7): rows come from DOCK_ROWS (the recording row, then one job row); each renders
// null when it has nothing to show, and the dock takes no space then. UI-SHELL owns the frame in wave 2.
import React, { Suspense, lazy } from 'react';
import type { AppServices } from '../services/types/common';
import { DOCK_ROWS } from '../features/registry';
import { useI18n } from '../ui/i18n';
import { ErrorBoundary } from './ErrorBoundary';

const ROWS = DOCK_ROWS.map((l) => lazy(l));

export function Dock({ services }: { services: AppServices }) {
  const { t } = useI18n();
  return (
    <section className="dock" aria-label={t('app.dock.label')} data-testid="dock">
      {ROWS.map((Row, i) => (
        // A failing row (another package's) leaves the dock; it never takes the screen down with it.
        <ErrorBoundary key={i} quiet>
          <Suspense fallback={null}>
            <Row services={services} />
          </Suspense>
        </ErrorBoundary>
      ))}
    </section>
  );
}
