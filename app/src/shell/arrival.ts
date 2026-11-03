// Where the keyboard focus goes when the screen changes under it. Unlocking, opening a project,
// opening a segment in its document or pressing "Import documents" removes the control that had
// the focus, and the browser drops it on <body>: a screen reader announces nothing and the next
// Tab starts at the top of the window. After such a change the focus goes to the new screen's
// heading (or, going Back, to the control that had it when the researcher left). A change that
// leaves the focus somewhere real (a rail button, a field the screen focused itself) is left
// alone.

/** The minimal element surface the helpers read (tests pass plain objects). */
interface Attrs {
  getAttribute(name: string): string | null;
}

/** Attributes that tell one item of a list from its neighbours, most specific first. */
// Tramado: the identity attributes of UX §0.3.
const KEYS = ['data-class-id', 'data-lecture-id', 'data-doc-path', 'data-exam-id', 'data-question-id', 'data-message-id', 'data-member-id', 'data-device-id', 'data-segment-id', 'data-thread-id', 'data-index'];

const esc = (s: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

/**
 * A selector that finds `el` again once its screen is rebuilt: its test id, plus the attribute
 * naming which item it is. Null for an element without a test id (nothing stable to find).
 */
export function selectorFor(el: Attrs | null): string | null {
  const id = el?.getAttribute('data-testid');
  if (!el || !id) return null;
  let sel = `[data-testid="${esc(id)}"]`;
  for (const k of KEYS) {
    const v = el.getAttribute(k);
    if (v) {
      sel += `[${k}="${esc(v)}"]`;
      break;
    }
  }
  return sel;
}

/**
 * True when the focus is nowhere useful: on <body>, gone with the screen that held it, or on a
 * control no longer shown (React hides the old screen while the next one loads).
 */
export function focusAdrift(doc: Document = document): boolean {
  const a = doc.activeElement;
  return !a || a === doc.body || a === doc.documentElement || !a.isConnected || a.getClientRects().length === 0;
}

/** Focuses a heading without adding it to the Tab order. */
function focusHeading(h: HTMLElement): void {
  if (!h.hasAttribute('tabindex')) h.tabIndex = -1;
  h.focus({ preventScroll: true });
}

const visible = (el: Element): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0 && !el.closest('[inert]');

let pending = 0;

/**
 * Once the new screen has rendered (screens load lazily, so this waits up to `waitMs`), and
 * only while the focus is adrift: focus `restore` if it matches, else the screen's first
 * visible heading inside `scope`. A newer call cancels an older one.
 */
export function arriveFocus(opts: { scope?: string; restore?: string | null; waitMs?: number } = {}): void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  const run = ++pending;
  const started = performance.now();
  const waitMs = opts.waitMs ?? 1500;
  // A control to restore gets a moment longer to appear than a heading takes.
  const restoreMs = 600;
  const tick = () => {
    if (run !== pending || !focusAdrift()) return;
    const elapsed = performance.now() - started;
    const scope = (opts.scope && document.querySelector(opts.scope)) || document;
    if (opts.restore) {
      const el = scope.querySelector(opts.restore);
      if (el && visible(el)) return el.focus({ preventScroll: false });
    }
    if (!opts.restore || elapsed > restoreMs) {
      const h = [...scope.querySelectorAll('h1')].find(visible);
      if (h) return focusHeading(h);
    }
    if (elapsed < waitMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
