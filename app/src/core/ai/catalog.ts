// The model catalog (`GET /models`, openrouter-lab §10): capabilities per model, display labels (UX §8 OQ13), the
// 24 h cache record (architecture §13.1 `models-catalog.json`) and validation of the chain against it (critique G21).
import { AI_DEFAULTS, MAX_CHAIN, isFreeId } from './defaults';
import type { ModelCaps, PrivacyLevel } from './types';

export const CATALOG_TTL_MS = 24 * 3600_000;
export const CATALOG_KEY = 'models-catalog.json';

/** The fields of one `/models` entry Tramado keeps (the cache stores these, not the 800 KB original). */
export interface CatalogEntry {
  id: string; name?: string; context_length?: number; expiration_date?: string | null;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  top_provider?: { context_length?: number | null; max_completion_tokens?: number | null };
  supported_parameters?: string[];
  reasoning?: { mandatory?: boolean; default_enabled?: boolean; supported_efforts?: string[] } | null;
  endpoints?: string[];
}
export interface CatalogCache { fetchedAt: number; data: CatalogEntry[] }
/** What the settings screen shows (architecture §11.2 `CatalogModel`). */
export interface CatalogModelView {
  id: string; label: string; free: boolean; context: number; tools: boolean; vision: boolean; levels: PrivacyLevel[];
}

/** Models that are never offered: classifiers, routers to paid models, app-gated free models (AI_MODEL_GATED). */
const HIDDEN = [/content-safety/i, /guard/i, /^thinkingmachines\/inkling/i];

/** UX §8 OQ13: the catalog name without "Vendor: "; without a catalog the id after `/`, `:free` → " (free)". */
export function modelLabel(id: string, name?: string | null): string {
  if (name && name.trim()) return name.replace(/^[^:]{1,40}:\s+/, '').trim();
  const tail = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
  return tail.endsWith(':free') ? `${tail.slice(0, -5)} (free)` : tail;
}

/** Keeps the fields of an entry Tramado uses. */
export function trimEntry(m: Record<string, unknown>): CatalogEntry | null {
  if (typeof m.id !== 'string' || !m.id) return null;
  const pick = <K extends keyof CatalogEntry>(k: K) => (m[k] === undefined ? {} : { [k]: m[k] });
  const tp = m.top_provider as CatalogEntry['top_provider'] | undefined;
  const arch = m.architecture as CatalogEntry['architecture'] | undefined;
  const pr = m.pricing as CatalogEntry['pricing'] | undefined;
  return {
    id: m.id,
    ...pick('name'), ...pick('context_length'), ...pick('expiration_date'), ...pick('supported_parameters'),
    ...pick('reasoning'), ...pick('endpoints'),
    ...(arch ? { architecture: { input_modalities: arch.input_modalities ?? [], output_modalities: arch.output_modalities ?? [] } } : {}),
    ...(pr ? { pricing: { prompt: pr.prompt ?? '', completion: pr.completion ?? '' } } : {}),
    ...(tp ? { top_provider: { context_length: tp.context_length ?? null, max_completion_tokens: tp.max_completion_tokens ?? null } } : {}),
  };
}

/** Parses a `/models` response body (`{data: [...]}`) into trimmed entries. */
export function parseModels(body: unknown): CatalogEntry[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((m) => {
    const e = m && typeof m === 'object' ? trimEntry(m as Record<string, unknown>) : null;
    return e ? [e] : [];
  });
}

export function capsOf(m: CatalogEntry): ModelCaps {
  const params = m.supported_parameters ?? [];
  const inputs = m.architecture?.input_modalities ?? [];
  const free = isFreeId(m.id) || (m.pricing?.prompt === '0' && m.pricing?.completion === '0');
  return {
    id: m.id, name: m.name ?? m.id, label: modelLabel(m.id, m.name), free,
    context: m.context_length ?? m.top_provider?.context_length ?? 0,
    maxOut: m.top_provider?.max_completion_tokens ?? null,
    tools: params.includes('tools'), vision: inputs.includes('image'),
    strictJson: params.includes('structured_outputs'), reasoning: params.includes('reasoning'),
    reasoningMandatory: Boolean(m.reasoning?.mandatory),
    chat: m.endpoints ? m.endpoints.includes('/api/v1/chat/completions') : true,
    deprecated: m.expiration_date ?? null,
  };
}

/**
 * Privacy levels at which a model is expected to answer. `/models` says nothing about data policies, so: free
 * models are "no training" only when a bundled no-training chain lists them (Gemma passes `deny`, NVIDIA's free
 * endpoints do not; openrouter-lab §9) and never ZDR; paid models are assumed to serve every level (the 404
 * `AI_PRIVACY_BLOCKS` explains the exceptions).
 */
export function levelsOf(c: Pick<ModelCaps, 'id' | 'free'>): PrivacyLevel[] {
  if (!c.free) return ['standard', 'no-training', 'zdr'];
  const known = AI_DEFAULTS.chains['no-training'].includes(c.id) || AI_DEFAULTS.vision['no-training'].includes(c.id);
  return known ? ['standard', 'no-training'] : ['standard'];
}

export interface Catalog {
  readonly fetchedAt: number;
  get(id: string): ModelCaps | null;
  all(): ModelCaps[];
  /** Chat models shown in the pickers (tools, not hidden, not deprecated). */
  views(): CatalogModelView[];
}

export function createCatalog(cache: CatalogCache): Catalog {
  const map = new Map<string, ModelCaps>();
  for (const e of cache.data) map.set(e.id, capsOf(e));
  return {
    fetchedAt: cache.fetchedAt,
    get: (id) => map.get(id) ?? null,
    all: () => [...map.values()],
    views: () =>
      [...map.values()]
        .filter((c) => c.chat && c.tools && !HIDDEN.some((re) => re.test(c.id)) && !c.id.endsWith(':batch'))
        .map((c) => ({ id: c.id, label: c.label, free: c.free, context: c.context, tools: c.tools, vision: c.vision, levels: levelsOf(c) })),
  };
}

export const isFresh = (cache: CatalogCache | null, nowMs: number): boolean => !!cache && nowMs - cache.fetchedAt < CATALOG_TTL_MS && nowMs >= cache.fetchedAt;

/** Reads the cached record (`{fetchedAt, data}`), null when absent or unreadable. */
export function readCatalogCache(bytes: Uint8Array | null): CatalogCache | null {
  if (!bytes) return null;
  try {
    const j = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CatalogCache>;
    if (typeof j.fetchedAt !== 'number' || !Array.isArray(j.data)) return null;
    return { fetchedAt: j.fetchedAt, data: j.data.filter((e): e is CatalogEntry => !!e && typeof (e as CatalogEntry).id === 'string') };
  } catch {
    return null;
  }
}

export interface ChainCheck { chain: string[]; dropped: string[]; replacement: string | null }

/**
 * Validates a chain against the catalog (critique G21): drops ids the catalog does not list; when the first is
 * missing, puts the first catalog model with tools and context ≥ 128k that the level allows (free first) in
 * front. Without a catalog the chain is returned unchanged.
 */
export function validateChain(chain: readonly string[], catalog: Catalog | null, level: PrivacyLevel): ChainCheck {
  if (!catalog || catalog.all().length === 0) return { chain: [...chain], dropped: [], replacement: null };
  const kept = chain.filter((id) => catalog.get(id) !== null);
  const dropped = chain.filter((id) => catalog.get(id) === null);
  let replacement: string | null = null;
  if (chain.length && catalog.get(chain[0]!) === null) {
    const candidates = catalog.all()
      .filter((c) => c.chat && c.tools && c.context >= 128_000 && !c.deprecated && !HIDDEN.some((re) => re.test(c.id)) && levelsOf(c).includes(level))
      .sort((a, b) => Number(b.free) - Number(a.free));
    const pick = candidates.find((c) => !kept.includes(c.id));
    if (pick) {
      replacement = pick.id;
      kept.unshift(pick.id);
    }
  }
  return { chain: kept.slice(0, MAX_CHAIN), dropped, replacement };
}
