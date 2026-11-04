// AiCard (UX §2.11, §3.9.8): 4 px --ai bar, the "AI" badge with the Sparkles icon, the model that answered
// ("— answered because {requested} was busy" when a fallback answered), the title line ("from 2 of your sources ·
// asked by Ana · 30 Oct"), the body in the reading font, and a footer with the 5-segment Grounded meter and the
// card's actions. Streaming shows a caret and hides the footer; a cut answer is greyed with "The answer was cut off."
import React, { type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import type { ModelLabel } from '../../services/types/viewModels';
import { useI18n } from '../i18n';
import { cx } from '../cx';
import './ai.css';

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

/** The Grounded meter (UX §3.9.8): five segments, `role="meter"`, "Grounded in your sources: {p} %". */
export function GroundedMeter({ value }: { value: number }) {
  const { t } = useI18n();
  const p = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const on = Math.round((p / 100) * 5);
  return (
    <span className="grounded" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={t('ai.card.groundedLabel', { p })} data-testid="ai-grounded" data-grounded={value.toFixed(2)}>
      <span aria-hidden>{t('ai.card.grounded')}</span>
      <span className="grounded__bar" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className={cx('grounded__seg', i < on && 'grounded__seg--on')} />)}
      </span>
      <span className="grounded__value" aria-hidden>{p} %</span>
    </span>
  );
}

export function AiCard({ title, model, fallbackOf, askedBy, at, children, grounded, footer, state = 'done', className, ...rest }: AiCardProps) {
  const { t } = useI18n();
  const streaming = state === 'streaming';
  const meta = askedBy && at ? t('ai.card.askedBy', { name: askedBy, date: at }) : askedBy ?? at ?? null;
  return (
    <article className={cx('aicard', `aicard--${state}`, className)} aria-label={t('ai.card.label')} aria-busy={streaming || undefined} data-testid={rest['data-testid']} data-state={state}>
      <header className="aicard__head">
        <span className="aicard__badge">
          <Sparkles size={12} strokeWidth={2} aria-hidden /> {t('ai.badge')}
        </span>
        <span className="aicard__model">{model.label}</span>
        {fallbackOf ? <span className="aicard__fallback">{t('ai.card.fallback', { requested: fallbackOf })}</span> : null}
      </header>
      {title || meta ? (
        <p className="aicard__meta">
          {title ? <span className="aicard__title">{title}</span> : null}
          {title && meta ? ' · ' : null}
          {meta}
        </p>
      ) : null}
      <div className="aicard__body reading">
        {children}
        {streaming ? <span className="aicard__caret" aria-hidden /> : null}
      </div>
      {streaming ? (
        <p className="aicard__writing" role="status">
          <Sparkles size={12} strokeWidth={2} aria-hidden /> {t('ai.card.streaming')}
        </p>
      ) : null}
      {state === 'cut' ? <p className="aicard__cut" role="status">{t('ai.card.cut')}</p> : null}
      {!streaming && (grounded !== undefined || footer) ? (
        <footer className="aicard__foot">
          {grounded !== undefined ? <GroundedMeter value={grounded} /> : null}
          {footer ? <div className="aicard__foot-actions">{footer}</div> : null}
        </footer>
      ) : null}
    </article>
  );
}
