// SourceRow (UX §2.11, §4.4): one source under an answer, `[source-row]` with data-index.
import React from 'react';
import type { ViewCitation as Citation } from '../../services/types/viewModels';
import { useI18n } from '../i18n';
import { citationWhere } from './citationText';

export interface SourceRowProps {
  citation: Citation;
  onOpen(c: Citation): void;
  className?: string;
  'data-testid'?: string;
}

export function SourceRow({ citation, onOpen, className, ...rest }: SourceRowProps) {
  const i18n = useI18n();
  const src = citation.source;
  return (
    <button type="button" className={['source-row', className].filter(Boolean).join(' ')} onClick={() => onOpen(citation)} data-testid={rest['data-testid'] ?? 'source-row'} data-index={citation.n}>
      <span className="citation-chip" aria-hidden>{citation.n}</span>
      <span className="source-row__title">{src ? src.title : i18n.t('ai.cite.badges.hallucinated')}</span>
      {src ? <span className="source-row__where t-small t-muted">{citationWhere(citation, i18n)}</span> : null}
      {src?.quote.exact ? <span className="source-row__quote t-small">“{src.quote.exact}”</span> : null}
    </button>
  );
}
