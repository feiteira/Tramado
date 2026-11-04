// The chat's rail badge (UX §2.3): mentions first ("@{n}", tone info), else the unread count (tone neutral);
// null when everything is read. Archived classes have no badge (the rail does not ask for them).
import type { ClassId } from '../../core/model/ids';
import type { ReadableStore } from '../../services/store';
import type { AppServices } from '../../services/types/common';

type Badge = { count: number; tone: 'neutral' | 'info' | 'danger' } | null;

export function badgeOf(v: { unread: number; mentions: number } | null | undefined): Badge {
  if (!v) return null;
  if (v.mentions > 0) return { count: v.mentions, tone: 'info' };
  if (v.unread > 0) return { count: v.unread, tone: 'neutral' };
  return null;
}

export default function railBadge(services: AppServices, classId: ClassId): ReadableStore<Badge> {
  let chat: ReturnType<AppServices['forClass']>['chat'] | null = null;
  try {
    chat = services.forClass(classId).chat;
  } catch {
    chat = null;
  }
  let last: Badge = badgeOf(chat?.view.get());
  const same = (a: Badge, b: Badge) => a === b || (!!a && !!b && a.count === b.count && a.tone === b.tone);
  return {
    get() {
      const next = badgeOf(chat?.view.get());
      if (!same(next, last)) last = next;
      return last;
    },
    subscribe(listener) {
      if (!chat) return () => undefined;
      return chat.view.subscribe(() => {
        const next = badgeOf(chat!.view.get());
        if (same(next, last)) return;
        last = next;
        listener();
      });
    },
  };
}
