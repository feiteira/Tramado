// The tabs a class shows (UX §3.3.2, §6 "same tabs in the same order in every class"): Share replaces Chat and
// Members while the class is not shared.
import type { ClassTabId } from './routes';

export function tabsOf(shared: boolean): ClassTabId[] {
  return shared ? ['lectures', 'documents', 'notes', 'exams', 'chat', 'ask', 'members'] : ['lectures', 'documents', 'notes', 'exams', 'ask', 'share'];
}
