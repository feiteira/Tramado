// Bindings of architecture §6.5 (commands/system.rs), notifications and the window (Trama pattern:
// onCloseRequested → preventDefault → handler → hide / quit).
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { Platform, Power, RustDiagnostics } from '../types';
import { call } from './index';

export function createSystemBindings(): Platform['system'] {
  return {
    power: () => call<Power>('system_power'),
    openExternal: (url, text) => call<boolean>('open_external', { url, text }),
    setMarkerShortcuts: (accelerators) => call<void>('shortcut_set_markers', { accelerators }),
    takePendingLinks: () => call<string[]>('app_take_pending_links'),
    diagnostics: () => call<RustDiagnostics>('diag_collect'),
  };
}

export function createNotificationBindings(): Platform['notifications'] {
  return { show: (n) => call<void>('notify_show', { n }) };
}

export function createWindowBindings(): Platform['window'] {
  let handler: (() => Promise<'hide' | 'quit' | 'stay'>) | null = null;
  let listening = false;
  const listen = () => {
    if (listening) return;
    listening = true;
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      const what = handler ? await handler().catch(() => 'quit' as const) : 'quit';
      if (what === 'hide') await getCurrentWindow().hide();
      else if (what === 'quit') await call<void>('app_quit');
    });
  };
  return {
    setTitle: (title) => getCurrentWindow().setTitle(title),
    onCloseRequested(h) {
      handler = h;
      listen();
      return () => {
        if (handler === h) handler = null;
      };
    },
    show: () => getCurrentWindow().show(),
    hide: () => getCurrentWindow().hide(),
    quit: () => call<void>('app_quit'),
    setBackgroundMode: (mode) => call<void>('app_set_background_mode', { mode }),
    setZoom: (factor) => getCurrentWebview().setZoom(factor),
    autostart: {
      get: () => call<boolean>('app_autostart_get'),
      set: (enabled) => call<void>('app_autostart_set', { enabled }),
    },
  };
}
