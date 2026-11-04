// System notifications (UX §2.8, §5.22; architecture §11.2): the `notify.*` keys translated with the UI locale and
// shown through `notify_show`, honouring Settings › Notifications (`notify.system`, `notify.transcripts`,
// `notify.joins`, `notify.exams`, `notify.model`) and the class level (`notify.class.<id>`, else `notify.default`):
// `none` shows nothing for that class, `important` only mentions, @everyone, joins, transcripts and exams.
import { catalogs } from '../core/i18n/catalogs';
import { isUiLocale } from '../core/i18n/languages';
import { translate, type MessageKeyOf } from '../core/i18n/translate';
import type { Messages } from '../core/i18n/catalogs';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { NotificationService } from './types/class';

type Kind = Parameters<NotificationService['notify']>[0];

const TOGGLE: Partial<Record<Kind, string>> = { transcript: 'notify.transcripts', join: 'notify.joins', exam: 'notify.exams', model: 'notify.model' };
const IMPORTANT: ReadonlySet<Kind> = new Set<Kind>(['mention', 'join', 'transcript', 'exam', 'recording', 'sync', 'model']);

/** Whether a notification passes the preferences (pure; exported for tests). */
export function allowed(prefs: { get(k: string): string }, kind: Kind, classId: string | null): boolean {
  if (prefs.get('notify.system') === '0') return false;
  const toggle = TOGGLE[kind];
  if (toggle && prefs.get(toggle) === '0') return false;
  if (!classId) return true;
  const level = prefs.get(`notify.class.${classId}`) || prefs.get('notify.default') || 'important';
  if (level === 'none') return false;
  if (level === 'important') return IMPORTANT.has(kind);
  return true;
}

export interface NotificationServiceImpl extends NotificationService {
  /** The last notifications shown (diagnostics and tests). */
  recent(): Array<{ kind: Kind; key: string; text: string; tag?: string }>;
}

export function createNotificationService(ctx: AppContext, app: () => AppServices): NotificationServiceImpl {
  void app;
  const recent: Array<{ kind: Kind; key: string; text: string; tag?: string }> = [];
  const shownTags = new Set<string>();
  return {
    recent: () => [...recent],
    async notify(kind, key, vars, tag) {
      const classId = typeof vars.classId === 'string' ? vars.classId : null;
      if (!allowed(ctx.prefs as unknown as { get(k: string): string }, kind, classId)) return;
      if (tag && shownTags.has(tag)) return;
      if (tag) shownTags.add(tag);
      const locale = ctx.prefs.get('ui.locale');
      const messages: Messages = catalogs[isUiLocale(locale) ? locale : 'en'];
      const text = translate(messages, catalogs.en, key as MessageKeyOf<Messages>, vars);
      recent.push({ kind, key, text, ...(tag ? { tag } : {}) });
      if (recent.length > 50) recent.shift();
      const title = typeof vars.class === 'string' && kind !== 'model' ? vars.class : 'Tramado';
      await ctx.platform.notifications.show({ title, body: text, ...(tag ? { tag } : {}) });
    },
  };
}
