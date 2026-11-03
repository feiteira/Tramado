// System services of the memory platform (power, links, shortcuts, diagnostics).
import { PlatformError } from '../../core/errors';
import type { ConfirmText, Power, RustDiagnostics } from '../types';

export function createSystem(deps: { power: Power; version: string; pendingLinks: string[] }) {
  const opened: string[] = [];
  let shortcuts: Partial<Record<'important' | 'confused' | 'exam' | 'todo', string>> | null = null;
  return {
    opened,
    shortcuts: () => shortcuts,
    api: {
      async power(): Promise<Power> {
        return deps.power;
      },
      async openExternal(url: string, _text: ConfirmText): Promise<boolean> {
        if (!/^https:\/\//.test(url)) throw new PlatformError('INVALID', 'only https:// links open');
        opened.push(url);
        return true;
      },
      async setMarkerShortcuts(accelerators: Partial<Record<'important' | 'confused' | 'exam' | 'todo', string>> | null): Promise<void> {
        shortcuts = accelerators;
      },
      async takePendingLinks(): Promise<string[]> {
        return deps.pendingLinks.splice(0);
      },
      async diagnostics(): Promise<RustDiagnostics> {
        return {
          app: { version: deps.version, os: 'web', arch: 'wasm', webview: null, cpu: { avx2: false, fma: false, f16c: false } },
          sync: null,
          speech: { cpuOk: false, models: [], vad: false },
          ai: { lastCodes: [] },
          logTail: [],
        };
      },
    },
  };
}
