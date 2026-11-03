import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { cx } from '../cx';
import { useI18n } from '../i18n';
import { problemKey } from '../problems';
import './toast.css';

// One short message at a time at the bottom of the window, often with an action ("Code
// deleted · Undo"). A new message replaces the one showing. Screen readers hear it through a
// polite live region; the action and the close button are in the Tab order, and the timer
// pauses while the pointer or keyboard focus is on it. If the toast closes under the focus,
// the focus goes back where it came from (adapted from Sala's Toast).

export interface ToastOptions {
  message: string;
  tone?: 'neutral' | 'success' | 'danger';
  /** A button on the toast, such as Undo. */
  action?: { label: string; run: () => void | Promise<unknown>; testId?: string };
  /** How long it shows, paused while hovered or focused. Default 6 s, 10 s with an action. */
  durationMs?: number;
}

export interface Toasts {
  show: (toast: ToastOptions | string) => number;
  /** A failure, in the reader's language, with the technical message appended. */
  error: (e: unknown) => number;
  dismiss: (id?: number) => void;
}

interface Current extends ToastOptions {
  id: number;
}

const Ctx = createContext<Toasts | null>(null);
let seq = 0;

export function useToast(): Toasts {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toast, setToast] = useState<Current | null>(null);
  const api = useMemo<Toasts>(
    () => ({
      show: (o) => {
        const id = ++seq;
        setToast(typeof o === 'string' ? { message: o, id } : { ...o, id });
        return id;
      },
      error: (e) => {
        const id = ++seq;
        console.error(e);
        const known = problemKey(e);
        const message = e instanceof Error ? e.message : String(e);
        setToast({ message: known ? t(known) : t('common.unknownError', { message }), tone: 'danger', id });
        return id;
      },
      dismiss: (id) => setToast((cur) => (id === undefined || cur?.id === id ? null : cur)),
    }),
    [t],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastHost toast={toast} dismiss={api.dismiss} fail={api.error} />
    </Ctx.Provider>
  );
}

function ToastHost({ toast, dismiss, fail }: { toast: Current | null; dismiss: (id?: number) => void; fail: (e: unknown) => void }) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const paused = hovered || focused;
  const id = toast?.id;
  const duration = toast?.durationMs ?? (toast?.action ? 10_000 : 6_000);

  // A toast removed under the pointer or focus never hears it leave.
  useEffect(() => {
    setHovered(false);
    setFocused(false);
  }, [id]);

  useEffect(() => {
    if (id === undefined || paused) return;
    const timer = setTimeout(() => close(id), duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, paused, duration]);

  function close(which: number) {
    const el = box.current;
    if (el && el.contains(document.activeElement) && origin.current?.isConnected) origin.current.focus();
    dismiss(which);
  }

  const Icon = toast?.tone === 'danger' ? CircleAlert : toast?.tone === 'success' ? CircleCheck : null;
  // In the body, beside #root: a dialog makes #root inert, and the toast must stay usable.
  return createPortal(
    <div className="toast-region" aria-live="polite" aria-atomic="true">
      {toast ? (
        <div
          key={toast.id}
          ref={box}
          className={cx('toast', toast.tone && `toast--${toast.tone}`)}
          data-testid="toast"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={(e) => {
            if (!focused && e.relatedTarget instanceof HTMLElement && !box.current?.contains(e.relatedTarget)) origin.current = e.relatedTarget;
            setFocused(true);
          }}
          onBlur={(e) => {
            if (!box.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close(toast.id);
            }
          }}
        >
          {Icon ? <Icon size={16} aria-hidden className="toast__icon" /> : null}
          <span className="toast__message">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast__action"
              data-testid={toast.action.testId ?? 'toast-action'}
              onClick={() => {
                const run = toast.action!.run;
                close(toast.id);
                void Promise.resolve()
                  .then(run)
                  .catch((e: unknown) => fail(e));
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" className="toast__close" aria-label={t('common.close')} onClick={() => close(toast.id)}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
