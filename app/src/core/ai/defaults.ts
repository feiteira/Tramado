// The bundled AI defaults (architecture §11.1.1; critique D7, D8, G21): chains per privacy level, vision chains,
// the models used only with the explicit "may train" choice, task profiles and limits. Data, so a release can
// update them without code changes.
import raw from './ai-defaults.json';
import type { PrivacyLevel, Reasoning, Task } from './types';

export interface Profile { maxTokens: number; temperature: number; reasoning: Reasoning }
export interface AiDefaults {
  format: 'tramado.ai-defaults'; version: 1; updated: string;
  chains: Record<PrivacyLevel, string[]>;
  vision: Record<PrivacyLevel, string[]>;
  trainingOptIn: string[];
  stt: { model: string; usdPerHour: number; catalog: string };
  profiles: Record<Task, Profile>;
  limits: { freePerMinute: number; maxInFlight: number; maxChain: number };
}

export const AI_DEFAULTS = raw as AiDefaults;
export const DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
export const MAX_CHAIN = AI_DEFAULTS.limits.maxChain;
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** A free model by id (`:free`) — the throttle's 18/min bucket and the quota apply to these. */
export const isFreeId = (id: string): boolean => id.endsWith(':free') || id === 'openrouter/free';

/** The default fallbacks of a level for a chosen model: the level's list without that model, two at most. */
export function defaultFallbacks(level: PrivacyLevel, model: string, vision = false): string[] {
  const list = (vision ? AI_DEFAULTS.vision : AI_DEFAULTS.chains)[level] ?? [];
  return list.filter((m) => m !== model).slice(0, MAX_CHAIN - 1);
}

/**
 * The chain sent with a request (architecture §11.1.1): the user's model first, then the user's fallbacks
 * (`ai.fallbacks`, empty = the level's defaults), de-duplicated, at most three.
 */
export function chainFor(level: PrivacyLevel, model: string, fallbacks: readonly string[] = [], vision = false): string[] {
  const rest = fallbacks.length ? [...fallbacks] : defaultFallbacks(level, model, vision);
  const out: string[] = [];
  for (const id of [model, ...rest]) if (id && !out.includes(id)) out.push(id);
  return out.slice(0, MAX_CHAIN);
}

/** The NVIDIA / "may train" chain for the busy chooser (C14, D9): never used without the explicit choice. */
export function trainingChain(exclude: readonly string[] = []): string[] {
  return AI_DEFAULTS.trainingOptIn.filter((m) => !exclude.includes(m)).slice(0, MAX_CHAIN);
}
