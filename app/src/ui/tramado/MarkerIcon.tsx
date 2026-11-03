// MarkerIcon (UX §2.11): span[data-mk] + the marker's lucide icon; `auto` adds the radar badge.
import React from 'react';
import { CircleQuestionMark, Radar, SquareCheck, Star, StickyNote, Target } from 'lucide-react';
import type { MarkerKind } from '../../core/model/files';
import { cx } from '../cx';

const ICON = { important: Star, confused: CircleQuestionMark, exam: Target, todo: SquareCheck, note: StickyNote } as const;

export interface MarkerIconProps {
  kind: MarkerKind;
  auto?: boolean;
  size?: number;
  className?: string;
  'data-testid'?: string;
}

export function MarkerIcon({ kind, auto = false, size = 16, className, ...rest }: MarkerIconProps) {
  const Icon = ICON[kind];
  return (
    <span data-mk={kind} aria-hidden className={cx('marker-icon', className)} data-testid={rest['data-testid']}>
      <Icon size={size} strokeWidth={1.75} />
      {auto ? <Radar size={Math.round(size * 0.6)} strokeWidth={2} className="marker-icon__auto" /> : null}
    </span>
  );
}
