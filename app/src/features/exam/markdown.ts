// "Copy all answers as Markdown" (UX §3.9.8 ⋯): the paper's questions, my answers and the AI answers with `[n]`
// citations and their footnotes.
import type { ExamPaperView } from '../../services/types/viewModels';
import type { I18n } from '../../ui/i18n';
import { copyWithSources } from '../ask/turns';
import { pointsLabel } from '../exams/format';

export function examMarkdown(p: ExamPaperView, i18n: Pick<I18n, 't' | 'tp'>): string {
  const out: string[] = [`# ${p.title}`, ''];
  if (p.rules.length) out.push(...p.rules.map((r) => `- ${r}`), '');
  for (const q of p.questions) {
    const pts = q.points !== null ? ` (${pointsLabel(i18n, p.scale, q.points)})` : '';
    out.push(`## ${q.number}${pts}`, '', q.text, '');
    if (q.mine.draft.trim()) out.push(`**${i18n.t('exams.practice.yourAnswer')}**`, '', q.mine.draft.trim(), '');
    if (q.mine.correct.trim()) out.push(`**${i18n.t('exams.practice.yourCorrect')}**`, '', q.mine.correct.trim(), '');
    if (q.ai) out.push(`**${i18n.t('ai.badge')} · ${q.ai.model.label}**`, '', copyWithSources(q.ai, i18n), '');
  }
  return `${out.join('\n').trim()}\n`;
}
