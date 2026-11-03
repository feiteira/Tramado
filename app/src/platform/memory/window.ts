// Window control of the memory platform: the demo uses CSS zoom for text size (UX §8 OQ9).
import type { Unsubscribe } from '../types';

export function createWindow() {
  let closeHandler: (() => Promise<'hide' | 'quit' | 'stay'>) | null = null;
  let autostart = false;
  const state = { title: '', visible: true, zoom: 1, background: { trayOnClose: true, sharedClasses: 0 }, quit: false };
  return {
    state,
    /** Test helper: what the window's close button would do. */
    async requestClose(): Promise<'hide' | 'quit' | 'stay'> {
      const r = closeHandler ? await closeHandler() : 'quit';
      if (r === 'hide') state.visible = false;
      if (r === 'quit') state.quit = true;
      return r;
    },
    api: {
      async setTitle(title: string): Promise<void> {
        state.title = title;
        if (typeof document !== 'undefined') document.title = title;
      },
      onCloseRequested(handler: () => Promise<'hide' | 'quit' | 'stay'>): Unsubscribe {
        closeHandler = handler;
        return () => {
          if (closeHandler === handler) closeHandler = null;
        };
      },
      async show(): Promise<void> {
        state.visible = true;
      },
      async hide(): Promise<void> {
        state.visible = false;
      },
      async quit(): Promise<void> {
        state.quit = true;
      },
      async setBackgroundMode(m: { trayOnClose: boolean; sharedClasses: number }): Promise<void> {
        state.background = m;
      },
      async setZoom(factor: 0.875 | 1 | 1.125 | 1.25 | 1.5): Promise<void> {
        state.zoom = factor;
        if (typeof document !== 'undefined') (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(factor);
      },
      autostart: {
        async get(): Promise<boolean> {
          return autostart;
        },
        async set(enabled: boolean): Promise<void> {
          autostart = enabled;
        },
      },
    },
  };
}
