// Event hub of the memory platform: the same events Rust emits (architecture §7.1), raised by the fakes.
import type { ClassChangedEvent, MarkerKind, Picked, SyncEvent, TrayAction, Unsubscribe } from '../types';

export class Emitter<T> {
  private readonly handlers = new Set<(e: T) => void>();
  on(cb: (e: T) => void): Unsubscribe {
    this.handlers.add(cb);
    return () => {
      this.handlers.delete(cb);
    };
  }
  emit(e: T): void {
    for (const h of [...this.handlers]) {
      try {
        h(e);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

export function createEvents() {
  const classChanged = new Emitter<ClassChangedEvent>();
  const sync = new Emitter<SyncEvent>();
  const deepLink = new Emitter<{ url: string; text?: string }>();
  const shortcut = new Emitter<{ id: 'marker'; kind: MarkerKind }>();
  const tray = new Emitter<TrayAction>();
  const drop = new Emitter<{ picked: Picked[]; x: number; y: number }>();
  return {
    emitters: { classChanged, sync, deepLink, shortcut, tray, drop },
    api: {
      onClassChanged: (cb: (e: ClassChangedEvent) => void) => classChanged.on(cb),
      onSync: (cb: (e: SyncEvent) => void) => sync.on(cb),
      onDeepLink: (cb: (e: { url: string; text?: string }) => void) => deepLink.on(cb),
      onShortcut: (cb: (e: { id: 'marker'; kind: MarkerKind }) => void) => shortcut.on(cb),
      onTray: (cb: (action: TrayAction) => void) => tray.on(cb),
      onDrop: (cb: (e: { picked: Picked[]; x: number; y: number }) => void) => drop.on(cb),
    },
  };
}
export type MemoryEvents = ReturnType<typeof createEvents>;
