// The states of the sync and AI pills (UX §2.4, §2.5) as pure functions, so the table order is tested.
import type { SyncUiState } from '../services/types/sync';
import type { AiSettingsView } from '../services/types/ai';
import type { ClassView } from '../services/types/viewModels';

export type SyncPillState =
  | { id: 'local' } | { id: 'starting' } | { id: 'error' } | { id: 'paused' }
  | { id: 'attention'; n: number } | { id: 'offline' } | { id: 'syncing'; n: number | null }
  | { id: 'waiting' } | { id: 'upToDate'; n: number };

const ERROR_CODES = new Set(['SYNC_UNAVAILABLE', 'SYNC_LOCKED', 'SYNC_PORT']);

/**
 * The first row of UX §2.4's table that applies. `online` is navigator.onLine. `facts` (shell/syncFacts.ts): the
 * distinct classmates online over every shared class (UX: "n = distinct members online, me excluded") and the
 * unresolved conflict copies; without it, the most classmates online in one class.
 */
export function syncPillState(sync: SyncUiState, classes: readonly ClassView[], online: boolean, facts?: { online: number; conflicts: number }): SyncPillState {
  const shared = classes.filter((c) => c.shared && !c.archived);
  if (!classes.some((c) => c.shared)) return { id: 'local' };
  const st = sync.status;
  if (st?.state === 'starting' || st?.state === 'restarting') return { id: 'starting' };
  if (st?.state === 'error' || (st?.error && ERROR_CODES.has(st.error))) return { id: 'error' };
  if (st?.paused) return { id: 'paused' };
  const folderErrors = Object.values(sync.folders).filter((f) => f.error || f.pullErrors > 0).length;
  const problems = shared.reduce((n, c) => n + (c.sync.kind === 'problems' ? c.sync.count : 0), 0);
  const attention = sync.massDelete.length + sync.massDeleteRemote.length + folderErrors + problems + (facts?.conflicts ?? 0);
  if (attention > 0) return { id: 'attention', n: attention };
  const peers = facts ? facts.online : shared.reduce((n, c) => Math.max(n, c.onlineMembers), 0);
  if (!online && peers === 0) return { id: 'offline' };
  const syncing = shared.filter((c) => c.sync.kind === 'syncing');
  if (syncing.length > 0) {
    const counts = syncing.map((c) => (c.sync.kind === 'syncing' ? c.sync.files : null));
    return { id: 'syncing', n: counts.every((x) => x !== null) ? counts.reduce<number>((a, b) => a + (b ?? 0), 0) : null };
  }
  if (peers === 0) return { id: 'waiting' };
  return { id: 'upToDate', n: peers };
}

export type AiPillState =
  | { id: 'off' } | { id: 'local' } | { id: 'checkKey' }
  | { id: 'model'; model: string; n: number } | { id: 'modelOnly'; model: string };

/** "google/gemma-4-31b-it:free" → "Gemma 4 31B" (until the catalog label of UX §8 OQ13 is known). */
export function modelLabelOf(id: string): string {
  const base = (id.split('/').pop() ?? id).replace(/:.*$/, '').replace(/-(it|instruct|chat)$/i, '');
  return base
    .split('-')
    .map((w) => (/^\d+[bm]$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** The label without "(free)", at most 18 characters (UX §2.5). */
/** The model's name for the pill: at most 15 characters, cut at a word where it can be ("Nemotron 3.5 Super" →
 *  "Nemotron 3.5…"), so the quota count after it stays visible at 1000 px in every language (G3, L10N review). */
export function modelShort(label: string): string {
  const s = label.replace(/\s*\(free\)\s*$/i, '').trim();
  if (s.length <= 15) return s;
  const head = s.slice(0, 14);
  const space = head.lastIndexOf(' ');
  return `${(space >= 6 ? head.slice(0, space) : head).trimEnd()}…`;
}

export function aiPillState(s: AiSettingsView & { enabled: boolean }, lastCode: string | null = null): AiPillState {
  if (!s.enabled) return { id: 'off' };
  if (s.customHost) return { id: 'local' };
  if (!s.key.set) return { id: 'off' };
  if (lastCode === 'AI_AUTH') return { id: 'checkKey' };
  const model = modelShort(s.lastAnswerModel?.label ?? modelLabelOf(s.model));
  return s.quota ? { id: 'model', model, n: s.quota.remaining } : { id: 'modelOnly', model };
}
