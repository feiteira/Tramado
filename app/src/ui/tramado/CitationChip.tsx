// CitationChip (UX §2.11, §4.2): a numbered highlighter chip; its accessible name says where the source is.
import React from 'react';
import type { ViewCitation as Citation } from '../../services/types/viewModels';
import { useI18n } from '../i18n';
import { citationWhere } from './citationText';

export interface CitationChipProps {
  citation: Citation;
  onOpen(c: Citation): void;
  className?: string;
  'data-testid'?: string;
}

export function CitationChip({ citation, onOpen, className, ...rest }: CitationChipProps) {
  const i18n = useI18n();
  const where = citationWhere(citation, i18n, true);
  const status = citation.status === 'ok' ? '' : i18n.t(`ai.cite.${citation.status}`);
  const label = citation.source ? i18n.t('ai.cite.label', { n: citation.n, title: citation.source.title, where }) + status : `${citation.n}${status}`;
  return (
    <button
      type="button"
      className={['citation-chip', `citation-chip--${citation.status}`, className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      onClick={() => onOpen(citation)}
      data-testid={rest['data-testid'] ?? 'cite-chip'}
      data-index={citation.n}
    >
      {citation.n}
      {citation.pin ? <span className="citation-chip__pin">, {citation.pin}</span> : null}
    </button>
  );
}
