// The palette's "Recent" (UX §3.13): the last 8 items opened on this computer. A per-viewer convenience kept in
// localStorage (guarded: it may be missing or refuse), never synced. Recent *searches* are prefs `search.recent`.
import { Store } from '../services/store';
import { pushRecent, type RecentEntry } from './paletteModel';

const KEY = 'tramado.palette.recent';

function read(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object' && typeof (x as RecentEntry).key === 'string' && typeof (x as RecentEntry).label === 'string') as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

export const recentItems = new Store<RecentEntry[]>(typeof localStorage === 'undefined' ? [] : read());

export function noteRecent(entry: RecentEntry): void {
  const next = pushRecent(recentItems.get(), entry);
  recentItems.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // per-viewer convenience only
  }
}

/** Forgets the recent items of a class that left this computer. */
export function forgetRecentOf(classId: string): void {
  const next = recentItems.get().filter((e) => (e.route as { classId?: string } | null)?.classId !== classId);
  if (next.length === recentItems.get().length) return;
  recentItems.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // per-viewer convenience only
  }
}
