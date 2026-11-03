// ProgressSteps (UX §2.11): an ordered list with icons.
import React from 'react';
import { Circle, CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import { cx } from '../cx';

export interface ProgressStepsProps {
  steps: { label: string; state: 'todo' | 'doing' | 'done' | 'failed' }[];
  className?: string;
  'data-testid'?: string;
}

const ICON = { todo: Circle, doing: LoaderCircle, done: CircleCheck, failed: CircleX } as const;

export function ProgressSteps({ steps, className, ...rest }: ProgressStepsProps) {
  return (
    <ol className={cx('progress-steps', className)} data-testid={rest['data-testid']}>
      {steps.map((s, i) => {
        const Icon = ICON[s.state];
        return (
          <li key={i} className={`progress-steps__step progress-steps__step--${s.state}`} aria-current={s.state === 'doing' ? 'step' : undefined}>
            <Icon size={16} strokeWidth={1.75} aria-hidden className={s.state === 'doing' ? 'spin' : undefined} />
            <span>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
