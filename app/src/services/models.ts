// STUB (M0) → T-LECTURES owns this file from wave 1: speech models (download, import, active model).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ModelId } from '../platform/types';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { ModelsService } from './types/transcription';

export function createModelsService(ctx: AppContext, app: () => AppServices): ModelsService {
  void app;
  const m = ctx.prefs.get('speech.model');
  const active: ModelId = m === 'small' || m === 'large-v3' ? m : 'turbo';
  const no = (x: string) => () => Promise.reject(notImplemented(`ModelsService.${x}`));
  return { models: constant([]), active: constant(active), download: no('download'), cancel: no('cancel'), remove: no('remove'), import: no('import'), setActive: no('setActive') };
}
