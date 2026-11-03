// Window-level listeners run in the capture phase: a component that stops a keydown's
// propagation (a menu, a field handling Escape) must not hide typing from the idle timer or
// the global shortcuts.

const CAPTURE = { capture: true } as const;

/** Calls `onActivity` (throttled) whenever the person uses the keyboard, mouse or touch. */
export function watchActivity(onActivity: () => void): () => void {
  let last = 0;
  const handler = () => {
    const now = Date.now();
    if (now - last > 5000) {
      last = now;
      onActivity();
    }
  };
  const events = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
  for (const e of events) window.addEventListener(e, handler, { capture: true, passive: true });
  return () => {
    for (const e of events) window.removeEventListener(e, handler, CAPTURE);
  };
}

/** True while a modal (a dialog, or the Locking curtain) covers the screen. */
function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * Global keyboard shortcuts (Ctrl/Cmd + key). They work while typing in a field too. While a
 * modal is open only the keys in `overModals` run, so a shortcut cannot move away under a
 * dialog and throw away what was typed in it.
 */
export function watchShortcuts(map: Record<string, () => void>, overModals: readonly string[] = []): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const fn = map[key];
    if (fn) {
      e.preventDefault();
      if (!overModals.includes(key) && modalOpen()) return;
      fn();
    }
  };
  window.addEventListener('keydown', handler, CAPTURE);
  return () => window.removeEventListener('keydown', handler, CAPTURE);
}

const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !NOT_TEXT.has(target.type);
}

const arrowClaims = new Set<() => boolean>();

/**
 * Lets a screen take Alt+←/→ for itself while `active()` says so (the recording player while
 * it plays or has the focus, where Alt+← skips back). Back then leaves the key alone, without
 * cancelling it, for the screen's own handler. Returns the function that withdraws the claim.
 */
export function claimAltArrows(active: () => boolean): () => void {
  const claim = () => active();
  arrowClaims.add(claim);
  return () => arrowClaims.delete(claim);
}

/** True while a screen has claimed Alt+←/→ (see claimAltArrows). */
export function altArrowsClaimed(): boolean {
  for (const c of arrowClaims) if (c()) return true;
  return false;
}

/**
 * Calls `onBack` for Alt+Left and for the mouse's back button. Alt+Left is left alone while
 * the cursor is in a text field, where it moves between words on some systems, and while a
 * screen has claimed it. Neither goes back while a modal is open: that would close a dialog
 * and lose what was typed in it.
 */
export function watchBack(onBack: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (isTextField(e.target) || modalOpen() || altArrowsClaimed()) return;
    e.preventDefault();
    onBack();
  };
  // Button 3 is "back". Cancelling it also stops a browser from leaving the demo page.
  const onMouse = (e: MouseEvent) => {
    if (e.button !== 3) return;
    e.preventDefault();
    if (e.type === 'mouseup' && !modalOpen()) onBack();
  };
  window.addEventListener('keydown', onKey, CAPTURE);
  window.addEventListener('mousedown', onMouse, CAPTURE);
  window.addEventListener('mouseup', onMouse, CAPTURE);
  return () => {
    window.removeEventListener('keydown', onKey, CAPTURE);
    window.removeEventListener('mousedown', onMouse, CAPTURE);
    window.removeEventListener('mouseup', onMouse, CAPTURE);
  };
}
