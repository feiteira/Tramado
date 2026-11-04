// CitationChip (UX §2.11, §4.2): a numbered highlighter chip; its accessible name says where the source is
// ("Source 1: Lei Fundamental de Exemplo, article 18.º, page 9"). It also exports the locator labels of UX §4.3
// shared by CitationPopover and SourceRow (spoken forms spell times out in words).
import React from 'react';
import { Lock } from 'lucide-react';
import type { ViewCitation as Citation } from '../../services/types/viewModels';
import type { I18n } from '../i18n';
import { useI18n } from '../i18n';
import { cx } from '../cx';
import './ai.css';

export interface CitationChipProps {
  citation: Citation;
  onOpen(c: Citation): void;
  className?: string;
  'data-testid'?: string;
}

/** "41:12" or "1:02:03". */
export function clockLabel(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "1 hour 2 minutes 3 seconds" in the UI language, zero parts omitted (UX §4.3 spoken time). */
export function spokenClock(ms: number, i18n: Pick<I18n, 'tp'>): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const parts: string[] = [];
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) parts.push(i18n.tp('ai.cite.units.h', h, { n: h }));
  if (m) parts.push(i18n.tp('ai.cite.units.m', m, { n: m }));
  if (sec || !parts.length) parts.push(i18n.tp('ai.cite.units.s', sec, { n: sec }));
  return parts.join(' ');
}

/** The visible (or spoken) locator label of UX §4.3: "p. 9", "art. 18.º · p. 9", "▶ 41:12", "slide 4", "§ 2. Regime". */
export function whereLabel(c: Pick<Citation, 'source'>, i18n: Pick<I18n, 't' | 'tp'>, spoken = false): string {
  const l = c.source?.locator;
  if (!l) return '';
  const { t } = i18n;
  switch (l.kind) {
    case 'page': return t(spoken ? 'ai.cite.where.pageSpoken' : 'ai.cite.where.page', { page: l.label ?? l.page });
    case 'article':
      if (spoken) return t('ai.cite.where.articleSpoken', { article: l.label, page: l.page });
      return l.pageEnd && l.pageEnd !== l.page ? t('ai.cite.where.articleRange', { article: l.label, page: l.page, end: l.pageEnd }) : t('ai.cite.where.article', { article: l.label, page: l.page });
    case 'slide': return t(spoken ? 'ai.cite.where.slideSpoken' : 'ai.cite.where.slide', { n: l.slide });
    case 'time': return spoken ? t('ai.cite.where.timeSpoken', { time: spokenClock(l.ms, i18n) }) : t('ai.cite.where.time', { time: clockLabel(l.ms) });
    case 'question': return t(spoken ? 'ai.cite.where.questionSpoken' : 'ai.cite.where.question', { number: l.number });
    case 'heading': {
      const last = l.path.at(-1) ?? '';
      return last ? t(spoken ? 'ai.cite.where.headingSpoken' : 'ai.cite.where.heading', { heading: last }) : '';
    }
    case 'none': return '';
  }
}

/** The chip's accessible name and tooltip: "Source {n}: {title}, {where}" + the status suffix. */
export function citationLabel(c: Citation, i18n: Pick<I18n, 't' | 'tp'>): string {
  const status = c.status === 'ok' ? '' : i18n.t(`ai.cite.${c.status}`);
  if (!c.source) return `${i18n.t('ai.cite.label', { n: c.n, title: c.ref, where: '' }).replace(/,\s*$/, '')}${status}`;
  const where = whereLabel(c, i18n, true);
  const base = i18n.t('ai.cite.label', { n: c.n, title: c.source.title, where });
  return `${where ? base : base.replace(/,\s*$/, '')}${status}`;
}

let lastOpen: { el: HTMLElement; modifier: boolean } | null = null;

/**
 * What the last chip click was: its element (the popover's anchor) and whether Ctrl/⌘ or the middle button was used
 * ("open at once", UX §4.5). Read once by the `onOpen` handler, which only receives the citation (frozen props).
 */
export function takeChipOpen(): { el: HTMLElement; modifier: boolean } | null {
  const v = lastOpen;
  lastOpen = null;
  return v;
}

export function CitationChip({ citation, onOpen, className, ...rest }: CitationChipProps) {
  const i18n = useI18n();
  const label = citationLabel(citation, i18n);
  const open = (e: React.MouseEvent<HTMLButtonElement>, modifier: boolean) => {
    e.stopPropagation();
    lastOpen = { el: e.currentTarget, modifier };
    onOpen(citation);
  };
  // The accessible name is the label sentence, with the visible number (and pin-point) inside it, so speech
  // input users can say what they see (WCAG 2.5.3): "Source [1 · n.º 3]: Lei Fundamental…, article 18.º, page 9".
  const n = String(citation.n);
  const at = label.indexOf(n);
  const before = at >= 0 ? label.slice(0, at) : `${label} `;
  const after = at >= 0 ? label.slice(at + n.length) : '';
  return (
    <button
      type="button"
      className={cx('cchip', `cchip--${citation.status}`, className)}
      aria-haspopup="dialog"
      title={label}
      onClick={(e) => open(e, e.ctrlKey || e.metaKey)}
      onAuxClick={(e) => {
        if (e.button === 1) open(e, true);
      }}
      data-testid={rest['data-testid'] ?? 'cite-chip'}
      data-index={citation.n}
      data-status={citation.status}
    >
      <span className="visually-hidden">{before}</span>
      <span>{n}</span>
      {citation.pin ? <span className="cchip__pin">{` · ${citation.pin}`}</span> : null}
      <span className="visually-hidden">{after}</span>
      {citation.source?.private ? <Lock size={10} strokeWidth={2.25} aria-hidden /> : null}
    </button>
  );
}
