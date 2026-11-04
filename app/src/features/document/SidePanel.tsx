// The document view's side panel (UX §3.7.2): Highlights (my private highlights and comments of this file; a click
// jumps to one), Ask (an Ask thread scoped to "This document", plus the last Explain result) and Info (type, pages,
// size, location, fingerprint, text state, added by, [Show in folder], [Read the text with AI…] for a scan).
import React, { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { FolderOpen, MessageSquare, Sparkles, Trash2 } from 'lucide-react';
import type { ClassId, Ulid } from '../../core/model/ids';
import { viewCitations } from '../../services/ai';
import type { AskTurn } from '../../services/types/ask';
import type { AppServices } from '../../services/types/common';
import type { DocSummary } from '../../services/types/documents';
import type { Annotation } from '../../services/types/notes';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { Notice, Spinner } from '../../ui/components/Feedback';
import { Tabs } from '../../ui/components/Tabs';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { AiCard } from '../../ui/tramado/AiCard';
import { CitationChip } from '../../ui/tramado/CitationChip';
import { Composer } from '../../ui/tramado/Composer';
import { MarkdownView } from '../../ui/tramado/MarkdownView';
import { MarkerIcon } from '../../ui/tramado/MarkerIcon';
import type { ViewCitation } from '../../services/types/viewModels';

export type SideTab = 'highlights' | 'ask' | 'info';
const EMPTY_TURNS: AskTurn[] = [];
const NO_TURNS = { get: () => EMPTY_TURNS, subscribe: () => () => undefined };

const threadKey = (classId: string, path: string) => `tramado.doc.askThread.${classId}.${path}`;
function readThread(classId: string, path: string): Ulid | null {
  try {
    return localStorage.getItem(threadKey(classId, path));
  } catch {
    return null;
  }
}
function writeThread(classId: string, path: string, id: Ulid) {
  try {
    localStorage.setItem(threadKey(classId, path), id);
  } catch {
    // per-device convenience
  }
}

export function SidePanel({ services, classId, doc, tab, onTab, highlights, onJump, explain, askSeed, onOcr, ocrOffer, textLabel, onOpenCitation }: {
  services: AppServices; classId: ClassId; doc: DocSummary; tab: SideTab; onTab(t: SideTab): void;
  highlights: readonly Annotation[]; onJump(a: Annotation): void;
  explain: AskTurn | 'loading' | null;
  /** A question to put in the composer (Ask about a selection). */
  askSeed: { text: string; n: number } | null;
  onOcr: (() => void) | null; ocrOffer: string | null;
  textLabel: string;
  onOpenCitation(c: ViewCitation): void;
}) {
  const { t, tp } = useI18n();
  return (
    <aside className="docside" aria-label={t('documents.view.sideToggle')} data-testid="doc-side">
      <Tabs
        value={tab}
        onChange={onTab}
        label={t('documents.view.sideToggle')}
        items={[
          { value: 'highlights', label: t('documents.view.side.highlights'), badge: highlights.length ? <span className="docside__count">{highlights.length}</span> : undefined },
          { value: 'ask', label: t('documents.view.side.ask') },
          { value: 'info', label: t('documents.view.side.info') },
        ]}
        data-testid="doc-side"
        className="docside__tabs"
      >
        <div className="docside__body">
          {tab === 'highlights' ? <Highlights services={services} classId={classId} highlights={highlights} onJump={onJump} /> : null}
          {tab === 'ask' ? <Ask services={services} classId={classId} doc={doc} explain={explain} askSeed={askSeed} onOpenCitation={onOpenCitation} /> : null}
          {tab === 'info' ? <Info services={services} classId={classId} doc={doc} onOcr={onOcr} ocrOffer={ocrOffer} textLabel={textLabel} /> : null}
        </div>
      </Tabs>
      <span className="visually-hidden">{tp('common.count.documents', 1)}</span>
    </aside>
  );
}

function Highlights({ services, classId, highlights, onJump }: { services: AppServices; classId: ClassId; highlights: readonly Annotation[]; onJump(a: Annotation): void }) {
  const { t } = useI18n();
  const toast = useToast();
  if (!highlights.length) return <p className="docside__empty t-muted" data-testid="doc-highlights-empty">{t('documents.view.highlightsEmpty')}</p>;
  const sorted = [...highlights].sort((a, b) => pageOf(a) - pageOf(b) || a.ms - b.ms);
  return (
    <ul className="docside__list" data-testid="doc-highlights">
      {sorted.map((h) => {
        const p = pageOf(h);
        return (
          <li key={h.id} className="dochl" data-testid="doc-highlight" data-index={h.id}>
            <button type="button" className="dochl__open" onClick={() => onJump(h)}>
              <span className="dochl__meta">
                {h.kind === 'comment' ? <MessageSquare size={14} aria-hidden /> : <span className="dochl__swatch" data-mk={h.colour ?? 'other'} aria-hidden />}
                {h.kind === 'highlight' && h.colour ? <span>{t(`lectures.selection.highlightKinds.${h.colour}`)}</span> : null}
                {p < Number.MAX_SAFE_INTEGER ? <span className="t-muted">{h.target?.locator.type === 'slide' ? t('documents.view.slide', { n: p }) : t('documents.view.pageShort', { n: p })}</span> : null}
              </span>
              <span className="dochl__quote">“{h.target?.quote.exact}”</span>
              {h.body ? <span className="dochl__body">{h.body}</span> : null}
              {h.anchor === 'lost' ? <span className="t-small dochl__lost">{t('documents.view.highlightLost')}</span> : null}
            </button>
            <IconButton
              icon={Trash2}
              size="sm"
              label={t('common.delete')}
              onClick={() => void services.forClass(classId).annotations.remove(h.id).then(() => toast.show(t('documents.view.highlightDeleted')), (e: unknown) => toast.error(e))}
              data-testid="doc-highlight-delete"
            />
          </li>
        );
      })}
    </ul>
  );
}

const pageOf = (a: Annotation): number => {
  const l = a.target?.locator;
  if (!l) return Number.MAX_SAFE_INTEGER;
  if (l.type === 'page') return l.page;
  if (l.type === 'article') return l.pages?.[0] ?? Number.MAX_SAFE_INTEGER;
  if (l.type === 'slide') return l.slide;
  return Number.MAX_SAFE_INTEGER;
};

function Ask({ services, classId, doc, explain, askSeed, onOpenCitation }: {
  services: AppServices; classId: ClassId; doc: DocSummary; explain: AskTurn | 'loading' | null; askSeed: { text: string; n: number } | null; onOpenCitation(c: ViewCitation): void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { go } = useRouter();
  const ai = useStore(services.ai.settings);
  const cls = services.forClass(classId);
  const [threadId, setThreadId] = useState<Ulid | null>(() => readThread(classId, doc.path));
  const turns = useStore(threadId ? cls.ask.thread(threadId) : NO_TURNS);
  const [draftKey, setDraftKey] = useState(0);
  const notesDir = cls.store.dir('notes');
  const on = ai.enabled && ai.key.set;
  const searchable = doc.extraction === 'ready';

  useEffect(() => {
    if (askSeed) setDraftKey((k) => k + 1);
  }, [askSeed]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    try {
      const id = await cls.ask.ask(threadId, q, { kinds: ['document'], docPath: doc.path });
      setThreadId(id);
      writeThread(classId, doc.path, id);
    } catch (e) {
      toast.error(e);
    }
  };

  const answer = (turn: AskTurn) => {
    const cites = viewCitations(turn.answer, turn.citations, classId, notesDir);
    const byRef = new Map(cites.map((c) => [c.ref, c]));
    return (
      <AiCard
        title={turn.question}
        model={services.ai.label(turn.model ?? ai.model)}
        state={turn.status === 'running' ? 'streaming' : turn.status === 'error' ? 'error' : 'done'}
        data-testid="doc-ask-answer"
      >
        {turn.status === 'error' ? <p className="t-muted">{t(`errors.${turn.error ?? 'INVALID'}` as 'errors.INVALID')}</p> : (
          <MarkdownView
            source={turn.answer || (turn.status === 'running' ? '…' : '')}
            links="internal-only"
            citations
            renderCite={(refs, pin, key) => (
              <span key={key} className="doc-cites">
                {refs.map((r) => {
                  const c = byRef.get(r);
                  return c ? <CitationChip key={r} citation={pin ? { ...c, pin } : c} onOpen={onOpenCitation} /> : null;
                })}
              </span>
            )}
          />
        )}
      </AiCard>
    );
  };

  return (
    <div className="docask" data-testid="doc-ask-panel">
      {explain === 'loading' ? <p className="docask__loading t-muted"><Spinner size={14} /> {t('common.working')}</p> : null}
      {explain && explain !== 'loading' ? <div className="docask__explain">{answer({ ...explain, question: t('documents.view.explainTitle') })}</div> : null}
      {!on ? (
        <Notice tone="info" icon={Sparkles} actions={<Button size="sm" onClick={() => go({ name: 'settings', section: 'ai' })} data-testid="doc-ask-setup">{t('documents.view.setUpAi')}</Button>}>
          {t('documents.view.askOff')}
        </Notice>
      ) : !searchable ? (
        <Notice tone="warning">{t('documents.view.askNoText')}</Notice>
      ) : (
        <p className="t-small t-muted docask__intro">{t('documents.view.askIntro')}</p>
      )}
      <div className="docask__turns" aria-live="polite">
        {turns.map((turn) => (
          <div key={turn.id} className="docask__turn">
            {answer(turn)}
          </div>
        ))}
      </div>
      <Composer
        key={draftKey}
        placeholder={askSeed ? `“${askSeed.text.slice(0, 120)}” — ${t('documents.view.askPlaceholder')}` : t('documents.view.askPlaceholder')}
        onSend={(text) => void ask(askSeed ? `“${askSeed.text}”\n\n${text}` : text)}
        mentions={[]}
        disabled={!on ? t('documents.view.askOff') : !searchable ? t('documents.view.askNoText') : undefined}
        className="docask__composer"
        data-testid="doc-ask-input"
      />
    </div>
  );
}

function Info({ services, classId, doc, onOcr, ocrOffer, textLabel }: { services: AppServices; classId: ClassId; doc: DocSummary; onOcr: (() => void) | null; ocrOffer: string | null; textLabel: string }) {
  const { t, tp, date } = useI18n();
  const toast = useToast();
  const size = useMemo(() => formatSize(doc.size, t), [doc.size, t]);
  const rows: Array<[string, React.ReactNode]> = [
    [t('documents.view.info.type'), t(`documents.view.kinds.${doc.kind}`)],
    ...(doc.pages !== null ? [[doc.kind === 'pptx' ? t('documents.tab.columns.pages') : t('documents.tab.columns.pages'), doc.kind === 'pptx' ? tp('common.count.slides', doc.pages) : tp('common.count.pages', doc.pages)] as [string, React.ReactNode]] : []),
    [t('documents.view.info.size'), size],
    [t('documents.view.info.location'), <span className="docinfo__path" key="p">{doc.path}</span>],
    [t('documents.view.info.hash'), doc.sha256 ? <code key="h">{doc.sha256.slice(0, 12)}</code> : '—'],
    [t('documents.view.info.text'), textLabel],
    [t('documents.view.info.addedBy'), doc.localOnly || doc.addedBy?.self ? t('common.you') : doc.addedBy?.name ?? '—'],
    [t('documents.tab.columns.date'), date(DateTime.fromMillis(doc.mtimeMs), 'medium')],
  ];
  return (
    <div className="docinfo" data-testid="doc-info">
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="docinfo__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="docinfo__actions">
        <Button size="sm" icon={FolderOpen} onClick={() => void services.forClass(classId).documents.reveal(doc.path).catch((e: unknown) => toast.error(e))} data-testid="doc-info-reveal">{t('common.showInFolder')}</Button>
        {onOcr && ocrOffer ? <Button size="sm" icon={Sparkles} onClick={onOcr} data-testid="doc-info-ocr">{ocrOffer}</Button> : null}
      </div>
    </div>
  );
}

export function formatSize(bytes: number, t: (k: 'common.size.b' | 'common.size.kb' | 'common.size.mb' | 'common.size.gb', v: { n: string | number }) => string): string {
  if (bytes < 1024) return t('common.size.b', { n: bytes });
  if (bytes < 1024 * 1024) return t('common.size.kb', { n: Math.round(bytes / 1024) });
  if (bytes < 1024 ** 3) return t('common.size.mb', { n: (bytes / 1024 / 1024).toFixed(1) });
  return t('common.size.gb', { n: (bytes / 1024 ** 3).toFixed(1) });
}
