import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { type Align, place, type Placement, type Rect, type Side } from '../position';

/**
 * What a floating box hangs from:
 * - an element (a ref), followed as it moves;
 * - a fixed rectangle in viewport coordinates (a right-click point), which stays put;
 * - a function returning the rectangle now (a point inside scrolling content), asked again on
 *   every scroll and resize so the box moves with it. Keep its identity stable (useCallback)
 *   while the point is the same; a new function re-measures.
 */
export type Anchor = RefObject<HTMLElement | null> | Rect | (() => Rect | null) | null;

/** The anchor's element, when it is one. */
export function anchorElement(anchor: Anchor): HTMLElement | null {
  return anchor && typeof anchor !== 'function' && 'current' in anchor ? anchor.current : null;
}

/** The anchor's rectangle in viewport coordinates now, or null when it is not on the page. */
export function anchorRect(anchor: Anchor): Rect | null {
  if (!anchor) return null;
  if (typeof anchor === 'function') return anchor();
  if ('current' in anchor) return anchor.current?.getBoundingClientRect() ?? null;
  return anchor;
}

/**
 * Positions `floating` next to `anchor` while `open`, and again when the window resizes or
 * anything scrolls. Before the first measurement the box is placed off-screen, so it never
 * flashes at 0,0.
 */
export function useFloating(
  open: boolean,
  anchor: Anchor,
  floating: RefObject<HTMLElement | null>,
  side: Side = 'bottom',
  align: Align = 'start',
  gap = 6,
): Placement | null {
  const [pos, setPos] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = floating.current;
      const a = anchorRect(anchor);
      if (!el || !a) return;
      // Measure at natural size: a previous maxHeight must not shrink what we measure.
      const prevMax = el.style.maxHeight;
      el.style.maxHeight = '';
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      el.style.maxHeight = prevMax;
      const next = place(
        { top: a.top, left: a.left, width: a.width, height: a.height },
        size,
        { width: window.innerWidth, height: window.innerHeight },
        side,
        align,
        gap,
      );
      setPos((cur) => (cur && cur.top === next.top && cur.left === next.left && cur.side === next.side && cur.maxHeight === next.maxHeight ? cur : next));
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (floating.current) ro?.observe(floating.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
    // A rectangle anchor is compared by value, so a new object for the same point does not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchor && (typeof anchor === 'function' || 'current' in anchor) ? anchor : JSON.stringify(anchor), floating, side, align, gap]);
  return pos;
}

/** Styles for a floating box from its placement. */
export function floatingStyle(pos: Placement | null): CSSProperties {
  return pos
    ? { position: 'fixed', top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
    : { position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' };
}
