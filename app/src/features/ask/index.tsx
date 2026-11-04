// Ask across all classes (route `ask`, UX §3.11, `[screen-ask]`): the Ask view with scope "All classes"; class chips
// narrow it. Threads are private (GlobalAskService, `services/ask.ts`).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useI18n } from '../../ui/i18n';
import { AskView } from './AskView';
import './ask.css';

export default function AskScreen({ route, services }: { route: Extract<Route, { name: 'ask' }>; services: AppServices }) {
  const { t } = useI18n();
  const { replace } = useRouter();
  return (
    <div className="ask-screen" data-testid="screen-ask">
      <ScreenHeader title={t('ask.screenTitle')} subtitle={t('ask.scope.allClasses')} />
      <div className="ask-screen__body">
        <AskView
          services={services}
          classId={null}
          {...(route.threadId ? { threadId: route.threadId } : {})}
          {...(route.query ? { query: route.query } : {})}
          onThread={(threadId) => replace(threadId ? { name: 'ask', threadId } : { name: 'ask' })}
        />
      </div>
    </div>
  );
}
