import React, { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx';
import { focusBackTo, pushLayer, useOpener } from '../focus';
import type { Align, Side } from '../position';
import { type Anchor, anchorElement, floatingStyle, useFloating } from './floating';
import './floating.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The element it hangs from, a fixed point (a right click), or a point that moves (see Anchor). */
  anchor: Anchor;
  side?: Side;
  align?: Align;
  children: ReactNode;
  className?: string;
  /** Adds the standard inner padding. */
  padded?: boolean;
  /** Focus the first focusable element inside on open (default true). */
  autoFocus?: boolean;
  role?: string;
  /** At least as wide as the anchor (a menu opened from a wide button). */
  matchAnchorWidth?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  id?: string;
}

/**
 * A box anchored to an element that flips to the other side when there is no room. Closes on
 * Escape and on a click outside, and gives the focus back to whatever had it when it opened.
 */
export function Popover({ open, onClose, anchor, side = 'bottom', align = 'start', children, className, padded, autoFocus = true, role = 'dialog', matchAnchorWidth, id, ...aria }: PopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const pos = useFloating(open, anchor, box, side, align);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tracked = useOpener(open);

  useEffect(() => {
    if (!open) return;
    const opener = tracked.opener;
    const layer = pushLayer();
    if (autoFocus) {
      // After layout, so the box is in place and focusing scrolls nothing.
      requestAnimationFrame(() => {
        const el = box.current;
        if (!el || el.contains(document.activeElement)) return;
        const first = el.querySelector<HTMLElement>('[data-autofocus], [role="menuitem"]:not([aria-disabled="true"]), input, button, [tabindex]:not([tabindex="-1"])');
        (first ?? el).focus({ preventScroll: true });
      });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && layer.isTop()) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t)) return;
      const a = anchorElement(anchor);
      // A click on the anchor toggles it: the anchor's own handler closes it.
      if (a?.contains(t)) return;
      if (layer.isTop()) closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      layer.pop();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      // Let React remove the box first, then return the focus if it was left adrift.
      setTimeout(() => focusBackTo(opener), 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const anchorWidth = matchAnchorWidth ? anchorElement(anchor)?.offsetWidth : undefined;
  return createPortal(
    <div
      ref={box}
      id={id}
      role={role}
      tabIndex={-1}
      className={cx('popover', padded && 'popover--padded', className)}
      style={{ ...floatingStyle(pos), minWidth: anchorWidth }}
      data-side={pos?.side}
      {...aria}
    >
      {children}
    </div>,
    document.body,
  );
}
