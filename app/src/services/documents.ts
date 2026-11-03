// STUB (M0) → T-DOCS owns this file from wave 1: documents (import, remove, rename, move, text).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { DocumentService } from './types/documents';

export function createDocumentService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): DocumentService {
  void app;
  const no = (m: string) => () => Promise.reject(notImplemented(`DocumentService.${m}`));
  return {
    list: constant([]),
    import: no('import'), remove: no('remove'), rename: no('rename'), move: no('move'), text: no('text'),
    url: (path) => ctx.platform.media.url({ kind: 'file', classId: cls.classId, path }),
    reveal: (path) => ctx.platform.classes.reveal(cls.classId, path),
    open: (path) => ctx.platform.classes.open(cls.classId, path),
  };
}
