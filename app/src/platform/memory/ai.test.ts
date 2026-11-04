import { describe, expect, it } from 'vitest';
import { createFakeAi, fakeReply, sourcesIn } from './ai';
import { createAiClient } from '../../core/ai/client';
import { createTestClock } from '../../core/ai/clock.testutil';
import { answerMessages } from '../../core/ai/prompts';
import { AI_DEFAULTS } from '../../core/ai/defaults';
import type { AiPipeRequest, AiWireEvent } from '../types';

const settings = () => ({ level: 'no-training' as const, model: 'google/gemma-4-31b-it:free', fallbacks: [], customHost: null, busyRelax: false });
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
    const client = createAiClient({ transport: ai, clock, rand: () => 0.5, settings });
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
    const run = (mode: 'off' | 'badkey' | 'quota') => createAiClient({ transport: createFakeAi({ mode }), clock, rand: () => 0.5, settings }).run({ task: 'chat', messages: msgs, activity });
    await expect(run('off')).rejects.toMatchObject({ code: 'AI_NO_KEY' });
    await expect(run('badkey')).rejects.toMatchObject({ code: 'AI_AUTH' });
    await expect(run('quota')).rejects.toMatchObject({ code: 'AI_FREE_LIMIT' });
    const key = await createAiClient({ transport: createFakeAi({ mode: 'quota' }), clock, rand: () => 0.5, settings }).get('key');
    expect(key).toMatchObject({ data: { free_model_daily_requests: { remaining: 0, limit: 50 } } });
  });

  it('busy → AI_BUSY after the retries (no long waits); the NVIDIA fallback answers', async () => {
    const clock = createTestClock();
    const ai = createFakeAi({ mode: 'busy' });
    const client = createAiClient({ transport: ai, clock, rand: () => 0.5, settings });
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
    const client = createAiClient({ transport: ai, clock, rand: () => 0.5, settings });
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
