// Architecture §11.2 (verbatim declarations): service contracts of the `recording` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, Instant, Lang, Ulid } from '../../core/model/ids';
import type { FinishedRecording, Marker, MeterRequest, Picked, RecorderStatus, ShareMode, TrackLevel } from '../../platform/types';
import type { MarkerKind } from './viewModels';
import type { ReadableStore } from '../store';
import type { ConsentInput } from './class';

export interface RecordingState { status: RecorderStatus; classId: ClassId; title: string; markers: Marker[] }

export interface RecordingService {
  state: ReadableStore<RecordingState | null>; pending: ReadableStore<FinishedRecording[]>;
  meter: ReadableStore<{ mic: TrackLevel | null; system: TrackLevel | null } | null>;
  startMeter(req: MeterRequest): Promise<void>; stopMeter(): Promise<void>;   // record dialog and Settings › Transcription
  start(input: { classId: ClassId; title: string; mode: 'room' | 'online'; includeMic: boolean; inputDeviceId: string | null; language: Lang | 'auto'; consent: { record: ConsentInput; share: ConsentInput | null; remember: boolean } }): Promise<void>;
      // writes the consent lines (scope 'lecture', or 'class' when remember) before the recorder starts
  pause(): Promise<void>; resume(): Promise<void>; mark(kind: MarkerKind, note?: string): Promise<void>;
  stop(): Promise<FinishedRecording>;
  publish(rec: FinishedRecording, opts: { title: string; share: ShareMode; transcribe: 'here' | 'cloud' | 'classmate' | 'later' }): Promise<Ulid>;
  importAudio(classId: ClassId, pick: Picked, opts: { title: string; keepVideo: boolean; startedAt?: Instant }): Promise<Ulid>;
  discard(recordingId: Ulid): Promise<void>; recover(): Promise<void>;
}
