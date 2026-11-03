// The search units of a transcript (architecture §11.1): one unit per segment, carrying a `segment`
// locator (folder spec §8.15), over the indexed text = the segments' texts joined by '\n'.
// M0 implements it; T-LECTURES owns core/transcript from wave 1.
import type { Locator, TranscriptFile } from '../model/files';

export interface TranscriptUnit { start: number; end: number; locator: Locator }

/** The text a transcript is indexed as: one line per non-empty segment, in segment order. */
export function transcriptIndexText(t: Pick<TranscriptFile, 'segments'>): { text: string; units: TranscriptUnit[] } {
  const units: TranscriptUnit[] = [];
  let text = '';
  for (const s of [...t.segments].sort((a, b) => a.startMs - b.startMs)) {
    const said = s.text.replace(/\s+/g, ' ').trim();
    if (!said) continue;
    if (text) text += '\n';
    const start = text.length;
    text += said;
    units.push({ start, end: text.length, locator: { type: 'segment', segmentId: s.id, startMs: s.startMs, endMs: s.endMs } });
  }
  return { text, units };
}

/** The units of `transcriptIndexText` only. */
export function transcriptUnits(t: Pick<TranscriptFile, 'segments'>): TranscriptUnit[] {
  return transcriptIndexText(t).units;
}
