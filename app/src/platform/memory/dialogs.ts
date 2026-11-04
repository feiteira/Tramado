// Dialogs answered from a queue (tests and the demo's queueAnswer hook), as opaque pick tokens (D-4).
import { PlatformError } from '../../core/errors';
import type { FileFilter, Picked, PickToken } from '../types';

export type DialogAnswer = { picks: Array<{ name: string; bytes: Uint8Array; isDir?: boolean }> } | { cancel: true };

export interface PickEntry { token: PickToken; name: string; bytes: Uint8Array | null; isDir: boolean; kind: 'open' | 'save' | 'folder' }

export function createDialogs(rand: () => number) {
  const queue: DialogAnswer[] = [];
  const picks = new Map<PickToken, PickEntry>();
  const token = () => Array.from({ length: 16 }, () => Math.floor(rand() * 256).toString(16).padStart(2, '0')).join('');
  const register = (name: string, bytes: Uint8Array | null, isDir: boolean, kind: PickEntry['kind']): Picked => {
    const t = token();
    picks.set(t, { token: t, name, bytes, isDir, kind });
    return { token: t, name, path: `/home/demo/${name}`, size: bytes ? bytes.length : null, isDir };
  };
  const next = (): DialogAnswer => queue.shift() ?? { cancel: true };
  return {
    queue: (a: DialogAnswer) => void queue.push(a),
    register,
    resolve(t: PickToken, expect?: PickEntry['kind']): PickEntry {
      const p = picks.get(t);
      if (!p || (expect && p.kind !== expect)) throw new PlatformError('INVALID', 'unknown or expired pick token');
      return p;
    },
    api: {
      async pickFiles(_req: { title: string; filters: FileFilter[]; multiple: boolean }): Promise<Picked[]> {
        const a = next();
        if ('cancel' in a) return [];
        return a.picks.filter((p) => !p.isDir).map((p) => register(p.name, p.bytes, false, 'open'));
      },
      async pickFolder(_req: { title: string }): Promise<Picked | null> {
        const a = next();
        if ('cancel' in a) return null;
        const p = a.picks[0];
        return p ? register(p.name, null, true, 'folder') : null;
      },
      async save(req: { title: string; defaultName: string; filters: FileFilter[] }): Promise<Picked | null> {
        const a = next();
        if ('cancel' in a) return null;
        return register(a.picks[0]?.name ?? req.defaultName, null, false, 'save');
      },
      async saveText(req: { title: string; defaultName: string; filters: FileFilter[] }, text: string): Promise<boolean> {
        // The browser demo hands the browser a file (Downloads); tests answer from the queue and keep the bytes.
        if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
          const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = req.defaultName;
          a.rel = 'noopener';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          return true;
        }
        const a = next();
        if ('cancel' in a) return false;
        register(a.picks[0]?.name ?? req.defaultName, new TextEncoder().encode(text), false, 'save');
        return true;
      },
    },
  };
}
export type MemoryDialogs = ReturnType<typeof createDialogs>;
