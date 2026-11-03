// STUB (M0) → T-DOCS owns this file from wave 1: private annotations (comments and highlights).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { AnnotationService } from './types/notes';

export function createAnnotationService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): AnnotationService {
  void ctx; void app; void cls;
  const no = (m: string) => () => Promise.reject(notImplemented(`AnnotationService.${m}`));
  return { forSource: () => constant([]), add: no('add'), edit: no('edit'), remove: no('remove') };
}
