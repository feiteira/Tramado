// STUB (M0) → T-SYNC owns this file from wave 1: class chat (fold, delivery ticks, mentions).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { ChatService } from './types/chat';

export function createChatService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): ChatService {
  void ctx; void app; void cls;
  return {
    view: constant({ items: [], pins: [], unread: 0, mentions: 0, olderAvailable: false, newerFormatLines: 0 }),
    send: () => Promise.reject(notImplemented('ChatService.send')),
    edit: () => Promise.reject(notImplemented('ChatService.edit')),
    remove: () => Promise.reject(notImplemented('ChatService.remove')),
    thank: () => Promise.reject(notImplemented('ChatService.thank')),
    loadOlder: () => Promise.reject(notImplemented('ChatService.loadOlder')),
    markRead: () => undefined,
  };
}
