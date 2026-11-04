// The class's Ask tab (UX §3.11, `[class-ask]`, ready marker `[ask-thread]`): private conversations about this class.
// The class route's `threadId` opens a thread and `query` pre-fills the question; selecting a thread records it with
// `replace`, so Back does not walk through every thread opened.
import React from 'react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useI18n } from '../../ui/i18n';
import { AskView } from './AskView';

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  const { t } = useI18n();
  const { route, replace } = useRouter();
  const r = route.name === 'class' && route.classId === classId ? route : null;
  return (
    <section className="ask-tab" data-testid="class-ask" aria-label={t('classes.tabs.ask')}>
      <AskView
        services={services}
        classId={classId}
        {...(r?.threadId ? { threadId: r.threadId } : {})}
        {...(r?.query ? { query: r.query } : {})}
        onThread={(threadId) => {
          if (!r) return;
          const { threadId: _old, query: _q, ...rest } = r;
          replace(threadId ? { ...rest, tab: 'ask', threadId } : { ...rest, tab: 'ask' });
        }}
      />
    </section>
  );
}
