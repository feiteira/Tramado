import { decodeEntities } from './entities';
import { canonicalize } from './text';
import { type Cue, refineCueSpeakers } from './transcript';
import { WARNING, warning } from './types';

// WebVTT (Teams, Zoom, YouTube, most transcription services). Speakers come from voice tags
// (<v Name>…</v>, Teams), "Name: text" prefixes (Zoom) or a name line; refineCueSpeakers
// decides the last two for the whole file.

const TIME = String.raw`(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}`;
const TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-->\s*(${TIME})`);

/** "01:02:03.456" or "02:03.456" → milliseconds. */
export function parseCueTime(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min > 59 || sec > 59) return null;
  return ((h * 60 + min) * 60 + sec) * 1000 + Number(m[4]!.padEnd(3, '0'));
}

/** Cue payload lines → (speaker, text) pieces: one per voice, tags and entities removed. */
export function cuePayload(lines: string[]): { speaker: string | null; text: string }[] {
  const pieces: { speaker: string | null; text: string }[] = [];
  for (const line of lines) {
    let rest = line;
    const voices = [...rest.matchAll(/<v(?:\.[^\s>]+)?(?:\s+([^>]*))?>/g)];
    if (!voices.length) {
      const text = clean(rest);
      const last = pieces[pieces.length - 1];
      if (last) last.text += (last.text ? '\n' : '') + text;
      else pieces.push({ speaker: null, text });
      continue;
    }
    // Text before the first voice tag belongs to the previous voice.
    const before = clean(rest.slice(0, voices[0]!.index));
    if (before) {
      const last = pieces[pieces.length - 1];
      if (last) last.text += (last.text ? '\n' : '') + before;
      else pieces.push({ speaker: null, text: before });
    }
    for (let k = 0; k < voices.length; k++) {
      const v = voices[k]!;
      const from = v.index + v[0].length;
      const to = k + 1 < voices.length ? voices[k + 1]!.index : rest.length;
      const speaker = decodeEntities(v[1] ?? '').trim() || null;
      const text = clean(rest.slice(from, to));
      const last = pieces[pieces.length - 1];
      if (last && last.speaker === speaker) last.text += (last.text ? '\n' : '') + text;
      else pieces.push({ speaker, text });
    }
    rest = '';
  }
  return pieces.map((p) => ({ speaker: p.speaker, text: p.text.trim() })).filter((p) => p.text);
}

/** Removes cue markup (<c>, <i>, <b>, <u>, <lang>, <ruby>, inline timestamps) and entities. */
function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ''))
    .replace(/[\u{200e}\u{200f}]/gu, '')
    .trim();
}

export interface ParsedCues {
  cues: Cue[];
  warnings: string[];
}

export function parseVtt(source: string): ParsedCues {
  const lines = canonicalize(source).split('\n');
  const cues: Cue[] = [];
  let skipped = 0;
  let i = 0;
  // Header: "WEBVTT" and anything up to the first blank line.
  if (/^WEBVTT/.test(lines[0] ?? '')) {
    while (i < lines.length && lines[i]!.trim()) i++;
  }
  while (i < lines.length) {
    while (i < lines.length && !lines[i]!.trim()) i++;
    if (i >= lines.length) break;
    const block: string[] = [];
    while (i < lines.length && lines[i]!.trim()) block.push(lines[i++]!);
    const first = block[0]!;
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(first)) continue;
    const t = block.findIndex((l) => l.includes('-->'));
    if (t < 0 || t > 1) {
      skipped++;
      continue;
    }
    const m = TIMING.exec(block[t]!);
    const start = m ? parseCueTime(m[1]!) : null;
    const end = m ? parseCueTime(m[2]!) : null;
    if (start === null || end === null) {
      skipped++;
      continue;
    }
    for (const p of cuePayload(block.slice(t + 1))) cues.push({ start, end, speaker: p.speaker, text: p.text });
  }
  const warnings = skipped ? [warning(WARNING.cuesSkipped, skipped)] : [];
  return { cues: refineCueSpeakers(cues), warnings };
}
