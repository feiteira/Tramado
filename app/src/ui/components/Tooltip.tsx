import React, { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { floatingStyle, useFloating } from './floating';
import type { Side } from '../position';
import './floating.css';

const SHOW_DELAY = 450;
// After one tooltip, the next appears at once while the pointer moves along a toolbar.
let warmUntil = 0;

/**
 * A short label shown on hover and on keyboard focus. The child keeps its own accessible name;
 * the tooltip is only a visual echo (plus the shortcut), so it is linked with aria-describedby
 * when it adds something.
 */
export function Tooltip({ label, shortcut, side = 'bottom', children }: { label: string; shortcut?: string; side?: Side; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const id = useId();
  const pos = useFloating(open, anchor, box, side, 'center', 6);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!isValidElement(children)) return children;
  const props = children.props as Record<string, unknown>;
  const chain = (name: string, fn: (e: React.SyntheticEvent) => void) => (e: React.SyntheticEvent) => {
    (props[name] as ((e: React.SyntheticEvent) => void) | undefined)?.(e);
    fn(e);
  };
  const show = (e: React.SyntheticEvent) => {
    anchor.current = e.currentTarget as HTMLElement;
    clearTimeout(timer.current);
    if (Date.now() < warmUntil) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), SHOW_DELAY);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (open) warmUntil = Date.now() + 600;
    setOpen(false);
  };
  const describes = shortcut || props['aria-label'] !== label;

  return (
    <>
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        onPointerEnter: chain('onPointerEnter', show),
        onPointerLeave: chain('onPointerLeave', hide),
        onFocus: chain('onFocus', (e) => {
          // Only keyboard focus: a click that focuses the button should not pop a label up.
          if ((e.currentTarget as HTMLElement).matches(':focus-visible')) show(e);
        }),
        onBlur: chain('onBlur', hide),
        onPointerDown: chain('onPointerDown', hide),
        'aria-describedby': open && describes ? id : (props['aria-describedby'] as string | undefined),
      })}
      {open
        ? createPortal(
            <div ref={box} id={id} role="tooltip" className="tooltip" style={floatingStyle(pos)}>
              <span>{label}</span>
              {shortcut ? <kbd className="tooltip__kbd">{shortcut}</kbd> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
