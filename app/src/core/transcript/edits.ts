// Transcript corrections (folder spec §8.9): the five edit operations as `TranscriptEditLine`s, and the
// checks a reader applies to a line before replaying it. Writers append these lines to their own
// `.tramado/edits/<lectureId>/<deviceId>.jsonl`; the transcript owner folds them (fold.ts).
import { isHex40, isHlc, isMemberId, isSegmentId, isUlid, type DeviceId, type EpochMs, type Hlc, type MemberId, type SegmentId, type Ulid } from '../model/ids';
import type { Segment, TranscriptEditLine, TranscriptFile } from '../model/files';
import { isSpeakerId } from './labels';
import { sha1Hex } from './sha1';

/** A speaker label is at most this long (folder spec §8.9). */
export const MAX_LABEL_CHARS = 40;
/** A corrected segment text is at most this long (the JSONL line limit is the hard one). */
export const MAX_SEGMENT_CHARS = 8_000;

/** The edit log of one device. */
export const editLogPath = (lectureId: Ulid, deviceId: DeviceId): string => `.tramado/edits/${lectureId}/${deviceId}.jsonl`;

/** The SHA-1 a `set_text` names as its `base`. */
export const textBase = (text: string): string => sha1Hex(text);

/** What every line carries besides its operation. */
export interface EditStamp {
  id: Ulid; hlc: Hlc; ms: EpochMs; memberId: MemberId;
  transcript: Pick<TranscriptFile, 'lectureId' | 'round' | 'revision'>;
}

const head = (s: EditStamp) => ({
  format: 'tramado.transcript-edit' as const, version: 1 as const, id: s.id, hlc: s.hlc, ms: s.ms, memberId: s.memberId,
  lectureId: s.transcript.lectureId, round: s.transcript.round, baseRevision: s.transcript.revision,
});

/** `set_text`: `base` is the SHA-1 of the text the editor saw. */
export function setTextOp(s: EditStamp, segment: SegmentId, oldText: string, text: string): TranscriptEditLine {
  return { ...head(s), op: 'set_text', segment, base: textBase(oldText), text: normalizeText(text) };
}

export function setSpeakerOp(s: EditStamp, segment: SegmentId, speaker: string): TranscriptEditLine {
  return { ...head(s), op: 'set_speaker', segment, speaker };
}

export function splitOp(s: EditStamp, segment: SegmentId, atChar: number, atMs: number, newId: SegmentId): TranscriptEditLine {
  return { ...head(s), op: 'split', segment, atChar, atMs: Math.round(atMs), newId };
}

export function mergeOp(s: EditStamp, segment: SegmentId, withId: SegmentId): TranscriptEditLine {
  return { ...head(s), op: 'merge', segment, with: withId };
}

export function labelSpeakerOp(s: EditStamp, speakerId: string, label: string): TranscriptEditLine {
  return { ...head(s), op: 'label_speaker', speakerId, label: normalizeLabel(label) };
}

/** Segment text as written by an editor: NFC, one line, single spaces, trimmed. */
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Speaker label: NFC, collapsed spaces, trimmed, at most 40 characters. */
export function normalizeLabel(label: string): string {
  return [...label.normalize('NFC').replace(/\s+/g, ' ').trim()].slice(0, MAX_LABEL_CHARS).join('');
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

/**
 * Whether a parsed line (its envelope already checked by `parseRecord`) is a well-formed edit for this
 * transcript (lecture id and round): the fields its operation needs, with the types of §8.9. Readers
 * skip any other line.
 */
export function validEditLine(line: TranscriptEditLine, t?: Pick<TranscriptFile, 'lectureId' | 'round'>): boolean {
  const l = line as unknown as Record<string, unknown>;
  if (!isUlid(l.id) || !isHlc(l.hlc) || !isInt(l.ms) || !isMemberId(l.memberId) || !isUlid(l.lectureId)) return false;
  if (!isInt(l.round) || (l.round as number) < 1 || !isInt(l.baseRevision)) return false;
  if (t && (l.lectureId !== t.lectureId || l.round !== t.round)) return false;
  switch (l.op) {
    case 'set_text':
      return isSegmentId(l.segment) && typeof l.text === 'string' && [...l.text].length <= MAX_SEGMENT_CHARS && (l.base === undefined || isHex40(l.base));
    case 'set_speaker':
      return isSegmentId(l.segment) && isSpeakerId(l.speaker);
    case 'split':
      return isSegmentId(l.segment) && isInt(l.atChar) && isInt(l.atMs) && (l.atMs as number) >= 0 && isSegmentId(l.newId);
    case 'merge':
      return isSegmentId(l.segment) && isSegmentId(l.with);
    case 'label_speaker':
      return isSpeakerId(l.speakerId) && typeof l.label === 'string' && l.label.trim() !== '' && [...l.label].length <= MAX_LABEL_CHARS;
    default:
      return false;
  }
}

/**
 * Where to split a segment at a character offset: the start of the first word at or after the caret
 * when word times exist and line up with the text, otherwise a linear estimate over the segment.
 */
export function splitTime(seg: Pick<Segment, 'startMs' | 'endMs' | 'text' | 'words'>, atChar: number): number {
  const len = seg.text.length;
  if (seg.words?.length) {
    let pos = 0;
    let ok = true;
    for (const w of seg.words) {
      const at = seg.text.indexOf(w.text, pos);
      if (at < 0) {
        ok = false;
        break;
      }
      if (at >= atChar) return Math.min(Math.max(w.startMs, seg.startMs), seg.endMs);
      pos = at + w.text.length;
    }
    if (ok) return seg.endMs;
  }
  if (len <= 0) return seg.startMs;
  return Math.round(seg.startMs + ((seg.endMs - seg.startMs) * Math.min(Math.max(atChar, 0), len)) / len);
}
