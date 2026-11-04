// IconPicker (UX §3.3.1): the 33 class icons as a radio grid (`role="radiogroup"`, arrow keys move in 2D, one Tab
// stop), the suggested icon first and marked "Suggested". Option test ids are `${id}-${iconName}`; each option's
// accessible name is the icon's localised name (classes.icons.*).
import React, { useRef } from 'react';
import { CLASS_ICONS, type ClassIconName } from '../classIcons';
import { cx } from '../cx';
import { useI18n } from '../i18n';
import { classStyle } from '../classColor';
import { classIconComponent } from './ClassTab';
import './tramado.css';
import './iconpicker.css';

export interface IconPickerProps {
  value: ClassIconName;
  onChange(icon: ClassIconName): void;
  /** Shown first, with the "Suggested" mark. */
  suggested: ClassIconName;
  /** The class colour the icons are previewed in. */
  color: string;
  label: string;
  /** Columns of the grid (arrow keys move by this many vertically). */
  columns?: number;
  className?: string;
  'data-testid'?: string;
}

export function IconPicker({ value, onChange, suggested, color, label, columns = 11, className, ...rest }: IconPickerProps) {
  const { t } = useI18n();
  const order: ClassIconName[] = [suggested, ...CLASS_ICONS.filter((i) => i !== suggested)];
  // One Tab stop: the checked option, or the first when the value is not in the grid (an icon from a newer Tramado).
  const tabStop = Math.max(0, order.indexOf(value));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, delta: number) => {
    const n = order.length;
    const to = (from + delta + n) % n;
    const icon = order[to]!;
    onChange(icon);
    refs.current[to]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (e.key in map) {
      e.preventDefault();
      move(i, map[e.key]!);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(i, -i);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(i, order.length - 1 - i);
    }
  };
  const id = rest['data-testid'];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('icon-picker', 'cls-scope', className)}
      style={{ ...classStyle(color), gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      data-testid={id}
    >
      {order.map((icon, i) => {
        const Icon = classIconComponent(icon);
        const checked = icon === value;
        const name = t(`classes.icons.${icon}`);
        return (
          <button
            key={icon}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={icon === suggested ? `${name} (${t('classes.dialog.iconSuggested')})` : name}
            title={name}
            tabIndex={i === tabStop ? 0 : -1}
            className={cx('icon-picker__option', checked && 'icon-picker__option--checked', icon === suggested && 'icon-picker__option--suggested')}
            onClick={() => onChange(icon)}
            onKeyDown={(e) => onKeyDown(e, i)}
            data-testid={id ? `${id}-${icon}` : undefined}
            data-icon={icon}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            {icon === suggested ? <span className="icon-picker__suggested" aria-hidden>{t('classes.dialog.iconSuggested')}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
