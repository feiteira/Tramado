// Deterministic filler transcripts and waveform peaks for the demo (UX §7.1). Never random: screenshots must be
// reproducible. Pauses follow Trama's pattern `(i*7919) % 1100` ms; speech runs at about 160 words a minute.
import type { DemoSegment, KeySegment } from './types';
import { clockMs } from './time';

/** 160 words a minute. */
export const MS_PER_WORD = 375;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** How long a sentence takes to say. */
export const spokenMs = (text: string) => words(text) * MS_PER_WORD;

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Filler segment ids: `s_<lecture key>x<3 base62>` (5–8 characters after `s_`, folder spec §2), never a key id. */
export function fillerId(lectureKey: string, i: number): string {
  let n = i;
  let s = '';
  for (let k = 0; k < 3; k++) {
    s = B62[n % 62]! + s;
    n = Math.floor(n / 62);
  }
  return `s_${lectureKey}x${s}`;
}

export interface FillOptions {
  /** Prefix of the segment ids (the lecture key). */
  key: string;
  speaker: string;
  /** The first filler index (ids continue across calls for one lecture). */
  startIndex?: number;
}

/**
 * Filler segments from `fromMs` up to (not past) `toMs`, cycling through `sentences` from a position derived from
 * `seed`. Segment `i` lasts its words × 375 ms and is followed by a pause of `(i*7919) % 1100` ms.
 */
export function fillTranscript(seed: number, fromMs: number, toMs: number, sentences: readonly string[], opts: FillOptions = { key: 'f', speaker: 'lecture' }): DemoSegment[] {
  if (!sentences.length) return [];
  const out: DemoSegment[] = [];
  let ms = fromMs;
  let i = opts.startIndex ?? 0;
  let pick = Math.abs(seed * 31) % sentences.length;
  for (;;) {
    const text = sentences[pick % sentences.length]!;
    const end = ms + spokenMs(text);
    if (end > toMs) break;
    out.push({ id: fillerId(opts.key, i), startMs: ms, endMs: end, speaker: opts.speaker, text });
    ms = end + ((i * 7919) % 1100);
    i++;
    // A stride coprime with 40 walks the whole pool before repeating.
    pick += 7;
  }
  return out;
}

/** The key segments at their times (UX §7.3), each lasting its words × 375 ms. */
export function keySegments(keys: readonly KeySegment[], defaultSpeaker: string): DemoSegment[] {
  return keys.map((k) => {
    const startMs = clockMs(k.at);
    return { id: k.id, startMs, endMs: startMs + spokenMs(k.text), speaker: k.speaker ?? defaultSpeaker, text: k.text };
  });
}

/** Gap kept between a key segment and the filler around it. */
const GAP_MS = 400;

/**
 * A whole transcript: the key segments at their times and filler in every gap, from 2 s to the end of the
 * recording. Segments are sorted by start; filler never overlaps a key segment.
 */
export function buildTranscript(opts: {
  key: string; durationMs: number; keys: readonly KeySegment[]; speaker: string; fillerSpeaker?: string; sentences: readonly string[]; seed: number;
}): DemoSegment[] {
  const key = keySegments(opts.keys, opts.speaker).sort((a, b) => a.startMs - b.startMs);
  const out: DemoSegment[] = [];
  let from = 2_000;
  let index = 0;
  let n = 0;
  const fill = (to: number) => {
    const segs = fillTranscript(opts.seed + n++, from, to, opts.sentences, { key: opts.key, speaker: opts.fillerSpeaker ?? opts.speaker, startIndex: index });
    index += segs.length;
    out.push(...segs);
  };
  for (const k of key) {
    if (k.startMs - GAP_MS > from) fill(k.startMs - GAP_MS);
    out.push(k);
    from = k.endMs + GAP_MS;
  }
  fill(opts.durationMs - 1_000);
  return out;
}

/** Waveform peaks of UX §7.1: `p[i] = clamp(60 + 50·sin(i/7) + 40·sin(i/23) + (i·7919 mod 37), 0, 255)`. */
export function demoPeaks(buckets = 1200): number[] {
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const v = 60 + 50 * Math.sin(i / 7) + 40 * Math.sin(i / 23) + ((i * 7919) % 37);
    out.push(Math.max(0, Math.min(255, Math.round(v))));
  }
  return out;
}
