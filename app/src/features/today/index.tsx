// PLACEHOLDER (M0) → UI-SHELL builds Today in wave 2 (UX §3.2): greeting, checklist, coming up,
// transcriptions, recent lectures, unread. It renders `[screen-today]` and `placeholder-data`.
import React from 'react';
import { DateTime } from 'luxon';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { useStore } from '../../shell/useStore';
import { useI18n } from '../../ui/i18n';
import { PlaceholderScreen } from '../placeholder';

export default function Today({ route, services }: { route: Extract<Route, { name: 'today' }>; services: AppServices }) {
  void route;
  const i18n = useI18n();
  const classes = useStore(services.library.classes);
  const me = useStore(services.ctx.identity);
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const first = (me?.name ?? '').split(/\s+/)[0] ?? '';
  const part = now.hour >= 5 && now.hour < 12 ? 'morning' : now.hour >= 12 && now.hour < 19 ? 'afternoon' : 'evening';
  return (
    <PlaceholderScreen
      testid="screen-today"
      title={i18n.t(`today.greeting.${part}`, { name: first })}
      subtitle={i18n.date(now, 'long')}
      data={{ classes: classes.filter((c) => !c.archived).map((c) => c.name), archived: classes.filter((c) => c.archived).map((c) => c.name) }}
    />
  );
}
