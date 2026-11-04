// Architecture §11.2 (verbatim declarations): service contracts of the `lectures` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
// T-LECTURES (scope change 2026-11-04, transcript corrections in 0.1): `EffectiveTranscript.correctedBy`,
// `LectureDetail.canEdit` widened to boolean, `LectureService.edit` and `LectureService.fold` added.
import type { ClassPath, SegmentId, Ulid } from '../../core/model/ids';
import type { LectureFile, TranscriptFile } from '../../core/model/files';
import type { Marker, Picked } from '../../platform/types';
import type { LectureView, TranscriptionState } from './viewModels';
import type { ReadableStore } from '../store';
import type { AskTurn } from './ask';
import type { SearchService } from './search';

export type EffectiveTranscript = TranscriptFile & {
  concurrent: SegmentId[]; unfolded: number; stale: boolean; newer: boolean;
  /** Segments with corrections not folded yet → who made them ("Corrected by {name}", UX §3.5.3); self included. */
  correctedBy: Record<SegmentId, string[]>;
};

export interface LectureDetail {
  view: LectureView; lecture: LectureFile; transcript: EffectiveTranscript | null; audioUrl: string | null;
  peaks: number[] | null; markers: Marker[];
  autoMarkers: Array<{ segmentId: SegmentId; atMs: number }>;            // core/transcript/radar.ts minus private removals
  references: Array<{ segmentId: SegmentId; start: number; end: number; article: string; code: string | null;
                      target: { path: ClassPath; page: number | null } | null }>;   // core/transcript/references.ts, resolved via SearchService article units
  aiNotes: { summary: AskTurn | null; terms: AskTurn | null };          // private/<classId>/lectures/<id>.json
  canEdit: boolean; isOwner: boolean;                                    // corrections are in 0.1 (scope change 2026-11-04)
}

/**
 * Transcript corrections (folder spec §8.9): each call appends one edit line to this device's
 * `.tramado/edits/<lectureId>/<deviceId>.jsonl`; the transcript owner folds them (debounced 5 min).
 * Errors: NOT_FOUND (lecture, transcript or segment), NEWER_FORMAT (read-only transcript), INVALID (arguments).
 */
export interface TranscriptEditor {
  setText(id: Ulid, segmentId: SegmentId, text: string): Promise<void>;
  setSpeaker(id: Ulid, segmentId: SegmentId, speaker: string): Promise<void>;     // a speakers[].id, or a new `spk_<n>`
  split(id: Ulid, segmentId: SegmentId, atChar: number): Promise<SegmentId>;       // UTF-16 caret offset → the new segment's id
  merge(id: Ulid, segmentId: SegmentId): Promise<void>;                            // with the following segment
  labelSpeaker(id: Ulid, speakerId: string, label: string): Promise<void>;         // "Speakers…", ≤ 40 characters
  keep(id: Ulid, segmentId: SegmentId): Promise<void>;                             // "Keep this one" after two corrections met
}

export interface LectureService {
  list: ReadableStore<LectureView[]>;                       // UX LectureView (with TranscriptionState)
  open(id: Ulid): ReadableStore<LectureDetail | null>;
  rename(id: Ulid, title: string): Promise<void>; markDuplicate(id: Ulid, of: Ulid | null): Promise<void>;
  deleteLecture(id: Ulid): Promise<void>; deleteAudio(id: Ulid): Promise<void>;
  markers: { add(id: Ulid, m: Omit<Marker, 'id'>): Promise<void>; remove(id: Ulid, markerId: Ulid): Promise<void>; removeAuto(id: Ulid, atMs: number): Promise<void> };
  share(id: Ulid, mode: 'audio+transcript' | 'transcript-only'): Promise<void>;   // publishes a recording kept with share 'none'
  exportTranscript(id: Ulid, format: 'md' | 'vtt' | 'txt', pick: Picked): Promise<void>;
  edit: TranscriptEditor;
  /**
   * Folds the pending corrections into transcript.json now (the owner does it by itself 5 min after the last
   * one). `takeOver` makes this device the transcript owner: only after it won a fold claim (sync spec §14.8,
   * T-SYNC). Returns the new revision, or null when there was nothing to fold or this device is not the owner.
   */
  fold(id: Ulid, opts?: { takeOver?: boolean }): Promise<number | null>;
  /**
   * UI-LECTURES addition (UX §3.4 "Remove from this computer only"): adds the lecture's directory to this device's
   * ignores (folder spec §11.2, `classes.json` `localIgnores`) first, so the local delete does not propagate, then
   * removes the directory and this device's private files of the lecture. Errors: NOT_FOUND, INVALID (a lecture
   * stored at the class root cannot be ignored on its own).
   */
  removeLocal(id: Ulid): Promise<void>;
  /**
   * INT (wave 3, UX §3.5.2 "Get the recording"): this device skips audio files in the class, but fetches this one
   * lecture's `audio.webm` (`classes.json` `localIncludes`, emitted before the skip-audio ignore line).
   */
  fetchAudio(id: Ulid): Promise<void>;
}

