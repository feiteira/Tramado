// Ask turns → the UX AiAnswerView (UX §3.11), copies with footnotes (UX §4.2 "plain-text copies") and the note an
// answer is saved as. Cross-class turns (route `ask`) carry the class of each cited ref in `AskTurn.classOf`.
import { DateTime } from 'luxon';
import { citeRegex } from '../../core/ai/citations';
import { docHref } from '../../core/ai/lecture';
import { isPrivateSource, answerView } from '../../services/ai';
import type { AskTurn } from '../../services/types/ask';
import type { AppServices } from '../../services/types/common';
import type { AiAnswerView, DeviceRef, ViewCitation } from '../../services/types/viewModels';
import type { I18n } from '../../ui/i18n';
import { clockLabel, whereLabel } from '../../ui/tramado/CitationChip';

/** This computer's person as a DeviceRef ("asked by Ana"). */
export function meRef(services: AppServices): DeviceRef {
  const d = services.ctx.device.get();
  const i = services.ctx.identity.get();
  return { deviceId: d?.deviceId ?? '', deviceName: '', memberId: i?.memberId ?? '', memberName: i?.name ?? '', self: true };
}

const notesDirOf = (services: AppServices, classId: string): string => {
  try {
    return services.forClass(classId).store.dir('notes');
  } catch {
    return 'Notes';
  }
};

/** The answer of a turn as the AiCard shows it. */
export function turnView(services: AppServices, turn: AskTurn, classId: string): AiAnswerView {
  const s = services.ai.settings.get();
  const model = turn.model ?? s.chain[0] ?? s.model;
  const view = answerView(
    { text: turn.answer, citations: turn.citations, model, requestedModel: turn.requestedModel ?? model, at: turn.at, mode: turn.mode ?? 'quick', scope: turn.general ? 'materials+general' : 'materials' },
    { classId, notesDir: notesDirOf(services, classId), askedBy: meRef(services), label: services.ai.label, sent: { passages: turn.sent?.length ?? 0, chars: 0 } },
  );
  if (!turn.classOf) return view;
  const stored = new Map(turn.citations.map((c) => [c.ref, c]));
  return {
    ...view,
    citations: view.citations.map((c): ViewCitation => {
      const other = turn.classOf![c.ref];
      const st = stored.get(c.ref);
      if (!c.source || !other) return c;
      return { ...c, source: { ...c.source, classId: other, private: st ? isPrivateSource(st.source, notesDirOf(services, other)) || undefined : c.source.private } };
    }),
  };
}

/** True when the answer cites a private note (it can't be posted to the class chat, UX §3.11). */
export const citesPrivate = (view: AiAnswerView): boolean => view.citations.some((c) => !!c.source?.private);

/** Markdown with `[n]` numbers and a footnote list `[n] {title}, {where}` (UX §4.2, "Copy with sources"). */
export function copyWithSources(view: Pick<AiAnswerView, 'text' | 'citations'>, i18n: Pick<I18n, 't' | 'tp'>): string {
  const num = new Map(view.citations.map((c) => [c.ref, c.n]));
  const body = view.text.replace(citeRegex(), (_m, refs: string, pin?: string) => {
    const ns = refs.split(/\s*,\s*/).map((r) => num.get(r.trim()) ?? '?');
    return `[${ns.join(', ')}${pin ? `, ${pin.trim()}` : ''}]`;
  });
  const notes = view.citations.filter((c) => c.source).map((c) => {
    const where = whereLabel(c, i18n);
    return `[${c.n}] ${c.source!.title}${where ? `, ${where}` : ''}`;
  });
  return notes.length ? `${body.trim()}\n\n${notes.join('\n')}` : body.trim();
}

/** The private note an answer is saved as ("Save as note"): links to the cited lectures and documents. */
export function answerNote(question: string, view: Pick<AiAnswerView, 'text' | 'citations' | 'model'>, i18n: Pick<I18n, 't' | 'tp'>, at: DateTime): string {
  const byRef = new Map(view.citations.map((c) => [c.ref, c]));
  const body = view.text.replace(citeRegex(), (_m, refs: string) => refs.split(/\s*,\s*/).map((r) => {
    const c = byRef.get(r.trim());
    const s = c?.source;
    if (!c || !s) return '';
    if (s.type === 'lecture' && s.lectureId && s.locator.kind === 'time') return `[${clockLabel(s.locator.ms)}](tramado:lecture/${s.lectureId}?t=${s.locator.ms})`;
    if (s.type === 'document' && s.relPath) {
      const page = s.locator.kind === 'page' || s.locator.kind === 'article' ? s.locator.page : null;
      const where = whereLabel(c, i18n);
      return `[${`${s.title}${where ? `, ${where}` : ''}`.replace(/[[\]]/g, '')}](${docHref(s.relPath, page)})`;
    }
    return `[${c.n}]`;
  }).filter(Boolean).join(' '));
  return `# ${question.replace(/\s+/g, ' ').trim().slice(0, 120)}\n\n${body.trim()}\n\n— ${i18n.t('ai.badge')} · ${view.model.label} · ${at.toISODate() ?? ''}\n`;
}
