// Bindings of architecture §6.4 (commands/ai.rs): secrets and the AI pipe (streamed over a Channel).
import { Channel } from '@tauri-apps/api/core';
import type { AiActivityEntry, AiHost, AiWireEvent, Platform, PrivacyLevel, SecretStatus } from '../types';
import { call } from './index';

export function createSecretBindings(): Platform['secrets'] {
  return {
    set: (name, value) => call<SecretStatus>('secret_set', { name, value }),
    status: (name) => call<SecretStatus>('secret_status', { name }),
    clear: (name) => call<void>('secret_clear', { name }),
  };
}

export function createAiBindings(): Platform['ai'] {
  return {
    send(request, onEvent) {
      const onEventChannel = new Channel<AiWireEvent>();
      onEventChannel.onmessage = onEvent;
      return call<void>('ai_send', { request, onEvent: onEventChannel });
    },
    cancel: (requestId) => call<void>('ai_cancel', { requestId }),
    hosts: () => call<AiHost[]>('ai_hosts'),
    allowHost: (base, text) => call<AiHost | null>('ai_host_allow', { base, text }),
    forgetHost: (hostId) => call<void>('ai_host_forget', { hostId }),
    privacy: () => call<PrivacyLevel>('ai_privacy_get'),
    setPrivacy: (level, text) => call<boolean>('ai_privacy_set', { level, text }),
    busyPolicy: () => call<boolean>('ai_busy_policy_get'),
    setBusyPolicy: (relax, text) => call<boolean>('ai_busy_policy_set', { relax, text }),
    activity: (limit) => call<AiActivityEntry[]>('ai_activity', { limit }),
    clearActivity: () => call<void>('ai_activity_clear'),
  };
}
