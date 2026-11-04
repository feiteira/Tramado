// QuotaMeter (UX §2.11, §3.14.3): free AI requests left today, from `GET /key` `free_model_daily_requests`.
// Full: a 10-segment meter (`role="meter"`) and "38 of 50 left today · resets at 01:00 (midnight UTC)", plus
// the credit line when the key has a limit. Compact: the text only. Without a quota: "Free requests left: unknown".
import React from 'react';
import { DateTime } from 'luxon';
import type { Quota } from '../../services/types/viewModels';
import { useI18n } from '../i18n';
import { cx } from '../cx';
import './ai.css';

export interface QuotaMeterProps {
  quota: Quota | null;
  compact?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** The local time of the next reset ("01:00" in Lisbon in summer), from `Quota.resetsAt`. */
export function useResetTime(): (quota: Pick<Quota, 'resetsAt'>) => string {
  const i18n = useI18n();
  return (q) => {
    const dt = DateTime.fromISO(q.resetsAt);
    return dt.isValid ? i18n.time(dt.toLocal()) : '00:00';
  };
}

export function QuotaMeter({ quota, compact = false, className, ...rest }: QuotaMeterProps) {
  const { t, meta } = useI18n();
  const reset = useResetTime();
  const testid = rest['data-testid'] ?? 'quota-meter';
  if (!quota) {
    if (compact) return null;
    return (
      <div className={cx('quota', className)} data-testid={testid} data-remaining="">
        <span className="quota__text">{t('ai.quota.unknown')}</span>
      </div>
    );
  }
  const left = t('ai.quota.left', { remaining: quota.remaining, limit: quota.limit });
  const on = quota.limit > 0 ? Math.round((Math.max(0, Math.min(quota.limit, quota.remaining)) / quota.limit) * 10) : 0;
  const credit = quota.creditLeft !== null
    ? new Intl.NumberFormat(meta.bcp47, { style: 'currency', currency: 'USD' }).format(quota.creditLeft)
    : null;
  return (
    <div className={cx('quota', compact && 'quota--compact', className)} data-testid={testid} data-remaining={quota.remaining}>
      {compact ? null : (
        <span className="quota__bar" role="meter" aria-valuemin={0} aria-valuemax={quota.limit} aria-valuenow={quota.remaining} aria-label={left}>
          {Array.from({ length: 10 }, (_, i) => <span key={i} className={cx('quota__seg', i < on && 'quota__seg--on')} aria-hidden />)}
        </span>
      )}
      <span className="quota__text">
        <strong>{left}</strong>
        {compact ? null : ` · ${t('ai.quota.resets', { time: reset(quota) })}`}
        {!compact && credit ? ` · ${t('ai.quota.credit', { amount: credit })}` : null}
      </span>
    </div>
  );
}
