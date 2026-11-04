// "Add documents…" from the palette and Today (registry ACTIONS.importDocuments): the native picker, then the
// documents tab of the class adds the picks with its full flow (recordings, duplicates, progress, Undo). When the
// tab cannot be opened (no navigation available), the files are added directly.
import { toPlatformError } from '../../core/errors';
import { isUiLocale } from '../../core/i18n/languages';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { makeI18n } from '../../ui/i18n';
import { navigate } from '../search/navigate';
import { PICK_EXTENSIONS } from './model';
import { queueImport } from './useDocImport';

export default async function action(services: AppServices, classId: ClassId): Promise<void> {
  const locale = services.ctx.prefs.get('ui.locale');
  const { t } = makeI18n(isUiLocale(locale) ? locale : 'en');
  let picks;
  try {
    picks = await services.ctx.platform.dialogs.pickFiles({
      title: t('documents.tab.add'),
      filters: [{ name: t('documents.tab.pickFilter'), extensions: PICK_EXTENSIONS }, { name: t('documents.tab.pickAll'), extensions: ['*'] }],
      multiple: true,
    });
  } catch (e) {
    if (toPlatformError(e).code === 'CANCELLED') return;
    throw e;
  }
  if (!picks.length) return;
  queueImport(classId, picks);
  if (navigate({ name: 'class', classId, tab: 'documents' })) return;
  // Nothing could open the tab: add them here (no duplicate questions; duplicates are skipped).
  await services.forClass(classId).documents.import(picks);
}
