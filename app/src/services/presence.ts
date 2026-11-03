// STUB (M0) → T-SYNC owns this file from wave 1: presence (activity file, 60 s heartbeat, others with staleness).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { PresenceService } from './types/sync';

export function createPresenceService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): PresenceService {
  void ctx; void app; void cls;
  return { setActivity: () => Promise.reject(notImplemented('PresenceService.setActivity')), others: constant({}) };
}
