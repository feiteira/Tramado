// STUB (M0) → T-SYNC owns this file from wave 1: the trust gate (authorship bound to the bytes, signatures, no rollback; sync spec §12).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { TrustService } from './types/sync';

/** Until T-SYNC: every file is trusted, as for a local-only class (folder spec §6.3). */
export function createTrustService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): TrustService {
  void ctx; void app; void cls;
  return {
    verify: async () => ({ kind: 'trusted' }),
    noteOwnWrite: () => undefined,
    pass: async () => ({ checked: 0, untrusted: 0 }),
    noteRemote: () => undefined,
  };
}
