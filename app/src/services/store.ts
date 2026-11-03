// Read-only stores that services expose and React reads with useSyncExternalStore (shell/useStore.ts).
// Frozen after M0 (architecture §19.1).

export interface ReadableStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export class Store<T> implements ReadableStore<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  /** Replaces the value and notifies listeners (only when it is a different value). */
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (e) {
        console.error(e);
      }
    }
  }

  update(f: (t: T) => T): void {
    this.set(f(this.value));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** A store computed from another; recomputes lazily and notifies only when `eq` says the result changed. */
export function derived<A, T>(a: ReadableStore<A>, f: (a: A) => T, eq: (x: T, y: T) => boolean = Object.is): ReadableStore<T> {
  let source = a.get();
  let value = f(source);
  const listeners = new Set<() => void>();
  let off: (() => void) | null = null;
  const refresh = () => {
    const s = a.get();
    if (s === source) return false;
    source = s;
    const next = f(s);
    if (eq(next, value)) return false;
    value = next;
    return true;
  };
  return {
    get() {
      if (!off) refresh();
      return value;
    },
    subscribe(l) {
      listeners.add(l);
      if (!off) {
        refresh();
        off = a.subscribe(() => {
          if (refresh()) for (const x of [...listeners]) x();
        });
      }
      return () => {
        listeners.delete(l);
        if (listeners.size === 0 && off) {
          off();
          off = null;
        }
      };
    },
  };
}

/** A store that never changes (stubs and placeholders). */
export function constant<T>(value: T): ReadableStore<T> {
  return { get: () => value, subscribe: () => () => undefined };
}
