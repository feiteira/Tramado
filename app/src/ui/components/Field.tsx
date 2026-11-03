import React, { forwardRef, useCallback, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cx } from '../cx';
import { grownHeight } from '../grow';
import { useI18n } from '../i18n';
import './field.css';

export function Label({ htmlFor, children, optional, id }: { htmlFor?: string; children: ReactNode; optional?: string; id?: string }) {
  return (
    <label className="field__label" htmlFor={htmlFor} id={id}>
      {children}
      {optional ? <span className="field__optional"> {optional}</span> : null}
    </label>
  );
}

export function Hint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="field__hint" id={id}>
      {children}
    </p>
  );
}

export function ErrorText({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="field__error" id={id} role="alert">
      {children}
    </p>
  );
}

export interface FieldIds {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export interface FieldProps {
  label?: ReactNode;
  /** Shown after the label, e.g. "(optional)". */
  optional?: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** Something at the right of the label row (a Show/Hide toggle). */
  labelAside?: ReactNode;
  /** The control, given the ids that tie it to the label, hint and error. */
  children: (ids: FieldIds) => ReactNode;
  className?: string;
  id?: string;
}

/** Label, control, hint and error, stacked, with the ids wired for screen readers. */
export function Field({ label, optional, hint, error, labelAside, children, className, id: given }: FieldProps) {
  const auto = useId();
  const id = given ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('field', error ? 'field--invalid' : null, className)}>
      {label || labelAside ? (
        <div className="field__label-row">
          {label ? <Label htmlFor={id} optional={optional}>{label}</Label> : <span />}
          {labelAside}
        </div>
      ) : null}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

type FieldChrome = Pick<FieldProps, 'label' | 'optional' | 'hint' | 'error' | 'labelAside'> & { fieldClassName?: string };

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'>, FieldChrome {
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md' | 'lg';
  /** Renders inside the box, before the text (an icon). */
  leading?: ReactNode;
  /** Renders inside the box, after the text (a button). */
  trailing?: ReactNode;
  'data-testid'?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, optional, hint, error, labelAside, fieldClassName, value, onChange, size = 'md', leading, trailing, className, id, type = 'text', ...rest },
  ref,
) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error} labelAside={labelAside} className={fieldClassName} id={id}>
      {(ids) => (
        <div className={cx('input', `input--${size}`, leading ? 'input--leading' : null, trailing ? 'input--trailing' : null, className)}>
          {leading ? <span className="input__leading">{leading}</span> : null}
          <input
            ref={ref}
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input__control"
            {...ids}
            aria-describedby={[ids['aria-describedby'], rest['aria-describedby']].filter(Boolean).join(' ') || undefined}
            {...omit(rest, 'aria-describedby')}
          />
          {trailing ? <span className="input__trailing">{trailing}</span> : null}
        </div>
      )}
    </Field>
  );
});

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _drop, ...rest } = obj;
  return rest;
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'>, FieldChrome {
  value: string;
  onChange: (value: string) => void;
  /** Grows with its text between these heights (px). Without `autoGrow` it keeps `rows`. */
  autoGrow?: boolean;
  minHeight?: number;
  maxHeight?: number;
  /** Document text (Literata) instead of interface text. */
  reading?: boolean;
  'data-testid'?: string;
}

/**
 * A multi-line field. With `autoGrow` it follows its content using grow.ts's slack rule: at a
 * fractional display scale the reported height is rounded up, and following it exactly would
 * grow the box a pixel on every render.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, optional, hint, error, labelAside, fieldClassName, value, onChange, autoGrow, minHeight = 72, maxHeight = 480, reading, className, id, style, ...rest },
  outer,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof outer === 'function') outer(el);
      else if (outer) outer.current = el;
    },
    [outer],
  );
  useLayoutEffect(() => {
    const el = inner.current;
    if (!autoGrow || !el) return;
    // Measure the content at the minimum height, then restore: scrollHeight never reports less
    // than the box itself.
    const prev = el.style.height;
    el.style.height = `${minHeight}px`;
    const content = el.scrollHeight;
    el.style.height = prev;
    setHeight((cur) => grownHeight(cur, content, minHeight, maxHeight));
  }, [value, autoGrow, minHeight, maxHeight]);
  return (
    <Field label={label} optional={optional} hint={hint} error={error} labelAside={labelAside} className={fieldClassName} id={id}>
      {(ids) => (
        <textarea
          ref={setRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cx('textarea', reading && 'textarea--reading', className)}
          style={autoGrow ? { ...style, height: height ?? minHeight, minHeight, maxHeight, resize: 'none', overflowY: height !== null && height >= maxHeight ? 'auto' : 'hidden' } : style}
          {...ids}
          {...rest}
        />
      )}
    </Field>
  );
});

export interface SearchFieldProps extends Omit<TextFieldProps, 'leading' | 'trailing' | 'type'> {
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
}

/** A search box: magnifier, a clear button once something is typed, Escape clears. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({ value, onChange, onKeyDown, size = 'md', ...rest }, ref) {
  const { t } = useI18n();
  return (
    <TextField
      ref={ref}
      type="search"
      size={size}
      value={value}
      onChange={onChange}
      autoComplete="off"
      spellCheck={false}
      leading={<Search size={size === 'sm' ? 13 : 15} aria-hidden strokeWidth={1.75} />}
      trailing={
        value ? (
          <button type="button" className="input__clear" aria-label={t('common.clear')} onClick={() => onChange('')} tabIndex={-1}>
            <X size={13} aria-hidden />
          </button>
        ) : null
      }
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === 'Escape' && value && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          onChange('');
        }
      }}
      {...rest}
    />
  );
});

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'size'>, FieldChrome {
  value: V;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  size?: 'sm' | 'md';
  'data-testid'?: string;
}

/** A native select, styled: it brings the platform's keyboard and screen-reader behaviour for free. */
export function Select<V extends string>({ label, optional, hint, error, labelAside, fieldClassName, value, onChange, options, size = 'md', className, id, ...rest }: SelectProps<V>) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error} labelAside={labelAside} className={fieldClassName} id={id}>
      {(ids) => (
        <div className={cx('select', `select--${size}`, className)}>
          <select value={value} onChange={(e) => onChange(e.target.value as V)} {...ids} {...rest}>
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={15} aria-hidden className="select__chevron" />
        </div>
      )}
    </Field>
  );
}
