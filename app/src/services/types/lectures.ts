// Architecture §11.2 (verbatim declarations): service contracts of the `lectures` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassPath, SegmentId, Ulid } from '../../core/model/ids';
import type { LectureFile, TranscriptFile } from '../../core/model/files';
import type { Marker, Picked } from '../../platform/types';
import type { LectureView, TranscriptionState } from './viewModels';
import type { ReadableStore } from '../store';
import type { AskTurn } from './ask';
import type { SearchService } from './search';

export type EffectiveTranscript = TranscriptFile & { concurrent: SegmentId[]; unfolded: number; stale: boolean; newer: boolean };

export interface LectureDetail {
  view: LectureView; lecture: LectureFile; transcript: EffectiveTranscript | null; audioUrl: string | null;
  peaks: number[] | null; markers: Marker[];
  autoMarkers: Array<{ segmentId: SegmentId; atMs: number }>;            // core/transcript/radar.ts minus private removals
  references: Array<{ segmentId: SegmentId; start: number; end: number; article: string; code: string | null;
                      target: { path: ClassPath; page: number | null } | null }>;   // core/transcript/references.ts, resolved via SearchService article units
  aiNotes: { summary: AskTurn | null; terms: AskTurn | null };          // private/<classId>/lectures/<id>.json
  canEdit: false; isOwner: boolean;                                      // transcripts are read-only in 0.1 (§1.1)
}

export interface LectureService {
  list: ReadableStore<LectureView[]>;                       // UX LectureView (with TranscriptionState)
  open(id: Ulid): ReadableStore<LectureDetail | null>;
  rename(id: Ulid, title: string): Promise<void>; markDuplicate(id: Ulid, of: Ulid | null): Promise<void>;
  deleteLecture(id: Ulid): Promise<void>; deleteAudio(id: Ulid): Promise<void>;
  markers: { add(id: Ulid, m: Omit<Marker, 'id'>): Promise<void>; remove(id: Ulid, markerId: Ulid): Promise<void>; removeAuto(id: Ulid, atMs: number): Promise<void> };
  share(id: Ulid, mode: 'audio+transcript' | 'transcript-only'): Promise<void>;   // publishes a recording kept with share 'none'
  exportTranscript(id: Ulid, format: 'md' | 'vtt' | 'txt', pick: Picked): Promise<void>;
}
