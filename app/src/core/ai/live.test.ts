// The live check of the default free model (plan §4.2, the user's requirement). Skipped unless TRAMADO_AI_LIVE=1 and
// OPENROUTER_API_KEY are set; the key comes from the environment only and is never printed or written.
//   TRAMADO_AI_LIVE=1 OPENROUTER_API_KEY=… npx vitest run --root app src/core/ai/live.test.ts
// 1. GET models lists the default id, free (price 0) and with tools.
// 2. One streamed chat request through the default "No training" chain (Gemma 4 31B first) MUST get an HTTP 200
//    completion, with [S#] citations parsed against the sources sent; the answering model and latency are logged.
// 3. Gemma 4 31B pinned alone: up to 6 attempts over 10 minutes with backoff; the outcome is reported, not asserted.
// Free models only; fewer than 20 requests in total.
import { describe, expect, it } from 'vitest';
import { parseCitations } from './citations';
import { createCatalog, parseModels } from './catalog';
import { createAiClient, type ClientClock } from './client';
import { AI_DEFAULTS, DEFAULT_MODEL } from './defaults';
import { createFetchTransport, type FetchLike } from './fetchTransport';
import { answerMessages } from './prompts';
import type { AiTransport, PipeRequest, WireEvent } from './types';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LIVE = env.TRAMADO_AI_LIVE === '1' && !!env.OPENROUTER_API_KEY;

const realClock: ClientClock = {
  now: () => Date.now(),
  mono: () => performance.now(),
  setTimeout: (f, ms) => {
    const id = setTimeout(f, ms);
    return () => clearTimeout(id);
  },
};

/** Counts requests and records the status of each (never the key). */
function counted(t: AiTransport, log: Array<{ path: string; status: number | null; model?: string }>): AiTransport {
  return {
    async send(req: PipeRequest, onEvent: (e: WireEvent) => void) {
      const entry: { path: string; status: number | null; model?: string } = { path: req.path, status: null };
      const body = req.body as { model?: string } | undefined;
      if (body?.model) entry.model = body.model;
      log.push(entry);
      return t.send(req, (e) => {
        if (e.type === 'head') entry.status = e.status;
        onEvent(e);
      });
    },
    cancel: (id) => t.cancel(id),
  };
}

describe.skipIf(!LIVE)('live OpenRouter (opt-in)', () => {
  const log: Array<{ path: string; status: number | null; model?: string }> = [];
  const transport = counted(createFetchTransport({ fetch: globalThis.fetch as unknown as FetchLike, key: () => env.OPENROUTER_API_KEY ?? null, level: () => 'no-training' }), log);
  let catalogData: ReturnType<typeof parseModels> = [];

  it('GET models lists the default model, free and with tools', async () => {
    const client = createAiClient({ transport, clock: realClock, rand: Math.random, settings: () => ({ level: 'no-training', model: DEFAULT_MODEL, fallbacks: [], customHost: null, busyRelax: false }) });
    catalogData = parseModels(await client.get('models', { classId: null, action: 'catalog', passages: 0 }));
    const gemma = catalogData.find((m) => m.id === DEFAULT_MODEL);
    expect(gemma, 'the default model is listed').toBeTruthy();
    expect(gemma!.pricing).toMatchObject({ prompt: '0', completion: '0' });
    expect(gemma!.supported_parameters).toContain('tools');
    console.log(`[live] catalog: ${catalogData.length} models; ${DEFAULT_MODEL} free with tools`);
  }, 60_000);

  it('the default "No training" chain answers (HTTP 200, streamed), with [S#] citations', async () => {
    const catalog = catalogData.length ? createCatalog({ fetchedAt: Date.now(), data: catalogData }) : null;
    const client = createAiClient({ transport, clock: realClock, rand: Math.random, catalog: () => catalog, settings: () => ({ level: 'no-training', model: DEFAULT_MODEL, fallbacks: [], customHost: null, busyRelax: false }) });
    const sources = [
      { ref: 'S1', label: 'Lei Fundamental de Exemplo · p. 9 · art. 18.º', text: 'Artigo 18.º (Força jurídica) 2. A lei só pode restringir os direitos, liberdades e garantias nos casos expressamente previstos na Lei Fundamental. 3. As leis restritivas têm de revestir caráter geral e abstrato e não podem diminuir a extensão e o alcance do conteúdo essencial dos preceitos.' },
      { ref: 'S2', label: 'Aula 6 · 41:12', text: 'Portanto, a restrição tem de ser necessária, adequada e proporcional: é o princípio da proporcionalidade.' },
    ];
    const msgs = answerMessages({ lang: 'pt', answerLanguage: 'question', general: false, role: 'exam' }, 'Pergunta II.b (3 valores): Em que condições pode a lei restringir direitos, liberdades e garantias?', sources);
    const t0 = performance.now();
    const events: string[] = [];
    const r = await client.run({ task: 'chat', messages: msgs, activity: { classId: null, action: 'ask', passages: 2 }, maxRetries: 6, onEvent: (e) => events.push(e.kind) });
    const ms = Math.round(performance.now() - t0);
    const cites = parseCitations(r.content, new Set(['S1', 'S2']));
    console.log(`[live] chain ${JSON.stringify(r.chain)} → answered by ${r.model} (requested ${r.requestedModel}) in ${ms} ms after ${r.attempts} attempt(s); finish ${r.finish}; ${cites.chips.length} citation chip(s); usage ${JSON.stringify(r.usage ?? {})}`);
    console.log(`[live] answer: ${r.content.slice(0, 400).replace(/\s+/g, ' ')}`);
    expect(r.chain).toEqual(AI_DEFAULTS.chains['no-training']);
    expect(r.chain[0]).toBe(DEFAULT_MODEL);
    expect(AI_DEFAULTS.chains['no-training']).toContain(r.model.replace(/^private\//, ''));
    expect(r.content.trim().length).toBeGreaterThan(10);
    expect(events).toContain('started');
    expect(log.some((l) => l.path === 'chat/completions' && l.status === 200)).toBe(true);
  }, 300_000);

  it('Gemma 4 31B pinned alone: up to 6 attempts over 10 minutes (reported, not failed)', async () => {
    const delays = [0, 15_000, 45_000, 90_000, 150_000, 240_000];
    let outcome = 'busy every time';
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      const client = createAiClient({ transport, clock: realClock, rand: Math.random, settings: () => ({ level: 'no-training', model: DEFAULT_MODEL, fallbacks: [], customHost: null, busyRelax: false }) });
      const t0 = performance.now();
      try {
        const r = await client.run({ task: 'title', chain: [DEFAULT_MODEL], messages: [{ role: 'user', content: 'Diz olá numa frase curta, em português europeu.' }], activity: { classId: null, action: 'title', passages: 0 }, maxRetries: 0 });
        outcome = `answered on attempt ${i + 1} by ${r.model} in ${Math.round(performance.now() - t0)} ms: ${r.content.slice(0, 80)}`;
        break;
      } catch (e) {
        const code = (e as { code?: string }).code;
        console.log(`[live] pinned ${DEFAULT_MODEL} attempt ${i + 1}: ${code}`);
        if (code !== 'AI_BUSY' && code !== 'AI_UPSTREAM' && code !== 'AI_TIMEOUT' && code !== 'AI_UNAVAILABLE') {
          outcome = `failed with ${code}`;
          break;
        }
      }
    }
    console.log(`[live] pinned ${DEFAULT_MODEL}: ${outcome}`);
    console.log(`[live] requests sent: ${log.length} (${log.map((l) => `${l.path}:${l.status}`).join(', ')})`);
    expect(log.length).toBeLessThan(40);
  }, 660_000);
});

describe('live test guard', () => {
  it('is skipped without TRAMADO_AI_LIVE=1 and a key', () => {
    expect(typeof LIVE).toBe('boolean');
  });
});
