// Global events of architecture §7.1 (`listen` from @tauri-apps/api/event). Unsubscribe is synchronous:
// the unlisten promise is awaited behind the scenes.
import { listen } from '@tauri-apps/api/event';
import type { ClassChangedEvent, MarkerKind, Picked, Platform, SyncEvent, TrayAction, Unsubscribe } from '../types';

function on<T>(event: string, cb: (payload: T) => void): Unsubscribe {
  let off: (() => void) | null = null;
  let done = false;
  void listen<T>(event, (e) => cb(e.payload)).then((u) => {
    if (done) u();
    else off = u;
  });
  return () => {
    done = true;
    off?.();
  };
}

export function createEventBindings(): Platform['events'] {
  return {
    onClassChanged: (cb) => on<ClassChangedEvent>('class:changed', cb),
    onSync: (cb) => on<SyncEvent>('sync:event', cb),
    onDeepLink: (cb) => on<{ url: string; text?: string }>('app:deep-link', cb),
    onShortcut: (cb) => on<{ id: 'marker'; kind: MarkerKind }>('app:shortcut', cb),
    onTray: (cb) => on<{ action: TrayAction }>('app:tray', (p) => cb(p.action)),
    onDrop: (cb) => on<{ picked: Picked[]; x: number; y: number }>('app:drop', cb),
  };
}
