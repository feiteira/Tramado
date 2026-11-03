import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../cx';
import { clampSplit, loadSplit, saveSplit } from '../splitSize';
import './splitpane.css';

export interface SplitPaneProps {
  /** The first pane (left, or top when vertical). */
  first: ReactNode;
  second: ReactNode;
  direction?: 'horizontal' | 'vertical';
  /**
   * Which pane has the controlled size (default the first). The other one takes the rest, so
   * a sized second pane (a side panel on the right) keeps its width while the window grows.
   */
  sized?: 'first' | 'second';
  /** Default size of the sized pane in px. */
  initial: number;
  min?: number;
  max?: number;
  /** Space the other pane always keeps. */
  minRest?: number;
  /** Remembers the size under this key (per device). */
  storageKey?: string;
  /** Accessible name of the divider, e.g. "Resize the code list". */
  label: string;
  className?: string;
  'data-testid'?: string;
  /** Test id of the divider. */
  handleTestId?: string;
}

const STEP = 16;

/**
 * Two panes with a draggable divider. The divider is a focusable separator: arrow keys move it
 * in steps (Shift for larger), Home/End move it to either end, double-click resets.
 */
export function SplitPane({
  first, second, direction = 'horizontal', sized = 'first', initial, min = 160, max = 800, minRest = 240, storageKey, label, className, handleTestId, ...rest
}: SplitPaneProps) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => (storageKey ? loadSplit(storageKey, initial) : initial));
  const [total, setTotal] = useState<number | undefined>(undefined);
  const horizontal = direction === 'horizontal';
  const end = sized === 'second';
  const limits = { min, max, total, minRest };
  const shown = clampSplit(size, limits);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTotal(horizontal ? el.clientWidth : el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [horizontal]);

  const commit = useCallback(
    (next: number) => {
      const v = clampSplit(next, { min, max, total, minRest });
      setSize(v);
      if (storageKey) saveSplit(storageKey, v);
    },
    [min, max, total, minRest, storageKey],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add(horizontal ? 'is-resizing-x' : 'is-resizing-y');
    // The sized pane's extent: from the start edge to the pointer, or from the pointer to the end edge.
    const at = (ev: PointerEvent) => {
      const p = horizontal ? ev.clientX : ev.clientY;
      if (end) return (horizontal ? box.right : box.bottom) - p;
      return p - (horizontal ? box.left : box.top);
    };
    const move = (ev: PointerEvent) => setSize(clampSplit(at(ev), { min, max, total: horizontal ? box.width : box.height, minRest }));
    const up = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing-x', 'is-resizing-y');
      commit(at(ev));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const fwd = horizontal ? 'ArrowRight' : 'ArrowDown';
    // Keys move the divider; a divider before the pane it sizes grows that pane moving back.
    const sign = end ? -1 : 1;
    if (e.key === back) commit(shown - sign * step);
    else if (e.key === fwd) commit(shown + sign * step);
    else if (e.key === 'Home') commit(end ? max : min);
    else if (e.key === 'End') commit(end ? min : max);
    else return;
    e.preventDefault();
  };

  const sizeStyle = horizontal ? { width: shown } : { height: shown };
  return (
    <div ref={root} className={cx('split', `split--${direction}`, end && 'split--sized-second', className)} data-testid={rest['data-testid']}>
      <div className="split__pane split__pane--first" style={end ? undefined : sizeStyle}>
        {first}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-label={label}
        aria-valuenow={shown}
        aria-valuemin={min}
        aria-valuemax={clampSplit(max, limits)}
        className="split__handle"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => commit(initial)}
        data-testid={handleTestId}
      />
      <div className="split__pane split__pane--second" style={end ? sizeStyle : undefined}>
        {second}
      </div>
    </div>
  );
}
