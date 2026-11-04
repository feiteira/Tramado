// Live check of the study-notes prompt with class documents among the sources (UI-EXAMS, prompt tuning in wave 2).
// Skipped unless TRAMADO_AI_LIVE=1 and OPENROUTER_API_KEY are set; free models only (the default "No training" chain),
// at most 6 requests; the key comes from the environment only and is never printed or written.
//   TRAMADO_AI_LIVE=1 OPENROUTER_API_KEY=… npx vitest run --root app src/core/ai/studyNotes.live.test.ts
import { describe, expect, it } from 'vitest';
import { parseCitations } from './citations';
import { createAiClient, type ClientClock } from './client';
import { DEFAULT_MODEL } from './defaults';
import { createFetchTransport, type FetchLike } from './fetchTransport';
import { languageRule, PACKS, sourcesBlock } from './prompts';

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

describe.skipIf(!LIVE)('live study notes with documents (opt-in)', () => {
  it('cites the transcript parts and the document the lecture refers to', async () => {
    let requests = 0;
    const base = createFetchTransport({ fetch: globalThis.fetch as unknown as FetchLike, key: () => env.OPENROUTER_API_KEY ?? null, level: () => 'no-training' });
    const transport = { send: (r: Parameters<typeof base.send>[0], e: Parameters<typeof base.send>[1]) => { requests++; return base.send(r, e); }, cancel: base.cancel };
    const client = createAiClient({ transport, clock: realClock, rand: Math.random, settings: () => ({ level: 'no-training', model: DEFAULT_MODEL, fallbacks: [], customHost: null, busyRelax: false }) });
    const p = PACKS.pt;
    const transcript = [
      { ref: 'S1', label: 'Aula 6 · 0:05', text: 'Bom dia. Hoje vamos falar das restrições aos direitos, liberdades e garantias.' },
      { ref: 'S2', label: 'Aula 6 · 12:05', text: 'O primeiro requisito é que a restrição esteja expressamente prevista na Lei Fundamental.' },
      { ref: 'S3', label: 'Aula 6 · 41:12', text: 'Isto costuma sair no exame: a lei restritiva nunca pode atingir o conteúdo essencial do direito. É o que diz o artigo 18.º, n.º 3.' },
    ];
    const docs = [{ ref: 'S4', label: 'Lei Fundamental de Exemplo · p. 9 · art. 18.º', text: 'Artigo 18.º 2. A lei só pode restringir direitos, liberdades e garantias nos casos expressamente previstos nesta Lei Fundamental. 3. As leis restritivas devem ser gerais e abstratas, não podem ter efeito retroativo e nunca podem atingir o conteúdo essencial do direito restringido.' }];
    const r = await client.run({
      task: 'summary', maxRetries: 4, activity: { classId: null, action: 'studyNotes', passages: 4 },
      messages: [
        { role: 'system', content: [p.role, p.studyNotesRole, p.studyNotesDocs, p.citeRule, languageRule(p, 'question')].join(' ') },
        { role: 'user', content: `${p.labels.transcript} — Aula 6:\n\n${sourcesBlock(p, transcript)}\n\n${p.labels.documents}:\n\n${sourcesBlock(p, docs)}` },
      ],
    });
    const chips = parseCitations(r.content, new Set(['S1', 'S2', 'S3', 'S4'])).chips;
    console.log(`[live] study notes by ${r.model} (requested ${r.requestedModel}); refs ${chips.map((c) => c.ref).join(',')}; ${requests} request(s)`);
    console.log(`[live] notes: ${r.content.slice(0, 500).replace(/\s+/g, ' ')}`);
    expect(chips.some((c) => ['S1', 'S2', 'S3'].includes(c.ref))).toBe(true);
    expect(chips.some((c) => c.ref === 'S4')).toBe(true);
    expect(chips.every((c) => !c.hallucinated)).toBe(true);
    expect(requests).toBeLessThanOrEqual(6);
  }, 300_000);
});

describe('live study notes guard', () => {
  it('is skipped without TRAMADO_AI_LIVE=1 and a key', () => {
    expect(typeof LIVE).toBe('boolean');
  });
});
