// STUB (M0) → T-LECTURES owns this file from wave 1: createFakeSpeech() simulates models, the recorder,
// publishing, transcription and peaks (architecture §10). Until then every method throws NOT_IMPLEMENTED.
import { notImplemented } from '../../core/errors';
import type { Platform } from '../types';

export interface FakeSpeechOptions { model?: 'ready' | 'missing' | 'downloading'; recording?: boolean }

type Speech = NonNullable<Platform['speech']>;

export function createFakeSpeech(_opts: FakeSpeechOptions = {}): Speech {
  const no = (name: string) => () => Promise.reject(notImplemented(`speech.${name}`));
  return {
    info: no('info'),
    models: no('models'),
    downloadModel: no('downloadModel'),
    attachModel: no('attachModel'),
    cancelModel: no('cancelModel'),
    deleteModel: no('deleteModel'),
    importModel: no('importModel'),
    devices: no('devices'),
    meter: { start: no('meter.start'), stop: no('meter.stop') },
    recorder: {
      start: no('recorder.start'), attach: no('recorder.attach'), pause: no('recorder.pause'), resume: no('recorder.resume'),
      mark: no('recorder.mark'), stop: no('recorder.stop'), pending: no('recorder.pending'), publish: no('recorder.publish'),
      discard: no('recorder.discard'),
    },
    importAudio: no('importAudio'),
    attachImport: no('attachImport'),
    transcribe: { start: no('transcribe.start'), attach: no('transcribe.attach'), cancel: no('transcribe.cancel'), jobs: no('transcribe.jobs'), take: no('transcribe.take') },
    peaks: no('peaks'),
  };
}
