import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeKind, ClassStore } from '../services/types/common';

/**
 * Trama's useLive, re-targeted to Tramado's class stores (architecture §11.4): loads, then reloads
 * whenever the class store reports a change of one of `kinds`. A load that finishes after its inputs
 * changed is dropped. The store already coalesces bursts (ClassStore, ≤ 500 ms).
 */
export function useLive<T>(
  store: ClassStore | null,
  load: () => Promise<T>,
  deps: unknown[],
  kinds: ChangeKind[],
): { data: T | undefined; error: unknown; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    loadRef
      .current()
      .then((d) => {
        if (mine === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(e);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
    if (!store) return undefined;
    return store.onChange(kinds, () => run());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, store, kinds.join(',')]);
  return { data, error, reload: run };
}
