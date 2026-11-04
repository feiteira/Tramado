import { describe, expect, it } from 'vitest';
import { createServices } from './index';
import { createTestContext } from './testing/context';
import { createFakeAi, DEMO_CATALOG, fakeReply, sourcesIn } from '../platform/memory/ai';
import { localIso, nextUtcMidnight, quotaFromKey, viewCitations, viewLocator } from './ai';
import { AI_DEFAULTS } from '../core/ai/defaults';
import type { Citation } from '../core/model/files';
import { createAiClient } from '../core/ai/client';
import { createTestClock } from '../core/ai/clock.testutil';
import { answerMessages } from '../core/ai/prompts';
import type { AiPipeRequest, AiWireEvent } from '../platform/types';

async function bed(mode: 'fake' | 'off' | 'busy' | 'quota' | 'badkey' = 'fake') {
  const ai = createFakeAi({ mode });
  const { ctx, platform, clock } = await createTestContext({ name: 'Ana Ribeiro', ai });
  const s = createServices(ctx);
  await s.ai.ready();
  return { s, ctx, platform, clock, ai };
}

describe('AiService (architecture §11.2, UX §3.14.3)', () => {
  it('settings: defaults, key status, chain per privacy level, answer language, enabled', async () => {
    const b = await bed();
    const v = b.s.ai.settings.get();
    expect(v).toMatchObject({ privacy: 'no-training', model: 'google/gemma-4-31b-it:free', chain: AI_DEFAULTS.chains['no-training'], key: { set: false }, enabled: true, busyRelax: false, generalDefault: false, answerLanguage: 'question', customHost: null, replaced: null });
    await b.s.ai.setKey('test-key-1234');
    expect(b.s.ai.settings.get().key).toEqual({ set: true, last4: '1234', store: 'memory' });
    await expect(b.s.ai.setKey('has space')).rejects.toMatchObject({ code: 'INVALID' });
    expect(await b.s.ai.setPrivacy('standard')).toBe(true);
    expect(b.s.ai.settings.get().chain).toEqual(AI_DEFAULTS.chains.standard);
    await b.s.ai.setFallbacks(['dots-studio/dots-3-note-preview:free']);
    expect(b.s.ai.settings.get().chain).toEqual(['google/gemma-4-31b-it:free', 'dots-studio/dots-3-note-preview:free']);
    await b.s.ai.setModel('nvidia/nemotron-3.5-super-vl:free');
    expect(b.s.ai.settings.get().chain[0]).toBe('nvidia/nemotron-3.5-super-vl:free');
    expect(b.s.ai.client.settings()).toMatchObject({ level: 'standard', model: 'nvidia/nemotron-3.5-super-vl:free' });
    await b.s.ai.setGeneralDefault(true);
    expect(b.s.ai.settings.get().generalDefault).toBe(true);
    await b.s.ai.setEnabled(false);
    expect(b.s.ai.settings.get().enabled).toBe(false);
    await expect(b.s.ai.client.run({ task: 'chat', messages: [{ role: 'user', content: 'x' }], activity: { classId: null, action: 'ask', passages: 0 } })).rejects.toMatchObject({ code: 'AI_NO_KEY', data: { disabled: true } });
    await b.s.ai.clearKey();
    expect(b.s.ai.settings.get().key.set).toBe(false);
    b.s.dispose();
  });

  it('testKey reads the free-request quota from GET key; badkey → AI_AUTH; estimate uses the remaining count', async () => {
    const b = await bed();
    await b.s.ai.setKey('test-key-1234');
    expect(await b.s.ai.testKey()).toEqual({ ok: true, remaining: 38 });
    expect(b.s.ai.settings.get().quota).toMatchObject({ remaining: 38, limit: 50, used: 12, isFreeTier: true, creditLeft: null });
    expect(b.s.ai.estimate('exam-quick', 6)).toEqual({ requests: 7, remaining: 38 });
    expect(b.s.ai.estimate('summary', 90_000)).toEqual({ requests: 4, remaining: 38 });
    expect(b.ai.requests.at(-1)).toMatchObject({ method: 'GET', path: 'key', activity: { action: 'keyCheck' } });
    const bad = await bed('badkey');
    expect(await bad.s.ai.testKey()).toEqual({ ok: false, code: 'AI_AUTH' });
    b.s.dispose();
    bad.s.dispose();
  });

  it('catalog: fetched once, cached 24 h in cache/models-catalog.json, labels; a missing default model is replaced (G21)', async () => {
    const b = await bed();
    const models = await b.s.ai.catalog();
    expect(models.map((m) => m.id)).toContain('google/gemma-4-31b-it:free');
    expect(models.find((m) => m.id === 'google/gemma-4-31b-it:free')).toMatchObject({ label: 'Gemma 4 31B (free)', free: true, tools: true, vision: true, levels: ['standard', 'no-training'] });
    expect(models.find((m) => m.id === 'nvidia/nemotron-3.5-super-vl:free')!.levels).toEqual(['standard']);
    const cached = JSON.parse(new TextDecoder().decode((await b.platform.cache.read('models-catalog.json'))!));
    expect(cached.data).toHaveLength(DEMO_CATALOG.length);
    await b.s.ai.catalog();
    expect(b.ai.requests.filter((r) => r.path === 'models')).toHaveLength(1);
    expect(b.s.ai.label('google/gemma-4-31b-it:free')).toEqual({ id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)', free: true });
    expect(b.s.ai.label('x/unknown-model:free')).toEqual({ id: 'x/unknown-model:free', label: 'unknown-model (free)', free: true });
    expect(b.s.ai.settings.get().freeAtLevel).toBe(3);
    await b.s.ai.setModel('gone/model:free');
    const v = b.s.ai.settings.get();
    expect(v.replaced).toMatchObject({ model: 'gone/model:free' });
    expect(v.chain[0]).toBe(v.replaced!.replacement);
    b.clock.advance(25 * 3600_000);
    await b.s.ai.catalog();
    expect(b.ai.requests.filter((r) => r.path === 'models')).toHaveLength(2);
    b.s.dispose();
  });

  it('busy policy and custom hosts go through the platform; activity is passed through', async () => {
    const b = await bed();
    expect(await b.s.ai.setBusyPolicy(true)).toBe(true);
    expect(b.s.ai.settings.get().busyRelax).toBe(true);
    await b.s.ai.setCustomHost('http://localhost:11434/v1');
    expect(b.s.ai.settings.get().customHost).toMatchObject({ base: 'http://localhost:11434/v1', label: 'localhost:11434' });
    expect(b.s.ai.settings.get().quota).toBeNull();
    expect(b.s.ai.client.settings().customHost).toBe(b.s.ai.settings.get().customHost!.id);
    await b.s.ai.setCustomHost(null);
    expect(b.s.ai.settings.get().customHost).toBeNull();
    await b.s.ai.testKey();
    expect((await b.s.ai.activity(10))[0]).toMatchObject({ path: 'key', action: 'keyCheck', status: 200 });
    await b.s.ai.clearActivity();
    expect(await b.s.ai.activity(10)).toEqual([]);
    b.s.dispose();
  });

  it('the answering model becomes lastAnswerModel', async () => {
    const b = await bed();
    await b.s.ai.client.run({ task: 'chat', messages: [{ role: 'user', content: 'Olá' }], activity: { classId: null, action: 'ask', passages: 0 } });
    expect(b.s.ai.settings.get().lastAnswerModel).toEqual({ id: 'google/gemma-4-31b-it:free', label: 'gemma-4-31b-it (free)', free: true });
    b.s.dispose();
  });
});

describe('AI view helpers', () => {
  it('quota from GET key, next UTC midnight, local ISO', () => {
    expect(nextUtcMidnight(Date.UTC(2026, 10, 4, 15, 30))).toBe(Date.UTC(2026, 10, 5));
    expect(localIso(0)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(quotaFromKey({ data: { free_model_daily_requests: { used: 50, limit: 50, remaining: 0 }, is_free_tier: true, limit_remaining: 9.74 } }, 0)).toMatchObject({ remaining: 0, limit: 50, used: 50, creditLeft: 9.74 });
    expect(quotaFromKey({ data: {} }, 0)).toBeNull();
  });
  it('maps storage citations to numbered view citations (UX §4.1)', () => {
    const c: Citation = { ref: 'S2', source: { kind: 'document', path: 'Documentos/LF.pdf', sha256: 'a'.repeat(64) }, locator: { type: 'article', article: '18.º', pages: [9, 10] }, quote: { exact: 'x', prefix: '', suffix: '' }, label: 'Lei Fundamental · art. 18.º', pin: 'n.º 3' };
    const n: Citation = { ref: 'S1', source: { kind: 'note', path: 'mine.md', sha256: 'b'.repeat(64) }, locator: { type: 'whole' }, quote: null, label: 'Mine' };
    const v = viewCitations('A [S2, n.º 3]. B [S1]. C [S7].', [c, n], 'tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa', 'Notes');
    expect(v.map((x) => [x.n, x.ref, x.pin, x.status])).toEqual([[1, 'S2', 'n.º 3', 'ok'], [2, 'S1', null, 'ok'], [3, 'S7', null, 'hallucinated']]);
    expect(v[0]!.source).toMatchObject({ type: 'document', title: 'Lei Fundamental', relPath: 'Documentos/LF.pdf', locator: { kind: 'article', label: '18.º', page: 9, pageEnd: 10 } });
    expect(v[1]!.source!.private).toBe(true);
    expect(viewLocator({ type: 'segment', segmentId: 's_l6a00', startMs: 2472000, endMs: 2479500 })).toEqual({ kind: 'time', ms: 2472000, endMs: 2479500, segmentId: 's_l6a00' });
    expect(viewLocator({ type: 'page', page: 3, pageLabel: 'iii' })).toEqual({ kind: 'page', page: 3, label: 'iii' });
  });
});

// ── The memory platform's fake AI (architecture §10, UX §7.2) ──
const clientSettings = () => ({ level: 'no-training' as const, model: 'google/gemma-4-31b-it:free', fallbacks: [], customHost: null, busyRelax: false });
const activity = { classId: null, action: 'ask' as const, passages: 2 };
const SOURCES = [
  { ref: 'S1', label: 'Lei Fundamental · p. 9 · art. 18.º', text: 'A lei só pode restringir direitos nos casos previstos. As restrições têm caráter geral.' },
  { ref: 'S2', label: 'Aula 6 · 41:12', text: 'Nunca se atinge o conteúdo essencial do direito.' },
];
const msgs = answerMessages({ lang: 'pt', answerLanguage: 'question', general: false, role: 'ask' }, 'Em que condições pode a lei restringir direitos?', SOURCES);
const send = (ai: ReturnType<typeof createFakeAi>, req: Partial<AiPipeRequest>) => new Promise<AiWireEvent[]>((resolve) => {
  const events: AiWireEvent[] = [];
  void ai.send({ requestId: 'r', base: { type: 'openrouter' }, method: 'POST', path: 'chat/completions', stream: true, ...req }, (e) => {
    events.push(e);
    if (e.type === 'end' || e.type === 'fail') resolve(events);
  });
});

describe('fake AI (architecture §10, UX §7.2)', () => {
  it('fake: answers with the real wire format, citing only the sources it was sent', async () => {
    const clock = createTestClock();
    const ai = createFakeAi({ mode: 'fake' });
    const client = createAiClient({ transport: ai, clock, rand: () => 0.5, settings: clientSettings });
    const r = await client.run({ task: 'chat', messages: msgs, activity });
    expect(r.model).toBe('google/gemma-4-31b-it:free');
    expect(r.content).toMatch(/\[S1\].*\[S2\]/s);
    expect(r.content).not.toMatch(/\[S3\]/);
    const events = await send(ai, { body: { model: 'x', messages: msgs } });
    expect(events[0]).toMatchObject({ type: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } });
    expect(events.some((e) => e.type === 'line' && e.line === ': OPENROUTER PROCESSING')).toBe(true);
    expect(events.some((e) => e.type === 'line' && e.line.startsWith('data: {"id":"gen-'))).toBe(true);
    expect(events.at(-2)).toEqual({ type: 'line', line: 'data: [DONE]' });
    expect(sourcesIn(String(msgs[1]!.content)).map((s) => s.ref)).toEqual(['S1', 'S2']);
  });

  it('off → AI_NO_KEY; badkey → AI_AUTH; quota → AI_FREE_LIMIT and 0 left', async () => {
    const clock = createTestClock();
    const run = (mode: 'off' | 'badkey' | 'quota') => createAiClient({ transport: createFakeAi({ mode }), clock, rand: () => 0.5, settings: clientSettings }).run({ task: 'chat', messages: msgs, activity });
    await expect(run('off')).rejects.toMatchObject({ code: 'AI_NO_KEY' });
    await expect(run('badkey')).rejects.toMatchObject({ code: 'AI_AUTH' });
    await expect(run('quota')).rejects.toMatchObject({ code: 'AI_FREE_LIMIT' });
    const key = await createAiClient({ transport: createFakeAi({ mode: 'quota' }), clock, rand: () => 0.5, settings: clientSettings }).get('key');
    expect(key).toMatchObject({ data: { free_model_daily_requests: { remaining: 0, limit: 50 } } });
  });

  it('busy → AI_BUSY after the retries (no long waits); the NVIDIA fallback answers', async () => {
    const clock = createTestClock();
    const ai = createFakeAi({ mode: 'busy' });
    const client = createAiClient({ transport: ai, clock, rand: () => 0.5, settings: clientSettings });
    const p = client.run({ task: 'chat', messages: msgs, activity }).catch((e: unknown) => e);
    for (let i = 0; i < 5; i++) await clock.advance(0);
    expect(await p).toMatchObject({ code: 'AI_BUSY', data: { tried: AI_DEFAULTS.chains['no-training'] } });
    const r = await client.run({ task: 'chat', messages: msgs, activity, busyFallback: true });
    expect(r.model).toBe('nvidia/nemotron-3.5-super-vl:free');
    expect(r.privacy).toBe('standard');
  });

  it('controls: aiNext queues an answer, aiFail the next request and its retries', async () => {
    const clock = createTestClock();
    const ai = createFakeAi({ mode: 'fake' });
    const client = createAiClient({ transport: ai, clock, rand: () => 0.5, settings: clientSettings });
    ai.controls.next('Resposta preparada [S1].');
    expect((await client.run({ task: 'chat', messages: msgs, activity })).content).toBe('Resposta preparada [S1].');
    ai.controls.next((body) => `tem ${String((body as { messages: unknown[] }).messages.length)} mensagens`);
    expect((await client.run({ task: 'chat', messages: msgs, activity })).content).toBe('tem 2 mensagens');
    ai.controls.fail('AI_PRIVACY_BLOCKS');
    await expect(client.run({ task: 'chat', messages: msgs, activity })).rejects.toMatchObject({ code: 'AI_PRIVACY_BLOCKS' });
    ai.controls.fail('AI_BUSY');
    const p = client.run({ task: 'chat', messages: msgs, activity }).catch((e: unknown) => e);
    for (let i = 0; i < 6; i++) await clock.advance(10_000);
    expect(await p).toMatchObject({ code: 'AI_BUSY' });
    expect((await client.run({ task: 'chat', messages: msgs, activity })).content).toMatch(/\[S1\]/);
  });

  it('scripted replies cover OCR, extraction, expansion, tools and the "not covered" case', () => {
    const req = (messages: unknown[], extra: Record<string, unknown> = {}): AiPipeRequest => ({ requestId: 'r', base: { type: 'openrouter' }, method: 'POST', path: 'chat/completions', stream: true, body: { model: 'm', messages, ...extra } });
    expect(fakeReply(req([{ role: 'user', content: [{ type: 'text', text: 'read' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' } }] }]))).toMatchObject({ kind: 'text', text: expect.stringContaining('GRUPO II') });
    const ex = fakeReply(req([{ role: 'system', content: 'Return ONLY a JSON object matching this JSON Schema: {"exam_questions"}' }, { role: 'user', content: 'Exam:\n1. Defina A. (2 valores)\n2. Defina B.' }]));
    expect(JSON.parse((ex as { text: string }).text).questions.map((q: { number: string }) => q.number)).toEqual(['1', '2']);
    const exp = fakeReply(req([{ role: 'system', content: 'Return ONLY a JSON object: {"queries": {}}' }, { role: 'user', content: 'q_abcdefg: Em que condições pode a lei restringir?' }]));
    expect(JSON.parse((exp as { text: string }).text).queries.q_abcdefg.length).toBeGreaterThan(0);
    expect(fakeReply(req([{ role: 'user', content: 'Pergunta' }], { tools: [{}], tool_choice: 'auto' }))).toMatchObject({ kind: 'tools' });
    expect(fakeReply(req([{ role: 'user', content: 'Uma pergunta sem fontes nenhumas aqui.' }]))).toMatchObject({ kind: 'text', text: expect.stringMatching(/^Os materiais não cobrem/) });
  });

  it('keeps privacy, busy policy, hosts and a metadata-only activity log', async () => {
    const ai = createFakeAi({ mode: 'fake', now: () => 1_793_721_438_157 });
    expect(await ai.privacy()).toBe('no-training');
    await ai.setPrivacy('zdr', { title: '', message: '', confirm: '', cancel: '' });
    expect(await ai.privacy()).toBe('zdr');
    const h = await ai.allowHost('http://localhost:11434/v1', { title: '', message: '', confirm: '', cancel: '' });
    expect(await ai.hosts()).toEqual([h]);
    await expect(ai.allowHost('not a url', { title: '', message: '', confirm: '', cancel: '' })).rejects.toMatchObject({ code: 'AI_BAD_ADDRESS' });
    await send(ai, { body: { model: 'google/gemma-4-31b-it:free', messages: msgs }, activity });
    const [entry] = await ai.activity(10);
    expect(entry).toMatchObject({ host: 'openrouter.ai', path: 'chat/completions', model: 'google/gemma-4-31b-it:free', status: 200, code: null, privacy: 'zdr', action: 'ask', passages: 2 });
    expect(JSON.stringify(entry)).not.toContain('restringir');
    await ai.forgetHost(h!.id);
    expect(await ai.hosts()).toEqual([]);
  });
});
