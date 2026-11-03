// STUB (M0) → T-SYNC owns this file from wave 1: system notifications through notify_show (UX §2.8, §5.22).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { NotificationService } from './types/class';

export function createNotificationService(ctx: AppContext, app: () => AppServices): NotificationService {
  void ctx; void app;
  return { notify: () => Promise.reject(notImplemented('NotificationService.notify')) };
}
