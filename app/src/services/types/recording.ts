// Architecture §11.2 (verbatim declarations): service contracts of the `recording` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
// T-LECTURES additions: `RecordingState.warnings`, `RecordingService.imports`, `RecordingService.share`, optional
// `importAudio` options `language`, `transcribe`, `consent`.
import type { ClassId, Instant, Lang, Ulid } from '../../core/model/ids';
import type { ErrorCode, FinishedRecording, Marker, MeterRequest, Picked, RecorderEvent, RecorderStatus, ShareMode, TrackLevel } from '../../platform/types';
import type { MarkerKind } from './viewModels';
import type { ReadableStore } from '../store';
import type { ConsentInput } from './class';

export type RecorderWarning = Extract<RecorderEvent, { type: 'warning' }>['code'];

export interface RecordingState {
  status: RecorderStatus; classId: ClassId; title: string; markers: Marker[];
  /** Warnings the recorder raised and that still hold (the dock shows the latest), e.g. 'silentMic'. */
  warnings: RecorderWarning[];
}

/** INT (wave 3): why the last recording ended without Stop (the dock's "The recording stopped: {reason}"). */
export interface StopReason { recordingId: Ulid; classId: ClassId; title: string; reason: 'error' | 'diskFull'; code: ErrorCode | null }

/** An audio import running in Rust (the dock row "Converting “{file}”… {percent} %"). */
export interface ImportProgress { recordingId: Ulid; classId: ClassId; name: string; title: string; progress: number }

export interface RecordingService {
  state: ReadableStore<RecordingState | null>; pending: ReadableStore<FinishedRecording[]>;
  meter: ReadableStore<{ mic: TrackLevel | null; system: TrackLevel | null } | null>;
  startMeter(req: MeterRequest): Promise<void>; stopMeter(): Promise<void>;   // record dialog and Settings › Transcription
  start(input: { classId: ClassId; title: string; mode: 'room' | 'online'; includeMic: boolean; inputDeviceId: string | null; language: Lang | 'auto'; consent: { record: ConsentInput; share: ConsentInput | null; remember: boolean } }): Promise<void>;
      // writes the consent lines (scope 'lecture', or 'class' when remember) before the recorder starts
  pause(): Promise<void>; resume(): Promise<void>;
  /** `atMs` (INT): the raw audio time to stamp, e.g. when the note field opened; default now. Resolves with the marker. */
  mark(kind: MarkerKind, note?: string, atMs?: number): Promise<Marker | void>;
  /** INT (wave 3): the toast's Undo — removes a marker of the running recording (or of the recording just stopped). */
  removeMarker(markerId: Ulid): Promise<void>;
  /** INT (wave 3): the reason of the last recording that ended on its own (null after a Start or a user Stop). */
  stopReason: ReadableStore<StopReason | null>;
  stop(): Promise<FinishedRecording>;
  publish(rec: FinishedRecording, opts: { title: string; share: ShareMode; transcribe: 'here' | 'cloud' | 'classmate' | 'later' }): Promise<Ulid>;
  importAudio(classId: ClassId, pick: Picked, opts: { title: string; keepVideo: boolean; startedAt?: Instant;
    /** T-LECTURES additions (UX §3.6.6): the language spoken (default: the class's), the transcript choice, and the
     *  "I'm allowed to share this recording with the class" consent of a shared class (a `share` line). */
    language?: Lang | 'auto'; transcribe?: 'here' | 'cloud' | 'classmate' | 'later'; consent?: ConsentInput;
    /** INT (wave 3): a `.vtt` picked with the recording becomes its transcript (engine `import`, folder spec §8.8). */
    subtitles?: Picked }): Promise<Ulid>;
  discard(recordingId: Ulid): Promise<void>; recover(): Promise<void>;
  /** Imports converting now (one at a time in Rust). */
  imports: ReadableStore<ImportProgress[]>;
  /** Publishes a recording kept on this computer with share 'none' (the lecture's ⋯ › Share…). Returns the lecture id. */
  share(recordingId: Ulid, mode: 'audio+transcript' | 'transcript-only'): Promise<Ulid>;
}
