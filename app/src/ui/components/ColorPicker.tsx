import React, { useEffect, useId, useState } from 'react';
import { Check } from 'lucide-react';
import { CLASS_COLORS, CLASS_COLOR_NAMES } from '../classColor';
import { inkOn, normalizeHex } from '../color';
import { cx } from '../cx';
import { useI18n } from '../i18n';
import './colorpicker.css';

/** Where the system picker opens while no colour is chosen. */
const NO_COLOUR = '#7a7f87';

export interface ColorPickerProps {
  /** The colour, or null for none chosen yet (no swatch selected). */
  value: string | null;
  onChange: (hex: string) => void;
  label: string;
  /** Offer a custom colour beside the palette (default false in Tramado: UX §1.3 offers the 12 class colours). */
  custom?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * Tramado: the 12 class colours (UX §1.3), named by classes.colours.*. The palette as a radio group of swatches (arrow keys move between them), plus a custom
 * #rrggbb typed or picked with the system picker. Always reports lower-case #rrggbb. With a
 * null value nothing is selected until the researcher picks a colour.
 */
export function ColorPicker({ value, onChange, label, custom = false, className, ...rest }: ColorPickerProps) {
  const { t } = useI18n();
  const name = useId();
  // An unreadable colour shows as the first swatch; null shows none selected.
  const current = value === null ? null : (normalizeHex(value) ?? CLASS_COLORS[0]);
  const inPalette = current !== null && (CLASS_COLORS as readonly string[]).includes(current);
  const [text, setText] = useState(current ?? '');
  useEffect(() => setText(current ?? ''), [current]);
  const testId = rest['data-testid'];

  return (
    <fieldset className={cx('colorpicker', className)} data-testid={testId}>
      <legend className="field__label">{label}</legend>
      <div className="colorpicker__swatches" role="radiogroup" aria-label={label}>
        {CLASS_COLORS.map((c, i) => (
          <label key={c} className="colorpicker__swatch" style={{ background: c }} title={c}>
            <input
              type="radio"
              name={name}
              value={c}
              checked={current === c}
              onChange={() => onChange(c)}
              className="choice__input"
              aria-label={t(`classes.colours.${CLASS_COLOR_NAMES[i]!}`)}
              data-testid={testId ? `${testId}-${i}` : undefined}
            />
            {current === c ? <Check size={14} strokeWidth={3} color={inkOn(c)} aria-hidden /> : null}
          </label>
        ))}
      </div>
      {custom ? (
        <div className="colorpicker__custom">
          <label
            className={cx('colorpicker__native', current !== null && !inPalette && 'colorpicker__native--on', current === null && 'colorpicker__native--none')}
            style={current !== null ? { background: current } : undefined}
            title={label}
          >
            <input type="color" value={current ?? NO_COLOUR} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label={label} />
          </label>
          <input
            className="colorpicker__hex"
            value={text}
            spellCheck={false}
            maxLength={7}
            aria-label={`${label} (#rrggbb)`}
            placeholder="#rrggbb"
            aria-invalid={(text !== '' && normalizeHex(text) === null) || undefined}
            onChange={(e) => {
              setText(e.target.value);
              const n = normalizeHex(e.target.value);
              // Only complete colours apply: "#3a6" while typing "#3a6ea5" would flash a wrong one.
              if (n && e.target.value.replace('#', '').length === 6) onChange(n);
            }}
            onBlur={() => {
              const n = normalizeHex(text);
              if (n) onChange(n);
              else setText(current ?? '');
            }}
            data-testid={testId ? `${testId}-hex` : undefined}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
