import React, { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type RefObject } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { pointRect, type Align, type Rect, type Side } from '../position';
import { Button, type ButtonSize, type ButtonVariant, IconButton } from './Button';
import type { Anchor } from './floating';
import { Popover } from './Popover';

export interface MenuItem {
  kind?: 'item';
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Right-aligned hint: a shortcut, a count. */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Shows a tick (menuitemcheckbox / radio-like choices). */
  checked?: boolean;
  onSelect: () => void;
  testId?: string;
}

export type MenuEntry = MenuItem | { kind: 'separator'; id?: string } | { kind: 'heading'; id?: string; label: string };

const isItem = (e: MenuEntry): e is MenuItem => e.kind === undefined || e.kind === 'item';

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  anchor: Anchor;
  items: MenuEntry[];
  side?: Side;
  align?: Align;
  label?: string;
  id?: string;
  matchAnchorWidth?: boolean;
  'data-testid'?: string;
}

/**
 * A list of actions. Arrow keys move (wrapping), Home/End jump, a letter jumps to the next item
 * starting with it, Enter or Space chooses, Escape or Tab closes.
 */
export function Menu({ open, onClose, anchor, items, side = 'bottom', align = 'start', label, id, matchAnchorWidth, ...rest }: MenuProps) {
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const enabled = items.map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0);
  // Labels line up in one column: items without a tick or an icon keep the room for one.
  const hasChecks = items.some((x) => isItem(x) && x.checked !== undefined);
  const hasIcons = items.some((x) => isItem(x) && x.icon !== undefined);

  useEffect(() => {
    if (open) setActive(enabled[0] ?? -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus({ preventScroll: false });
  }, [open, active]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    onClose();
    // After the menu is gone, so a dialog the action opens takes the focus cleanly.
    setTimeout(item.onSelect, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pos = enabled.indexOf(active);
    const move = (to: number) => {
      e.preventDefault();
      const n = enabled.length;
      if (n) setActive(enabled[((to % n) + n) % n]!);
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(pos + 1);
      case 'ArrowUp':
        return move(pos < 0 ? -1 : pos - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(enabled.length - 1);
      case 'Tab':
        e.preventDefault();
        return onClose();
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const item = items[active];
        if (item && isItem(item)) choose(item);
        return;
      }
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const ch = e.key.toLocaleLowerCase();
          const order = [...enabled.slice(pos + 1), ...enabled.slice(0, pos + 1)];
          const hit = order.find((i) => (items[i] as MenuItem).label.toLocaleLowerCase().startsWith(ch));
          if (hit !== undefined) {
            e.preventDefault();
            setActive(hit);
          }
        }
    }
  };

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} side={side} align={align} role="presentation" autoFocus={false} matchAnchorWidth={matchAnchorWidth}>
      <div ref={list} role="menu" aria-label={label} id={id} className="menu" onKeyDown={onKeyDown} data-testid={rest['data-testid']}>
        {items.map((entry, i) => {
          if (entry.kind === 'separator') return <div key={entry.id ?? `sep-${i}`} role="separator" className="menu__sep" />;
          if (entry.kind === 'heading') return <div key={entry.id ?? `h-${i}`} role="presentation" className="menu__heading">{entry.label}</div>;
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              role={entry.checked !== undefined ? 'menuitemradio' : 'menuitem'}
              aria-checked={entry.checked}
              aria-disabled={entry.disabled || undefined}
              tabIndex={-1}
              data-index={i}
              data-active={i === active}
              data-testid={entry.testId}
              className={cx('menu__item', entry.danger && 'menu__item--danger')}
              onPointerMove={() => !entry.disabled && active !== i && setActive(i)}
              onClick={() => choose(entry)}
            >
              {hasChecks ? <span className="menu__check">{entry.checked ? <Check size={15} aria-hidden /> : null}</span> : null}
              {Icon ? <Icon size={15} aria-hidden strokeWidth={1.75} /> : hasIcons ? <span className="menu__icon" aria-hidden /> : null}
              <span className="menu__label">{entry.label}</span>
              {entry.hint ? <span className="menu__hint">{entry.hint}</span> : null}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

export interface MenuButtonProps {
  items: MenuEntry[];
  label: string;
  icon?: LucideIcon;
  /** Only the icon shows; `label` becomes its tooltip and accessible name. */
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  side?: Side;
  align?: Align;
  className?: string;
  disabled?: boolean;
  /** Something the menu started is running: a spinner shows and the menu does not open. */
  busy?: boolean;
  'data-testid'?: string;
}

/** A button that opens a menu (aria-haspopup). ArrowDown on the button opens it too. */
export function MenuButton({ items, label, icon, iconOnly, variant = 'secondary', size = 'md', side = 'bottom', align = 'start', className, disabled = false, busy = false, ...rest }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const blocked = disabled || busy;
  // A menu left open over a control that has just become unavailable would act on it anyway.
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);
  const common = {
    ref,
    className,
    disabled,
    busy,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => !blocked && setOpen((o) => !o),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' && !blocked) {
        e.preventDefault();
        setOpen(true);
      }
    },
    'data-testid': rest['data-testid'],
  };
  return (
    <>
      {iconOnly && icon ? (
        <IconButton {...common} icon={icon} label={label} variant={variant === 'primary' ? 'secondary' : variant} size={size} />
      ) : (
        <Button {...common} icon={icon} iconEnd={ChevronDown} variant={variant} size={size}>
          {label}
        </Button>
      )}
      <Menu open={open && !blocked} onClose={() => setOpen(false)} anchor={ref} items={items} side={side} align={align} label={label} id={menuId} />
    </>
  );
}

/**
 * Right-click menu around one element. The keyboard opens it too (the Menu key or Shift+F10),
 * at the element.
 */
export function ContextMenu({ items, children, label, disabled }: { items: MenuEntry[] | (() => MenuEntry[]); children: ReactElement; label?: string; disabled?: boolean }) {
  const [at, setAt] = useState<Rect | null>(null);
  const [entries, setEntries] = useState<MenuEntry[]>([]);
  const openAt = useCallback(
    (r: Rect) => {
      setEntries(typeof items === 'function' ? items() : items);
      setAt(r);
    },
    [items],
  );
  if (!isValidElement(children)) return children;
  const props = children.props as Record<string, unknown>;
  return (
    <>
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        onContextMenu: (e: React.MouseEvent) => {
          (props.onContextMenu as ((e: React.MouseEvent) => void) | undefined)?.(e);
          if (disabled || e.defaultPrevented) return;
          e.preventDefault();
          openAt(pointRect(e.clientX, e.clientY));
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          (props.onKeyDown as ((e: React.KeyboardEvent) => void) | undefined)?.(e);
          if (disabled || e.defaultPrevented) return;
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openAt({ top: r.top, left: r.left + 12, width: 0, height: r.height });
          }
        },
      })}
      <Menu open={at !== null} onClose={() => setAt(null)} anchor={at} items={entries} label={label} />
    </>
  );
}
