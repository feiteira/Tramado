// The lecture view (UX §3.5): header with Ask and [⋯]; the player and the timeline, fixed above a split of the
// transcript (find, follow-along, legal references, highlights, AI notes, corrections in edit mode) and the side
// panel (Notes, AI, Markers; a drawer below 1 100 px of main width). While there is no transcript the
// transcription card takes its place. Keys (focus not in text, no modal): Space, ←/→ (Shift: 30 s), [ and ],
// F follow, N note, 1–4 markers, E edit, Ctrl/⌘+F find.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Download, CircleCheck, PanelRight, Pencil, Search, Sparkles, TriangleAlert, X, ChevronDown, ChevronUp, Ellipsis, MessageSquare, Highlighter, Copy, Lock } from 'lucide-react';
import { DateTime } from 'luxon';
import type { MarkerKind, Segment } from '../../core/model/files';
import type { ClassId, ClassPath, SegmentId, Ulid } from '../../core/model/ids';
import { quoteOf, reanchor, segmentAt, segmentLocator } from '../../core/transcript/anchors';
import type { Paragraph } from '../../core/transcript/render';
import type { AppServices } from '../../services/types/common';
import type { LectureDetail } from '../../services/types/lectures';
import type { Annotation } from '../../services/types/notes';
import type { Route } from '../../shell/routes';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useStore } from '../../shell/useStore';
import { useKeyLabel } from '../../shell/keys';
import { Missing } from '../../shell/Placeholder';
import { useAppState } from '../../shell/AppState';
import { Button, IconButton } from '../../ui/components/Button';
import { Badge, Notice } from '../../ui/components/Feedback';
import { TextArea } from '../../ui/components/Field';
import { Menu, MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { Popover } from '../../ui/components/Popover';
import { SplitPane } from '../../ui/components/SplitPane';
import { Toolbar } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { isTextEntry, modalOpen } from '../../ui/focus';
import { scrollBehavior } from '../../ui/media';
import type { Rect } from '../../ui/position';
import { cx } from '../../ui/cx';
import { Player, PLAYER_RATES, type PlayerHandle } from '../../ui/tramado/Player';
import { Timeline, type TimelineMarker } from '../../ui/tramado/Timeline';
import { TranscriptView, type TvDecoration, type TvRef, type TvSegment } from '../../ui/tramado/TranscriptView';
import { useLectureActions } from '../lectures/actions';
import { cardModel, TranscriptionCard } from '../lectures/TranscriptionCard';
import { duration, findAll, firstName, longClock, rowDate, shortClock, spokenTime } from '../lectures/format';
import { lastPlayback, usePlayback } from './playback';
import { SidePanel, type ExplainRequest, type SideTab } from './SidePanel';
import { SpeakersDialog } from './SpeakersDialog';
import './lecture.css';

type LectureRoute = Extract<Route, { name: 'lecture' }>;
const MARKER_KEYS: Record<string, MarkerKind> = { '1': 'important', '2': 'confused', '3': 'exam', '4': 'todo' };
const SIDE_BREAKPOINT = 1100;

export default function LectureScreen({ route, services }: { route: LectureRoute; services: AppServices }) {
  const cls = services.forClass(route.classId);
  const store = useMemo(() => cls.lectures.open(route.lectureId), [cls, route.lectureId]);
  const detail = useStore(store);
  const list = useStore(cls.lectures.list);
  const st = useStore(cls.store.state);
  const [patience, setPatience] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPatience(true), 4000);
    return () => clearTimeout(timer);
  }, [route.lectureId]);
  if (!detail) {
    const gone = (st.status === 'ready' && list.length > 0 && !list.some((l) => l.id === route.lectureId)) || (patience && st.status !== 'loading' && !list.some((l) => l.id === route.lectureId));
    if (gone || st.status === 'missing') return <Missing what="lecture" />;
    return <LectureSkeleton />;
  }
  return <LectureLoaded key={route.lectureId} route={route} services={services} detail={detail} />;
}

function LectureSkeleton() {
  const { t } = useI18n();
  return (
    <div className="lecture-screen" data-testid="screen-lecture" aria-busy="true">
      <ScreenHeader title={<span className="skeleton skeleton--title" aria-label={t('common.loading')} />} />
      <div className="lecture-player lecture-player--skeleton" data-testid="lecture-loading">
        <span className="skeleton skeleton--player" />
        <span className="skeleton skeleton--wave" />
      </div>
      <div className="lecture-skeleton-text">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="lecture-skeleton-para">
            <span className="skeleton skeleton--time" />
            <span className="skeleton skeleton--line" style={{ width: `${88 - (i % 3) * 14}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface Selection { rect: Rect; text: string; segmentId: SegmentId; start: number; end: number }

function LectureLoaded({ route, services, detail }: { route: LectureRoute; services: AppServices; detail: LectureDetail }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const toast = useToast();
  const { go, replace } = useRouter();
  const key = useKeyLabel();
  const app = useAppState();
  const classId = route.classId as ClassId;
  const lectureId = route.lectureId as Ulid;
  const cls = services.forClass(classId);
  const classView = useStore(services.library.classes).find((c) => c.id === classId);
  const identity = useStore(services.ctx.identity);
  const actions = useLectureActions(services, classId);
  const view = detail.view;
  const transcript = detail.transcript;
  const shared = !!classView?.shared;
  const audioPath = (cls.store.state.get().index.lectures.get(lectureId)?.dir ?? null) !== null ? (() => {
    const dir = cls.store.state.get().index.lectures.get(lectureId)!.dir;
    return (dir ? `${dir}/audio.webm` : 'audio.webm') as ClassPath;
  })() : null;
  const playback = usePlayback(services, classId, detail, audioPath);
  const player = useRef<PlayerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);

  // ── playback state ──
  const [ms, setMs] = useState(route.at ?? 0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(() => Number(app.prefsStore?.get('lecture.playbackRate' as never)) || 1);
  const setRate = useCallback((r: number) => {
    const next = Math.min(3, Math.max(0.5, r));
    setRateState(next);
    void app.setPref('lecture.playbackRate' as never, String(next));
  }, [app]);
  const [follow, setFollow] = useState(true);
  const [followPaused, setFollowPaused] = useState(false);
  const onTime = useCallback((t: number, p: boolean) => {
    setMs(t);
    lastPlayback.set({ classId, lectureId, ms: t });
    setPlaying(p);
  }, [classId, lectureId]);
  const seek = useCallback((target: number, play = false) => {
    const h = player.current;
    if (h) {
      h.seek(target);
      if (play) h.play();
    }
    setMs(target);
  }, []);

  // ── layout: side panel or drawer ──
  const [narrow, setNarrow] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useLayoutEffect(() => {
    const el = screen.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < SIDE_BREAKPOINT));
    ro.observe(el);
    setNarrow(el.clientWidth < SIDE_BREAKPOINT);
    return () => ro.disconnect();
  }, []);
  // Opening the drawer moves focus into it (unless something in it already took focus, like a new note).
  useEffect(() => {
    if (!drawer) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = screen.current?.querySelector<HTMLElement>('.lecture-drawer');
      if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [drawer]);
  const [sideTab, setSideTab] = useState<SideTab>('notes');
  const [noteRequest, setNoteRequest] = useState(0);
  const [explain, setExplain] = useState<ExplainRequest | null>(null);
  const openSide = (tab: SideTab) => {
    setSideTab(tab);
    if (narrow) setDrawer(true);
  };

  // ── the current segment ──
  const segments = transcript?.segments ?? [];
  const current = useMemo(() => {
    if (!segments.length || (!playing && ms === 0 && !route.at)) return null;
    const s = segmentAt({ segments }, ms);
    return s && ms >= s.startMs - 500 ? s.id : null;
  }, [segments, ms, playing, route.at]);

  // ── citation arrival (UX §4.5): seek, mark the quote, scroll to it, flash ──
  const cited = useMemo(() => {
    if (!transcript || !route.segmentId) return null;
    const seg = transcript.segments.find((s) => s.id === route.segmentId) ?? transcript.segments.find((s) => s.merged?.includes(route.segmentId!));
    const base = seg ?? segmentAt(transcript, route.at ?? 0);
    if (!base) return null;
    const q = route.quote ? { exact: route.quote, prefix: '', suffix: '' } : null;
    const r = reanchor(transcript, segmentLocator({ id: route.segmentId, startMs: route.at ?? base.startMs, endMs: (route.at ?? base.startMs) + 1 }), q);
    const loc = r.locator;
    const target = transcript.segments.find((s) => s.id === loc.segmentId) ?? base;
    return { segmentId: target.id, start: loc.charStart ?? 0, end: loc.charEnd ?? target.text.length };
  }, [transcript, route.segmentId, route.quote, route.at]);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !player.current && !playback.media && !playback.src) return;
    arrived.current = true;
    if (route.at !== undefined) {
      const at = route.play ? Math.max(0, route.at - 10_000) : route.at;
      setTimeout(() => seek(at, !!route.play), 0);
    }
  }, [route.at, route.play, seek, playback.media, playback.src]);
  // Bring the cited (or `at`) segment to the middle, again once the reading font has loaded and the paragraphs
  // reflowed, unless the student scrolled meanwhile.
  const userScrolled = useRef(false);
  useEffect(() => {
    const id = cited?.segmentId ?? (route.at !== undefined && transcript ? segmentAt(transcript, route.at)?.id : null);
    if (!id) return undefined;
    let live = true;
    const center = () => {
      if (!live || userScrolled.current) return;
      const box = scroller.current;
      const el = box?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(id)}"]`);
      if (!box || !el) return;
      const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTop = Math.max(0, top - box.clientHeight / 2 + el.offsetHeight / 2);
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(center));
    const late = setTimeout(center, 450);
    void document.fonts?.ready.then(() => requestAnimationFrame(center));
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      clearTimeout(late);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!transcript, cited?.segmentId]);

  // ── follow along ──
  useEffect(() => {
    if (!follow || followPaused || !playing || !current) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(current)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  }, [current, follow, followPaused, playing]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const manual = () => {
      userScrolled.current = true;
      if (follow && playing) setFollowPaused(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key) && !isTextEntry(e.target)) manual();
    };
    el.addEventListener('wheel', manual, { passive: true });
    el.addEventListener('touchmove', manual, { passive: true });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', manual);
      el.removeEventListener('touchmove', manual);
      el.removeEventListener('keydown', onKey);
    };
  }, [follow, playing]);
  const resumeFollow = () => {
    setFollowPaused(false);
    if (current) scroller.current?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(current)}"]`)?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  };

  // ── find ──
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => {
    if (!findOpen || !findQ.trim() || !transcript) return [];
    const out: Array<{ segmentId: SegmentId; start: number; end: number; ms: number }> = [];
    for (const s of transcript.segments) for (const [a, b] of findAll(s.text, findQ)) out.push({ segmentId: s.id, start: a, end: b, ms: s.startMs });
    return out;
  }, [findOpen, findQ, transcript]);
  useEffect(() => setFindIndex(0), [findQ]);
  const activeHit = hits.length ? hits[Math.min(findIndex, hits.length - 1)] : null;
  useEffect(() => {
    if (!activeHit) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(activeHit.segmentId)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  }, [activeHit]);
  const openFind = useCallback(() => {
    setFindOpen(true);
    setTimeout(() => findInput.current?.select(), 0);
  }, []);
  const stepHit = (d: 1 | -1) => hits.length && setFindIndex((i) => (i + d + hits.length) % hits.length);

  // ── edit mode (transcript corrections, in 0.1) ──
  const canEdit = detail.canEdit && !view.newerFormat && !!transcript && !transcript.newer;
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<SegmentId | null>(null);
  const [speakersOpen, setSpeakersOpen] = useState(false);
  const caret = useRef<{ id: SegmentId; at: number } | null>(null);
  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);

  // ── annotations (private highlights, comments, AI notes) ──
  const source = useMemo(() => ({ kind: 'lecture' as const, lectureId, audioSha256: detail.lecture.audio?.sha256 ?? null, transcriptRevision: transcript?.revision ?? 0 }), [lectureId, detail.lecture.audio?.sha256, transcript?.revision]);
  const annStore = useMemo(() => cls.annotations.forSource(source), [cls, source]);
  const annotations = useStore(annStore);
  const [openAnnotation, setOpenAnnotation] = useState<{ a: Annotation; el: HTMLElement } | null>(null);

  // ── decorations for the transcript view ──
  const decorations = useMemo<TvDecoration[]>(() => {
    const out: TvDecoration[] = [];
    for (const a of annotations) {
      if (!a.target) continue;
      const loc = a.target.locator;
      if (a.target.source.kind !== 'lecture' || loc.type !== 'segment' || a.anchor === 'lost') continue;
      const seg = segments.find((s) => s.id === loc.segmentId);
      if (!seg) continue;
      const start = loc.charStart ?? 0;
      const end = loc.charEnd ?? seg.text.length;
      if (a.ai) out.push({ segmentId: seg.id, start, end, kind: 'ai', id: a.id, title: a.body ? `${a.body} — ${t('lectures.annotation.aiBy', { model: a.ai.model })}` : t('lectures.annotation.aiBy', { model: a.ai.model }) });
      else if (a.kind === 'comment') out.push({ segmentId: seg.id, start, end, kind: 'comment', id: a.id, title: a.body });
      else out.push({ segmentId: seg.id, start, end, kind: 'hl', mk: a.colour ?? 'other', id: a.id, title: t('a11y.highlighted', { kind: t(`lectures.selection.highlightKinds.${a.colour ?? 'other'}`) }) });
    }
    hits.forEach((h, i) => out.push({ segmentId: h.segmentId, start: h.start, end: h.end, kind: activeHit && i === Math.min(findIndex, hits.length - 1) ? 'hitActive' : 'hit' }));
    if (cited) out.push({ segmentId: cited.segmentId, start: cited.start, end: cited.end, kind: 'cite' });
    return out;
  }, [annotations, segments, hits, activeHit, findIndex, cited, t]);

  const refs = useMemo<TvRef[]>(() => detail.references.map((r, i) => ({ key: `${i}`, segmentId: r.segmentId, start: r.start, end: r.end, resolved: !!r.target })), [detail.references]);
  const inlineMarkers = useMemo(() => {
    const out: Record<string, Array<{ kind: MarkerKind; auto?: boolean }>> = {};
    if (!transcript) return out;
    for (const m of detail.markers) {
      const s = segmentAt(transcript, m.atMs);
      if (s) (out[s.id] ??= []).push({ kind: m.kind });
    }
    for (const a of detail.autoMarkers) (out[a.segmentId] ??= []).push({ kind: 'exam', auto: true });
    return out;
  }, [detail.markers, detail.autoMarkers, transcript]);
  const correctedBy = useMemo(() => {
    const out: Record<string, string> = {};
    const me = identity?.name;
    for (const [seg, names] of Object.entries(transcript?.correctedBy ?? {})) {
      const others = names.filter((n) => n !== me);
      if (others.length) out[seg] = t('lectures.transcript.correctedBy', { name: others.join(', ') });
    }
    return out;
  }, [transcript?.correctedBy, identity?.name, t]);
  const concurrent = useMemo(() => new Set(transcript?.concurrent ?? []), [transcript?.concurrent]);
  const citeSegments = useMemo(() => new Set(cited ? [cited.segmentId] : []), [cited]);
  const speakers = transcript?.speakers ?? [];
  const showSpeakers = useMemo(() => new Set(segments.map((s) => s.speaker)).size > 1, [segments]);
  const speakerLabel = useCallback((id: string) => speakers.find((s) => s.id === id)?.label ?? id, [speakers]);

  // ── markers and notes at the playback time ──
  const addMarker = useCallback(
    async (kind: MarkerKind) => {
      const at = Math.round(player.current?.ms ?? ms);
      try {
        await cls.lectures.markers.add(lectureId, { atMs: at, rawMs: at, kind });
        const label = t(`record.markers.${kind}`);
        toast.show({
          message: t('record.dock.marked', { kind: label, time: shortClock(at) }),
          action: {
            label: t('common.undo'),
            run: async () => {
              const m = cls.lectures.open(lectureId).get()?.markers.find((x) => x.kind === kind && x.atMs === at);
              if (m) await cls.lectures.markers.remove(lectureId, m.id);
            },
          },
        });
      } catch (e) {
        toast.error(e);
      }
    },
    [cls, lectureId, ms, t, toast],
  );
  const noteHere = useCallback(() => {
    setSideTab('notes');
    if (narrow) setDrawer(true);
    setNoteRequest((n) => n + 1);
  }, [narrow]);

  // ── keyboard (UX §3.5.2 and §3.5.4) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modalOpen()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openFind();
        return;
      }
      if (mod || e.altKey || isTextEntry(e.target)) return;
      const target = e.target as HTMLElement | null;
      const role = target?.getAttribute?.('role');
      if (role && ['slider', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'tab', 'option', 'radio'].includes(role)) return;
      const h = player.current;
      if (e.key === ' ' && !(target instanceof HTMLButtonElement) && !(target?.getAttribute?.('role') === 'button')) {
        e.preventDefault();
        h?.toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (target?.closest?.('[role="toolbar"], [role="tablist"], .lecture-list')) return;
        e.preventDefault();
        h?.skip((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30_000 : 5_000));
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const i = PLAYER_RATES.indexOf(rate as (typeof PLAYER_RATES)[number]);
        const next = PLAYER_RATES[Math.max(0, Math.min(PLAYER_RATES.length - 1, (i < 0 ? 2 : i) + (e.key === ']' ? 1 : -1)))]!;
        setRate(next);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setFollow((f) => !f);
        setFollowPaused(false);
      } else if ((e.key === 'e' || e.key === 'E') && canEdit) {
        e.preventDefault();
        setEditing((x) => !x);
        setEditingId(null);
      } else if (services.recording.state.get()) {
        // While recording, 1–4 and N mark the recording (features/record/Recovery.tsx).
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        noteHere();
      } else if (MARKER_KEYS[e.key]) {
        e.preventDefault();
        void addMarker(MARKER_KEYS[e.key]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFind, rate, setRate, canEdit, services, noteHere, addMarker]);

  // ── selection toolbar (UX §3.5.3) ──
  const [selection, setSelection] = useState<Selection | null>(null);
  const [commenting, setCommenting] = useState<Selection | null>(null);
  const [lastKind, setLastKind] = useState<MarkerKind | 'other'>('important');
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) {
      setSelection(null);
      return undefined;
    }
    const read = () => {
      const sel = window.getSelection();
      const root = scroller.current;
      if (!sel || sel.isCollapsed || !root || sel.rangeCount === 0) {
        setSelection((s) => (s && toolbarRef.current?.contains(document.activeElement) ? s : null));
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const pos = (node: Node, offset: number) => {
        const el = node.nodeType === 3 ? node.parentElement : (node as Element);
        const run = el?.closest<HTMLElement>('[data-off]');
        return run ? { seg: run.dataset.seg ?? '', off: Number(run.dataset.off ?? 0) + (node.nodeType === 3 ? offset : 0) } : null;
      };
      const a = pos(range.startContainer, range.startOffset);
      const b = pos(range.endContainer, range.endOffset);
      if (!a) return;
      const seg = segments.find((s) => s.id === a.seg);
      if (!seg) return;
      const end = b && b.seg === a.seg ? b.off : seg.text.length;
      const text = sel.toString().trim();
      if (!text) return;
      const r = range.getBoundingClientRect();
      setSelection({ rect: { top: r.top, left: r.left, width: r.width, height: r.height }, text, segmentId: seg.id, start: Math.min(a.off, end), end: Math.max(a.off, end) });
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [editing, segments]);
  useEffect(() => {
    if (!selection) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        toolbarRef.current?.querySelector<HTMLElement>('button')?.focus();
      } else if (e.key === 'Escape') {
        setSelection(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selection]);

  const segOf = (id: SegmentId) => segments.find((s) => s.id === id);
  const highlight = async (sel: Selection, kind: MarkerKind | 'other') => {
    const seg = segOf(sel.segmentId);
    if (!seg) return;
    setLastKind(kind);
    try {
      await cls.annotations.add({
        visibility: 'private', kind: 'highlight', colour: kind === 'note' ? 'other' : (kind as 'important'),
        target: { source, locator: segmentLocator(seg, { start: sel.start, end: sel.end }), quote: quoteOf(seg.text, sel.start, sel.end) },
      });
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    } catch (e) {
      toast.error(e);
    }
  };
  const copyWithSource = async (sel: Selection) => {
    const seg = segOf(sel.segmentId);
    const text = t('lectures.selection.copyFormat', { text: sel.text, class: classView?.shortName ?? '', title: view.title, time: shortClock(seg?.startMs ?? 0) });
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: t('lectures.selection.copied'), tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
    setSelection(null);
  };
  const explainSel = (sel: Selection) => {
    const seg = segOf(sel.segmentId);
    if (!seg) return;
    setExplain({ text: sel.text, segmentId: seg.id, startMs: seg.startMs, endMs: seg.endMs, charStart: sel.start, charEnd: sel.end, seq: Date.now() });
    openSide('ai');
    setSelection(null);
  };

  // ── transcript callbacks (stable, so only changed paragraphs re-render) ──
  const onSegment = useCallback(
    (seg: TvSegment, offset: number | null) => {
      if (editing) {
        setEditingId(seg.id);
        return;
      }
      let at = seg.startMs;
      if (offset !== null && seg.words?.length) {
        let pos = 0;
        for (const w of seg.words) {
          const i = seg.text.indexOf(w.text, pos);
          if (i < 0) break;
          if (i + w.text.length >= offset) {
            at = w.startMs;
            break;
          }
          pos = i + w.text.length;
        }
      }
      const h = player.current;
      if (h) h.seek(at);
      setMs(at);
    },
    [editing],
  );
  const onTimeClick = useCallback((at: number) => seek(at, true), [seek]);
  const onRef = useCallback(
    (r: TvRef) => {
      const ref = detail.references[Number(r.key)];
      if (ref?.target) go({ name: 'document', classId, relPath: ref.target.path, ...(ref.target.page ? { page: ref.target.page } : {}) });
    },
    [detail.references, go, classId],
  );
  const onDecoration = useCallback(
    (d: TvDecoration, el: HTMLElement) => {
      const a = annotations.find((x) => x.id === d.id);
      if (a) setOpenAnnotation({ a, el });
    },
    [annotations],
  );
  const timeText = useCallback((at: number) => longClock(at), []);
  const playFromLabel = useCallback((time: string) => t('lectures.transcript.playFrom', { time }), [t]);

  const renderEditor = useCallback(
    (seg: TvSegment) => (
      <SegmentEditor
        key={seg.id}
        seg={seg}
        onCaret={(at) => (caret.current = { id: seg.id, at })}
        onCancel={() => setEditingId(null)}
        onSave={async (text, move) => {
          try {
            if (text !== seg.text) await cls.lectures.edit.setText(lectureId, seg.id, text);
          } catch (e) {
            toast.error(e);
            return;
          }
          if (!move) {
            setEditingId(null);
            return;
          }
          const i = segments.findIndex((s) => s.id === seg.id);
          const next = segments[i + move];
          setEditingId(next ? next.id : null);
        }}
      />
    ),
    [cls, lectureId, segments, toast],
  );
  const renderParaMenu = useCallback(
    (para: Paragraph) => {
      const inPara = editingId && para.segments.some((s) => s.id === editingId) ? editingId : null;
      const target = (inPara ? segments.find((s) => s.id === inPara) : para.segments[0]) as Segment | undefined;
      if (!target) return null;
      const idx = segments.findIndex((s) => s.id === target.id);
      const c = caret.current && caret.current.id === target.id ? caret.current.at : null;
      const items: MenuEntry[] = [
        { kind: 'heading', label: t('lectures.transcript.changeSpeaker') },
        ...speakers.map((sp) => ({ id: `sp-${sp.id}`, label: sp.label, checked: target.speaker === sp.id, onSelect: () => void cls.lectures.edit.setSpeaker(lectureId, target.id, sp.id).catch((e: unknown) => toast.error(e)) })),
        { id: 'sp-new', label: t('lectures.transcript.newSpeaker'), onSelect: () => void cls.lectures.edit.setSpeaker(lectureId, target.id, nextSpeakerId(speakers.map((s) => s.id))).catch((e: unknown) => toast.error(e)) },
        { kind: 'separator' },
        { id: 'split', label: t('lectures.transcript.splitHere'), disabled: c === null || c <= 0 || c >= target.text.length, onSelect: () => c !== null && void cls.lectures.edit.split(lectureId, target.id, c).then(() => setEditingId(null), (e: unknown) => toast.error(e)), testId: 'transcript-split' },
        { id: 'merge', label: t('lectures.transcript.mergeNext'), disabled: idx < 0 || idx >= segments.length - 1, onSelect: () => void cls.lectures.edit.merge(lectureId, target.id).then(() => setEditingId(null), (e: unknown) => toast.error(e)), testId: 'transcript-merge' },
        { id: 'play', label: t('lectures.transcript.playFrom', { time: shortClock(target.startMs) }), onSelect: () => seek(target.startMs, true) },
      ];
      return <MenuButton size="sm" variant="ghost" iconOnly icon={Ellipsis} label={t('lectures.transcript.segmentMenu')} items={items} className="tv-para__menu" data-testid="transcript-segment-menu" />;
    },
    [editingId, segments, speakers, cls, lectureId, t, toast, seek],
  );
  const renderConcurrent = useCallback(
    (seg: TvSegment) => (
      <span className="tv-clash-wrap" onClick={(e) => e.stopPropagation()}>
        <TriangleAlert size={14} className="tv-clash" aria-label={t('lectures.transcript.clash')} />
        <span className="tv-clash__text">{t('lectures.transcript.clash')}</span>
        {canEdit ? (
          <button type="button" className="link-button" onClick={() => void cls.lectures.edit.keep(lectureId, seg.id).catch((e: unknown) => toast.error(e))} data-testid="transcript-keep">
            {t('lectures.transcript.keepThis')}
          </button>
        ) : null}
      </span>
    ),
    [t, canEdit, cls, lectureId, toast],
  );

  // ── header ──
  const s = view.transcription;
  const lang = i18n.locale;
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const subtitle = (
    <>
      {t('lectures.view.subtitle', { date: rowDate(view.startedAt, now, i18n), duration: duration(view.durationMs, i18n), who: view.recordedBy.self ? t('common.you') : view.recordedBy.memberName })}
      {' · '}
      {shared ? t('common.sharedWithClass') : t('common.onlyThisComputer')}
    </>
  );
  const recorder = view.recordedBy.self;
  const onlyRecorder = t('lectures.list.menu.renameOnlyRecorder', { name: firstName(view.recordedBy.memberName) });
  const moreItems: MenuEntry[] = [
    {
      id: 'link', label: t('lectures.view.more.copyLink'), testId: 'lecture-copy-link',
      onSelect: () => void navigator.clipboard.writeText(`tramado:lecture/${lectureId}?t=${Math.round(ms)}`).then(() => toast.show({ message: t('lectures.view.more.linkCopied'), tone: 'success' }), (e: unknown) => toast.error(e)),
    },
    { id: 'rename', label: t('lectures.list.menu.rename'), disabled: !recorder, hint: recorder ? undefined : onlyRecorder, onSelect: () => actions.rename(view), testId: 'lecture-more-rename' },
    s.kind === 'done'
      ? { id: 'retranscribe', label: t('lectures.list.menu.retranscribe'), onSelect: () => void actions.retranscribe(view), testId: 'lecture-more-retranscribe' }
      : { id: 'transcribe', label: t('lectures.list.menu.transcribe'), disabled: s.kind === 'local' || (s.kind === 'claimed' && s.health !== 'stale') || s.kind === 'unavailable', onSelect: () => void (s.kind === 'claimed' ? actions.takeOver(lectureId) : actions.transcribeHere(lectureId)), testId: 'lecture-more-transcribe' },
    { id: 'speakers', label: t('lectures.view.more.speakers'), disabled: !canEdit, onSelect: () => setSpeakersOpen(true), testId: 'lecture-more-speakers' },
    { kind: 'heading', label: t('lectures.view.more.export') },
    { id: 'md', label: t('lectures.view.more.exportMd'), disabled: !transcript, onSelect: () => void actions.exportTranscript(view, 'md') },
    { id: 'vtt', label: t('lectures.view.more.exportVtt'), disabled: !transcript, onSelect: () => void actions.exportTranscript(view, 'vtt') },
    { id: 'txt', label: t('lectures.view.more.exportTxt'), disabled: !transcript, onSelect: () => void actions.exportTranscript(view, 'txt') },
    { kind: 'separator' },
    { id: 'deleteAudio', label: t('lectures.list.menu.deleteAudio'), disabled: !recorder || !view.audio, danger: true, onSelect: () => void actions.deleteAudio(view) },
    { id: 'deleteAll', label: t('lectures.list.menu.deleteAll'), disabled: !recorder, danger: true, onSelect: () => void actions.deleteAll(view).then((ok) => ok && replace({ name: 'class', classId, tab: 'lectures' })) },
    ...(shared ? [{ id: 'removeLocal', label: t('lectures.list.menu.removeLocal'), onSelect: () => void actions.removeLocal(view).then((ok) => ok && replace({ name: 'class', classId, tab: 'lectures' })) }] : []),
    { kind: 'separator' },
    { id: 'reveal', label: t('lectures.list.menu.showInFolder'), onSelect: () => void actions.showInFolder(view) },
  ];

  // ── the player area ──
  const noAudio = noAudioReason(detail, t, i18n);
  const timelineMarkers = useMemo<TimelineMarker[]>(
    () => [
      ...detail.markers.map((m) => ({ id: m.id, atMs: m.atMs, kind: m.kind, label: t(`record.markers.${m.kind}`), ...(m.note ? { note: m.note } : {}) })),
      ...detail.autoMarkers.map((a) => ({ id: `auto-${a.atMs}`, atMs: a.atMs, kind: 'exam' as const, auto: true, label: t('record.markers.auto') })),
    ],
    [detail.markers, detail.autoMarkers, t],
  );
  const hitTimes = useMemo(() => hits.map((h) => h.ms), [hits]);
  const doneModel = s.kind === 'done' ? cardModel(view, i18n, { shared }) : null;
  const status = doneModel ? (
    <span className="tr-status tr-status--done" title={doneModel.text.replace(/\[\/?b\]/g, '')}>
      <CircleCheck size={14} aria-hidden strokeWidth={2} />
      <span className="tr-status__text">{doneModel.text.replace(/\[\/?b\]/g, '')}</span>
    </span>
  ) : null;

  const durationMs = detail.lecture.durationMs;
  const transcriptArea = (
    <div className="lecture-transcript-pane">
      <div className="transcript-toolbar">
        <h2 className="transcript-toolbar__title">{t('lectures.transcript.label')}</h2>
        {s.kind === 'done' && s.pendingEdits > 0 ? (
          <Badge tone="info" title={t('lectures.transcript.pendingHint')}>
            <span data-testid="transcript-pending">{tp('lectures.transcript.pending', s.pendingEdits, { n: s.pendingEdits })}</span>
          </Badge>
        ) : null}
        <span className="transcript-toolbar__spacer" />
        {transcript ? (
          <Button size="sm" variant="ghost" icon={Search} onClick={openFind} title={key('F')} data-testid="transcript-find-open">
            {t('lectures.transcript.find')}
          </Button>
        ) : null}
        {canEdit ? (
          <Button size="sm" variant={editing ? 'primary' : 'secondary'} icon={Pencil} aria-pressed={editing} aria-keyshortcuts="E" onClick={() => { setEditing((x) => !x); setEditingId(null); }} data-testid="transcript-edit">
            {editing ? t('lectures.transcript.editDone') : t('lectures.transcript.edit')}
          </Button>
        ) : null}
        {narrow ? <IconButton icon={PanelRight} label={t('app.header.sidePanel')} pressed={drawer} onClick={() => setDrawer((d) => !d)} data-testid="lecture-side-toggle" /> : null}
      </div>
      {findOpen ? (
        <div className="transcript-find" role="search" data-testid="transcript-find">
          <Search size={15} aria-hidden className="transcript-find__icon" />
          <input
            ref={findInput}
            className="transcript-find__input"
            value={findQ}
            onChange={(e) => setFindQ(e.target.value)}
            placeholder={t('lectures.transcript.find')}
            aria-label={t('lectures.transcript.find')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                stepHit(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setFindOpen(false);
                setFindQ('');
              }
            }}
            data-testid="transcript-find-input"
          />
          <span className="transcript-find__count t-tabular" role="status" data-testid="transcript-find-count">
            {findQ.trim() ? (hits.length ? t('lectures.transcript.findCount', { i: Math.min(findIndex, hits.length - 1) + 1, n: hits.length }) : t('lectures.transcript.findNone')) : ''}
          </span>
          <IconButton size="sm" icon={ChevronUp} label={t('lectures.transcript.findPrev')} disabled={!hits.length} onClick={() => stepHit(-1)} />
          <IconButton size="sm" icon={ChevronDown} label={t('lectures.transcript.findNext')} disabled={!hits.length} onClick={() => stepHit(1)} />
          <IconButton size="sm" icon={X} label={t('common.close')} onClick={() => { setFindOpen(false); setFindQ(''); }} />
        </div>
      ) : null}
      <div className="lecture-transcript-scroll" ref={scroller} tabIndex={-1} data-testid="lecture-transcript">
        <div className="lecture-transcript-inner">
          {view.newerFormat || transcript?.newer ? <Notice tone="info" data-testid="lecture-newer">{t('lectures.view.newer')}</Notice> : null}
          {view.untrustedTranscript ? (
            <Notice tone="warning" actions={<Button size="sm" onClick={() => void actions.retranscribe(view)}>{t('lectures.list.menu.retranscribe')}</Button>} data-testid="lecture-untrusted">
              {t('lectures.transcription.untrusted')}
            </Notice>
          ) : null}
          {transcript?.stale ? (
            <Notice tone="warning" actions={<Button size="sm" onClick={() => void actions.retranscribe(view)}>{t('lectures.list.menu.retranscribe')}</Button>} data-testid="lecture-stale">
              {t('lectures.view.stale')}
            </Notice>
          ) : null}
          {view.probableDuplicateOf && s.kind !== 'done' ? <DuplicateHint view={view} services={services} classId={classId} actions={actions} /> : null}
          {editing ? (
            <Notice tone="info" icon={shared ? undefined : Lock} data-testid="transcript-edit-notice">
              {shared ? t('lectures.transcript.editNotice') : t('lectures.transcript.editNoticeLocal')} {t('lectures.transcript.editHow')}
            </Notice>
          ) : null}
          {transcript && transcript.segments.length > 0 ? (
            <TranscriptView
              language={transcript.language}
              segments={transcript.segments}
              showSpeakers={showSpeakers}
              speakerLabel={speakerLabel}
              currentSegmentId={editing ? null : current}
              inlineMarkers={inlineMarkers}
              decorations={editing ? undefined : decorations}
              refs={editing ? undefined : refs}
              citeSegments={citeSegments}
              correctedBy={correctedBy}
              concurrent={concurrent}
              editing={editing}
              editingSegmentId={editingId}
              renderEditor={renderEditor}
              renderParaMenu={renderParaMenu}
              renderConcurrent={renderConcurrent}
              onSegment={onSegment}
              onTime={onTimeClick}
              onRef={onRef}
              onDecoration={onDecoration}
              timeText={timeText}
              playFromLabel={playFromLabel}
              refMissingTitle={t('lectures.transcript.refMissing')}
              clashTitle={t('lectures.transcript.clash')}
            />
          ) : transcript ? (
            <p className="side-panel__empty">{t('lectures.transcript.empty')}</p>
          ) : !view.untrustedTranscript ? (
            <TranscriptionCard view={view} services={services} classId={classId} shared={shared} actions={actions} />
          ) : null}
        </div>
        {follow && followPaused && playing ? (
          <button type="button" className="follow-resume" onClick={resumeFollow} data-testid="transcript-follow-resume">
            <ArrowDownToLine size={14} aria-hidden />
            {t('lectures.transcript.backTo', { time: shortClock(ms) })}
          </button>
        ) : null}
      </div>
    </div>
  );
  const side = (
    <SidePanel services={services} classId={classId} detail={detail} tab={sideTab} onTab={setSideTab} ms={ms} onSeek={(at, play) => seek(at, play)} noteRequest={noteRequest} explain={explain} onCloseExplain={() => setExplain(null)} />
  );

  return (
    <div className="lecture-screen" data-testid="screen-lecture" ref={screen} data-lang={lang}>
      <ScreenHeader
        title={view.title}
        subtitle={subtitle}
        backTo={t('classes.tabs.lectures')}
        actions={
          <Button icon={Sparkles} onClick={() => go({ name: 'class', classId, tab: 'ask', lectureId: view.id })} data-testid="lecture-ask">
            {t('lectures.view.ask')}
          </Button>
        }
        more={<MenuButton iconOnly icon={Ellipsis} variant="ghost" label={t('app.header.more')} items={moreItems} align="end" data-testid="lecture-more" />}
      />
      <div className="lecture-player">
        {noAudio ? (
          <Notice
            tone="neutral"
            data-testid="player-no-audio"
            className="lecture-player__noaudio"
            actions={
              detail.view.audio?.skipped ? (
                <Button size="sm" icon={Download} onClick={() => void cls.lectures.fetchAudio(lectureId).catch((e: unknown) => toast.error(e))} data-testid="player-get-audio">
                  {t('lectures.player.noAudio.getIt')}
                </Button>
              ) : undefined
            }
          >
            {noAudio}
          </Notice>
        ) : (
          <Player
            ref={player}
            src={playback.src}
            media={playback.media}
            durationMs={durationMs}
            rate={rate}
            onRate={setRate}
            follow={follow}
            onFollow={(on) => {
              setFollow(on);
              setFollowPaused(false);
            }}
            downmix={playback.downmix}
            onTime={onTime}
            onMediaError={playback.onMediaError}
            keys={{ toggle: t('lectures.keys.space'), back: '←', forward: '→', follow: 'F' }}
            status={status}
          />
        )}
        <Timeline
          durationMs={durationMs}
          ms={ms}
          peaks={detail.peaks}
          markers={timelineMarkers}
          hits={hitTimes}
          citedMs={cited && route.at !== undefined ? route.at : null}
          onSeek={(at) => (noAudio ? undefined : seek(at))}
          label={t('lectures.timeline.label')}
          valueText={(at) => t('lectures.timeline.value', { current: spokenTime(at, lang), total: spokenTime(durationMs, lang) })}
          timeText={shortClock}
          citedLabel={t('lectures.timeline.citedHere')}
        />
      </div>
      <div className="lecture-body">
        {narrow ? (
          <>
            {transcriptArea}
            {drawer ? (
              <div
                className="lecture-drawer"
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !e.defaultPrevented && !modalOpen()) {
                    e.preventDefault();
                    setDrawer(false);
                    screen.current?.querySelector<HTMLElement>('[data-testid="lecture-side-toggle"]')?.focus();
                  }
                }}
                data-testid="lecture-drawer"
              >
                <div className="lecture-drawer__head">
                  <IconButton size="sm" icon={X} label={t('common.close')} onClick={() => setDrawer(false)} />
                </div>
                {side}
              </div>
            ) : null}
          </>
        ) : (
          <SplitPane first={transcriptArea} second={side} sized="second" initial={360} min={280} max={520} minRest={420} storageKey="tramado.split.lecture" label={t('lectures.side.resize')} className="lecture-split" />
        )}
      </div>
      {selection && !editing ? (
        <div ref={toolbarRef} className="selection-toolbar lecture-selection" style={{ position: 'fixed', left: Math.max(8, selection.rect.left), top: Math.max(8, selection.rect.top - 46) }} data-testid="selection-toolbar">
          <Toolbar label={t('lectures.selection.label')} roving>
            <HighlightMenu last={lastKind} onPick={(k) => void highlight(selection, k)} />
            <Button size="sm" variant="ghost" icon={MessageSquare} onClick={() => { setCommenting(selection); setSelection(null); }} data-testid="selection-comment">
              {t('lectures.selection.comment')}
            </Button>
            <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => explainSel(selection)} data-testid="selection-explain">
              {t('lectures.selection.explain')}
            </Button>
            <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => go({ name: 'class', classId, tab: 'ask', lectureId: view.id, query: t('lectures.selection.askPrefill', { text: selection.text }) })} data-testid="selection-ask">
              {t('lectures.selection.ask')}
            </Button>
            <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copyWithSource(selection)} data-testid="selection-copy">
              {t('lectures.selection.copy')}
            </Button>
          </Toolbar>
        </div>
      ) : null}
      {commenting ? (
        <CommentPopover
          sel={commenting}
          onClose={() => setCommenting(null)}
          onSave={async (body) => {
            const seg = segOf(commenting.segmentId);
            if (!seg) return;
            try {
              await cls.annotations.add({ visibility: 'private', kind: 'comment', body, target: { source, locator: segmentLocator(seg, { start: commenting.start, end: commenting.end }), quote: quoteOf(seg.text, commenting.start, commenting.end) } });
              setCommenting(null);
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      ) : null}
      {openAnnotation ? (
        <Popover open anchor={{ current: openAnnotation.el }} onClose={() => setOpenAnnotation(null)} padded className="annotation-pop">
          <div className="annotation-pop__body" data-testid="annotation-popover">
            {openAnnotation.a.ai ? (
              <span className="annotation-pop__by">
                <Sparkles size={12} aria-hidden /> {t('lectures.annotation.aiBy', { model: openAnnotation.a.ai.model })}
              </span>
            ) : (
              <span className="annotation-pop__by">
                <Lock size={12} aria-hidden /> {t('lectures.selection.commentHint')}
              </span>
            )}
            {openAnnotation.a.body ? <p className="annotation-pop__text">{openAnnotation.a.body}</p> : null}
            <div className="annotation-pop__actions">
              <Button size="sm" variant="ghost" onClick={() => void cls.annotations.remove(openAnnotation.a.id).then(() => setOpenAnnotation(null), (e: unknown) => toast.error(e))} data-testid="annotation-remove">
                {t('common.remove')}
              </Button>
            </div>
          </div>
        </Popover>
      ) : null}
      {speakersOpen && transcript ? <SpeakersDialog services={services} classId={classId} lectureId={lectureId} speakers={speakers} onClose={() => setSpeakersOpen(false)} /> : null}
      {actions.dialogs}
    </div>
  );
}

/** "spk_<n>" with n one past the largest in use. */
function nextSpeakerId(ids: readonly string[]): string {
  let n = 0;
  for (const id of ids) {
    const m = /^spk_(\d+)$/.exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `spk_${n + 1}`;
}

function noAudioReason(detail: LectureDetail, t: ReturnType<typeof useI18n>['t'], i18n: ReturnType<typeof useI18n>): string | null {
  const v = detail.view;
  const l = detail.lecture;
  if (detail.audioUrl) return null;
  if (v.audio === null) {
    if (l.audioDeletedAt) return t('lectures.player.noAudio.deleted', { date: DateTime.fromISO(l.audioDeletedAt).setLocale(i18n.meta.bcp47).toLocaleString(DateTime.DATE_MED) });
    return t('lectures.player.noAudio.transcriptOnly', { name: v.recordedBy.memberName });
  }
  if (v.audio.skipped) return t('lectures.player.noAudio.skipped');
  if (v.audio.arriving) {
    const s = v.transcription;
    const percent = s.kind === 'waitingAudio' && s.size > 0 ? Math.floor((s.have / s.size) * 100) : 0;
    return t('lectures.player.noAudio.arriving', { percent });
  }
  return null;
}

function HighlightMenu({ last, onPick }: { last: MarkerKind | 'other'; onPick(k: MarkerKind | 'other'): void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const kinds = ['important', 'confused', 'exam', 'todo', 'other'] as const;
  return (
    <>
      <span className="selection-hl">
        <Button size="sm" variant="ghost" icon={Highlighter} onClick={() => onPick(last)} data-testid="selection-highlight">
          {t('lectures.selection.highlight')}
        </Button>
        <button ref={ref} type="button" className="selection-hl__more" aria-haspopup="menu" aria-expanded={open} aria-label={t('lectures.selection.highlightKind')} onClick={() => setOpen((o) => !o)} data-testid="selection-highlight-kind">
          <ChevronDown size={14} aria-hidden />
        </button>
      </span>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref}
        label={t('lectures.selection.highlight')}
        items={kinds.map((k) => ({ id: k, label: t(`lectures.selection.highlightKinds.${k}`), checked: k === last, onSelect: () => onPick(k), testId: `selection-highlight-${k}` }))}
      />
    </>
  );
}

function CommentPopover({ sel, onClose, onSave }: { sel: Selection; onClose(): void; onSave(body: string): Promise<void> }) {
  const { t } = useI18n();
  const [body, setBody] = useState('');
  const anchor = useMemo(() => sel.rect, [sel.rect]);
  return (
    <Popover open anchor={anchor} onClose={onClose} padded className="comment-pop">
      <div className="comment-pop__body" data-testid="selection-comment-popover">
        <TextArea autoFocus autoGrow minHeight={64} maxHeight={200} value={body} onChange={setBody} label={t('lectures.selection.comment')} hint={t('lectures.selection.commentHint')} data-testid="selection-comment-input" />
        <div className="comment-pop__actions">
          <Button size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={!body.trim()} onClick={() => void onSave(body.trim())} data-testid="selection-comment-save">
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

function SegmentEditor({ seg, onSave, onCancel, onCaret }: { seg: TvSegment; onSave(text: string, move: 0 | 1 | -1): Promise<void>; onCancel(): void; onCaret(at: number): void }) {
  const { t } = useI18n();
  const [text, setText] = useState(seg.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const note = () => onCaret(ref.current?.selectionStart ?? 0);
  return (
    <TextArea
      ref={ref}
      autoFocus
      autoGrow
      reading
      minHeight={40}
      maxHeight={320}
      value={text}
      onChange={setText}
      onSelect={note}
      onKeyUp={note}
      onClick={note}
      aria-label={t('lectures.transcript.editSegment', { time: shortClock(seg.startMs) })}
      className="tv-editor"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          void onSave(text.replace(/\s+/g, ' ').trim(), 0);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          void onSave(text.replace(/\s+/g, ' ').trim(), e.key === 'ArrowUp' ? -1 : 1);
        }
      }}
      data-testid="transcript-segment-input"
    />
  );
}

function DuplicateHint({ view, services, classId, actions }: { view: LectureDetail['view']; services: AppServices; classId: ClassId; actions: ReturnType<typeof useLectureActions> }) {
  const { t } = useI18n();
  const toast = useToast();
  const list = useStore(services.forClass(classId).lectures.list);
  const other = list.find((l) => l.id === view.probableDuplicateOf);
  return (
    <Notice
      tone="info"
      data-testid="lecture-duplicate-hint"
      actions={
        <>
          {view.recordedBy.self ? (
            <Button size="sm" onClick={() => void services.forClass(classId).lectures.markDuplicate(view.id, view.probableDuplicateOf).catch((e: unknown) => toast.error(e))}>
              {t('lectures.transcription.markDuplicate')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void actions.transcribeHere(view.id)}>
            {t('lectures.transcription.transcribeAnyway')}
          </Button>
        </>
      }
    >
      {t('lectures.transcription.duplicate', { title: other?.title ?? '' })}
    </Notice>
  );
}
