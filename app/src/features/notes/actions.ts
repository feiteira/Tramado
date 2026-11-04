// "New note in {class}" from the palette and Today (registry ACTIONS.newNote): a private note with a dated title,
// opened in the editor.
import { isUiLocale } from '../../core/i18n/languages';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { makeI18n } from '../../ui/i18n';
import { navigate } from '../search/navigate';
import { createNote } from './model';

export default async function action(services: AppServices, classId: ClassId): Promise<void> {
  const locale = services.ctx.prefs.get('ui.locale');
  const path = await createNote(services, classId, 'private', makeI18n(isUiLocale(locale) ? locale : 'en'));
  navigate({ name: 'note', classId, relPath: path, private: true });
}
