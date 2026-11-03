// CitationPopover (UX §2.11, §4.5): the cited passage with its quote highlighted and an open action.
import React from 'react';
import type { ViewCitation as Citation } from '../../services/types/viewModels';
import { Popover } from '../components/Popover';
import type { Anchor } from '../components/floating';
import { Button } from '../components/Button';
import { useI18n } from '../i18n';
import { citationWhere } from './citationText';

export interface CitationPopoverProps {
  citation: Citation;
  anchor: Anchor;
  onClose(): void;
  onOpen(play?: boolean): void;
  'data-testid'?: string;
}

export function CitationPopover({ citation, anchor, onClose, onOpen, ...rest }: CitationPopoverProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const src = citation.source;
  return (
    <Popover open anchor={anchor} onClose={onClose} data-testid={rest['data-testid'] ?? 'cite-popover'}>
      <div className="citation-popover">
        <p className="citation-popover__where t-small t-muted">
          {src ? `${src.title} · ${citationWhere(citation, i18n)}` : t('ai.cite.badges.hallucinated')}
        </p>
        {src ? (
          <blockquote className="cite-block reading">
            {src.quote.prefix}
            <mark className="cite">{src.quote.exact}</mark>
            {src.quote.suffix}
          </blockquote>
        ) : (
          <p>{t('ai.cite.hallucinatedNote')}</p>
        )}
        {src ? (
          <div className="citation-popover__actions">
            <Button size="sm" onClick={() => onOpen(false)} data-testid="cite-open">
              {t('ai.cite.open')}
            </Button>
            {src.locator.kind === 'time' ? (
              <Button size="sm" variant="secondary" onClick={() => onOpen(true)} data-testid="cite-play">
                {t('ai.cite.playFrom', { time: citationWhere(citation, i18n).replace(/^▶ /, '') })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
