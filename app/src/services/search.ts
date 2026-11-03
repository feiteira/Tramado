// STUB (M0) → T-DOCS owns this file from wave 1: search over the class indexes (PassageIndex in search.worker).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { SearchService } from './types/search';

export function createSearchService(ctx: AppContext, app: () => AppServices): SearchService {
  void ctx; void app;
  const no = (m: string) => () => Promise.reject(notImplemented(`SearchService.${m}`));
  return {
    status: (classId) => constant({ classId, state: 'idle', docs: 0, pending: 0, chars: 0 }),
    ensure: no('ensure'), passages: no('passages'), passage: no('passage'), find: no('find'), resolve: no('resolve'),
  };
}
