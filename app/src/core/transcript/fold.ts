// The owner's fold (folder spec §8.9): the effective transcript written as the next transcript.json, with
// `revision + 1` and `folded[d]` = the greatest folded HLC of each device. A new owner (fold claim, sync
// spec §14.8) folds with itself as `writer`. Pure; the caller writes the file, then .md and .vtt.
import type { DeviceId, Instant, MemberId } from '../model/ids';
import type { Segment, TranscriptFile } from '../model/files';
import { mergeUnknown } from '../model/parse';
import { replay, type EditLog, type ReplayInfo } from './effective';

export interface FoldContext {
  at: Instant;
  /** A new owner taking the transcript over (sync spec §14.8); omitted = the current writer folds. */
  writer?: { deviceId: DeviceId; memberId: MemberId };
}

const stripSegment = (s: Segment): Segment => {
  const out: Segment = { ...s };
  if (out.editHlc && Object.keys(out.editHlc).length === 0) delete out.editHlc;
  if (out.merged && out.merged.length === 0) delete out.merged;
  return out;
};

/**
 * The next transcript.json, or null when there is nothing to fold (no pending edit line and no change of
 * writer). Unknown fields of `t` are kept (folder spec §4.3).
 */
export function fold(t: TranscriptFile, logs: readonly EditLog[], ctx: FoldContext): { transcript: TranscriptFile; info: ReplayInfo } | null {
  const { transcript: eff, info } = replay(t, logs);
  const newWriter = ctx.writer && ctx.writer.deviceId !== t.writer.deviceId ? ctx.writer : null;
  if (info.ops === 0 && !newWriter) return null;
  const folded: Record<DeviceId, string> = { ...t.folded };
  for (const [d, h] of Object.entries(info.foldedTo)) if (!folded[d] || h > folded[d]!) folded[d] = h;
  const next: TranscriptFile = {
    format: 'tramado.transcript',
    version: 1,
    lectureId: t.lectureId,
    round: t.round,
    revision: t.revision + 1,
    audioSha256: t.audioSha256,
    language: t.language,
    writer: newWriter ? { deviceId: newWriter.deviceId, memberId: newWriter.memberId } : t.writer,
    transcribedBy: t.transcribedBy,
    engine: t.engine,
    speakers: eff.speakers.map((s) => ({ ...s })),
    segments: eff.segments.map(stripSegment),
    folded,
    updatedAt: ctx.at,
  };
  return { transcript: mergeUnknown(t, next), info };
}
