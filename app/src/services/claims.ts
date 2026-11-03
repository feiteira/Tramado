// STUB (M0) → T-SYNC owns this file from wave 1: the transcription claim engine (sync spec §14).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { ClaimEngine } from './types/sync';

export function createClaimEngine(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): ClaimEngine {
  void ctx; void app; void cls;
  return {
    claims: () => constant([]),
    winner: () => null,
    tryClaim: () => Promise.reject(notImplemented('ClaimEngine.tryClaim')),
    onLost: () => () => undefined,
    setStatus: () => Promise.reject(notImplemented('ClaimEngine.setStatus')),
    remove: () => Promise.reject(notImplemented('ClaimEngine.remove')),
    sweep: () => Promise.reject(notImplemented('ClaimEngine.sweep')),
  };
}
