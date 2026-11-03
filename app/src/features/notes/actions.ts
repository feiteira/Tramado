// PLACEHOLDER (M0) → UI-DOCS: the "new note" action used by the palette and Today.
import { notImplemented } from '../../core/errors';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';

export default async function action(services: AppServices, classId: ClassId): Promise<void> {
  void services; void classId;
  throw notImplemented('new note');
}
