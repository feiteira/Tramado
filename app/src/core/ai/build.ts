// The request builder (openrouter-lab §11.3, architecture §11.1.1): task profile, chain per privacy level,
// capability filter (tools, vision), `models` ≤ 3, mandatory reasoning, `provider` per level (Rust overwrites it
// anyway, arch §5.2 rule 5; the fetch transport of the demo and the live test relies on it being right here).
import { AI_DEFAULTS, MAX_CHAIN, chainFor } from './defaults';
import type { Catalog } from './catalog';
import type { ChatBody, Effort, Msg, PrivacyLevel, Reasoning, ResponseFormat, Task, ToolDef } from './types';

export interface BuildSettings {
  /** The effective level, or `custom-host` for an OpenAI-compatible service (no provider, no `models`). */
  level: PrivacyLevel | 'custom-host';
  model: string;
  fallbacks: readonly string[];
  showReasoning?: boolean;
}
export interface BuildExtra {
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none';
  responseFormat?: ResponseFormat;
  /** Needs image input (OCR): the vision chain of the level. */
  vision?: boolean;
  /** An explicit chain (busy chooser, per-thread model); still capability-filtered. */
  chain?: string[];
  /** Pins the model inside a tool loop (openrouter-lab §4): `model` = pinned, the rest of the chain after it. */
  pinned?: string;
  maxTokens?: number;
  /** Steps of reasoning effort to drop (the AI_LENGTH retry, openrouter-lab §11.5 rule 6). */
  effortDown?: number;
  stream?: boolean;
}
export interface Built { body: ChatBody; chain: string[]; requested: string }

const EFFORTS: Effort[] = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'];

export function lowerEffort(r: Reasoning, steps: number): Reasoning {
  if (steps <= 0 || r.enabled === false) return r;
  const at = EFFORTS.indexOf(r.effort ?? 'medium');
  return { ...r, effort: EFFORTS[Math.min(EFFORTS.length - 2, Math.max(0, at) + steps)]! };   // never all the way to 'none'
}

/** The chain before capability filtering. */
export function baseChain(s: BuildSettings, catalog: Catalog | null, extra: BuildExtra): string[] {
  if (extra.chain?.length) return [...new Set(extra.chain)].slice(0, MAX_CHAIN);
  if (s.level === 'custom-host') return [s.model];
  if (extra.vision) {
    const list = AI_DEFAULTS.vision[s.level];
    const own = catalog?.get(s.model)?.vision ?? list.includes(s.model);
    return [...new Set([...(own ? [s.model] : []), ...list])].slice(0, MAX_CHAIN);
  }
  return chainFor(s.level, s.model, s.fallbacks);
}

/** Keeps the models that can do what the request needs; unknown ids pass when there is no catalog entry. */
export function filterChain(chain: readonly string[], catalog: Catalog | null, needs: { tools?: boolean; vision?: boolean }): string[] {
  const ok = chain.filter((id) => {
    const c = catalog?.get(id);
    if (!c) return true;
    return (!needs.tools || c.tools) && (!needs.vision || c.vision);
  });
  return ok.length ? ok : [...chain];
}

export function buildChat(task: Task, s: BuildSettings, catalog: Catalog | null, messages: Msg[], extra: BuildExtra = {}): Built {
  const custom = s.level === 'custom-host';
  let chain = filterChain(baseChain(s, catalog, extra), catalog, { tools: !!extra.tools?.length, vision: !!extra.vision });
  const requested = chain[0] ?? s.model;
  if (extra.pinned) chain = [extra.pinned, ...chain.filter((m) => m !== extra.pinned)].slice(0, MAX_CHAIN);
  chain = chain.slice(0, MAX_CHAIN);
  const model = chain[0] ?? s.model;
  const top = catalog?.get(model) ?? null;
  const p = AI_DEFAULTS.profiles[task];
  let reasoning: Reasoning = { ...p.reasoning };
  if (top?.reasoningMandatory && reasoning.enabled === false) reasoning = { effort: 'low', exclude: true };
  if (s.showReasoning && reasoning.exclude) reasoning = { ...reasoning, exclude: false };
  reasoning = lowerEffort(reasoning, extra.effortDown ?? 0);
  const cap = top?.maxOut ?? Infinity;
  const maxTokens = Math.max(1, Math.min(extra.maxTokens ?? p.maxTokens, cap));
  const body: ChatBody = {
    model,
    ...(!custom && chain.length > 1 ? { models: chain } : {}),
    messages: [...messages],
    max_tokens: maxTokens,
    temperature: p.temperature,
    ...(!custom && (top === null || top.reasoning || top.reasoningMandatory) ? { reasoning } : {}),
    stream: extra.stream ?? true,
  };
  if (extra.tools?.length) {
    body.tools = extra.tools;
    body.tool_choice = extra.toolChoice ?? 'auto';
  }
  if (extra.responseFormat && top?.strictJson) body.response_format = extra.responseFormat;   // else: schema in the prompt only
  if (s.level === 'no-training') body.provider = { data_collection: 'deny' };
  else if (s.level === 'zdr') body.provider = { data_collection: 'deny', zdr: true };
  return { body, chain, requested };
}
