// STUB (M0) → T-LECTURES owns this file from wave 1: the recorder, consent lines, publishing and recovery.
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { RecordingService } from './types/recording';

export function createRecordingService(ctx: AppContext, app: () => AppServices): RecordingService {
  void ctx; void app;
  const no = (m: string) => () => Promise.reject(notImplemented(`RecordingService.${m}`));
  return {
    state: constant(null), pending: constant([]), meter: constant(null),
    startMeter: no('startMeter'), stopMeter: no('stopMeter'), start: no('start'), pause: no('pause'), resume: no('resume'), mark: no('mark'),
    stop: no('stop'), publish: no('publish'), importAudio: no('importAudio'), discard: no('discard'), recover: no('recover'),
  };
}
