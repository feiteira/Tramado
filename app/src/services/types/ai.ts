// Architecture §11.2 (verbatim declarations): service contracts of the `ai` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { AiActivityEntry, AiHost, ErrorCode, PrivacyLevel, SecretStatus } from '../../platform/types';
import type { ModelLabel, Quota } from './viewModels';
import type { CatalogModel } from '../context';
import type { ReadableStore } from '../store';

/** The AI client of core/ai/client.ts (T-AI). */
export type { AiClient } from '../../core/ai/client';
import type { AiClient } from '../../core/ai/client';

export interface AiSettingsView {
  key: SecretStatus; privacy: PrivacyLevel; model: string; fallbacks: string[]; chain: string[];
  customHost: AiHost | null; answerLanguage: 'question' | 'ui'; quota: Quota | null;
  catalogAge: number | null; lastAnswerModel: ModelLabel | null;
}

export interface AiService {
  settings: ReadableStore<AiSettingsView & { enabled: boolean; busyRelax: boolean; generalDefault: boolean } & AiSettingsExtra>;
  client: AiClient;                                         // core/ai/client.ts instance over platform.ai
  setKey(value: string): Promise<void>; clearKey(): Promise<void>; testKey(): Promise<{ ok: boolean; code?: ErrorCode; remaining?: number;
    /** INT: the key works but the first model of the chain is busy right now (its endpoints' recent uptime). */
    busy?: boolean }>;
  setModel(id: string): Promise<void>; setFallbacks(ids: string[]): Promise<void>;
  setPrivacy(level: PrivacyLevel): Promise<boolean>; setCustomHost(base: string | null): Promise<void>;
  setEnabled(on: boolean): Promise<void>;                   // "Turn off AI on this computer" (prefs ai.enabled)
  setBusyPolicy(relax: boolean): Promise<boolean>;          // platform.ai.setBusyPolicy (native confirm when on)
  setGeneralDefault(on: boolean): Promise<void>;
  refreshQuota(): Promise<void>; catalog(): Promise<CatalogModel[]>;
  activity(limit: number): Promise<AiActivityEntry[]>; clearActivity(): Promise<void>;
  estimate(task: string, count: number): { requests: number; remaining: number | null };
  // ── Additive (T-AI, wave 1) ──
  /** The display label of a model id (catalog name without "Vendor: ", UX §8 OQ13). */
  label(id: string): ModelLabel;
  /** Resolves when the stored settings (key status, privacy, busy policy, catalog cache) have been read. */
  ready(): Promise<void>;
}

/** Additive fields of the settings store (T-AI): the catalog check of the chain (critique G21). */
export interface AiSettingsExtra {
  /** The chosen model is no longer in the catalog and `replacement` answers instead ("{model} is no longer on OpenRouter. Using {replacement}."). */
  replaced: { model: string; replacement: string } | null;
  /** Free models of the catalog that work at the current privacy level (the "{n} free models work" line). */
  freeAtLevel: number | null;
}
