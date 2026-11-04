// Ask (UX §3.11): private conversations about one class (the class tab) or about all classes (route `ask`). Threads on
// the left; the conversation, with cited answers, "Sent: your question and {n} passages. [See what was sent]" and the
// answer actions ([Post to class chat], [Copy with sources], [Save as note], [Try again], [Deep answer]); the scope
// chips (All · Lectures · Documents · Exams · 🔒 My notes, plus class chips across classes), [Allow general
// knowledge], the composer (Enter sends, Shift+Enter adds a line) and the CostLine with the per-thread model menu.
// AI off shows `[ask-off]`; errors render in the answer slot, AI_BUSY as the busy chooser (§3.15.6).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronDown, ChevronRight, Copy, Lock, MessageSquarePlus, MoreHorizontal, MessagesSquare, NotebookPen, RefreshCw, Search, SendHorizontal, Settings2, Sparkles, Telescope } from 'lucide-react';
import { detectLang, promptLang } from '../../core/ai/prompts';
import type { ClassId, ClassPath, Ulid } from '../../core/model/ids';
import type { SourceRef } from '../../core/model/files';
import { globalAskFor } from '../../services/ask';
import type { AskOptions, AskTurn } from '../../services/types/ask';
import type { AppServices } from '../../services/types/common';
import type { ClassView, ModelLabel } from '../../services/types/viewModels';
import type { ReadableStore } from '../../services/store';
import { Store } from '../../services/store';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { EmptyState, Notice } from '../../ui/components/Feedback';
import { TextArea, TextField } from '../../ui/components/Field';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { Tooltip } from '../../ui/components/Tooltip';
import { useI18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';
import { ClassChip } from '../../ui/tramado/ClassChip';
import { CostLine, costBlocked } from '../../ui/tramado/CostLine';
import { AiCard } from '../../ui/tramado/AiCard';
import { AiAnswer } from './AiAnswer';
import { AiErrorNotice, useErrorMessage } from './AiErrorNotice';
import { openPaletteWith } from './cite';
import { useQuota } from './useQuota';
import { answerNote, citesPrivate, copyWithSources, turnView } from './turns';
import './ask.css';

type Kind = 'lecture' | 'document' | 'exam';
interface Scope { all: boolean; kinds: Kind[]; mine: boolean; classes: ClassId[] }
interface Source {
  threads: ReadableStore<Array<{ threadId: Ulid; title: string; at: string; home?: ClassId }>>;
  thread(id: Ulid): ReadableStore<AskTurn[]>;
  ask(threadId: Ulid | null, q: string, scope: AskTurn['scope'], opts?: AskOptions): Promise<Ulid>;
  removeThread(id: Ulid): Promise<void>;
  renameThread(id: Ulid, title: string): Promise<void>;
}

const EMPTY_TURNS = new Store<AskTurn[]>([]);
const KINDS: Kind[] = ['lecture', 'document', 'exam'];
const KIND_KEY = { lecture: 'lectures', document: 'documents', exam: 'exams' } as const;

export interface AskViewProps {
  services: AppServices;
  /** null = all classes (route `ask`). */
  classId: ClassId | null;
  threadId?: string;
  query?: string;
  /** G2: "This lecture" / "This document" (UX §3.11): a chip, on at first, that limits the sources to one item. */
  focus?: { kind: 'lecture'; id: string } | { kind: 'document'; path: string };
  onThread(threadId: string | null): void;
}

export function AskView({ services, classId, threadId: routeThread, query, focus, onThread }: AskViewProps) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { go } = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const errorMessage = useErrorMessage(services);
  const settings = useStore(services.ai.settings);
  const classes = useStore(services.library.classes);
  const cls = classId ? classes.find((c) => c.id === classId) ?? null : null;
  const source: Source = useMemo(() => (classId ? services.forClass(classId).ask : globalAskFor(services)) as Source, [services, classId]);
  const threads = useStore(source.threads);
  const aiOnEarly = settings.enabled && (settings.key.set || !!settings.customHost);
  const [current, setCurrent] = useState<string | null>(routeThread ?? null);
  useEffect(() => setCurrent(routeThread ?? null), [routeThread]);
  // Opening Ask shows the latest conversation (unless a question is pre-filled); [New] starts an empty one.
  const opened = useRef(!!routeThread || !!query || !!focus);   // "Ask about this lecture" starts a new conversation
  useEffect(() => {
    if (opened.current || !threads.length) return;
    opened.current = true;
    setCurrent(threads[0]!.threadId);
  }, [threads]);
  useQuota(services, aiOnEarly);
  const turns = useStore(current ? source.thread(current) : EMPTY_TURNS);
  const [draft, setDraft] = useState(query ?? '');
  const [scope, setScope] = useState<Scope>({ all: true, kinds: [], mine: false, classes: [] });
  const focusKey = focus ? (focus.kind === 'lecture' ? `l:${focus.id}` : `d:${focus.path}`) : '';
  const [focusOn, setFocusOn] = useState(!!focus);
  useEffect(() => setFocusOn(!!focus), [focusKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const focusLabel = useMemo(() => {
    if (!focus || !classId) return null;
    if (focus.kind === 'document') return t('ask.scope.document', { name: focus.path.split('/').pop() ?? focus.path });
    let title = '';
    try {
      title = services.forClass(classId).lectures.list.get().find((l) => l.id === focus.id)?.title ?? '';
    } catch {
      title = '';
    }
    return title ? t('ask.scope.lecture', { title }) : null;
  }, [focusKey, classId, services, t]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [general, setGeneral] = useState(settings.generalDefault);
  const [model, setModel] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelLabel[]>([]);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const aiOn = settings.enabled && (settings.key.set || !!settings.customHost);
  const live = classes.filter((c) => !c.archived);

  useEffect(() => {
    if (!aiOn) return;
    let alive = true;
    void services.ai.catalog().then((list) => {
      if (alive) setCatalog(list.filter((m) => m.free && m.levels.includes(settings.privacy)).map((m) => services.ai.label(m.id)));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [services, aiOn, settings.privacy]);

  // New turns and streamed text keep the end of the conversation in view.
  const last = turns.at(-1);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, last?.answer.length, last?.status, current]);

  const select = (id: string | null) => {
    opened.current = true;
    setCurrent(id);
    onThread(id);
    setModel(null);
  };

  const requestScope = (s: Scope = scope): AskTurn['scope'] => {
    const kinds: Array<SourceRef['kind']> = s.all ? [] : [...s.kinds, ...(s.mine ? (['note'] as const) : [])];
    if (!classId) return { kinds, classes: s.classes };
    if (focus && focusOn && focusLabel) return focus.kind === 'lecture' ? { kinds, lectureId: focus.id as Ulid } : { kinds, docPath: focus.path as ClassPath };
    return { kinds };
  };
  const send = useCallback(async (text: string, opts: AskOptions = {}, into: string | null = current) => {
    const q = text.trim();
    if (!q) return;
    // The composer empties at once (a second Enter must not send the question twice); it comes back on a failure.
    const fromComposer = text === draft;
    if (fromComposer) setDraft('');
    try {
      const id = await source.ask(into, q, requestScope(), { general, privateNotes: scope.mine, ...(model ? { model } : {}), ...opts });
      if (id !== into) select(id);
    } catch (e) {
      if (fromComposer) setDraft((d) => d || text);
      toast.show(errorMessage(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, current, scope, general, model, draft, focusOn, focusLabel]);   // eslint-disable-line react-hooks/exhaustive-deps

  const retry = (turn: AskTurn, opts: AskOptions = {}) => void send(turn.question, { general: turn.general ?? general, ...(turn.mode ? { mode: turn.mode } : {}), ...opts });

  // Scope chips: "All" is exclusive; "My notes" adds private notes to whatever is chosen.
  const toggleKind = (k: Kind) => setScope((s) => {
    const kinds = s.kinds.includes(k) ? s.kinds.filter((x) => x !== k) : [...s.kinds, k];
    return { ...s, kinds, all: kinds.length === 0 };
  });
  const toggleClass = (id: ClassId) => setScope((s) => ({ ...s, classes: s.classes.includes(id) ? s.classes.filter((x) => x !== id) : [...s.classes, id] }));

  const qLang = detectLang(draft);
  const crossLang = !!classId && !!cls && cls.language !== 'auto' && !!qLang && promptLang(cls.language) !== qLang;
  const requests = crossLang ? 2 : 1;
  const modelId = model ?? settings.chain[0] ?? settings.model;
  const modelLabel = services.ai.label(modelId);
  const blocked = costBlocked(settings.quota, modelLabel);
  const placeholder = cls ? t('ask.placeholder', { class: cls.shortName }) : t('ask.placeholderAll');

  const latest = useMemo(() => suggestionsFor(services, classId), [services, classId]);

  const modelItems: MenuEntry[] = useMemo(() => {
    const seen = new Set<string>();
    const all = [services.ai.label(settings.chain[0] ?? settings.model), ...settings.chain.slice(1).map((id) => services.ai.label(id)), ...catalog];
    return all.filter((m) => !seen.has(m.id) && seen.add(m.id)).map((m) => ({ id: m.id, label: m.label, checked: m.id === modelId, onSelect: () => setModel(m.id), testId: 'ask-model-option' }));
  }, [catalog, settings.chain, settings.model, modelId, services]);

  const threadMenu = (id: string, title: string): MenuEntry[] => [
    { id: 'rename', label: t('ask.renameThread'), onSelect: () => setRenaming({ id, title }), testId: 'ask-thread-rename' },
    {
      id: 'delete', label: t('ask.deleteThread'), danger: true, testId: 'ask-thread-delete',
      onSelect: async () => {
        if (!(await confirm({ title: t('ask.deleteThreadConfirm'), confirmLabel: t('common.delete'), danger: true, 'data-testid': 'ask-delete-confirm' }))) return;
        await source.removeThread(id);
        if (current === id) select(null);
      },
    },
  ];

  const header = cls ? t('ask.empty.title', { class: cls.name }) : t('ask.empty.titleAll');
  // Enter or leaving the field keeps the new title (an empty or unchanged one changes nothing); Escape cancels.
  const commitRename = (id: string, title: string, before: string) => {
    setRenaming(null);
    const clean = title.trim();
    if (clean && clean !== before) void source.renameThread(id, clean).catch((e: unknown) => toast.show(errorMessage(e)));
  };

  return (
    <div className={cx('ask', !aiOn && 'ask--off')}>
      <aside className="ask__threads" aria-label={t('ask.threads')} data-testid="ask-threads">
        <div className="ask__threads-head">
          <h2 className="ask__threads-title">{t('ask.threads')}</h2>
          <Button size="sm" icon={MessageSquarePlus} onClick={() => select(null)} data-testid="ask-new">{t('ask.new')}</Button>
        </div>
        <ul className="ask__thread-list">
          {threads.map((th) => {
            const home = th.home ? classes.find((c) => c.id === th.home) : null;
            return (
              <li key={th.threadId} className={cx('ask__thread', th.threadId === current && 'ask__thread--current')} data-testid="ask-thread-item" data-thread-id={th.threadId}>
                {renaming?.id === th.threadId ? (
                  <form
                    className="ask__rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitRename(th.threadId, renaming.title, th.title);
                    }}
                  >
                    <TextField
                      label={t('ask.renameThread')}
                      value={renaming.title}
                      onChange={(v) => setRenaming({ id: th.threadId, title: v })}
                      onKeyDown={(e) => {
                        if (e.key !== 'Escape') return;
                        e.preventDefault();
                        e.stopPropagation();
                        setRenaming(null);
                      }}
                      onBlur={() => commitRename(th.threadId, renaming.title, th.title)}
                      autoFocus
                      size="sm"
                      maxLength={60}
                      data-testid="ask-rename-input"
                    />
                  </form>
                ) : (
                  <>
                    <button type="button" className="ask__thread-open" aria-current={th.threadId === current || undefined} onClick={() => select(th.threadId)}>
                      <span className="ask__thread-title">{th.title}</span>
                      <span className="ask__thread-meta">
                        {home && !classId ? <ClassChip cls={home} short /> : null}
                        <span>{i18n.relative(th.at, DateTime.fromMillis(services.ctx.clock.now()))}</span>
                      </span>
                    </button>
                    <MenuButton items={threadMenu(th.threadId, th.title)} label={t('common.more')} iconOnly icon={MoreHorizontal} variant="ghost" size="sm" align="end" data-testid="ask-thread-more" />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="ask__main" aria-label={header}>
        <div className="ask__scroll" ref={scroller} data-testid="ask-thread" data-thread-id={current ?? ''} tabIndex={-1}>
          {!aiOn ? (
            <EmptyState
              icon={Sparkles}
              title={t('ask.off.title')}
              data-testid="ask-off"
              actions={
                <>
                  <Button variant="primary" icon={Settings2} onClick={() => go({ name: 'settings', section: 'ai' })} data-testid="ask-off-setup">{t('ask.off.setUp')}</Button>
                  <Button icon={Search} onClick={() => openPaletteWith('')} data-testid="ask-off-search">{t('ask.off.search')}</Button>
                </>
              }
            >
              {t('ask.off.body')}
            </EmptyState>
          ) : turns.length === 0 ? (
            <div className="ask__empty paper-grid" data-testid="ask-empty">
              <Sparkles size={22} strokeWidth={1.5} aria-hidden className="ask__empty-icon" />
              <h2 className="ask__empty-title">{header}</h2>
              <div className="ask__suggestions">
                {latest.lecture ? (
                  <Button onClick={() => void send(t('ask.empty.summarise', { lecture: latest.lecture! }), {}, null)} data-testid="ask-suggestion">{t('ask.empty.summarise', { lecture: latest.lecture })}</Button>
                ) : null}
                {latest.exam ? (
                  <Button onClick={() => void send(t('ask.empty.quiz', { exam: latest.exam! }), {}, null)} data-testid="ask-suggestion">{t('ask.empty.quiz', { exam: latest.exam })}</Button>
                ) : null}
                <Button onClick={() => void send(t('ask.empty.topics'), {}, null)} data-testid="ask-suggestion">{t('ask.empty.topics')}</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="ask__intro t-small">{header}</p>
              <ol className="ask__turns">
                {turns.filter((turn, k) => !(turn.status === 'error' && turns.slice(k + 1).some((x) => x.question === turn.question))).map((turn) => (
                  <Turn key={turn.id} services={services} turn={turn} classId={classId} cls={cls} threadId={current} onRetry={retry} />
                ))}
              </ol>
            </>
          )}
        </div>

        {aiOn ? (
          <div className="ask__composer">
            <div className="ask__scope" role="group" aria-label={t('ask.scope.label')} data-testid="ask-scope">
              <span className="ask__scope-label t-small">{t('ask.scope.label')}</span>
              {focusLabel ? <Chip on={focusOn} onClick={() => setFocusOn((v) => !v)} testid="ask-scope-focus">{focusLabel}</Chip> : null}
              <Chip on={scope.all} onClick={() => setScope((s) => ({ ...s, all: true, kinds: [] }))} testid="ask-scope-all">{t('ask.scope.all')}</Chip>
              {KINDS.map((k) => <Chip key={k} on={!scope.all && scope.kinds.includes(k)} onClick={() => toggleKind(k)} testid={`ask-scope-${KIND_KEY[k]}`}>{t(`ask.scope.${KIND_KEY[k]}`)}</Chip>)}
              <Tooltip label={t('ask.scope.mineHint')}>
                <button type="button" className={cx('ask-chip', scope.mine && 'ask-chip--on')} aria-pressed={scope.mine} onClick={() => setScope((s) => ({ ...s, mine: !s.mine }))} data-testid="ask-scope-mine">
                  <Lock size={12} strokeWidth={2} aria-hidden /> {t('ask.scope.mine')}
                </button>
              </Tooltip>
              {!classId ? (
                <span className="ask__scope-classes">
                  {live.map((c) => (
                    <button key={c.id} type="button" className={cx('ask-chip', 'ask-chip--class', scope.classes.includes(c.id) && 'ask-chip--on')} aria-pressed={scope.classes.includes(c.id)} onClick={() => toggleClass(c.id)} data-testid="ask-scope-class" data-class-id={c.id}>
                      <ClassChip cls={c} short />
                    </button>
                  ))}
                </span>
              ) : null}
              <span className="ask__general">
                <Checkbox checked={general} onChange={setGeneral} label={t('ask.general')} data-testid="ask-general" />
              </span>
            </div>
            <form
              className="ask__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!blocked) void send(draft);
              }}
            >
              <TextArea
                ref={input}
                aria-label={placeholder}
                fieldClassName="ask__field"
                value={draft}
                onChange={setDraft}
                placeholder={placeholder}
                autoGrow
                minHeight={44}
                maxHeight={200}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (!blocked) void send(draft);
                  }
                }}
                data-testid="ask-input"
              />
              <IconButton type="submit" icon={SendHorizontal} label={t('ask.send')} variant="secondary" disabled={!draft.trim() || blocked} className="ask__send" data-testid="ask-send" />
            </form>
            <div className="ask__cost">
              {blocked ? (
                <CostLine requests={requests} quota={settings.quota} model={modelLabel} data-testid="ask-cost" />
              ) : (
                // UX §3.11: "✦ 1–2 requests · 37 free left today · Gemma 4 31B (free) ▾" — the model is the line's menu.
                <p className="costline" data-testid="ask-cost" data-model={modelLabel.id} data-requests={requests}>
                  <Sparkles size={13} strokeWidth={2} aria-hidden className="costline__icon" />
                  <span>{settings.quota && modelLabel.free ? tp('ai.cost.line', requests, { n: requests, left: settings.quota.remaining }) : tp('ai.cost.noQuota', requests, { n: requests })} ·</span>
                </p>
              )}
              <MenuButton items={modelItems} label={modelLabel.label} variant="ghost" size="sm" align="start" className="ask__model" data-testid="ask-model" />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Chip({ on, onClick, testid, children }: { on: boolean; onClick(): void; testid: string; children: React.ReactNode }) {
  return (
    <button type="button" className={cx('ask-chip', on && 'ask-chip--on')} aria-pressed={on} onClick={onClick} data-testid={testid}>
      {children}
    </button>
  );
}

/** The newest transcribed lecture and the newest exam paper (the suggested prompts of the empty state). */
function suggestionsFor(services: AppServices, classId: ClassId | null): { lecture: string | null; exam: string | null } {
  if (!classId) return { lecture: null, exam: null };
  try {
    const c = services.forClass(classId);
    const lec = [...c.lectures.list.get()].filter((l) => l.transcription.kind === 'done').sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    const paper = c.exams.list.get().papers.filter((p) => p.state === 'ready').at(-1);
    return { lecture: lec?.title ?? null, exam: paper?.title ?? null };
  } catch {
    return { lecture: null, exam: null };
  }
}

interface TurnProps {
  services: AppServices;
  turn: AskTurn;
  classId: ClassId | null;
  cls: ClassView | null;
  threadId: string | null;
  onRetry(turn: AskTurn, opts?: AskOptions): void;
}

function Turn({ services, turn, classId, cls, threadId, onRetry }: TurnProps) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { go } = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const errorMessage = useErrorMessage(services);
  const settings = useStore(services.ai.settings);
  const classes = useStore(services.library.classes);
  const [showSent, setShowSent] = useState(false);
  const home = classId ?? (turn.classOf ? Object.values(turn.classOf)[0] : undefined) ?? classes[0]?.id ?? '';
  const view = useMemo(() => turnView(services, turn, home), [services, turn, home, settings.chain]);
  const classOfCite = useCallback((c: { ref: string; source: { classId: string } | null }) => (turn.classOf?.[c.ref] ?? c.source?.classId ?? home) as ClassId, [turn.classOf, home]);

  // [Post to class chat]: one shared class, no private source (UX §3.11).
  const cited = new Set(Object.values(turn.classOf ?? {}));
  const postClass = classId ? cls : cited.size === 1 ? classes.find((c) => c.id === [...cited][0]) ?? null : null;
  const priv = citesPrivate(view);
  const canPost = !!postClass && postClass.shared && !priv;
  const post = async () => {
    if (!postClass) return;
    const ok = await confirm({ title: t('ask.postConfirm.title', { class: postClass.shortName }), body: t('ask.postConfirm.body'), confirmLabel: t('ask.postConfirm.confirm'), 'data-testid': 'ask-post-confirm' });
    if (!ok) return;
    try {
      if (classId && threadId) await services.forClass(classId).ask.postToChat(threadId, turn.id);
      else await services.forClass(postClass.id).ask.postTurn(turn);
      toast.show(t('ask.posted', { class: postClass.shortName }));
    } catch (e) {
      toast.show(errorMessage(e));
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyWithSources(view, i18n));
      toast.show(t('common.copied'));
    } catch {
      toast.show(t('errors.IO_ERROR'));
    }
  };
  const saveNote = async () => {
    const target = classId ?? home;
    try {
      const notes = services.forClass(target).notes;
      const path = await notes.create('private', turn.question.slice(0, 80));
      await notes.save('private', path, answerNote(turn.question, view, i18n, DateTime.fromMillis(services.ctx.clock.now())));
      toast.show({ message: t('ask.saved'), action: { label: t('common.open'), run: () => go({ name: 'note', classId: target, relPath: path, private: true }), testId: 'ask-saved-open' } });
    } catch (e) {
      toast.show(errorMessage(e));
    }
  };
  // The insufficient notice carries [Deep answer (4–8 requests)]; the footer does not repeat it then.
  const deepWanted = !view.insufficient && (view.grounded < 0.5 || (settings.quota?.limit ?? 0) >= 1000);
  const sent = turn.sent ?? [];

  return (
    <li className="ask-turn" data-testid="ask-turn" data-turn-id={turn.id} data-status={turn.status}>
      <div className="ask-q">
        <span className="ask-q__who">{t('ask.you')}</span>
        <p className="ask-q__text">{turn.question}</p>
      </div>
      {turn.status === 'error' && turn.error ? (
        <AiErrorNotice
          services={services}
          code={turn.error}
          onRetry={() => onRetry(turn)}
          onBusyFallback={() => onRetry(turn, { busyFallback: true })}
          {...(turn.retryAfterS ? { retryAt: Date.parse(turn.at) + turn.retryAfterS * 1000 } : {})}
        />
      ) : turn.status === 'running' && !turn.answer ? (
        <AiCard title={t('ai.card.streaming')} model={services.ai.label(turn.model ?? settings.chain[0] ?? settings.model)} state="streaming" data-testid="ai-answer">
          {null}
        </AiCard>
      ) : (
        <>
          <AiAnswer
            services={services}
            view={view}
            classId={home}
            classOf={classOfCite}
            state={turn.status === 'running' ? 'streaming' : turn.cut ? 'cut' : 'done'}
            actions={
              turn.status === 'ok' ? (
                <>
                  {postClass?.shared ? (
                    canPost ? (
                      <Button size="sm" icon={MessagesSquare} onClick={() => void post()} data-testid="ask-post">{t('ask.post')}</Button>
                    ) : (
                      <Tooltip label={priv ? t('ask.postPrivate') : t('ask.postOther')}>
                        <span className="ask__disabled-wrap" tabIndex={0}>
                          <Button size="sm" icon={MessagesSquare} disabled data-testid="ask-post">{t('ask.post')}</Button>
                        </span>
                      </Tooltip>
                    )
                  ) : null}
                  <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copy()} data-testid="ask-copy">{t('ask.copy')}</Button>
                  <Button size="sm" variant="ghost" icon={NotebookPen} onClick={() => void saveNote()} data-testid="ask-save-note">{t('ask.saveNote')}</Button>
                  <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => onRetry(turn, { mode: 'quick' })} data-testid="ask-retry">{t('ai.card.retry')}</Button>
                  {deepWanted && turn.mode !== 'deep' ? (
                    <Button size="sm" variant="ghost" icon={Telescope} onClick={() => onRetry(turn, { mode: 'deep' })} data-testid="ask-deep">{t('ai.card.deep')}</Button>
                  ) : null}
                </>
              ) : undefined
            }
          />
          {turn.status === 'ok' && turn.cut ? (
            // INT: `finish_reason: "length"` — the model ran out of room; the same question again with twice the room.
            <Notice tone="warning" data-testid="ask-cut" actions={<Button size="sm" icon={RefreshCw} onClick={() => onRetry(turn, { mode: turn.mode ?? 'quick', moreRoom: true })} data-testid="ask-more-room">{t('ai.cutoff.moreRoom')}</Button>}>
              {t('ai.cutoff.hint')}
            </Notice>
          ) : null}
          {turn.status === 'ok' && view.insufficient ? (
            <Notice tone="info" data-testid="ask-insufficient" actions={turn.mode !== 'deep' ? <Button size="sm" icon={Telescope} onClick={() => onRetry(turn, { mode: 'deep' })} data-testid="ai-deep">{t('ai.card.deepCost', { min: 4, max: 8 })}</Button> : undefined}>
              {t('exams.answers.insufficient')}
            </Notice>
          ) : null}
          {turn.status === 'ok' && turn.sent ? (
            <div className="ask-sent">
              <span className="t-small t-muted">{tp('ask.sent', sent.length, { n: sent.length })}</span>
              {sent.length ? (
                <button type="button" className="ask-sent__toggle" aria-expanded={showSent} onClick={() => setShowSent((v) => !v)} data-testid="ask-sent">
                  {showSent ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  {t('ask.seeSent')}
                </button>
              ) : null}
              {showSent ? (
                <ol className="ask-sent__list" data-testid="ask-sent-list">
                  {sent.map((s) => (
                    <li key={s.ref}>
                      <span className="ask-sent__label">{s.label}</span>
                      <span className="ask-sent__excerpt">{s.excerpt}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}
