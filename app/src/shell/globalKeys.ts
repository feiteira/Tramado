// The global keyboard map of UX §2.10 as a pure function (Layout listens; screens own their own keys).
// Ctrl/⌘ means Ctrl on Windows and Linux and ⌘ on macOS: either modifier is accepted.

export type GlobalAction =
  | { kind: 'palette' } | { kind: 'record' } | { kind: 'settings' } | { kind: 'today' } | { kind: 'join' }
  | { kind: 'class'; n: number } | { kind: 'back' } | { kind: 'shortcuts' };

export interface KeyLike { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

/**
 * The action of a key press, or null. `inText`: focus is in a text field (`isTextEntry`); `overModal`: a dialog or
 * the palette is open. Ctrl/⌘+K, +Shift+R and the others are "not over modals"; Ctrl/⌘+, and +Shift+H are global but
 * a modal still keeps them (the shell never navigates under an open dialog); ? and Alt+← are "not in text".
 */
export function globalAction(e: KeyLike, ctx: { inText: boolean; overModal: boolean; screenClaimsAltArrows?: boolean }): GlobalAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (ctx.overModal) return null;
  if (mod && !e.altKey) {
    if (!e.shiftKey && key === 'k') return { kind: 'palette' };
    if (e.shiftKey && (key === 'r' || e.code === 'KeyR')) return { kind: 'record' };
    if (e.shiftKey && (key === 'h' || e.code === 'KeyH')) return { kind: 'today' };
    if (e.shiftKey && (key === 'j' || e.code === 'KeyJ')) return { kind: 'join' };
    if (!e.shiftKey && (key === ',' || e.code === 'Comma')) return { kind: 'settings' };
    if (!e.shiftKey) {
      const digit = /^Digit([1-9])$/.exec(e.code ?? '')?.[1] ?? (/^[1-9]$/.test(key) ? key : null);
      if (digit) return { kind: 'class', n: Number(digit) };
    }
    return null;
  }
  if (e.key === 'F1' && !mod && !e.altKey) return { kind: 'shortcuts' };
  if (!ctx.inText && !mod && !e.altKey && e.key === '?') return { kind: 'shortcuts' };
  if (!ctx.inText && e.altKey && !mod && !e.shiftKey && e.key === 'ArrowLeft' && !ctx.screenClaimsAltArrows) return { kind: 'back' };
  return null;
}
