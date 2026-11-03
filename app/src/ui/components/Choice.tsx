import React, { useId, useRef, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cx } from '../cx';
import './choice.css';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** A line under the label. */
  description?: ReactNode;
  /** Neither on nor off (some of a group selected). */
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  'data-testid'?: string;
}

/** A native checkbox (keyboard and screen readers for free) with a drawn box. */
export function Checkbox({ checked, onChange, label, description, indeterminate, disabled, className, id, ...rest }: CheckboxProps) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label className={cx('choice', disabled && 'choice--disabled', className)} htmlFor={cid}>
      <input
        id={cid}
        type="checkbox"
        className="choice__input"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        aria-describedby={description ? `${cid}-desc` : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={rest['data-testid']}
      />
      <span className="choice__box" aria-hidden>
        {indeterminate ? <Minus size={12} strokeWidth={3} /> : checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="choice__text">
        <span className="choice__label">{label}</span>
        {description ? <span className="choice__description" id={`${cid}-desc`}>{description}</span> : null}
      </span>
    </label>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** An on/off setting that applies at once (role="switch"). */
export function Switch({ checked, onChange, label, description, disabled, className, ...rest }: SwitchProps) {
  const id = useId();
  return (
    <div className={cx('switch-row', disabled && 'choice--disabled', className)}>
      <span className="choice__text">
        <label className="choice__label" htmlFor={id}>{label}</label>
        {description ? <span className="choice__description" id={`${id}-desc`}>{description}</span> : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        className="switch"
        onClick={() => onChange(!checked)}
        data-testid={rest['data-testid']}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

export interface RadioOption<V extends string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: readonly RadioOption<V>[];
  label: ReactNode;
  /** Hide the group's label visually (it stays for screen readers). */
  hideLabel?: boolean;
  /** Buttons side by side (a segmented control) instead of a list. */
  variant?: 'list' | 'segmented';
  className?: string;
  name?: string;
  'data-testid'?: string;
}

/**
 * One choice of several, from native radio inputs: arrow keys move the choice, Tab leaves the
 * group. The segmented look suits two to four short options (language, theme).
 */
export function RadioGroup<V extends string>({ value, onChange, options, label, hideLabel, variant = 'list', className, name, ...rest }: RadioGroupProps<V>) {
  const auto = useId();
  const groupName = name ?? auto;
  const labelId = `${groupName}-label`;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div role="radiogroup" aria-labelledby={labelId} className={cx('radios', `radios--${variant}`, className)} ref={ref} data-testid={rest['data-testid']}>
      <span id={labelId} className={hideLabel ? 'visually-hidden' : 'field__label radios__label'}>{label}</span>
      <div className="radios__options">
        {options.map((o) => {
          const id = `${groupName}-${o.value}`;
          return (
            <label key={o.value} htmlFor={id} className={cx('radio', value === o.value && 'radio--checked', o.disabled && 'choice--disabled')}>
              <input
                id={id}
                type="radio"
                name={groupName}
                value={o.value}
                checked={value === o.value}
                disabled={o.disabled}
                className="choice__input"
                onChange={() => onChange(o.value)}
                data-testid={rest['data-testid'] ? `${rest['data-testid']}-${o.value}` : undefined}
              />
              {variant === 'list' ? <span className="radio__dot" aria-hidden /> : null}
              <span className="choice__text">
                <span className="choice__label">{o.label}</span>
                {o.description && variant === 'list' ? <span className="choice__description">{o.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
