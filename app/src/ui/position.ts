// Where a floating box (popover, menu, tooltip) goes next to its anchor. Pure, so it is tested
// without a browser: the components hand it rectangles measured from the DOM.

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Side = 'bottom' | 'top' | 'right' | 'left';
export type Align = 'start' | 'center' | 'end';

export interface Placement {
  top: number;
  left: number;
  side: Side;
  /** Height the box may take before it must scroll (it does not fit on either side). */
  maxHeight: number;
}

const OPPOSITE: Record<Side, Side> = { bottom: 'top', top: 'bottom', right: 'left', left: 'right' };

/** Keeps the window's edge this far from any floating box. */
export const EDGE = 8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, Math.max(lo, hi)));
}

/**
 * Places a box of `size` beside `anchor` on `side`, flipping to the opposite side when it does
 * not fit there but fits better on the other, then sliding along the edge to stay inside the
 * viewport. When neither side has room, the roomier one is used and `maxHeight` (or width, for
 * left/right) says how much of the box can show.
 */
export function place(anchor: Rect, size: Size, viewport: Size, side: Side = 'bottom', align: Align = 'start', gap = 6): Placement {
  const room = (s: Side): number => {
    switch (s) {
      case 'bottom':
        return viewport.height - (anchor.top + anchor.height) - gap - EDGE;
      case 'top':
        return anchor.top - gap - EDGE;
      case 'right':
        return viewport.width - (anchor.left + anchor.width) - gap - EDGE;
      case 'left':
        return anchor.left - gap - EDGE;
    }
  };
  const need = side === 'top' || side === 'bottom' ? size.height : size.width;
  let chosen = side;
  if (room(side) < need && room(OPPOSITE[side]) > room(side)) chosen = OPPOSITE[side];
  const vertical = chosen === 'top' || chosen === 'bottom';
  const available = Math.max(0, room(chosen));
  const height = vertical ? Math.min(size.height, available) : size.height;
  const width = vertical ? size.width : Math.min(size.width, available);

  let top: number;
  let left: number;
  if (vertical) {
    top = chosen === 'bottom' ? anchor.top + anchor.height + gap : anchor.top - gap - height;
    left = align === 'start' ? anchor.left : align === 'end' ? anchor.left + anchor.width - width : anchor.left + (anchor.width - width) / 2;
    left = clamp(left, EDGE, viewport.width - width - EDGE);
  } else {
    left = chosen === 'right' ? anchor.left + anchor.width + gap : anchor.left - gap - width;
    top = align === 'start' ? anchor.top : align === 'end' ? anchor.top + anchor.height - height : anchor.top + (anchor.height - height) / 2;
    top = clamp(top, EDGE, viewport.height - height - EDGE);
  }
  const maxHeight = vertical ? available : Math.max(0, viewport.height - 2 * EDGE);
  return { top: Math.round(top), left: Math.round(left), side: chosen, maxHeight: Math.floor(maxHeight) };
}

/** A point (a right click) as a zero-size anchor, for context menus. */
export const pointRect = (x: number, y: number): Rect => ({ top: y, left: x, width: 0, height: 0 });
