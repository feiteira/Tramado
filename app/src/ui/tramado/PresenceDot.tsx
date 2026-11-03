// PresenceDot (UX §2.11): shape + colour, role="img" with a label (never colour alone).
import React from 'react';
import { cx } from '../cx';

export type PresenceState = 'online' | 'syncing' | 'offline' | 'recording' | 'transcribing';

export interface PresenceDotProps {
  state: PresenceState;
  label: string;
  className?: string;
  'data-testid'?: string;
}

export function PresenceDot({ state, label, className, ...rest }: PresenceDotProps) {
  return <span role="img" aria-label={label} title={label} className={cx('presence-dot', `presence-dot--${state}`, className)} data-testid={rest['data-testid']} />;
}
