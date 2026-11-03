// Locator labels of UX §4.3 (`ai.cite.where.*`), shared by CitationChip, CitationPopover and SourceRow.
import type { ViewCitation as Citation } from '../../services/types/viewModels';
import type { I18n } from '../i18n';

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/** "p. 9", "art. 18.º · p. 9", "▶ 41:12", … (spoken forms for screen readers when `spoken`). */
export function citationWhere(c: Citation, i18n: Pick<I18n, 't'>, spoken = false): string {
  const l = c.source?.locator;
  if (!l) return '';
  const { t } = i18n;
  switch (l.kind) {
    case 'page': return t(spoken ? 'ai.cite.where.pageSpoken' : 'ai.cite.where.page', { page: l.label ?? l.page });
    case 'article':
      if (spoken) return t('ai.cite.where.articleSpoken', { article: l.label, page: l.page });
      return l.pageEnd && l.pageEnd !== l.page ? t('ai.cite.where.articleRange', { article: l.label, page: l.page, end: l.pageEnd }) : t('ai.cite.where.article', { article: l.label, page: l.page });
    case 'slide': return t(spoken ? 'ai.cite.where.slideSpoken' : 'ai.cite.where.slide', { n: l.slide });
    case 'time': return t(spoken ? 'ai.cite.where.timeSpoken' : 'ai.cite.where.time', { time: clock(l.ms) });
    case 'question': return t(spoken ? 'ai.cite.where.questionSpoken' : 'ai.cite.where.question', { number: l.number });
    case 'heading': return t(spoken ? 'ai.cite.where.headingSpoken' : 'ai.cite.where.heading', { heading: l.path.join(' › ') });
    case 'none': return '';
  }
}
