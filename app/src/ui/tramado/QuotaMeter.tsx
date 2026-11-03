// QuotaMeter (UX §2.11, §3.14.3): free AI requests left today.
import React from 'react';
import type { Quota } from '../../services/types/viewModels';
import { ProgressBar } from '../components/Feedback';
import { useI18n } from '../i18n';

export interface QuotaMeterProps {
  quota: Quota | null;
  compact?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function QuotaMeter({ quota, compact = false, className, ...rest }: QuotaMeterProps) {
  const { t } = useI18n();
  if (!quota) return null;
  const text = t('ai.quota.left', { remaining: quota.remaining, limit: quota.limit });
  return (
    <div className={['quota-meter', compact && 'quota-meter--compact', className].filter(Boolean).join(' ')} data-testid={rest['data-testid'] ?? 'quota-meter'}>
      {compact ? null : <ProgressBar value={quota.remaining} max={quota.limit} label={text} />}
      <span className="t-small t-muted">{text}</span>
    </div>
  );
}
