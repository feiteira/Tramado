import React, { useId, useRef, type ReactNode } from 'react';
import { cx } from '../cx';
import './tabs.css';

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  /** A count or marker after the label. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  items: readonly TabItem<V>[];
  label: string;
  className?: string;
  /** The panel of the selected tab. Rendered with role="tabpanel" and wired to its tab. */
  children?: ReactNode;
  'data-testid'?: string;
}

/**
 * Tabs with the WAI-ARIA keyboard model: one Tab stop on the selected tab, arrows move and
 * select (automatic activation), Home/End jump.
 */
export function Tabs<V extends string>({ value, onChange, items, label, className, children, ...rest }: TabsProps<V>) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const enabled = items.filter((i) => !i.disabled);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((x) => x.value === value);
    let next: TabItem<V> | undefined;
    if (e.key === 'ArrowRight') next = enabled[(i + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    list.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };
  return (
    <div className={cx('tabs', className)} data-testid={rest['data-testid']}>
      <div role="tablist" aria-label={label} className="tabs__list" ref={list} onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${base}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={children ? `${base}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              data-value={item.value}
              data-testid={rest['data-testid'] ? `${rest['data-testid']}-${item.value}` : undefined}
              className={cx('tabs__tab', selected && 'tabs__tab--selected')}
              onClick={() => onChange(item.value)}
            >
              {item.label}
              {item.badge != null ? <span className="tabs__badge">{item.badge}</span> : null}
            </button>
          );
        })}
      </div>
      {children ? (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className="tabs__panel" tabIndex={0}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
