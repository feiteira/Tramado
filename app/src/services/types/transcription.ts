// Architecture §11.2 (verbatim declarations): service contracts of the `transcription` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, Ulid } from '../../core/model/ids';
import type { JobSummary, ModelId, ModelState, Picked } from '../../platform/types';
import type { ReadableStore } from '../store';
import type { ClaimView } from './sync';

export interface TranscriptionQueueState {
  job: (JobSummary & { classId: ClassId; title: string }) | null;
  lectures: Array<{ classId: ClassId; lectureId: Ulid; title: string; claim: ClaimView | null; eligible: boolean; reason: string | null }>;
  volunteer: 'off' | 'plugged' | 'always';                  // the preference
  volunteerEffective: 'off' | 'plugged' | 'always';         // what the member file reports (sync spec §14.3)
  cloud: { on: boolean; model: string; auto: boolean };
}

export interface TranscriptionQueue {
  state: ReadableStore<TranscriptionQueueState>;
  claim(classId: ClassId, lectureId: Ulid, engine: 'local' | 'cloud'): Promise<'won' | 'lost' | 'ineligible'>;
  takeOver(classId: ClassId, lectureId: Ulid): Promise<'won' | 'lost' | 'ineligible'>;
  release(classId: ClassId, lectureId: Ulid): Promise<void>;
  retranscribe(classId: ClassId, lectureId: Ulid): Promise<void>;
  setVolunteer(v: 'off' | 'plugged' | 'always'): Promise<void>;
  setCloud(on: boolean, model: string, auto: boolean): Promise<void>;   // prefs speech.cloud / cloudModel / cloudAuto
}

export interface ModelsService { models: ReadableStore<ModelState[]>; active: ReadableStore<ModelId>; download(id: ModelId): Promise<void>; cancel(id: ModelId): Promise<void>; remove(id: ModelId): Promise<void>; import(id: ModelId, pick: Picked): Promise<void>; setActive(id: ModelId): Promise<void> }
