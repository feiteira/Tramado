// Class colours (UX §1.3): stored as #rrggbb in meta `colour`; derived values are never stored.
import type React from 'react';
import { CLASS_COLOURS, suggestColourFor } from '../core/model/icons';
import { inkOn } from './color';

export const CLASS_COLORS = CLASS_COLOURS;
export const CLASS_COLOR_NAMES = ['red','orange','amber','lime','green','teal','sky','blue','violet','purple','pink','graphite'] as const; // i18n: classes.colours.<name>
export const classStyle = (hex: string): React.CSSProperties =>
  ({ '--c': hex, '--c-on': inkOn(hex, '#181d29', '#ffffff') } as React.CSSProperties);
/** The first colour (in palette order) used by no existing, non-archived class; else index (classCount % 12). */
export function suggestColour(used: readonly string[]): string {
  return suggestColourFor(used);
}
/** Member avatar colour: index = parseInt(memberId.slice(0, 6), 32) % 12, unless the member picked one (UX §1.3). */
export function memberColour(memberId: string, picked?: string | null): string {
  if (picked) return picked;
  const n = parseInt(memberId.slice(0, 6), 32);
  return CLASS_COLORS[(Number.isFinite(n) ? n : 0) % 12]!;
}
