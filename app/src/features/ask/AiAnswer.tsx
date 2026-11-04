// An AI answer as exams, Ask and practice show it (UX §3.9.8, §3.11, §4): the AiCard ("AI · {model}", "— answered
// because {requested} was busy", "from {k} of your sources · asked by {name} · {date}"), the body with citation chips
// and unverified sentences, the Grounded meter and the caller's actions, the "{n} sentences aren't in your materials"
// warning, and the SOURCES list. A chip opens the CitationPopover (Ctrl/⌘+click or the middle button opens at once);
// a source row opens directly; Back returns to the chip (its `data-index` inside `[ai-answer]`).
import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { AiAnswerView, ViewCitation } from '../../services/types/viewModels';
import { useRouter } from '../../shell/router';
import { Notice } from '../../ui/components/Feedback';
import { AiCard } from '../../ui/tramado/AiCard';
import { takeChipOpen } from '../../ui/tramado/CitationChip';
import { CitationPopover } from '../../ui/tramado/CitationPopover';
import { SourceRow } from '../../ui/tramado/SourceRow';
import { useI18n } from '../../ui/i18n';
import { AnswerBody } from './AnswerBody';
import { citationRoute, openPaletteWith, routeOfLink, shortDate, useResolvedCitations } from './cite';
import './ask.css';

export interface AiAnswerProps {
  services: AppServices;
  view: AiAnswerView;
  /** The class an answer's sources belong to (cross-class answers pass `classOf`). */
  classId: ClassId;
  classOf?: (c: ViewCitation) => ClassId;
  title?: ReactNode;
  state?: 'streaming' | 'done' | 'cut' | 'error';
  actions?: ReactNode;
  /** Shown between the body and the footer (the hint's "Still stuck?"). */
  extra?: ReactNode;
  grounded?: boolean;
  sources?: boolean;
  /** Called after a citation opened its target (the practice session ends its keyboard handling). */
  onNavigate?(): void;
  'data-testid'?: string;
}

export function useOpenCitation(classOf?: (c: ViewCitation) => ClassId) {
  const { go } = useRouter();
  return useCallback((c: ViewCitation, play = false) => {
    if (c.status === 'missing') {
      openPaletteWith(c.source?.quote.exact ?? '');
      return;
    }
    const r = citationRoute(c, play, classOf?.(c));
    if (r) go(r);
  }, [go, classOf]);
}

export function AiAnswer({ services, view, classId, classOf, title, state = 'done', actions, extra, grounded = true, sources = true, onNavigate, ...rest }: AiAnswerProps) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { go } = useRouter();
  const citations = useResolvedCitations(services, view.citations, classOf);
  const [open, setOpen] = useState<{ c: ViewCitation; el: HTMLElement } | null>(null);
  const openCitation = useOpenCitation(classOf);
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const k = useMemo(() => new Set(citations.filter((c) => c.source).map((c) => `${c.source!.type}:${c.source!.relPath ?? c.source!.lectureId ?? c.source!.examId ?? c.ref}`)).size, [citations]);
  const onChip = useCallback((c: ViewCitation) => {
    const hit = takeChipOpen();
    const full = citations.find((x) => x.ref === c.ref) ?? c;
    if (hit?.modifier && full.status !== 'hallucinated') {
      openCitation(full);
      onNavigate?.();
      return;
    }
    if (hit) setOpen({ c: { ...full, pin: c.pin }, el: hit.el });
  }, [citations, openCitation, onNavigate]);
  const onLink = useCallback((href: string) => {
    const r = routeOfLink(href, classId);
    if (r) go(r);
  }, [go, classId]);
  const named = view.askedBy.memberName || view.askedBy.deviceName;
  const unverified = view.unverified;
  const anchor = useMemo(() => (open ? { current: open.el } : null), [open]);
  return (
    <div className="ai-answer" data-testid={rest['data-testid'] ?? 'ai-answer'} data-mode={view.mode}>
      <AiCard
        title={title ?? (view.mode === 'hint' ? t('exams.answers.hintTitle') : tp('ai.card.from', k, { n: k }))}
        model={view.model}
        {...(view.fallback ? { fallbackOf: view.requested.label } : {})}
        {...(named ? { askedBy: named } : {})}
        {...(view.at ? { at: shortDate(i18n, view.at, now) } : {})}
        grounded={grounded && state !== 'streaming' && view.mode !== 'hint' && view.text ? view.grounded : undefined}
        footer={actions}
        state={state}
      >
        {view.text ? (
          <AnswerBody text={view.text} citations={citations} unverified={unverified} onChip={onChip} openRef={open?.c.ref ?? null} onLink={onLink} />
        ) : state === 'streaming' ? null : <p className="t-muted">—</p>}
        {extra}
      </AiCard>
      {state !== 'streaming' && unverified.length ? (
        <Notice tone="warning" data-testid="ai-unverified">
          {tp('exams.answers.unverified', unverified.length, { n: unverified.length })}
        </Notice>
      ) : null}
      {sources && state !== 'streaming' && citations.length ? (
        <section className="ai-sources" aria-label={t('exams.answers.sources')} data-testid="ai-sources">
          <h3 className="ai-sources__title">{t('exams.answers.sources')}</h3>
          <div className="ai-sources__list">
            {citations.map((c) => (
              <SourceRow
                key={c.ref}
                citation={c}
                onOpen={(x) => {
                  if (x.status === 'hallucinated') {
                    const el = document.querySelector<HTMLElement>(`[data-testid="${rest['data-testid'] ?? 'ai-answer'}"] [data-testid="source-row"][data-index="${x.n}"]`);
                    if (el) setOpen({ c: x, el });
                    return;
                  }
                  openCitation(x);
                  onNavigate?.();
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {open && anchor ? (
        <CitationPopover
          citation={open.c}
          anchor={anchor}
          onClose={() => setOpen(null)}
          onOpen={(play) => {
            const c = open.c;
            setOpen(null);
            openCitation(c, !!play);
            onNavigate?.();
          }}
        />
      ) : null}
    </div>
  );
}
