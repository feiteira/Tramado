// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ported from Trama (app/src/shell/Placeholder.tsx), MPL-2.0.
//
// The Missing item state (UX §3.15.10): a route whose class, lecture, exam or file no longer exists.
import React from 'react';
import { FileQuestion } from 'lucide-react';
import { useI18n } from '../ui/i18n';
import { Button } from '../ui/components/Button';
import { EmptyState } from '../ui/components/Feedback';
import { ScreenHeader } from './ScreenHeader';
import { useRouter } from './router';
import type { Route } from './routes';
import { useDialogs } from './useDialogs';

export type MissingWhat = 'class' | 'lecture' | 'document' | 'exam' | 'note';

/** The kind of item a route points at. */
export function missingKindOf(route: Route): MissingWhat {
  switch (route.name) {
    case 'lecture':
    case 'document':
    case 'note':
      return route.name;
    case 'exam':
    case 'practice':
      return 'exam';
    default:
      return 'class';
  }
}

/**
 * `recentlyDeleted`: the shared class whose Recently deleted dialog may bring it back. `inline`: inside a screen or
 * dialog that already has its title (no top bar).
 */
export function Missing({ what, recentlyDeleted, inline }: { what: MissingWhat; recentlyDeleted?: string; inline?: boolean }) {
  const { t } = useI18n();
  const { go, back, canGoBack } = useRouter();
  const dialogs = useDialogs();
  return (
    <>
      {inline ? null : <ScreenHeader title={t(`app.missing.${what}`)} />}
      <div className="missing" data-testid="missing" data-missing={what}>
        <EmptyState
          icon={FileQuestion}
          title={t(`app.missing.${what}`)}
          data-testid="missing-item"
          actions={
            <>
              {recentlyDeleted ? (
                <Button onClick={() => dialogs.open('recently-deleted', { classId: recentlyDeleted })} data-testid="missing-recently-deleted">
                  {t('app.missing.recentlyDeleted')}
                </Button>
              ) : null}
              <Button onClick={() => (canGoBack ? back() : go({ name: 'today' }))} data-testid="missing-back">
                {canGoBack ? t('common.back') : t('app.rail.today')}
              </Button>
            </>
          }
        >
          {t('app.missing.body')}
        </EmptyState>
      </div>
    </>
  );
}
