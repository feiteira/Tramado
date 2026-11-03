import { canonicalize } from './text';
import { type Cue, refineCueSpeakers } from './transcript';
import { WARNING, warning } from './types';
import { cuePayload, parseCueTime, type ParsedCues } from './vtt';

// SubRip (.srt): "index / start --> end / text lines / blank line". Real files break the rules
// in every way (missing indices, missing blank lines, dots for commas, ASS override tags), so
// a cue starts at any timing line and runs until the next blank line or timing line.

const TIME = String.raw`\d{1,3}:\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?`;
const TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-+>\s*(${TIME})`);

function srtTime(s: string): number | null {
  const m = /^(\d{1,3}):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  return parseCueTime(`${m[1]}:${m[2]!.padStart(2, '0')}:${m[3]!.padStart(2, '0')}.${m[4] ?? '000'}`);
}

export function parseSrt(source: string): ParsedCues {
  const lines = canonicalize(source).split('\n');
  const cues: Cue[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = TIMING.exec(lines[i]!);
    if (!m) {
      // A block with text but no timing line (not an index, not blank) cannot be placed.
      const line = lines[i]!.trim();
      const prev = i > 0 ? lines[i - 1]!.trim() : '';
      if (line && !/^\d+$/.test(line) && (!prev || /^\d+$/.test(prev))) skipped++;
      continue;
    }
    const start = srtTime(m[1]!);
    const end = srtTime(m[2]!);
    const payload: string[] = [];
    let j = i + 1;
    for (; j < lines.length && lines[j]!.trim(); j++) {
      // No blank line before the next cue: an index followed by a timing line ends this one.
      if (TIMING.test(lines[j]!) || (/^\s*\d+\s*$/.test(lines[j]!) && TIMING.test(lines[j + 1] ?? ''))) break;
      payload.push(lines[j]!);
    }
    i = j - 1;
    if (start === null || end === null) {
      skipped++;
      continue;
    }
    // ASS/SSA override blocks ({\an8}, {\i1}) and <font> tags are styling only.
    const cleaned = payload.map((l) => l.replace(/\{\\[^}]*\}/g, ''));
    for (const p of cuePayload(cleaned)) cues.push({ start, end, speaker: p.speaker, text: p.text });
  }
  const warnings = skipped ? [warning(WARNING.cuesSkipped, skipped)] : [];
  return { cues: refineCueSpeakers(cues), warnings };
}
