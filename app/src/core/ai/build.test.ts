import { describe, expect, it } from 'vitest';
import { buildChat, lowerEffort } from './build';
import { createCatalog, isFresh, levelsOf, modelLabel, parseModels, readCatalogCache, validateChain } from './catalog';
import { AI_DEFAULTS, chainFor, defaultFallbacks, trainingChain } from './defaults';
import { fixtureJson } from './fixtures.testutil';
import type { Msg, ToolDef } from './types';

const catalog = createCatalog({ fetchedAt: 1_000, data: parseModels(fixtureJson('models-sample.json')) });
const msgs: Msg[] = [{ role: 'user', content: 'Olá' }];
const TOOLS: ToolDef[] = [{ type: 'function', function: { name: 'search_materials', description: 'x', parameters: { type: 'object' } } }];
const GEMMA = 'google/gemma-4-31b-it:free';

describe('ai-defaults.json (architecture §11.1.1)', () => {
  it('ships the chains, profiles and limits of the architecture', () => {
    expect(AI_DEFAULTS.chains['no-training']).toEqual([GEMMA, 'google/gemma-4-26b-a4b-it:free', 'dots-studio/dots-3-note-preview:free']);
    expect(AI_DEFAULTS.chains.standard).toEqual([GEMMA, 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3.5-super-vl:free']);
    expect(AI_DEFAULTS.chains.zdr).toEqual([]);
    expect(AI_DEFAULTS.limits).toEqual({ freePerMinute: 18, maxInFlight: 3, maxChain: 3 });
    expect(AI_DEFAULTS.profiles['exam-answer'].maxTokens).toBe(8000);
  });
});

describe('chains per privacy level', () => {
  it('the user model is first; the level fills the rest; ≤ 3; duplicates removed', () => {
    expect(chainFor('no-training', GEMMA)).toEqual(AI_DEFAULTS.chains['no-training']);
    expect(chainFor('standard', 'x/y:free')).toEqual(['x/y:free', GEMMA, 'google/gemma-4-26b-a4b-it:free']);
    expect(chainFor('no-training', GEMMA, ['a/b', GEMMA, 'c/d'])).toEqual([GEMMA, 'a/b', 'c/d']);
    expect(chainFor('zdr', 'anthropic/claude-haiku-5.5')).toEqual(['anthropic/claude-haiku-5.5']);
    expect(defaultFallbacks('no-training', GEMMA)).toHaveLength(2);
    expect(trainingChain()).toEqual(AI_DEFAULTS.trainingOptIn);
  });

  it('builds `models` (≤ 3) and the provider per level', () => {
    const nt = buildChat('chat', { level: 'no-training', model: GEMMA, fallbacks: [] }, catalog, msgs).body;
    expect(nt.model).toBe(GEMMA);
    expect(nt.models).toEqual(AI_DEFAULTS.chains['no-training']);
    expect(nt.provider).toEqual({ data_collection: 'deny' });
    expect(buildChat('chat', { level: 'zdr', model: 'anthropic/claude-haiku-5.5', fallbacks: [] }, catalog, msgs).body.provider).toEqual({ data_collection: 'deny', zdr: true });
    const std = buildChat('chat', { level: 'standard', model: GEMMA, fallbacks: [] }, catalog, msgs).body;
    expect(std.provider).toBeUndefined();
    expect(std.models).toEqual(AI_DEFAULTS.chains.standard);
    const many = buildChat('chat', { level: 'standard', model: GEMMA, fallbacks: [] }, catalog, msgs, { chain: ['a', 'b', 'c', 'd'] }).body;
    expect(many.models).toHaveLength(3);
  });

  it('a custom host gets one model, no `models`, no provider, no reasoning', () => {
    const b = buildChat('chat', { level: 'custom-host', model: 'qwen3:8b', fallbacks: [GEMMA] }, null, msgs).body;
    expect(b).toMatchObject({ model: 'qwen3:8b', stream: true });
    expect(b.models).toBeUndefined();
    expect(b.provider).toBeUndefined();
    expect(b.reasoning).toBeUndefined();
  });

  it('profiles: tokens, temperature, reasoning; max_tokens capped by the model', () => {
    const b = buildChat('exam-answer', { level: 'no-training', model: GEMMA, fallbacks: [] }, catalog, msgs).body;
    expect(b).toMatchObject({ max_tokens: 8000, temperature: 0.2, reasoning: { effort: 'medium', exclude: true } });
    expect(buildChat('ocr', { level: 'no-training', model: GEMMA, fallbacks: [] }, catalog, msgs).body.reasoning).toEqual({ enabled: false });
    expect(buildChat('chat', { level: 'no-training', model: GEMMA, fallbacks: [] }, catalog, msgs, { maxTokens: 999_999 }).body.max_tokens).toBe(32768);
  });

  it('reasoning is mandatory for some models: "enabled:false" becomes low effort', () => {
    const b = buildChat('title', { level: 'standard', model: 'liquid/lfm-2.5-2.6b:free', fallbacks: [] }, catalog, msgs).body;
    expect(b.reasoning).toEqual({ effort: 'low', exclude: true });
    expect(lowerEffort({ effort: 'medium', exclude: true }, 1)).toEqual({ effort: 'low', exclude: true });
    expect(lowerEffort({ effort: 'low' }, 5).effort).toBe('minimal');
  });

  it('capability filter: tools drop models without tools; vision uses the vision chain', () => {
    const t = buildChat('exam-answer', { level: 'standard', model: 'nvidia/nemotron-3.5-content-safety:free', fallbacks: [GEMMA] }, catalog, msgs, { tools: TOOLS });
    expect(t.chain).toEqual([GEMMA]);
    expect(t.body.tools).toBe(TOOLS);
    expect(t.body.tool_choice).toBe('auto');
    const v = buildChat('ocr', { level: 'no-training', model: GEMMA, fallbacks: [] }, catalog, msgs, { vision: true });
    expect(v.chain).toEqual(AI_DEFAULTS.vision['no-training']);
    const v2 = buildChat('ocr', { level: 'standard', model: 'cohere/north-mini-code:free', fallbacks: [] }, catalog, msgs, { vision: true });
    expect(v2.chain).toEqual(AI_DEFAULTS.vision.standard);
  });

  it('response_format only for models with structured_outputs (the schema stays in the prompt)', () => {
    const rf = { type: 'json_schema' as const, json_schema: { name: 'q', strict: true, schema: {} } };
    expect(buildChat('extract-questions', { level: 'no-training', model: GEMMA, fallbacks: [] }, catalog, msgs, { responseFormat: rf }).body.response_format).toBeUndefined();
    expect(buildChat('extract-questions', { level: 'standard', model: 'nvidia/nemotron-3.5-super-vl:free', fallbacks: [] }, catalog, msgs, { responseFormat: rf }).body.response_format).toEqual(rf);
  });

  it('pins a model inside a loop and keeps the requested model', () => {
    const b = buildChat('exam-answer', { level: 'no-training', model: GEMMA, fallbacks: [] }, catalog, msgs, { pinned: 'dots-studio/dots-3-note-preview:free' });
    expect(b.body.model).toBe('dots-studio/dots-3-note-preview:free');
    expect(b.body.models?.[0]).toBe('dots-studio/dots-3-note-preview:free');
    expect(b.requested).toBe(GEMMA);
  });
});

describe('catalog (openrouter-lab §10, UX OQ13, critique G21)', () => {
  it('labels models', () => {
    expect(modelLabel(GEMMA, 'Google: Gemma 4 31B (free)')).toBe('Gemma 4 31B (free)');
    // INT: the models of the bundled chains have their names even without a catalog (OQ13); others fall back to the id.
    expect(modelLabel('dots-studio/dots-3-note-preview:free')).toBe('Dots 3 Note Preview (free)');
    expect(modelLabel(GEMMA)).toBe('Gemma 4 31B (free)');
    expect(modelLabel('acme/tiny-7b:free')).toBe('tiny-7b (free)');
    expect(catalog.get(GEMMA)?.label).toMatch(/Gemma 4 31B/);
  });
  it('reads capabilities', () => {
    expect(catalog.get(GEMMA)).toMatchObject({ tools: true, vision: true, strictJson: false, free: true, context: 262144 });
    expect(catalog.get('nvidia/nemotron-3.5-super-vl:free')).toMatchObject({ strictJson: true, vision: true });
    expect(catalog.get('liquid/lfm-2.5-2.6b:free')?.reasoningMandatory).toBe(true);
  });
  it('levels: NVIDIA free models are not "no training"; paid models serve every level', () => {
    expect(levelsOf({ id: GEMMA, free: true })).toEqual(['standard', 'no-training']);
    expect(levelsOf({ id: 'nvidia/nemotron-3.5-super-vl:free', free: true })).toEqual(['standard']);
    expect(levelsOf({ id: 'anthropic/claude-haiku-5.5', free: false })).toEqual(['standard', 'no-training', 'zdr']);
  });
  it('views hide classifiers and gated models', () => {
    const ids = catalog.views().map((v) => v.id);
    expect(ids).toContain(GEMMA);
    expect(ids).not.toContain('nvidia/nemotron-3.5-content-safety:free');
    expect(ids).not.toContain('thinkingmachines/inkling-small:free');
  });
  it('validates the chain: drops missing ids; a missing first model gets a replacement', () => {
    expect(validateChain([GEMMA, 'gone/model:free'], catalog, 'no-training')).toEqual({ chain: [GEMMA], dropped: ['gone/model:free'], replacement: null });
    const v = validateChain(['gone/first:free', 'google/gemma-4-26b-a4b-it:free'], catalog, 'no-training');
    expect(v.replacement).not.toBeNull();
    expect(v.chain[0]).toBe(v.replacement);
    expect(levelsOf(catalog.get(v.replacement!)!)).toContain('no-training');
    expect(validateChain(['a'], null, 'standard').chain).toEqual(['a']);
  });
  it('cache: 24 h freshness, tolerant reading', () => {
    expect(isFresh({ fetchedAt: 0, data: [] }, 23 * 3600_000)).toBe(true);
    expect(isFresh({ fetchedAt: 0, data: [] }, 25 * 3600_000)).toBe(false);
    expect(readCatalogCache(new TextEncoder().encode('{"fetchedAt":5,"data":[{"id":"a"},3]}'))).toEqual({ fetchedAt: 5, data: [{ id: 'a' }] });
    expect(readCatalogCache(new TextEncoder().encode('nope'))).toBeNull();
  });
});
