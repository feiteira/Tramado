// MarkerButton (UX §2.7): one of the five marker buttons of the recording dock — the marker's icon in its
// colour, the key hint and the label. Compact (main width < 1280 px): icon-only with a tooltip. A just-dropped
// marker "pops" (no motion when reduced).
import React from 'react';
import type { MarkerKind } from '../../core/model/files';
import { Tooltip } from '../components/Tooltip';
import { cx } from '../cx';
import { MarkerIcon } from './MarkerIcon';
import './MarkerButton.css';

export interface MarkerButtonProps {
  kind: MarkerKind;
  label: string;
  /** "1"…"4", "N". */
  keyHint: string;
  compact?: boolean;
  disabled?: boolean;
  popped?: boolean;
  onClick(): void;
  pressed?: boolean;
}

export function MarkerButton({ kind, label, keyHint, compact = false, disabled, popped, onClick, pressed }: MarkerButtonProps) {
  const button = (
    <button
      type="button"
      className={cx('marker-button', compact && 'marker-button--compact', popped && 'marker-button--popped')}
      data-mk={kind}
      data-testid="record-mark"
      aria-label={label}
      aria-keyshortcuts={keyHint}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <MarkerIcon kind={kind} size={16} />
      <kbd className="marker-button__key" aria-hidden>
        {keyHint}
      </kbd>
      {compact ? null : <span className="marker-button__label">{label}</span>}
    </button>
  );
  return compact ? (
    <Tooltip label={label} shortcut={keyHint} side="top">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
