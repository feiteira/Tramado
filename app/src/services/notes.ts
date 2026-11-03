// STUB (M0) → T-DOCS owns this file from wave 1: class and private notes, conflict copies.
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { NotesService } from './types/notes';

export function createNotesService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): NotesService {
  void ctx; void app; void cls;
  const no = (m: string) => () => Promise.reject(notImplemented(`NotesService.${m}`));
  return {
    list: constant([]),
    read: no('read'), save: no('save'), create: no('create'), rename: no('rename'), remove: no('remove'), conflicts: no('conflicts'), resolve: no('resolve'),
    editing: () => undefined,
  };
}
