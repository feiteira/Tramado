import React, { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { focusables, focusBackTo, overflowsY, pushLayer, trapTab, useOpener } from '../focus';
import { useI18n } from '../i18n';
import { IconButton } from './Button';
import './dialog.css';

export interface DialogProps {
  open: boolean;
  /** Escape, the close button and a click on the backdrop (when `dismissible`). */
  onClose: () => void;
  title: ReactNode;
  /** A line under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned at the bottom; the primary action last. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** False while something must not be interrupted (a save running): Esc and the backdrop do nothing. */
  dismissible?: boolean;
  /** Submitting the dialog's form (Enter in a field) calls this. */
  onSubmit?: () => void;
  className?: string;
  'data-testid'?: string;
}

/**
 * A modal dialog: focus moves in (to `[data-autofocus]`, else the first field, else the close
 * button, else the first button), Tab stays inside, Escape closes, and the focus returns to the control that opened it.
 * The page behind is inert, so screen readers and the keyboard cannot wander there.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', dismissible = true, onSubmit, className, ...rest }: DialogProps) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tracked = useOpener(open);
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;
  // A body taller than the dialog scrolls; it joins the Tab order then (a named region), so the
  // keyboard can scroll it even when it holds nothing focusable (the shortcuts list).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!open || !el) return;
    const check = () => setScrolls(overflowsY(el));
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [open, children]);

  useEffect(() => {
    if (!open) return;
    const opener = tracked.opener;
    const layer = pushLayer();
    const root = document.getElementById('root');
    // Only the first dialog marks the page inert; nested ones live in the body beside it.
    const madeInert = root && !root.hasAttribute('inert');
    if (madeInert) root.setAttribute('inert', '');
    const el = box.current;
    if (el) {
      // A dialog without fields starts on its close button: focusing an action could confirm
      // it with a stray Enter, and focusing the box itself draws a ring around the whole dialog.
      const all = focusables(el);
      const target =
        el.querySelector<HTMLElement>('[data-autofocus]') ??
        all.find((x) => x.matches('input, textarea, select')) ??
        all.find((x) => !!x.closest('.dialog__close')) ??
        all[0] ??
        el;
      target.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (!layer.isTop()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (dismissRef.current) closeRef.current();
      } else if (e.key === 'Tab' && box.current) {
        trapTab(e, box.current);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      layer.pop();
      window.removeEventListener('keydown', onKey, true);
      if (madeInert) root.removeAttribute('inert');
      setTimeout(() => focusBackTo(opener), 0);
    };
  }, [open]);

  if (!open) return null;
  const body = (
    <>
      <header className="dialog__header">
        <div className="dialog__titles">
          <h2 id={titleId} className="dialog__title">{title}</h2>
          {description ? <p id={descId} className="dialog__description">{description}</p> : null}
        </div>
        {dismissible ? (
          <IconButton className="dialog__close" icon={X} label={t('common.close')} size="sm" onClick={onClose} data-testid="dialog-close" />
        ) : null}
      </header>
      {children ? (
        <div
          ref={bodyRef}
          className="dialog__body"
          tabIndex={scrolls ? 0 : undefined}
          role={scrolls ? 'region' : undefined}
          aria-labelledby={scrolls ? titleId : undefined}
          data-testid="dialog-body"
        >
          {children}
        </div>
      ) : null}
      {footer ? <footer className="dialog__footer">{footer}</footer> : null}
    </>
  );
  return createPortal(
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && dismissRef.current) closeRef.current();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx('dialog', `dialog--${size}`, className)}
        data-testid={rest['data-testid']}
      >
        {onSubmit ? (
          <form
            className="dialog__form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>,
    document.body,
  );
}
