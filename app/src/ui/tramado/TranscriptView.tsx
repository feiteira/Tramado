// TranscriptView (UX §3.5.3): the transcript in the reading font, as paragraphs (same speaker until a 2 s gap or
// 60 s of text, core/transcript/render.ts) with a timestamp button, the speaker label (only with more than one
// speaker) and the segments as inline spans carrying `data-segment-id`. Decorations come from the screen: the
// current segment, inline markers, legal references (links), private highlights and comments, AI annotations,
// find hits and the cited passage. In edit mode (corrections, in 0.1) a segment the screen is editing is replaced
// by the editor it renders. Text runs carry `data-seg`/`data-off` so the screen can map a selection to offsets.
import React, { memo, useMemo, type ReactNode } from 'react';
import { Sparkles, TriangleAlert } from 'lucide-react';
import { paragraphs, type Paragraph } from '../../core/transcript/render';
import type { MarkerKind } from '../../core/model/files';
import { cx } from '../cx';
import { MarkerIcon } from './MarkerIcon';
import './TranscriptView.css';

export interface TvSegment { id: string; startMs: number; endMs: number; speaker: string; text: string; words?: Array<{ startMs: number; endMs: number; text: string }> }

export type TvDecorationKind = 'hl' | 'comment' | 'ai' | 'hit' | 'hitActive' | 'cite';
export interface TvDecoration {
  segmentId: string; start: number; end: number; kind: TvDecorationKind;
  /** Highlight colour by meaning (`data-mk`). */
  mk?: MarkerKind | 'other';
  /** The annotation behind it (comments and AI notes open on click). */
  id?: string;
  title?: string;
}
export interface TvRef { key: string; segmentId: string; start: number; end: number; resolved: boolean }

export interface TranscriptViewProps {
  language: string;
  segments: readonly TvSegment[];
  showSpeakers: boolean;
  speakerLabel(id: string): string;
  currentSegmentId: string | null;
  /** MarkerIcons at the start of a segment (manual and automatic exam marks). */
  inlineMarkers?: Readonly<Record<string, ReadonlyArray<{ kind: MarkerKind; auto?: boolean }>>>;
  decorations?: readonly TvDecoration[];
  refs?: readonly TvRef[];
  /** Paragraphs holding these segments get the `.cite-block` look. */
  citeSegments?: ReadonlySet<string>;
  /** Segments corrected by others and not folded yet: their tooltip ("Corrected by Carla"). */
  correctedBy?: Readonly<Record<string, string>>;
  concurrent?: ReadonlySet<string>;
  editing?: boolean;
  editingSegmentId?: string | null;
  renderEditor?(seg: TvSegment): ReactNode;
  /** The ⋯ menu at a paragraph's left (edit mode). */
  renderParaMenu?(para: Paragraph): ReactNode;
  /** The review mark of a segment where two corrections met. */
  renderConcurrent?(seg: TvSegment): ReactNode;
  /** A click on a segment: `offset` is the character under the pointer when known. */
  onSegment(seg: TvSegment, offset: number | null): void;
  onTime(ms: number): void;
  onRef(ref: TvRef): void;
  onDecoration?(d: TvDecoration, el: HTMLElement): void;
  timeText(ms: number): string;
  playFromLabel(ms: string): string;
  refMissingTitle: string;
  clashTitle: string;
  className?: string;
}

interface Run { start: number; end: number; decos: TvDecoration[] }

/** Splits [0, len) at every decoration edge. */
function runsOf(len: number, decos: readonly TvDecoration[], from = 0, to = len): Run[] {
  const edges = new Set<number>([from, to]);
  for (const d of decos) {
    if (d.end <= from || d.start >= to) continue;
    edges.add(Math.max(from, d.start));
    edges.add(Math.min(to, d.end));
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const out: Run[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]!;
    const e = sorted[i + 1]!;
    if (e <= s) continue;
    out.push({ start: s, end: e, decos: decos.filter((d) => d.start < e && d.end > s) });
  }
  return out;
}

function RunSpan({ seg, run, onDecoration }: { seg: TvSegment; run: Run; onDecoration?: TranscriptViewProps['onDecoration'] }) {
  const text = seg.text.slice(run.start, run.end);
  const hl = [...run.decos].reverse().find((d) => d.kind === 'hl');
  const comment = run.decos.find((d) => d.kind === 'comment');
  const ai = run.decos.find((d) => d.kind === 'ai');
  const hit = run.decos.find((d) => d.kind === 'hit' || d.kind === 'hitActive');
  const cite = run.decos.some((d) => d.kind === 'cite');
  const clickable = comment ?? ai;
  const cls = cx(
    hl && 'hl',
    comment && 'tv-comment',
    ai && 'tv-ai',
    hit && 'cite-mark',
    hit?.kind === 'hitActive' && 'tv-hit--active',
    cite && !hit && 'tv-cite',
  );
  if (!cls) return <span data-seg={seg.id} data-off={run.start}>{text}</span>;
  return (
    <span
      data-seg={seg.id}
      data-off={run.start}
      data-mk={hl?.mk}
      className={cls}
      title={clickable?.title ?? hl?.title}
      data-annotation-id={clickable?.id}
      onClick={
        clickable && onDecoration
          ? (e) => {
              e.stopPropagation();
              onDecoration(clickable, e.currentTarget);
            }
          : undefined
      }
      data-testid={hit ? 'transcript-hit' : undefined}
    >
      {cite && !hit ? <mark className="cite">{text}</mark> : text}
    </span>
  );
}

function SegmentText({ seg, decos, refs, onRef, onDecoration, refMissingTitle }: { seg: TvSegment; decos: readonly TvDecoration[]; refs: readonly TvRef[]; onRef(r: TvRef): void; onDecoration?: TranscriptViewProps['onDecoration']; refMissingTitle: string }) {
  const sorted = [...refs].sort((a, b) => a.start - b.start);
  const chunks: Array<{ start: number; end: number; ref: TvRef | null }> = [];
  let at = 0;
  for (const r of sorted) {
    if (r.start < at || r.end > seg.text.length) continue;
    if (r.start > at) chunks.push({ start: at, end: r.start, ref: null });
    chunks.push({ start: r.start, end: r.end, ref: r });
    at = r.end;
  }
  if (at < seg.text.length) chunks.push({ start: at, end: seg.text.length, ref: null });
  const aiMark = decos.some((d) => d.kind === 'ai');
  return (
    <>
      {aiMark ? <Sparkles className="tv-ai-mark" size={12} aria-hidden strokeWidth={2} /> : null}
      {chunks.map((c) => {
        const runs = runsOf(seg.text.length, decos, c.start, c.end).map((r) => <RunSpan key={r.start} seg={seg} run={r} onDecoration={onDecoration} />);
        if (!c.ref) return <React.Fragment key={c.start}>{runs}</React.Fragment>;
        const ref = c.ref;
        return ref.resolved ? (
          <a
            key={c.start}
            href="#"
            role="link"
            className="tv-ref"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRef(ref);
            }}
            data-testid="transcript-ref"
          >
            {runs}
          </a>
        ) : (
          <span key={c.start} className="tv-ref tv-ref--missing" title={refMissingTitle} data-testid="transcript-ref">
            {runs}
          </span>
        );
      })}
    </>
  );
}

/** The character offset under a click, inside a run span (null when the browser cannot tell). */
function offsetAt(e: React.MouseEvent): number | null {
  const doc = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null; caretRangeFromPoint?(x: number, y: number): Range | null };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  const el = node?.nodeType === 3 ? node.parentElement : (node as Element | null);
  const run = el?.closest<HTMLElement>('[data-off]');
  if (!run) return null;
  return Number(run.dataset.off ?? 0) + offset;
}

interface ParaProps {
  para: Paragraph;
  current: string | null;
  props: Omit<TranscriptViewProps, 'segments' | 'currentSegmentId' | 'decorations' | 'refs'>;
  decos: readonly TvDecoration[];
  refs: readonly TvRef[];
  editingId: string | null;
}

const ParagraphView = memo(function ParagraphView({ para, current, props, decos, refs, editingId }: ParaProps) {
  const first = para.segments[0]!;
  const isCurrent = !!current;
  const cite = para.segments.some((s) => props.citeSegments?.has(s.id));
  return (
    <div
      className={cx('tv-para', isCurrent && 'tv-para--current', cite && 'cite-block', props.editing && 'tv-para--editing')}
      data-testid="transcript-para"
      data-segment-id={first.id}
      data-start-ms={para.startMs}
    >
      <div className="tv-para__gutter">
        <button type="button" className="tv-time t-tabular" onClick={() => props.onTime(para.startMs)} aria-label={props.playFromLabel(props.timeText(para.startMs))} data-testid="transcript-time">
          {props.timeText(para.startMs)}
        </button>
        {props.editing && props.renderParaMenu ? props.renderParaMenu(para) : null}
      </div>
      <div className="tv-para__body">
        {props.showSpeakers ? <span className="tv-speaker">{props.speakerLabel(para.speaker)}</span> : null}
        <p className="tv-text">
          {para.segments.map((s, i) => {
            const seg = s as TvSegment;
            if (props.editing && editingId === s.id && props.renderEditor) return <React.Fragment key={s.id}>{props.renderEditor(seg)}</React.Fragment>;
            const marks = props.inlineMarkers?.[s.id] ?? [];
            const corrected = props.correctedBy?.[s.id];
            const clash = props.concurrent?.has(s.id);
            return (
              <React.Fragment key={s.id}>
                {i > 0 ? ' ' : null}
                <span
                  data-segment-id={s.id}
                  className={cx('tv-seg', current === s.id && 'tv-seg--current', corrected && 'tv-seg--corrected', clash && 'tv-seg--clash', props.editing && 'tv-seg--editable')}
                  title={corrected}
                  role={props.editing ? 'button' : undefined}
                  tabIndex={props.editing ? 0 : undefined}
                  aria-current={current === s.id ? 'true' : undefined}
                  onClick={(e) => {
                    if (!props.editing && window.getSelection?.()?.toString()) return;
                    props.onSegment(seg, offsetAt(e));
                  }}
                  onKeyDown={
                    props.editing
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            props.onSegment(seg, null);
                          }
                        }
                      : undefined
                  }
                >
                  {marks.map((m, k) => (
                    <MarkerIcon key={k} kind={m.kind} auto={m.auto} size={14} className="tv-inline-marker" />
                  ))}
                  {props.editing ? (
                    seg.text
                  ) : (
                    <SegmentText seg={seg} decos={decos.filter((d) => d.segmentId === s.id)} refs={refs.filter((r) => r.segmentId === s.id)} onRef={props.onRef} onDecoration={props.onDecoration} refMissingTitle={props.refMissingTitle} />
                  )}
                  {clash ? (props.renderConcurrent ? props.renderConcurrent(seg) : <TriangleAlert size={14} className="tv-clash" aria-label={props.clashTitle} />) : null}
                </span>
              </React.Fragment>
            );
          })}
        </p>
      </div>
    </div>
  );
});

export function TranscriptView(all: TranscriptViewProps) {
  const { segments, currentSegmentId, decorations = [], refs = [], language, className, editingSegmentId = null, ...rest } = all;
  const paras = useMemo(() => paragraphs({ segments: segments as TvSegment[] as never }), [segments]);
  const byPara = useMemo(() => {
    const of = new Map<string, number>();
    paras.forEach((p, i) => p.segments.forEach((s) => of.set(s.id, i)));
    const decos: TvDecoration[][] = paras.map(() => []);
    const rf: TvRef[][] = paras.map(() => []);
    for (const d of decorations) {
      const i = of.get(d.segmentId);
      if (i !== undefined) decos[i]!.push(d);
    }
    for (const r of refs) {
      const i = of.get(r.segmentId);
      if (i !== undefined) rf[i]!.push(r);
    }
    return { of, decos, refs: rf };
  }, [paras, decorations, refs]);
  // Stable as long as the screen passes stable callbacks: only the paragraphs whose inputs change re-render.
  const shared = useMemo(
    () => ({ ...rest, language }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, rest.showSpeakers, rest.speakerLabel, rest.inlineMarkers, rest.citeSegments, rest.correctedBy, rest.concurrent, rest.editing, rest.renderEditor, rest.renderParaMenu, rest.renderConcurrent, rest.onSegment, rest.onTime, rest.onRef, rest.onDecoration, rest.timeText, rest.playFromLabel, rest.refMissingTitle, rest.clashTitle],
  );
  const EMPTY: TvDecoration[] = [];
  return (
    <div className={cx('transcript-view', 'reading', className)} lang={language}>
      {paras.map((p, i) => {
        const has = (id: string | null) => !!id && byPara.of.get(id) === i;
        return (
          <ParagraphView
            key={p.segments[0]!.id}
            para={p}
            current={has(currentSegmentId) ? currentSegmentId : null}
            props={shared}
            decos={byPara.decos[i] ?? EMPTY}
            refs={byPara.refs[i] ?? []}
            editingId={has(editingSegmentId) ? editingSegmentId : null}
          />
        );
      })}
    </div>
  );
}
