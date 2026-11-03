// AiCard (UX §2.11): 4 px --ai bar, Badge tone="ai" "AI", the model's name, body in the reading font.
import React, { type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import type { ModelLabel } from '../../services/types/viewModels';
import { Badge } from '../components/Feedback';
import { useI18n } from '../i18n';
import { cx } from '../cx';

export interface AiCardProps {
  title: ReactNode;
  model: ModelLabel;
  fallbackOf?: string;
  askedBy?: string;
  at?: string;
  children: ReactNode;
  grounded?: number;
  footer?: ReactNode;
  state?: 'streaming' | 'done' | 'cut' | 'error';
  className?: string;
  'data-testid'?: string;
}

export function AiCard({ title, model, fallbackOf, askedBy, at, children, grounded, footer, state = 'done', className, ...rest }: AiCardProps) {
  const { t } = useI18n();
  return (
    <article className={cx('ai-card', `ai-card--${state}`, className)} aria-label={t('ai.card.label')} aria-busy={state === 'streaming' || undefined} data-testid={rest['data-testid']}>
      <header className="ai-card__head">
        <Badge tone="ai">
          <Sparkles size={12} strokeWidth={1.75} aria-hidden /> {t('ai.badge')}
        </Badge>
        <span className="ai-card__title">{title}</span>
        <span className="ai-card__model t-muted t-small">
          {model.label}
          {fallbackOf ? ` · ${fallbackOf}` : ''}
          {askedBy ? ` · ${askedBy}` : ''}
          {at ? ` · ${at}` : ''}
        </span>
      </header>
      <div className="ai-card__body reading">{children}</div>
      {grounded !== undefined || footer ? (
        <footer className="ai-card__foot t-small t-muted">
          {grounded !== undefined ? <span data-grounded={grounded.toFixed(2)}>{t('ai.card.groundedLabel', { p: Math.round(grounded * 100) })}</span> : null}
          {footer}
        </footer>
      ) : null}
    </article>
  );
}
