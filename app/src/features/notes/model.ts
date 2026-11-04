// Small helpers of the notes feature shared by the tab, the editor and the palette/Today action.
import { DateTime } from 'luxon';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { I18n } from '../../ui/i18n';

export function editedLabel(i18n: I18n, ms: number, nowMs: number): string {
  if (!ms) return '';
  const dt = DateTime.fromMillis(ms).setLocale(i18n.meta.bcp47);
  const now = DateTime.fromMillis(nowMs);
  let when: string;
  if (dt.hasSame(now, 'day')) when = `${i18n.t('common.relative.today')} ${i18n.time(dt)}`;
  else if (dt.hasSame(now.minus({ days: 1 }), 'day')) when = i18n.t('common.relative.yesterday');
  else when = dt.year === now.year ? dt.toLocaleString({ day: 'numeric', month: 'short' }) : dt.toLocaleString(DateTime.DATE_MED);
  return i18n.t('notes.edited', { when });
}

/** Creates a note with a dated title and opens it (New note / New class note). */
export async function createNote(services: AppServices, classId: ClassId, scope: 'class' | 'private', i18n: I18n): Promise<string> {
  const title = i18n.t('notes.defaultTitle', { date: DateTime.fromMillis(services.ctx.clock.now()).setLocale(i18n.meta.bcp47).toLocaleString({ day: 'numeric', month: 'short' }) });
  return services.forClass(classId).notes.create(scope, title);
}

