// CostLine (UX §2.11): "About {n} requests · {left} free left today".
import React from 'react';
import type { ModelLabel, Quota } from '../../services/types/viewModels';
import { useI18n } from '../i18n';

export interface CostLineProps {
  requests: number;
  quota: Quota | null;
  model: ModelLabel;
  className?: string;
  'data-testid'?: string;
}

export function CostLine({ requests, quota, model, className, ...rest }: CostLineProps) {
  const { tp } = useI18n();
  const text = quota ? tp('ai.cost.line', requests, { n: requests, left: quota.remaining }) : tp('ai.cost.noQuota', requests, { n: requests });
  return (
    <p className={['cost-line', 't-small', 't-muted', className].filter(Boolean).join(' ')} data-testid={rest['data-testid'] ?? 'cost-line'} data-model={model.id}>
      {text}
    </p>
  );
}
