import React, { type HTMLAttributes, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import './feedback.css';

/** An indeterminate spinner. Decorative unless given a label. */
export function Spinner({ size = 16, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={cx('spinner', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Progress of a long job. `value` null is indeterminate. */
export function ProgressBar({ value, max = 1, label, className, ...rest }: { value: number | null; max?: number; label: string; className?: string; 'data-testid'?: string }) {
  const pct = value === null ? null : Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(pct)}
      className={cx('progress', pct === null && 'progress--indeterminate', className)}
      data-testid={rest['data-testid']}
    >
      <div className="progress__bar" style={pct === null ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

/** What an empty list or screen shows: what it is for, and the way to start. */
export function EmptyState({ icon: Icon, title, children, actions, className, ...rest }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string; 'data-testid'?: string }) {
  return (
    <div className={cx('empty', 'paper-grid', className)} data-testid={rest['data-testid']}>
      {Icon ? (
        <div className="empty__icon" aria-hidden>
          <Icon size={22} strokeWidth={1.5} />
        </div>
      ) : null}
      <h2 className="empty__title">{title}</h2>
      {children ? <div className="empty__body">{children}</div> : null}
      {actions ? <div className="empty__actions">{actions}</div> : null}
    </div>
  );
}

/** A key or key combination, e.g. <Kbd>Ctrl+K</Kbd>. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('kbd', className)}>{children}</kbd>;
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'ai' | 'mark' | 'rec';

/** A small label. `color` paints a code-coloured dot before the text. */
export function Badge({ children, tone = 'neutral', color, className, title }: { children: ReactNode; tone?: BadgeTone; color?: string; className?: string; title?: string }) {
  return (
    <span className={cx('badge', `badge--${tone}`, className)} title={title}>
      {color ? <span className="badge__dot" style={{ background: color }} aria-hidden /> : null}
      {children}
    </span>
  );
}

const NOTICE_ICON: Record<BadgeTone, LucideIcon> = { neutral: Info, info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert, ai: Info, mark: Info, rec: CircleAlert };

/** A message in the flow of a screen: an error, a warning, something to know. */
export function Notice({ tone = 'info', title, children, icon, actions, className, ...rest }: { tone?: BadgeTone; title?: ReactNode; children?: ReactNode; icon?: LucideIcon; actions?: ReactNode; className?: string; 'data-testid'?: string; [data: `data-${string}`]: string | number | boolean | undefined }) {
  const Icon = icon ?? NOTICE_ICON[tone];
  // INT: every data-* attribute reaches the element (`data-state`, `data-code` of tests and peek), not only the test id.
  const data = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-')));
  return (
    <div className={cx('notice', `notice--${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'} {...data}>
      <Icon size={16} aria-hidden className="notice__icon" strokeWidth={1.75} />
      <div className="notice__content">
        {title ? <div className="notice__title">{title}</div> : null}
        {children ? <div className="notice__body">{children}</div> : null}
      </div>
      {actions ? <div className="notice__actions">{actions}</div> : null}
    </div>
  );
}

/** A raised paper surface. */
export function Card({ children, className, padded = true, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean; 'data-testid'?: string }) {
  return (
    <div className={cx('card', padded && 'card--padded', className)} {...rest}>
      {children}
    </div>
  );
}

/** A titled part of a screen (a settings group, a panel of a dialog). */
export function Section({ title, description, actions, children, className, id, ...rest }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; id?: string; 'data-testid'?: string }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={cx('section', className)} aria-labelledby={title ? headingId : undefined} id={id} data-testid={rest['data-testid']}>
      {title || actions ? (
        <div className="section__header">
          <div className="section__titles">
            {title ? <h2 className="section__title" id={headingId}>{title}</h2> : null}
            {description ? <p className="section__description">{description}</p> : null}
          </div>
          {actions ? <div className="section__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A row of controls. role="toolbar" makes it one Tab stop when `roving` (arrow keys move inside). */
export function Toolbar({ children, label, className, roving = false, ...rest }: { children: ReactNode; label: string; className?: string; roving?: boolean; 'data-testid'?: string }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!roving || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [role="button"], input, select')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div role="toolbar" aria-label={label} className={cx('toolbar', className)} onKeyDown={onKeyDown} data-testid={rest['data-testid']}>
      {children}
    </div>
  );
}

/** Pushes the following toolbar items to the end. */
export const ToolbarSpacer = () => <span className="toolbar__spacer" />;
export const ToolbarDivider = () => <span className="toolbar__divider" role="separator" aria-orientation="vertical" />;
