// SourceRow (UX §2.11, §4.4): a 52 px row under an answer — the chip (not interactive here), the type icon, the
// title on one line, the locator on the second, a status badge ("Moved", "Changed", "Missing", "Not a real source")
// and a chevron. Click or Enter opens the source directly (§4.5).
import React from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import type { ViewCitation as Citation } from '../../services/types/viewModels';
import { Badge } from '../components/Feedback';
import { useI18n } from '../i18n';
import { cx } from '../cx';
import { citationLabel, whereLabel } from './CitationChip';
import { sourceIcon } from './CitationPopover';
import './ai.css';

export interface SourceRowProps {
  citation: Citation;
  onOpen(c: Citation): void;
  className?: string;
  'data-testid'?: string;
}

export function SourceRow({ citation, onOpen, className, ...rest }: SourceRowProps) {
  const i18n = useI18n();
  const src = citation.source;
  const Icon = sourceIcon(citation);
  const where = whereLabel(citation, i18n);
  const badge = citation.status === 'ok' ? null : i18n.t(`ai.cite.badges.${citation.status}`);
  return (
    <button
      type="button"
      className={cx('srow', `srow--${citation.status}`, className)}
      onClick={() => onOpen(citation)}
      title={citationLabel(citation, i18n)}
      data-testid={rest['data-testid'] ?? 'source-row'}
      data-index={citation.n}
      data-status={citation.status}
    >
      <span className={cx('cchip', 'cchip--static', `cchip--${citation.status}`)}>
        {citation.n}
        {src?.private ? <Lock size={10} strokeWidth={2.25} aria-hidden /> : null}
      </span>
      <Icon size={18} strokeWidth={1.75} aria-hidden className="srow__icon" />
      <span className="srow__text">
        <span className="srow__title">{src ? src.title : i18n.t('ai.cite.badges.hallucinated')}</span>
        {where ? <span className="srow__where">{where}{citation.pin ? ` · ${citation.pin}` : ''}</span> : !src ? <span className="srow__where">{i18n.t('ai.cite.hallucinatedNote')}</span> : null}
      </span>
      {badge && src ? <Badge tone={citation.status === 'hallucinated' || citation.status === 'missing' ? 'warning' : 'neutral'}>{badge}</Badge> : <span />}
      <ChevronRight size={16} strokeWidth={1.75} aria-hidden className="srow__chev" />
    </button>
  );
}
