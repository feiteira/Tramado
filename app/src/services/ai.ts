// STUB (M0) → T-AI owns this file from wave 1: AI settings, the client over platform.ai, quota and catalog.
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { Store } from './store';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { AiService, AiSettingsView } from './types/ai';

export function createAiService(ctx: AppContext, app: () => AppServices): AiService {
  void app;
  const settings = new Store<AiSettingsView & { enabled: boolean; busyRelax: boolean; generalDefault: boolean }>({
    key: { set: false, last4: null, store: 'memory' }, privacy: 'no-training', model: ctx.prefs.get('ai.model'), fallbacks: [], chain: [],
    customHost: null, answerLanguage: 'question', quota: null, catalogAge: null, lastAnswerModel: null,
    enabled: ctx.prefs.get('ai.enabled') === '1', busyRelax: false, generalDefault: ctx.prefs.get('ai.generalDefault') === '1',
  });
  const no = (m: string) => () => Promise.reject(notImplemented(`AiService.${m}`));
  return {
    settings,
    client: {},
    setKey: no('setKey'), clearKey: no('clearKey'), testKey: no('testKey'), setModel: no('setModel'), setFallbacks: no('setFallbacks'),
    setPrivacy: no('setPrivacy'), setCustomHost: no('setCustomHost'), setEnabled: no('setEnabled'), setBusyPolicy: no('setBusyPolicy'),
    setGeneralDefault: no('setGeneralDefault'), refreshQuota: no('refreshQuota'), catalog: no('catalog'), activity: no('activity'),
    clearActivity: no('clearActivity'),
    estimate: () => ({ requests: 0, remaining: null }),
  };
}
