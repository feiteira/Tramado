// Bindings of architecture §6.8 (commands/speech.rs → tramado-speech). R-SPEECH owns this file in wave 1.
// Long jobs take a Channel named `onEvent` and have an *_attach command (D-7).
import { Channel } from '@tauri-apps/api/core';
import type {
  AudioDevices, FinishedRecording, ImportEvent, JobSummary, Marker, MeterEvent, ModelEvent, ModelState, Platform, PublishedAudio,
  RecorderEvent, RecorderStatus, SpeechInfo, TranscribeEvent, TranscriptionResult,
} from '../types';
import { call } from './index';

function channel<E>(cb: (e: E) => void): Channel<E> {
  const c = new Channel<E>();
  c.onmessage = cb;
  return c;
}

export function createSpeechBindings(): NonNullable<Platform['speech']> {
  return {
    info: () => call<SpeechInfo>('speech_info'),
    models: () => call<ModelState[]>('speech_models'),
    downloadModel: (modelId, onEvent) => call<void>('speech_model_download', { modelId, onEvent: channel<ModelEvent>(onEvent) }),
    attachModel: (modelId, onEvent) => call<boolean>('speech_model_attach', { modelId, onEvent: channel<ModelEvent>(onEvent) }),
    cancelModel: (modelId) => call<void>('speech_model_cancel', { modelId }),
    deleteModel: (modelId) => call<void>('speech_model_delete', { modelId }),
    importModel: (modelId, pick) => call<ModelState>('speech_model_import', { modelId, pick }),
    devices: () => call<AudioDevices>('speech_devices'),
    meter: {
      start: (req, onEvent) => call<void>('speech_meter_start', { req, onEvent: channel<MeterEvent>(onEvent) }),
      stop: () => call<void>('speech_meter_stop'),
    },
    recorder: {
      start: (req, onEvent) => call<RecorderStatus>('speech_recorder_start', { req, onEvent: channel<RecorderEvent>(onEvent) }),
      attach: (onEvent) => call<RecorderStatus | null>('speech_recorder_attach', { onEvent: channel<RecorderEvent>(onEvent) }),
      pause: () => call<RecorderStatus>('speech_recorder_pause'),
      resume: () => call<RecorderStatus>('speech_recorder_resume'),
      mark: (kind, note, atMs) => call<Marker>('speech_recorder_mark', { m: { kind, ...(note !== undefined ? { note } : {}), ...(atMs !== undefined ? { atMs: Math.max(0, Math.round(atMs)) } : {}) } }),
      unmark: (markerId) => call<void>('speech_recorder_unmark', { markerId }),
      stop: () => call<FinishedRecording>('speech_recorder_stop'),
      pending: () => call<FinishedRecording[]>('speech_recordings_pending'),
      publish: (req) => call<PublishedAudio>('speech_recording_publish', { req }),
      discard: (recordingId) => call<void>('speech_recording_discard', { recordingId }),
    },
    importAudio: (req, onEvent) => call<void>('speech_import_audio', { req, onEvent: channel<ImportEvent>(onEvent) }),
    attachImport: (recordingId, onEvent) => call<boolean>('speech_import_attach', { recordingId, onEvent: channel<ImportEvent>(onEvent) }),
    transcribe: {
      start: (req, onEvent) => call<string>('speech_transcribe_start', { req, onEvent: channel<TranscribeEvent>(onEvent) }),
      attach: (jobId, onEvent) => call<JobSummary | null>('speech_transcribe_attach', { jobId, onEvent: channel<TranscribeEvent>(onEvent) }),
      cancel: (jobId, keepPartial) => call<void>('speech_transcribe_cancel', { jobId, keepPartial }),
      jobs: () => call<JobSummary[]>('speech_jobs'),
      take: (jobId) => call<TranscriptionResult>('speech_transcribe_take', { jobId }),
    },
    peaks: (source, buckets) => call<number[]>('speech_peaks', { req: { source, buckets } }),
  };
}
