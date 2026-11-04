// Timeline (UX §3.5.2): the lecture's waveform (1 200 peak buckets, `--ink-4`, the played part in `--accent`; a
// flat 2 px rule while the peaks load or without them), the marker row (MarkerIcons at their time, the radar badge
// on automatic exam marks), find hits as 2 px `--mark-strong` ticks, the cited moment as a `--mark-edge` triangle
// and the 2 px `--ink` playhead. role="slider": click or drag seeks; ←/→ 5 s, PageUp/PageDown 60 s, Home/End.
// Hovering shows the time and, over a marker, its label and note. Colours are read from the tokens at draw time,
// so a theme change repaints with the right ones.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MarkerKind } from '../../core/model/files';
import { cx } from '../cx';
import { MarkerIcon } from './MarkerIcon';
import './Timeline.css';

export interface TimelineMarker { id: string; atMs: number; kind: MarkerKind; auto?: boolean; label: string; note?: string }

export interface TimelineProps {
  durationMs: number;
  ms: number;
  peaks: readonly number[] | null;
  markers: readonly TimelineMarker[];
  /** Find hits (ms). */
  hits?: readonly number[];
  /** The cited moment, when the lecture was opened from a citation. */
  citedMs?: number | null;
  onSeek(ms: number): void;
  label: string;
  /** aria-valuetext and the hover tooltip ("41:12"). */
  valueText(ms: number): string;
  timeText(ms: number): string;
  citedLabel?: string;
  className?: string;
}

const WAVE_H = 40;
const HEIGHT = 64;

function token(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function Timeline({ durationMs, ms, peaks, markers, hits = [], citedMs = null, onSeek, label, valueText, timeText, citedLabel, className }: TimelineProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; ms: number; marker: TimelineMarker | null } | null>(null);
  const dragging = useRef(false);
  const total = Math.max(1, durationMs);
  const xOf = (t: number) => (Math.max(0, Math.min(total, t)) / total) * width;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Repaint on a theme change (the media query or the data-theme attribute).
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const bump = () => setThemeTick((n) => n + 1);
    mq?.addEventListener('change', bump);
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(bump) : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => {
      mq?.removeEventListener('change', bump);
      mo?.disconnect();
    };
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width <= 0) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(HEIGHT * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);
    const ink4 = token(c, '--ink-4', '#8f96a5');
    const accent = token(c, '--accent', '#2f4fd6');
    const ink = token(c, '--ink', '#181d29');
    const markStrong = token(c, '--mark-strong', '#f5c518');
    const markEdge = token(c, '--mark-edge', '#a37800');
    const playedX = xOf(ms);
    const mid = 4 + WAVE_H / 2;
    if (peaks && peaks.length > 0) {
      const n = peaks.length;
      const barW = width / n;
      const gap = barW > 2 ? 0.6 : 0;
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, Math.min(255, peaks[i]!)) / 255;
        const h = Math.max(1.5, v * WAVE_H);
        const x = i * barW;
        g.fillStyle = x + barW / 2 <= playedX ? accent : ink4;
        g.fillRect(x, mid - h / 2, Math.max(0.6, barW - gap), h);
      }
    } else {
      g.fillStyle = ink4;
      g.fillRect(0, mid - 1, width, 2);
      g.fillStyle = accent;
      g.fillRect(0, mid - 1, playedX, 2);
    }
    // Find hits: 2 px ticks across the waveform.
    g.fillStyle = markStrong;
    for (const h of hits) g.fillRect(Math.round(xOf(h)) - 1, 2, 2, WAVE_H + 4);
    // The cited moment: a triangle above the waveform.
    if (citedMs !== null) {
      const x = xOf(citedMs);
      g.fillStyle = markEdge;
      g.beginPath();
      g.moveTo(x - 5, 0);
      g.lineTo(x + 5, 0);
      g.lineTo(x, 7);
      g.closePath();
      g.fill();
    }
    // The playhead.
    g.fillStyle = ink;
    g.fillRect(Math.round(playedX) - 1, 0, 2, HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, ms, peaks, hits, citedMs, total, themeTick]);

  const msAt = useCallback(
    (clientX: number) => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r || r.width <= 0) return 0;
      return Math.round((Math.max(0, Math.min(r.width, clientX - r.left)) / r.width) * total);
    },
    [total],
  );

  const markerNear = (x: number): TimelineMarker | null => {
    let best: TimelineMarker | null = null;
    let d = 9;
    for (const m of markers) {
      const dx = Math.abs(xOf(m.atMs) - x);
      if (dx < d) {
        d = dx;
        best = m;
      }
    }
    return best;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -5000 : e.key === 'ArrowRight' ? 5000 : e.key === 'PageUp' ? 60_000 : e.key === 'PageDown' ? -60_000 : null;
    if (step !== null) {
      e.preventDefault();
      e.stopPropagation();
      onSeek(Math.max(0, Math.min(total, ms + (e.shiftKey && Math.abs(step) === 5000 ? step * 6 : step))));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeek(total);
    }
  };

  return (
    <div className={cx('timeline', className)}>
      <div
        ref={wrap}
        className="timeline__track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.round(ms / 1000)}
        aria-valuetext={valueText(ms)}
        data-testid="timeline"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          onSeek(msAt(e.clientX));
        }}
        onPointerMove={(e) => {
          const r = wrap.current?.getBoundingClientRect();
          if (!r) return;
          const x = e.clientX - r.left;
          setHover({ x, ms: msAt(e.clientX), marker: markerNear(x) });
          if (dragging.current) onSeek(msAt(e.clientX));
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerLeave={() => {
          if (!dragging.current) setHover(null);
        }}
      >
        <canvas ref={canvas} className="timeline__canvas" style={{ width: '100%', height: HEIGHT }} aria-hidden />
        <div className="timeline__markers" aria-hidden>
          {markers.map((m) => (
            <span key={m.id} className="timeline__marker" style={{ left: `${(Math.max(0, Math.min(total, m.atMs)) / total) * 100}%` }}>
              <MarkerIcon kind={m.kind} auto={m.auto} size={14} />
            </span>
          ))}
        </div>
        {citedMs !== null && citedLabel ? <span className="visually-hidden">{citedLabel}</span> : null}
        {hover ? (
          <div className="timeline__tip" style={{ left: Math.max(36, Math.min(width - 36, hover.x)) }} aria-hidden>
            <span className="t-tabular">{timeText(hover.marker ? hover.marker.atMs : hover.ms)}</span>
            {hover.marker ? (
              <>
                <span className="timeline__tip-label">{hover.marker.label}</span>
                {hover.marker.note ? <span className="timeline__tip-note">{hover.marker.note}</span> : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
