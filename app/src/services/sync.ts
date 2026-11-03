// STUB (M0) → T-SYNC owns this file from wave 1: the app-level sync service (boot, invites, join, admission, event routing §12 rule 5).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { Store } from './store';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { SyncService, SyncUiState } from './types/sync';

export const EMPTY_SYNC_STATE: SyncUiState = {
  status: null, folders: {}, joinRequests: [], offers: [], massDelete: [], massDeleteRemote: [], foreignWrites: 0, markerMissing: [],
  identityCopied: false, joinStalled: [],
};

export function createSyncService(ctx: AppContext, app: () => AppServices): SyncService {
  void app;
  const state = new Store<SyncUiState>(EMPTY_SYNC_STATE);
  const no = (m: string) => () => Promise.reject(notImplemented(`SyncService.${m}`));
  return {
    state,
    // The stub tolerates events: it only records the status so the sync pill has something to show.
    async boot() {
      try {
        const status = await ctx.platform.sync.status();
        state.set({ ...state.get(), status });
      } catch {
        // no sharing on this platform yet
      }
      ctx.platform.events.onSync((e) => {
        if (e.type === 'status') state.set({ ...state.get(), status: e.status });
      });
    },
    ensureStarted: no('ensureStarted'),
    restart: no('restart'),
    share: no('share'),
    invite: no('invite'),
    parseCode: no('parseCode'),
    join: no('join'),
    cancelJoin: no('cancelJoin'),
    leave: no('leave'),
    admit: no('admit'),
    decline: no('decline'),
    ban: no('ban'),
    unban: no('unban'),
    answerOffer: no('answerOffer'),
    applySettings: no('applySettings'),
    versions: no('versions'),
    restore: no('restore'),
    resolveMassDelete: no('resolveMassDelete'),
    resolveRemoteMassDelete: no('resolveRemoteMassDelete'),
    resolveCopiedIdentity: no('resolveCopiedIdentity'),
    diagnosticsText: no('diagnosticsText'),
  };
}
