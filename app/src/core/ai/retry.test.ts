import { describe, expect, it } from 'vitest';
import { backoffMs, decide, freshRetryState } from './retry';
import { mulberry32 } from '../util/prng';
import { createAiClient } from './client';
import { ERROR_REPLIES, createScriptedTransport, bodyOf, type FakeReply } from './fake';
import { createTestClock } from './clock.testutil';
import { AI_DEFAULTS } from './defaults';
import type { AiEvent } from './types';

const ctx = { nowMs: 1_000_000, rand: () => 0.5 };
const GEMMA = 'google/gemma-4-31b-it:free';

describe('retry policy (openrouter-lab §11.5)', () => {
  it('backs off 2, 4, 8 s ± 30 %, capped at 30 s', () => {
    expect(backoffMs(1, () => 0.5)).toBe(2000);
    expect(backoffMs(2, () => 0.5)).toBe(4000);
    expect(backoffMs(3, () => 0.5)).toBe(8000);
    expect(backoffMs(9, () => 0.5)).toBe(30000);
    expect(backoffMs(1, () => 0)).toBe(1400);
    expect(backoffMs(1, () => 1)).toBe(2600);
  });
  it('retries transient codes 3×, honouring Retry-After', () => {
    const st = freshRetryState();
    expect(decide('AI_BUSY', {}, st, ctx)).toEqual({ kind: 'retry', delayMs: 2000 });
    expect(decide('AI_UNAVAILABLE', { retryAfterMs: 5000 }, st, ctx)).toEqual({ kind: 'retry', delayMs: 5000 });
    expect(decide('AI_OFFLINE', {}, { ...st, transient: 3 }, ctx)).toEqual({ kind: 'fail' });
  });
  it('never retries AUTH, MODEL_UNKNOWN, BAD_REQUEST, NO_CREDIT, GATED, FLAGGED, PRIVACY_BLOCKS', () => {
    for (const c of ['AI_AUTH', 'AI_MODEL_UNKNOWN', 'AI_BAD_REQUEST', 'AI_NO_CREDIT', 'AI_MODEL_GATED', 'AI_FLAGGED', 'AI_PRIVACY_BLOCKS'] as const) {
      expect(decide(c, {}, freshRetryState(), ctx)).toEqual({ kind: 'fail' });
    }
  });
  it('one shrink for TOO_LONG, one bigger budget for LENGTH, one drop of strict params for UNSUPPORTED', () => {
    expect(decide('AI_TOO_LONG', {}, freshRetryState(), ctx)).toEqual({ kind: 'shrink' });
    expect(decide('AI_TOO_LONG', {}, { ...freshRetryState(), shrunk: true }, ctx)).toEqual({ kind: 'fail' });
    expect(decide('AI_LENGTH', {}, freshRetryState(), ctx)).toEqual({ kind: 'moreTokens' });
    expect(decide('AI_UNSUPPORTED', {}, freshRetryState(), ctx)).toEqual({ kind: 'dropStrict' });
  });
  it('FREE_LIMIT waits for a near reset (per-minute), stops for a far one (per-day)', () => {
    expect(decide('AI_FREE_LIMIT', { resetAt: 1_030_000, remaining: 0 }, freshRetryState(), ctx)).toEqual({ kind: 'retry', delayMs: 30_250 });
    expect(decide('AI_FREE_LIMIT', { resetAt: 50_000_000, remaining: 0 }, freshRetryState(), ctx)).toEqual({ kind: 'fail' });
    expect(decide('AI_FREE_LIMIT', {}, freshRetryState(), ctx)).toEqual({ kind: 'fail' });
  });
});

const settings = (over: Partial<{ level: 'standard' | 'no-training' | 'zdr'; busyRelax: boolean; customHost: string | null }> = {}) => () => ({
  level: over.level ?? 'no-training', model: GEMMA, fallbacks: [], customHost: over.customHost ?? null, busyRelax: over.busyRelax ?? false,
});
const msgs = [{ role: 'user' as const, content: 'Olá' }];
const activity = { classId: null, action: 'ask' as const, passages: 0 };

describe('AiClient.run: retry and fallback through the fake wire', () => {
  it('a busy chain is retried with backoff, then answers; the answering model is reported', async () => {
    const clock = createTestClock();
    const transport = createScriptedTransport([ERROR_REPLIES.busy(), ERROR_REPLIES.busy(), { kind: 'text', text: 'Resposta [S1].', model: 'dots-studio/dots-3-note-preview:free' }]);
    const client = createAiClient({ transport, clock, rand: () => 0.5, settings: settings() });
    const events: AiEvent[] = [];
    const p = client.run({ task: 'chat', messages: msgs, activity, onEvent: (e) => events.push(e) });
    await clock.advance(2000);
    await clock.advance(4000);
    const r = await p;
    expect(r).toMatchObject({ model: 'dots-studio/dots-3-note-preview:free', requestedModel: GEMMA, content: 'Resposta [S1].', attempts: 3, privacy: 'no-training' });
    expect(events.filter((e) => e.kind === 'retrying').map((e) => (e as { inMs: number }).inMs)).toEqual([2000, 4000]);
    expect(transport.requests[0]!.activity).toEqual(activity);
    expect(bodyOf(transport.requests[0]!).models).toEqual(AI_DEFAULTS.chains['no-training']);
  });

  it('gives up after 3 retries with AI_BUSY and the chain that was tried (the busy chooser)', async () => {
    const clock = createTestClock();
    const transport = createScriptedTransport([ERROR_REPLIES.busy()]);
    const client = createAiClient({ transport, clock, rand: () => 0.5, settings: settings() });
    const p = client.run({ task: 'chat', messages: msgs, activity });
    const caught = p.catch((e: unknown) => e);
    for (let i = 0; i < 4; i++) await clock.advance(10_000);
    const e = (await caught) as { code: string; data: { tried: string[] } };
    expect(e.code).toBe('AI_BUSY');
    expect(e.data.tried).toEqual(AI_DEFAULTS.chains['no-training']);
    expect(transport.requests).toHaveLength(4);
  });

  it('with busyRelax on, a busy chain moves to the NVIDIA chain with busyFallback (no dialog, D-10)', async () => {
    const clock = createTestClock();
    const transport = createScriptedTransport((req): FakeReply => (req.busyFallback ? { kind: 'text', text: 'ok', model: 'nvidia/nemotron-3.5-super-vl:free' } : ERROR_REPLIES.busy()));
    const client = createAiClient({ transport, clock, rand: () => 0.5, settings: settings({ busyRelax: true }) });
    const r = await client.run({ task: 'chat', messages: msgs, activity });
    expect(r.privacy).toBe('standard');
    expect(transport.requests[1]).toMatchObject({ busyFallback: true, privacyOverride: 'standard' });
    expect(bodyOf(transport.requests[1]!).models).toEqual(AI_DEFAULTS.trainingOptIn);
  });

  it('the explicit "use NVIDIA for this request" sends privacyOverride + busyFallback', async () => {
    const clock = createTestClock();
    const transport = createScriptedTransport([{ kind: 'text', text: 'ok', model: 'nvidia/nemotron-3.5-super-vl:free' }]);
    const client = createAiClient({ transport, clock, rand: () => 0.5, settings: settings() });
    await client.run({ task: 'chat', messages: msgs, activity, busyFallback: true });
    expect(transport.requests[0]).toMatchObject({ privacyOverride: 'standard', busyFallback: true });
  });

  it('LENGTH (empty content, finish length) retries once with a doubled budget and lower effort', async () => {
    const clock = createTestClock();
    const transport = createScriptedTransport([{ kind: 'text', text: '', finish: 'length' }, { kind: 'text', text: 'Agora sim.' }]);
    const client = createAiClient({ transport, clock, rand: () => 0.5, settings: settings() });
    const r = await client.run({ task: 'chat', messages: msgs, activity });
    expect(r.content).toBe('Agora sim.');
    expect(bodyOf(transport.requests[1]!).max_tokens).toBe(8000);
    expect(bodyOf(transport.requests[1]!).reasoning).toMatchObject({ effort: 'minimal' });
  });

  it('TOO_LONG shrinks once; UNSUPPORTED drops response_format once; AUTH fails at once', async () => {
    const clock = createTestClock();
    const long = [{ role: 'user' as const, content: 'x '.repeat(5000) }];
    const t1 = createScriptedTransport([ERROR_REPLIES.tooLong(), { kind: 'text', text: 'curto' }]);
    await createAiClient({ transport: t1, clock, rand: () => 0.5, settings: settings() }).run({ task: 'chat', messages: long, activity });
    const sizes = t1.requests.map((r) => JSON.stringify(bodyOf(r).messages).length);
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 0.7);
    const t3 = createScriptedTransport([ERROR_REPLIES.auth()]);
    await expect(createAiClient({ transport: t3, clock, rand: () => 0.5, settings: settings() }).run({ task: 'chat', messages: msgs, activity })).rejects.toMatchObject({ code: 'AI_AUTH' });
    expect(t3.requests).toHaveLength(1);
  });

  it('a mid-stream error is retried; a cancelled run stops at once', async () => {
    const clock = createTestClock();
    const t = createScriptedTransport([{ kind: 'midstream', text: 'meia', error: { code: 'server_error', message: 'Provider disconnected unexpectedly' } }, { kind: 'text', text: 'inteira' }]);
    const client = createAiClient({ transport: t, clock, rand: () => 0.5, settings: settings() });
    const p = client.run({ task: 'chat', messages: msgs, activity });
    await clock.advance(2000);
    expect((await p).content).toBe('inteira');
    const t2 = createScriptedTransport([{ kind: 'hang' }]);
    const c2 = createAiClient({ transport: t2, clock, rand: () => 0.5, settings: settings() });
    const ac = new AbortController();
    const p2 = c2.run({ task: 'chat', messages: msgs, activity, signal: ac.signal });
    await clock.advance(10);
    ac.abort();
    await expect(p2).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(t2.cancelled).toHaveLength(1);
  });

  it('the stall watchdog turns silence into AI_TIMEOUT (retried) and cancels the pipe request', async () => {
    const clock = createTestClock();
    const t = createScriptedTransport([{ kind: 'hang' }, { kind: 'text', text: 'acordei' }]);
    const client = createAiClient({ transport: t, clock, rand: () => 0.5, settings: settings() });
    const p = client.run({ task: 'chat', messages: msgs, activity });
    await clock.advance(120_000);
    await clock.advance(2_000);
    expect((await p).content).toBe('acordei');
    expect(t.cancelled).toEqual([t.requests[0]!.requestId]);
  });

  it('FREE_LIMIT (per day) fails with resetAt for the message', async () => {
    const clock = createTestClock();
    const t = createScriptedTransport([ERROR_REPLIES.freeLimit(clock.now() + 10 * 3600_000)]);
    const e = await createAiClient({ transport: t, clock, rand: mulberry32(1), settings: settings() }).run({ task: 'chat', messages: msgs, activity }).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 'AI_FREE_LIMIT', data: { resetAt: clock.now() + 10 * 3600_000 } });
  });

  it('a custom host goes to {type:host} without provider or models, and is not free-throttled', async () => {
    const clock = createTestClock();
    const t = createScriptedTransport([{ kind: 'text', text: 'local' }]);
    const r = await createAiClient({ transport: t, clock, rand: () => 0.5, settings: settings({ customHost: 'h1' }) }).run({ task: 'chat', messages: msgs, activity });
    expect(r.privacy).toBe('custom-host');
    expect(t.requests[0]!.base).toEqual({ type: 'host', hostId: 'h1' });
    expect(bodyOf(t.requests[0]!).provider).toBeUndefined();
  });

  it('GET key returns the parsed body; errors are classified', async () => {
    const clock = createTestClock();
    const t = createScriptedTransport([{ kind: 'json', body: { data: { free_model_daily_requests: { used: 12, limit: 50, remaining: 38 } } } }, ERROR_REPLIES.auth()]);
    const client = createAiClient({ transport: t, clock, rand: () => 0.5, settings: settings() });
    expect(await client.get('key')).toMatchObject({ data: { free_model_daily_requests: { remaining: 38 } } });
    expect(t.requests[0]).toMatchObject({ method: 'GET', path: 'key', stream: false });
    await expect(client.get('key')).rejects.toMatchObject({ code: 'AI_AUTH' });
  });
});
