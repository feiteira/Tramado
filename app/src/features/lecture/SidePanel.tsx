// The lecture view's side panel (UX §3.5.4): Notes (my notes for this lecture, private), AI (summary, key terms,
// Annotate with AI, Make study notes, Explain) and Markers (my markers and the exam radar's). The three panels
// stay mounted (hidden when not selected) so a running AI task or a draft note survives a tab switch.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NotebookPen, Plus, Sparkles, Trash, X } from 'lucide-react';
import type { Citation as StoredCitation } from '../../core/model/files';
import type { ClassId, Ulid } from '../../core/model/ids';
import type { Marker } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { AskTurn, ExplainStyle } from '../../services/types/ask';
import type { LectureDetail } from '../../services/types/lectures';
import type { MarkerKind, ModelLabel } from '../../services/types/viewModels';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { EmptyState, Notice, Spinner } from '../../ui/components/Feedback';
import { TextArea } from '../../ui/components/Field';
import { Tabs } from '../../ui/components/Tabs';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { AiCard } from '../../ui/tramado/AiCard';
import { CostLine } from '../../ui/tramado/CostLine';
import { MarkdownView } from '../../ui/tramado/MarkdownView';
import { MarkerIcon } from '../../ui/tramado/MarkerIcon';
import { cx } from '../../ui/cx';
import { longClock, shortClock } from '../lectures/format';

export type SideTab = 'notes' | 'ai' | 'markers';
const KINDS: readonly MarkerKind[] = ['important', 'confused', 'exam', 'todo', 'note'];

export interface ExplainRequest { text: string; segmentId: string; startMs: number; endMs: number; charStart: number; charEnd: number; seq: number }

export interface SidePanelProps {
  services: AppServices;
  classId: ClassId;
  detail: LectureDetail;
  tab: SideTab;
  onTab(tab: SideTab): void;
  ms: number;
  onSeek(ms: number, play?: boolean): void;
  /** Bumped by the N key: open a note draft at the playback time. */
  noteRequest: number;
  explain: ExplainRequest | null;
  onCloseExplain(): void;
}

export function SidePanel(p: SidePanelProps) {
  const { t } = useI18n();
  return (
    <aside className="lecture-side" aria-label={t('lectures.side.label')}>
      <Tabs
        value={p.tab}
        onChange={p.onTab}
        label={t('lectures.side.label')}
        items={[
          { value: 'notes', label: t('lectures.side.notes') },
          { value: 'ai', label: t('lectures.side.ai') },
          { value: 'markers', label: t('lectures.side.markers') },
        ]}
        data-testid="lecture-side"
      >
        <div hidden={p.tab !== 'notes'}>
          <NotesPanel {...p} />
        </div>
        <div hidden={p.tab !== 'ai'}>
          <AiPanel {...p} />
        </div>
        <div hidden={p.tab !== 'markers'}>
          <MarkersPanel {...p} />
        </div>
      </Tabs>
    </aside>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────────────────────────

function NotesPanel({ services, classId, detail, ms, onSeek, noteRequest }: SidePanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { go } = useRouter();
  const cls = services.forClass(classId);
  const id = detail.view.id as Ulid;
  const notes = detail.markers.filter((m) => m.kind === 'note');
  const [draft, setDraft] = useState<{ atMs: number; text: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const lastRequest = useRef(noteRequest);

  const startDraft = useCallback(() => setDraft({ atMs: Math.round(ms), text: '' }), [ms]);
  useEffect(() => {
    if (noteRequest !== lastRequest.current) {
      lastRequest.current = noteRequest;
      startDraft();
    }
  }, [noteRequest, startDraft]);

  const save = async () => {
    if (!draft) return;
    const text = draft.text.trim();
    setDraft(null);
    if (!text) return;
    try {
      await cls.lectures.markers.add(id, { atMs: draft.atMs, rawMs: draft.atMs, kind: 'note', note: text });
      toast.show({ message: t('record.dock.noteSaved', { time: shortClock(draft.atMs) }), tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
  };

  const openInNotes = async () => {
    setOpening(true);
    try {
      const title = t('lectures.side.notesTitle', { title: detail.view.title });
      const existing = cls.notes.list.get().find((n) => n.scope === 'private' && n.title === title);
      let path = existing?.path;
      if (!path) {
        path = await cls.notes.create('private', title);
        const lines = [`# ${title}`, ''];
        for (const n of notes) lines.push(`- [${shortClock(n.atMs)}](tramado:lecture/${id}?t=${n.atMs}) ${n.note ?? ''}`.trimEnd());
        await cls.notes.save('private', path, `${lines.join('\n')}\n`);
      }
      go({ name: 'note', classId, relPath: path, private: true });
    } catch (e) {
      toast.error(e);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="side-panel" data-testid="lecture-notes">
      <p className="side-panel__caption">{t('lectures.side.myNotes')}</p>
      {notes.length === 0 && !draft ? <p className="side-panel__empty">{t('lectures.side.noNotes')}</p> : null}
      <ul className="side-list" role="list">
        {notes.map((n) => (
          <NoteItem key={n.id} note={n} lectureId={id} services={services} classId={classId} onSeek={onSeek} />
        ))}
        {draft ? (
          <li className="side-note side-note--draft">
            <span className="side-note__time t-tabular">{shortClock(draft.atMs)}</span>
            <TextArea
              autoFocus
              autoGrow
              minHeight={36}
              maxHeight={160}
              value={draft.text}
              onChange={(text) => setDraft((d) => (d ? { ...d, text } : d))}
              placeholder={t('record.dock.noteLabel', { time: shortClock(draft.atMs) })}
              aria-label={t('record.dock.noteLabel', { time: shortClock(draft.atMs) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void save();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setDraft(null);
                }
              }}
              data-testid="lecture-note-input"
            />
            <IconButton size="sm" icon={X} label={t('common.cancel')} onClick={() => setDraft(null)} />
          </li>
        ) : null}
      </ul>
      <div className="side-panel__foot">
        <Button size="sm" icon={Plus} onClick={startDraft} aria-keyshortcuts="N" data-testid="lecture-note-add">
          {t('lectures.side.addNote', { time: shortClock(ms) })}
          <kbd className="side-kbd" aria-hidden>
            N
          </kbd>
        </Button>
        <Button size="sm" variant="ghost" icon={NotebookPen} busy={opening} onClick={() => void openInNotes()} data-testid="lecture-notes-open">
          {t('lectures.side.openNotes')}
        </Button>
      </div>
    </div>
  );
}

function NoteItem({ note, lectureId, services, classId, onSeek }: { note: Marker; lectureId: Ulid; services: AppServices; classId: ClassId; onSeek(ms: number): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const cls = services.forClass(classId);
  const [text, setText] = useState(note.note ?? '');
  useEffect(() => setText(note.note ?? ''), [note.note]);
  const commit = async () => {
    const next = text.trim();
    if (next === (note.note ?? '')) return;
    // An emptied note keeps its text (deleting is the trash button's job, never a side effect of clearing a field).
    if (!next) {
      setText(note.note ?? '');
      return;
    }
    try {
      // A marker has no edit operation: the note is replaced at the same time.
      await cls.lectures.markers.add(lectureId, { atMs: note.atMs, rawMs: note.rawMs, kind: 'note', note: next });
      await cls.lectures.markers.remove(lectureId, note.id);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <li className="side-note" data-testid="lecture-note" data-marker-id={note.id}>
      <button type="button" className="side-note__time t-tabular" onClick={() => onSeek(note.atMs)} aria-label={t('lectures.transcript.playFrom', { time: shortClock(note.atMs) })}>
        {shortClock(note.atMs)}
      </button>
      <TextArea
        autoGrow
        minHeight={32}
        maxHeight={200}
        value={text}
        onChange={setText}
        onBlur={() => void commit()}
        aria-label={t('lectures.side.noteAt', { time: shortClock(note.atMs) })}
        className="side-note__text"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
      />
      <IconButton size="sm" icon={Trash} label={t('common.delete')} onClick={() => void cls.lectures.markers.remove(lectureId, note.id).catch((e: unknown) => toast.error(e))} />
    </li>
  );
}

// ── AI ───────────────────────────────────────────────────────────────────────────────────────────

const CHARS_PER_REQUEST = 40_000;

function AiPanel({ services, classId, detail, onSeek, explain, onCloseExplain }: SidePanelProps) {
  const { t, tp } = useI18n();
  const toast = useToast();
  const { go } = useRouter();
  const cls = services.forClass(classId);
  const settings = useStore(services.ai.settings);
  const id = detail.view.id as Ulid;
  const aiOn = settings.enabled && settings.key.set;
  const chars = useMemo(() => (detail.transcript?.segments ?? []).reduce((n, s) => n + s.text.length, 0), [detail.transcript]);
  const requests = Math.ceil(chars / CHARS_PER_REQUEST) + 1;
  const model = services.ai.label(settings.model);
  const [summary, setSummary] = useState<AskTurn | null>(detail.aiNotes.summary);
  const [terms, setTerms] = useState<AskTurn | null>(detail.aiNotes.terms);
  useEffect(() => setSummary(detail.aiNotes.summary), [detail.aiNotes.summary]);
  useEffect(() => setTerms(detail.aiNotes.terms), [detail.aiNotes.terms]);
  const [running, setRunning] = useState<string | null>(null);
  const hasTranscript = !!detail.transcript && detail.transcript.segments.length > 0;

  const run = async <T,>(what: string, f: () => Promise<T>): Promise<T | null> => {
    setRunning(what);
    try {
      return await f();
    } catch (e) {
      toast.error(e);
      return null;
    } finally {
      setRunning(null);
    }
  };

  const saveAsNote = async (turn: AskTurn, kind: 'summary' | 'terms') => {
    const title = t(kind === 'summary' ? 'lectures.ai.summaryNoteTitle' : 'lectures.ai.termsNoteTitle', { title: detail.view.title });
    await run(`save-${kind}`, async () => {
      const path = await cls.notes.create('private', title);
      await cls.notes.save('private', path, `# ${title}\n\n${timeLinked(turn, id)}\n`);
      toast.show({ message: t('lectures.ai.savedAsNote'), tone: 'success', action: { label: t('common.open'), run: () => go({ name: 'note', classId, relPath: path, private: true }) } });
    });
  };

  if (!aiOn) {
    return (
      <div className="side-panel" data-testid="lecture-ai">
        <EmptyState icon={Sparkles} title={t('lectures.ai.off')} actions={<Button variant="primary" onClick={() => go({ name: 'settings', section: 'ai' })} data-testid="lecture-ai-setup">{t('lectures.ai.setUp')}</Button>} data-testid="lecture-ai-off" />
      </div>
    );
  }

  const cost = <CostLine requests={requests} quota={settings.quota} model={model} />;
  return (
    <div className="side-panel side-panel--ai" data-testid="lecture-ai">
      {explain ? <ExplainArea key={explain.seq} services={services} classId={classId} detail={detail} request={explain} onClose={onCloseExplain} onSeek={onSeek} /> : null}
      {!hasTranscript ? <p className="side-panel__empty">{t('lectures.ai.needsTranscript')}</p> : null}
      <ToolCard
        title={t('lectures.ai.summary')}
        testid="lecture-summary"
        result={summary}
        onSeek={onSeek}
        detail={detail}
        label={services.ai.label}
        actions={
          summary ? (
            <>
              <Button size="sm" variant="ghost" busy={running === 'summary'} disabled={!hasTranscript} onClick={() => void run('summary', () => cls.ask.summarize(id)).then((r) => r && setSummary(r))}>
                {t('lectures.ai.regenerate')}
              </Button>
              <Button size="sm" variant="ghost" busy={running === 'save-summary'} onClick={() => void saveAsNote(summary, 'summary')}>
                {t('lectures.ai.saveAsNote')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" icon={Sparkles} busy={running === 'summary'} disabled={!hasTranscript} onClick={() => void run('summary', () => cls.ask.summarize(id)).then((r) => r && setSummary(r))} data-testid="lecture-summary-run">
              {t('lectures.ai.summaryRun')}
            </Button>
          )
        }
        cost={summary ? null : cost}
      />
      <ToolCard
        title={t('lectures.ai.terms')}
        testid="lecture-terms"
        result={terms}
        onSeek={onSeek}
        detail={detail}
        label={services.ai.label}
        actions={
          terms ? (
            <>
              <Button size="sm" variant="ghost" busy={running === 'terms'} disabled={!hasTranscript} onClick={() => void run('terms', () => cls.ask.keyTerms(id)).then((r) => r && setTerms(r))}>
                {t('lectures.ai.regenerate')}
              </Button>
              <Button size="sm" variant="ghost" busy={running === 'save-terms'} onClick={() => void saveAsNote(terms, 'terms')}>
                {t('lectures.ai.saveAsNote')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" icon={Sparkles} busy={running === 'terms'} disabled={!hasTranscript} onClick={() => void run('terms', () => cls.ask.keyTerms(id)).then((r) => r && setTerms(r))} data-testid="lecture-terms-run">
              {t('lectures.ai.termsRun')}
            </Button>
          )
        }
        cost={terms ? null : cost}
      />
      <section className="side-tool" data-testid="lecture-annotate">
        <h3 className="side-tool__title">{t('lectures.ai.annotate')}</h3>
        <p className="side-tool__hint">{t('lectures.ai.annotateHint')}</p>
        <div className="side-tool__actions">
          <Button
            size="sm"
            icon={Sparkles}
            busy={running === 'annotate'}
            disabled={!hasTranscript}
            onClick={() =>
              void run('annotate', async () => {
                const started = Date.now() - 1000;
                const n = await cls.ask.annotate(id);
                toast.show({
                  message: tp('lectures.ai.annotated', n, { n }),
                  tone: 'success',
                  action: {
                    label: t('common.undo'),
                    run: async () => {
                      const source = { kind: 'lecture' as const, lectureId: id, audioSha256: detail.lecture.audio?.sha256 ?? null, transcriptRevision: detail.transcript?.revision ?? 0 };
                      for (const a of cls.annotations.forSource(source).get()) if (a.ai && a.ms >= started) await cls.annotations.remove(a.id);
                    },
                  },
                });
              })
            }
            data-testid="lecture-annotate-run"
          >
            {t('lectures.ai.annotateRun')}
          </Button>
        </div>
        {cost}
      </section>
      <section className="side-tool" data-testid="lecture-study-notes">
        <h3 className="side-tool__title">{t('lectures.ai.studyNotes')}</h3>
        <p className="side-tool__hint">{t('lectures.ai.studyNotesHint')}</p>
        <div className="side-tool__actions">
          <Button
            size="sm"
            icon={Sparkles}
            busy={running === 'study'}
            disabled={!hasTranscript}
            onClick={() =>
              void run('study', async () => {
                const path = await cls.ask.studyNotes(id);
                go({ name: 'note', classId, relPath: path, private: true });
              })
            }
            data-testid="lecture-study-notes-run"
          >
            {t('lectures.ai.studyNotesRun')}
          </Button>
        </div>
        {cost}
      </section>
    </div>
  );
}

/** `[S3]` markers of a lecture turn → `[41:12](tramado:lecture/<id>?t=<ms>)` links (a saved note). */
function timeLinked(turn: AskTurn, lectureId: Ulid): string {
  const at = new Map<string, number>();
  for (const c of turn.citations as unknown as StoredCitation[]) if (c.locator?.type === 'segment') at.set(c.ref, c.locator.startMs);
  return turn.answer.replace(/\[(S\d{1,3})(?:,\s*[^\]]*)?\]/g, (m, ref: string) => {
    const ms = at.get(ref);
    return ms === undefined ? '' : `[${shortClock(ms)}](tramado:lecture/${lectureId}?t=${ms})`;
  });
}

function ToolCard({ title, testid, result, actions, cost, onSeek, detail, label }: { title: string; testid: string; result: AskTurn | null; actions: React.ReactNode; cost: React.ReactNode; onSeek(ms: number): void; detail: LectureDetail; label(id: string): ModelLabel }) {
  return (
    <section className={cx('side-tool', result && 'side-tool--result')} data-testid={testid}>
      {result ? (
        <TurnCard turn={result} title={title} onSeek={onSeek} detail={detail} label={label} footer={<div className="side-tool__actions">{actions}</div>} />
      ) : (
        <>
          <h3 className="side-tool__title">{title}</h3>
          <div className="side-tool__actions">{actions}</div>
          {cost}
        </>
      )}
    </section>
  );
}

function TurnCard({ turn, title, onSeek, detail, footer, label }: { turn: AskTurn; title: string; onSeek(ms: number): void; detail: LectureDetail; footer?: React.ReactNode; label(id: string): ModelLabel }) {
  const { t } = useI18n();
  const cites = turn.citations as unknown as StoredCitation[];
  if (turn.status === 'error') return <Notice tone="danger" title={title}>{t(`errors.${turn.error ?? 'IO_ERROR'}` as never)}</Notice>;
  return (
    <AiCard title={title} model={turn.model ? label(turn.model) : { id: '', label: '', free: false }} state={turn.status === 'running' ? 'streaming' : 'done'} footer={footer}>
      <MarkdownView
        source={turn.answer}
        links="internal-only"
        citations
        renderCite={(refs, pin, key) => (
          <React.Fragment key={key}>
            {refs.map((ref) => {
              const c = cites.find((x) => x.ref === ref);
              if (!c) return null;
              const ms = c.locator?.type === 'segment' ? c.locator.startMs : null;
              return ms !== null && c.source.kind === 'lecture' && c.source.lectureId === detail.view.id ? (
                <button key={ref} type="button" className="time-chip t-tabular" onClick={() => onSeek(ms)} aria-label={t('lectures.transcript.playFrom', { time: shortClock(ms) })} data-testid="time-chip">
                  {shortClock(ms)}
                </button>
              ) : (
                <span key={ref} className="time-chip time-chip--doc" title={c.label}>
                  {c.label}
                  {pin ? `, ${pin}` : ''}
                </span>
              );
            })}
          </React.Fragment>
        )}
      />
    </AiCard>
  );
}

function ExplainArea({ services, classId, detail, request, onClose, onSeek }: { services: AppServices; classId: ClassId; detail: LectureDetail; request: ExplainRequest; onClose(): void; onSeek(ms: number): void }) {
  const { t, meta } = useI18n();
  const cls = services.forClass(classId);
  const settings = useStore(services.ai.settings);
  const [turn, setTurn] = useState<AskTurn | null>(null);
  const [style, setStyle] = useState<ExplainStyle | null>(null);
  const [sentOpen, setSentOpen] = useState(false);
  const ask = useCallback(
    (s: ExplainStyle | null) => {
      setStyle(s);
      setTurn(null);
      const source = { kind: 'lecture' as const, lectureId: detail.view.id, audioSha256: detail.lecture.audio?.sha256 ?? null, transcriptRevision: detail.transcript?.revision ?? 0 };
      const locator = { type: 'segment' as const, segmentId: request.segmentId, startMs: request.startMs, endMs: request.endMs, charStart: request.charStart, charEnd: request.charEnd };
      void cls.ask.explain({ text: request.text, source, locator } as never, s ?? 'detail').then(setTurn, () => setTurn({ id: '', question: request.text, scope: { kinds: [] }, answer: '', citations: [], model: null, status: 'error', error: 'IO_ERROR', at: '' }));
    },
    [cls, detail, request],
  );
  useEffect(() => ask(null), [ask]);
  const transcriptLang = (detail.transcript?.language ?? '').slice(0, 2);
  const chips: Array<{ id: ExplainStyle; label: string }> = [
    { id: 'simpler', label: t('lectures.ai.explainChips.simpler') },
    { id: 'detail', label: t('lectures.ai.explainChips.detail') },
    { id: 'example', label: t('lectures.ai.explainChips.example') },
    ...(transcriptLang && transcriptLang !== meta.bcp47.slice(0, 2) ? [{ id: 'translate' as const, label: t('lectures.ai.explainChips.inLanguage', { language: meta.nativeName }) }] : []),
    { id: 'exam', label: t('lectures.ai.explainChips.exam') },
  ];
  const provider = settings.customHost?.label ?? 'OpenRouter';
  return (
    <section className="side-tool side-tool--explain" data-testid="lecture-explain">
      <header className="side-tool__head">
        <h3 className="side-tool__title">{t('lectures.ai.explainTitle')}</h3>
        <IconButton size="sm" icon={X} label={t('common.close')} onClick={onClose} />
      </header>
      <blockquote className="cite-block side-quote reading">{request.text}</blockquote>
      {turn ? <TurnCard turn={turn} title={t('lectures.ai.explainTitle')} onSeek={onSeek} detail={detail} label={services.ai.label} /> : <p className="side-panel__loading"><Spinner size={14} /> {t('common.working')}</p>}
      <div className="explain-chips" role="group" aria-label={t('lectures.ai.explainTitle')}>
        {chips.map((c) => (
          <button key={c.id} type="button" className={cx('explain-chip', style === c.id && 'explain-chip--on')} aria-pressed={style === c.id} disabled={!turn} onClick={() => ask(c.id)} data-testid="explain-chip">
            {c.label}
          </button>
        ))}
      </div>
      {turn?.status === 'ok' ? (
        <p className="side-tool__hint">
          {t('lectures.ai.sentTo', { provider, n: Math.max(0, (turn.sent?.length ?? 1) - 1) })}{' '}
          <button type="button" className="link-button" onClick={() => setSentOpen((o) => !o)} aria-expanded={sentOpen}>
            {t('lectures.ai.seeSent')}
          </button>
        </p>
      ) : null}
      {sentOpen && turn?.sent ? (
        <ul className="sent-list">
          {turn.sent.map((s) => (
            <li key={s.ref}>
              <strong>{s.label || s.ref}</strong> {s.excerpt}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ── Markers ──────────────────────────────────────────────────────────────────────────────────────

function MarkersPanel({ services, classId, detail, onSeek }: SidePanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const cls = services.forClass(classId);
  const id = detail.view.id as Ulid;
  const [filter, setFilter] = useState<ReadonlySet<MarkerKind>>(new Set());
  const mine = detail.markers.filter((m) => filter.size === 0 || filter.has(m.kind));
  const auto = filter.size === 0 || filter.has('exam') ? detail.autoMarkers : [];
  const toggle = (k: MarkerKind) => setFilter((f) => {
    const n = new Set(f);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const segText = (segmentId: string) => detail.transcript?.segments.find((s) => s.id === segmentId)?.text ?? '';
  return (
    <div className="side-panel" data-testid="lecture-markers">
      <div className="marker-filters" role="group" aria-label={t('lectures.side.markers')}>
        {KINDS.map((k) => (
          <button key={k} type="button" className={cx('marker-filter', filter.has(k) && 'marker-filter--on')} data-mk={k} aria-pressed={filter.has(k)} onClick={() => toggle(k)} data-testid="lecture-marker-filter">
            <MarkerIcon kind={k} size={14} />
            <span>{t(`record.markers.${k}`)}</span>
          </button>
        ))}
      </div>
      {detail.markers.length === 0 && detail.autoMarkers.length === 0 ? <p className="side-panel__empty">{t('lectures.side.markersEmpty')}</p> : null}
      <ul className="side-list" role="list" aria-label={t('a11y.markerList')}>
        {mine.map((m) => (
          <li key={m.id} className="side-marker" data-testid="lecture-marker" data-mk={m.kind} data-marker-id={m.id}>
            <MarkerIcon kind={m.kind} size={16} />
            <button type="button" className="side-marker__main" onClick={() => onSeek(m.atMs)} title={t('a11y.markerItem', { kind: t(`record.markers.${m.kind}`), time: longClock(m.atMs), note: m.note ? `: ${m.note}` : '' })}>
              <span className="side-marker__label">{t(`record.markers.${m.kind}`)}</span>
              <span className="side-marker__time t-tabular">{shortClock(m.atMs)}</span>
              {m.note ? <span className="side-marker__note">{m.note}</span> : null}
            </button>
            <IconButton size="sm" icon={Trash} label={t('common.delete')} onClick={() => void cls.lectures.markers.remove(id, m.id).catch((e: unknown) => toast.error(e))} data-testid="lecture-marker-delete" />
          </li>
        ))}
      </ul>
      {auto.length > 0 ? (
        <>
          <h3 className="side-panel__subhead">{t('lectures.side.found')}</h3>
          <p className="side-tool__hint">{t('lectures.side.foundHint')}</p>
          <ul className="side-list" role="list">
            {auto.map((a) => (
              <li key={`${a.segmentId}-${a.atMs}`} className="side-marker" data-testid="lecture-auto-marker" data-mk="exam">
                <MarkerIcon kind="exam" auto size={16} className="side-marker__auto-icon" />
                <button type="button" className="side-marker__main" onClick={() => onSeek(a.atMs)}>
                  <span className="side-marker__label">{t('record.markers.auto')}</span>
                  <span className="side-marker__time t-tabular">{shortClock(a.atMs)}</span>
                  <span className="side-marker__note">{segText(a.segmentId)}</span>
                </button>
                <Button size="sm" variant="ghost" onClick={() => void cls.lectures.markers.removeAuto(id, a.atMs).catch((e: unknown) => toast.error(e))} data-testid="lecture-auto-marker-remove">
                  {t('lectures.side.removeAuto')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
