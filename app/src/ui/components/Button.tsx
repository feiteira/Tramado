import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Spinner } from './Feedback';
import { Tooltip } from './Tooltip';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** An icon after the label (a menu's chevron). */
  iconEnd?: LucideIcon;
  /** Shows a spinner and ignores clicks, keeping the button's width. */
  busy?: boolean;
  children?: ReactNode;
  'data-testid'?: string;
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconEnd: IconEnd, busy = false, className, children, type = 'button', disabled, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, busy && 'btn--busy', !children && 'btn--icon-only', className)}
      disabled={disabled}
      aria-busy={busy || undefined}
      // A busy button stays focusable (focus is not thrown to the page) but does nothing.
      onClick={busy ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {busy ? <Spinner size={ICON_SIZE[size]} /> : Icon ? <Icon size={ICON_SIZE[size]} aria-hidden strokeWidth={1.75} /> : null}
      {children != null ? <span className="btn__label">{children}</span> : null}
      {IconEnd ? <IconEnd size={ICON_SIZE[size]} aria-hidden strokeWidth={1.75} className="btn__end" /> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Accessible name and tooltip. */
  label: string;
  /** A keyboard shortcut shown in the tooltip, e.g. "Ctrl+Z". */
  shortcut?: string;
  variant?: 'ghost' | 'secondary' | 'danger';
  size?: ButtonSize;
  /** Pressed state, for toggles (aria-pressed). */
  pressed?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Shows a spinner in place of the icon and ignores clicks. */
  busy?: boolean;
  'data-testid'?: string;
}

/** A square button with only an icon: its label is its accessible name and its tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, shortcut, variant = 'ghost', size = 'md', pressed, className, type = 'button', tooltipSide = 'bottom', busy = false, onClick, ...rest },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        aria-busy={busy || undefined}
        className={cx('btn', `btn--${variant}`, `btn--${size}`, 'btn--icon-only', pressed && 'btn--pressed', busy && 'btn--busy', className)}
        onClick={busy ? (e) => e.preventDefault() : onClick}
        {...rest}
      >
        {busy ? <Spinner size={ICON_SIZE[size]} /> : <Icon size={ICON_SIZE[size]} aria-hidden strokeWidth={1.75} />}
      </button>
    </Tooltip>
  );
});
