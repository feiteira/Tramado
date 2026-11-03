// React over services' ReadableStore (architecture §11.4): useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import type { ReadableStore } from '../services/store';

export function useStore<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.get(),
    () => store.get(),
  );
}
