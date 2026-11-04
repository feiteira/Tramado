// CitationPopover (UX §4.5): 420 px; the source's type icon, title and locator, the quote in the reading font with
// `exact` highlighted (`mark.cite` in a `.cite-block`), the status note, and the primary action of its locator
// ("Open at p. 9", "Open art. 18.º", "Open at 41:12" + "▶ Play from 41:12", "Open question II.b", "Open my note",
// "Search for the passage" when missing). Focus lands on the primary button; Escape and a click outside close it.
import React from 'react';
import { ClipboardCheck, FileText, NotebookPen, Play, Presentation, AudioLines, Search, type LucideIcon } from 'lucide-react';
import type { ViewCitation as Citation } from '../../services/types/viewModels';
import { Popover } from '../components/Popover';
import type { Anchor } from '../components/floating';
import { Button } from '../components/Button';
import { useI18n, type I18n } from '../i18n';
import { clockLabel, whereLabel } from './CitationChip';
import './ai.css';

export interface CitationPopoverProps {
  citation: Citation;
  anchor: Anchor;
  onClose(): void;
  onOpen(play?: boolean): void;
  'data-testid'?: string;
}

/** The type icon of a source (UX §4.4): file-text / presentation / audio-lines / clipboard-check / notebook-pen. */
export function sourceIcon(c: Pick<Citation, 'source'>): LucideIcon {
  const s = c.source;
  if (!s) return FileText;
  if (s.type === 'lecture') return AudioLines;
  if (s.type === 'exam') return ClipboardCheck;
  if (s.type === 'note') return NotebookPen;
  return s.locator.kind === 'slide' ? Presentation : FileText;
}

/** The primary button's label for a citation (UX §4.5 table), or null when there is none (hallucinated). */
export function openLabel(c: Citation, i18n: Pick<I18n, 't'>): string | null {
  const { t } = i18n;
  const s = c.source;
  if (!s || c.status === 'hallucinated') return null;
  if (c.status === 'missing') return t('ai.cite.searchPassage');
  const l = s.locator;
  if (s.type === 'note') return t(s.private ? 'ai.cite.openMyNote' : 'ai.cite.openNote');
  switch (l.kind) {
    case 'page': return t('ai.cite.openPage', { page: l.label ?? l.page });
    case 'article': return t('ai.cite.openArticle', { article: l.label });
    case 'slide': return t('ai.cite.openSlide', { n: l.slide });
    case 'time': return t('ai.cite.openTime', { time: clockLabel(l.ms) });
    case 'question': return t('ai.cite.openQuestion', { number: l.number });
    default: return t('ai.cite.open');
  }
}

export function CitationPopover({ citation, anchor, onClose, onOpen, ...rest }: CitationPopoverProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const src = citation.source;
  const Icon = sourceIcon(citation);
  const where = whereLabel(citation, i18n);
  const primary = openLabel(citation, i18n);
  const time = src && citation.status !== 'missing' && src.locator.kind === 'time' ? src.locator.ms : null;
  const note = citation.status === 'hallucinated' || !src ? t('ai.cite.hallucinatedNote')
    : citation.status === 'missing' ? t('ai.cite.missingNote')
    : citation.status === 'moved' ? t('ai.cite.movedNote', { path: src.relPath ?? src.title })
    : citation.status === 'changed' ? t('ai.cite.changedNote')
    : null;
  const title = src ? src.title : t('ai.cite.badges.hallucinated');
  return (
    <Popover open anchor={anchor} onClose={onClose} aria-label={title} data-testid={rest['data-testid'] ?? 'cite-popover'}>
      <div className="cpop" data-status={citation.status}>
        <div className="cpop__head">
          <Icon size={16} strokeWidth={1.75} aria-hidden className="cpop__icon" />
          <span className="cpop__title">{title}</span>
          {where ? <span className="cpop__where">{where}</span> : null}
        </div>
        {src && src.quote.exact ? (
          <blockquote className="cite-block cpop__quote">
            {src.quote.prefix ? `…${src.quote.prefix}` : null}
            <mark className="cite">{src.quote.exact}</mark>
            {src.quote.suffix ? `${src.quote.suffix}…` : null}
          </blockquote>
        ) : null}
        {note ? <p className="cpop__note" data-testid="cite-note">{note}</p> : null}
        {primary ? (
          <div className="cpop__actions">
            <Button size="sm" variant="primary" icon={citation.status === 'missing' ? Search : undefined} onClick={() => onOpen(false)} data-testid="cite-open">
              {primary}
            </Button>
            {time !== null ? (
              <Button size="sm" variant="secondary" icon={Play} onClick={() => onOpen(true)} data-testid="cite-play">
                {t('ai.cite.playFrom', { time: clockLabel(time) })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
