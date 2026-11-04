// CostLine (UX §2.11, §3.15.7): "✦ About {n} requests · {left} free left today · Gemma 4 31B (free)". With the free
// quota used up it reads "You've used today's {limit} free AI requests. They reset at {time}." in the warning
// colour (callers disable their button then: `costBlocked`).
import React from 'react';
import { Sparkles } from 'lucide-react';
import type { ModelLabel, Quota } from '../../services/types/viewModels';
import { useI18n } from '../i18n';
import { cx } from '../cx';
import { useResetTime } from './QuotaMeter';
import './ai.css';

export interface CostLineProps {
  requests: number;
  quota: Quota | null;
  model: ModelLabel;
  className?: string;
  'data-testid'?: string;
}

/** True when the free quota is spent and the model is a free one: the action is disabled (UX §3.15.7). */
export const costBlocked = (quota: Quota | null, model: ModelLabel): boolean => !!quota && quota.remaining <= 0 && model.free;

export function CostLine({ requests, quota, model, className, ...rest }: CostLineProps) {
  const { t, tp } = useI18n();
  const reset = useResetTime();
  const exhausted = costBlocked(quota, model);
  const text = exhausted
    ? t('ai.cost.exhausted', { limit: quota!.limit, time: reset(quota!) })
    : `${quota && model.free ? tp('ai.cost.line', requests, { n: requests, left: quota.remaining }) : tp('ai.cost.noQuota', requests, { n: requests })} · ${model.label}`;
  return (
    <p
      className={cx('costline', exhausted && 'costline--exhausted', className)}
      data-testid={rest['data-testid'] ?? 'cost-line'}
      data-model={model.id}
      data-requests={requests}
      data-exhausted={exhausted || undefined}
    >
      <Sparkles size={13} strokeWidth={2} aria-hidden className="costline__icon" />
      <span>{text}</span>
    </p>
  );
}
