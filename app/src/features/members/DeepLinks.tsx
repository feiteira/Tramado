// Deep links and invite files (UX §3.12.3 entry points; architecture §7.1 `app:deep-link`): `tramado://join/<code>`,
// a `…/join/#<code>` page link, or the text of an opened `.tramado-invite` file open the Join dialog with the code
// filled in. Links that arrived before the window was ready are taken once at start-up. Renders nothing.
import { useEffect } from 'react';
import { findCode } from '../../core/sync/invite';
import type { AppServices } from '../../services/types/common';
import { useDialogs } from '../../shell/useDialogs';

/** The invite or pairing code in a deep link or an opened invite file's text, or null. */
export function codeOfLink(e: { url: string; text?: string }): string | null {
  for (const s of [e.text, e.url]) {
    if (!s) continue;
    let decoded = s;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      decoded = s;
    }
    const found = findCode(decoded);
    if (found) return found.code;
  }
  return null;
}

export default function DeepLinks({ services }: { services: AppServices }) {
  const { open } = useDialogs();
  useEffect(() => {
    const platform = services.ctx.platform;
    let live = true;
    const openCode = (code: string | null) => {
      if (live && code) open('join', { code });
    };
    void platform.system.takePendingLinks().then(
      (links) => {
        for (const l of links) {
          const code = codeOfLink(l.startsWith('tramado:') || l.includes('#') ? { url: l } : { url: 'file:', text: l });
          if (code) {
            openCode(code);
            break;
          }
        }
      },
      () => undefined,
    );
    const off = platform.events.onDeepLink((e) => openCode(codeOfLink(e)));
    return () => {
      live = false;
      off();
    };
  }, [services, open]);
  return null;
}
