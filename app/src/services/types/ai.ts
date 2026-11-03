// Architecture §11.2 (verbatim declarations): service contracts of the `ai` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { AiActivityEntry, AiHost, ErrorCode, PrivacyLevel, SecretStatus } from '../../platform/types';
import type { ModelLabel, Quota } from './viewModels';
import type { CatalogModel } from '../context';
import type { ReadableStore } from '../store';

/** The AI client of core/ai/client.ts (T-AI). M0 declares the slot; T-AI replaces this alias with an import. */
export type AiClient = object;

export interface AiSettingsView {
  key: SecretStatus; privacy: PrivacyLevel; model: string; fallbacks: string[]; chain: string[];
  customHost: AiHost | null; answerLanguage: 'question' | 'ui'; quota: Quota | null;
  catalogAge: number | null; lastAnswerModel: ModelLabel | null;
}

export interface AiService {
  settings: ReadableStore<AiSettingsView & { enabled: boolean; busyRelax: boolean; generalDefault: boolean }>;
  client: AiClient;                                         // core/ai/client.ts instance over platform.ai
  setKey(value: string): Promise<void>; clearKey(): Promise<void>; testKey(): Promise<{ ok: boolean; code?: ErrorCode; remaining?: number }>;
  setModel(id: string): Promise<void>; setFallbacks(ids: string[]): Promise<void>;
  setPrivacy(level: PrivacyLevel): Promise<boolean>; setCustomHost(base: string | null): Promise<void>;
  setEnabled(on: boolean): Promise<void>;                   // "Turn off AI on this computer" (prefs ai.enabled)
  setBusyPolicy(relax: boolean): Promise<boolean>;          // platform.ai.setBusyPolicy (native confirm when on)
  setGeneralDefault(on: boolean): Promise<void>;
  refreshQuota(): Promise<void>; catalog(): Promise<CatalogModel[]>;
  activity(limit: number): Promise<AiActivityEntry[]>; clearActivity(): Promise<void>;
  estimate(task: string, count: number): { requests: number; remaining: number | null };
}
