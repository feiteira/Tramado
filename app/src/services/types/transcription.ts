// Architecture §11.2 (verbatim declarations): service contracts of the `transcription` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
// T-LECTURES additions: `job.phase`, `volunteerNotice`, `notify`, `start`, `ackVolunteerNotice`, `notifyWhenReady`;
// ModelsService `info`, `downloads`, `refresh`.
import type { ClassId, Ulid } from '../../core/model/ids';
import type { JobSummary, ModelId, ModelState, Picked, SpeechInfo, TranscribeEvent } from '../../platform/types';
import type { ReadableStore } from '../store';
import type { ClaimView } from './sync';

export type TranscribePhase = Extract<TranscribeEvent, { type: 'phase' }>['phase'];

export interface TranscriptionQueueState {
  job: (JobSummary & { classId: ClassId; title: string; phase: TranscribePhase | null; engine: 'local' | 'cloud' }) | null;
  lectures: Array<{ classId: ClassId; lectureId: Ulid; title: string; claim: ClaimView | null; eligible: boolean; reason: string | null }>;
  volunteer: 'off' | 'plugged' | 'always';                  // the preference
  volunteerEffective: 'off' | 'plugged' | 'always';         // what the member file reports (sync spec §14.3)
  cloud: { on: boolean; model: string; auto: boolean };
  /** The one-time notice "This computer will help transcribe…" [OK] [Turn off] is due (sync spec §14.3). */
  volunteerNotice: boolean;
  /** Lectures whose "Notify me when it's ready" is on, as `${classId}/${lectureId}`. */
  notify: string[];
}

export interface TranscriptionQueue {
  state: ReadableStore<TranscriptionQueueState>;
  claim(classId: ClassId, lectureId: Ulid, engine: 'local' | 'cloud'): Promise<'won' | 'lost' | 'ineligible'>;
  takeOver(classId: ClassId, lectureId: Ulid): Promise<'won' | 'lost' | 'ineligible'>;
  release(classId: ClassId, lectureId: Ulid): Promise<void>;
  retranscribe(classId: ClassId, lectureId: Ulid): Promise<void>;
  setVolunteer(v: 'off' | 'plugged' | 'always'): Promise<void>;
  setCloud(on: boolean, model: string, auto: boolean): Promise<void>;   // prefs speech.cloud / cloudModel / cloudAuto
  /**
   * Starts the queue (once, after `library.load()` and `sync.boot()`): re-attaches running jobs after
   * `waitCaughtUp`, takes finished results, and starts the volunteer timers of every shared class.
   */
  start(): Promise<void>;
  /** Answers the one-time volunteering notice ([OK] or [Turn off]). */
  ackVolunteerNotice(turnOff: boolean): Promise<void>;
  /** "Notify me when it's ready" (a toggle; this session). */
  notifyWhenReady(classId: ClassId, lectureId: Ulid, on: boolean): void;
}

export interface ModelsService {
  models: ReadableStore<ModelState[]>; active: ReadableStore<ModelId>; download(id: ModelId): Promise<void>; cancel(id: ModelId): Promise<void>; remove(id: ModelId): Promise<void>; import(id: ModelId, pick: Picked): Promise<void>; setActive(id: ModelId): Promise<void>;
  /** `speech_info` (CPU support, system audio, engine); null without speech (the demo without `speech=fake`). */
  info: ReadableStore<SpeechInfo | null>;
  /** Downloads in progress: bytes done and the measured speed. */
  downloads: ReadableStore<Partial<Record<ModelId, { done: number; total: number; bytesPerSec: number }>>>;
  /** Re-reads `speech_info` and the models (after an import, a deletion elsewhere, or at start). */
  refresh(): Promise<void>;
}
