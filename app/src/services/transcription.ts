// STUB (M0) → T-LECTURES owns this file from wave 1: the transcription queue (claims, volunteering, cloud).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { TranscriptionQueue } from './types/transcription';

export function createTranscriptionQueue(ctx: AppContext, app: () => AppServices): TranscriptionQueue {
  void app;
  const v = ctx.prefs.get('speech.volunteer');
  const volunteer = v === 'off' || v === 'always' ? v : 'plugged';
  const no = (m: string) => () => Promise.reject(notImplemented(`TranscriptionQueue.${m}`));
  return {
    state: constant({ job: null, lectures: [], volunteer, volunteerEffective: 'off', cloud: { on: false, model: ctx.prefs.get('speech.cloudModel'), auto: false } }),
    claim: no('claim'), takeOver: no('takeOver'), release: no('release'), retranscribe: no('retranscribe'), setVolunteer: no('setVolunteer'), setCloud: no('setCloud'),
  };
}
