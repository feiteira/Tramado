import { describe, expect, it } from 'vitest';
import { createFetchTransport, rewriteBody, stripUserId, type FetchLike, type ResponseLike } from './fetchTransport';
import { createAiClient } from './client';
import { createTestClock } from './clock.testutil';
import { savedCall, savedLines } from './fixtures.testutil';
import type { WireEvent } from './types';

function response(status: number, headers: Record<string, string>, chunks: string[]): ResponseLike {
  const enc = new TextEncoder();
  let i = 0;
  return {
    status,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]!) } : { done: true }) }) },
    text: async () => chunks.join(''),
  };
}

describe('fetch transport (the Rust pipe rules, arch §5.2)', () => {
  it('rewrites provider per level and drops user; strips user_id from bodies', () => {
    expect(rewriteBody({ model: 'm', user: 'u', provider: { sort: 'price' } }, 'no-training', true)).toEqual({ model: 'm', provider: { data_collection: 'deny' } });
    expect(rewriteBody({ model: 'm' }, 'zdr', true)).toEqual({ model: 'm', provider: { data_collection: 'deny', zdr: true } });
    expect(rewriteBody({ model: 'm', provider: {} }, 'standard', true)).toEqual({ model: 'm' });
    expect(rewriteBody({ model: 'm', provider: {} }, 'no-training', false)).toEqual({ model: 'm' });
    expect(stripUserId('{"error":{"code":429},"user_id":"user_x"}')).toBe('{"error":{"code":429}}');
    expect(stripUserId('not json')).toBe('not json');
  });

  it('sends headers, splits a chunked SSE body into lines (CRLF, split lines) and the client reads it', async () => {
    const lines = savedLines('t2_stream_a');
    const text = lines.map((l) => `${l}\r\n\r\n`).join('');
    const chunks = [text.slice(0, 77), text.slice(77, 5000), text.slice(5000)];
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return response(200, { 'content-type': 'text/event-stream', 'x-generation-id': 'gen' }, chunks);
    };
    const t = createFetchTransport({ fetch, key: () => 'test-key-9', level: () => 'no-training' });
    const r = await createAiClient({ transport: t, clock: createTestClock(), rand: () => 0.5, settings: () => ({ level: 'no-training', model: 'google/gemma-4-31b-it:free', fallbacks: [], customHost: null, busyRelax: false }) })
      .run({ task: 'chat', messages: [{ role: 'user', content: 'x' }], activity: { classId: null, action: 'ask', passages: 0 } });
    expect(r.model).toBe('nvidia/nemotron-3.5-super-vl:free');
    expect(r.content.length).toBeGreaterThan(10);
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer test-key-9', 'X-OpenRouter-Title': 'Tramado', 'HTTP-Referer': 'https://github.com/feiteira/Tramado', Accept: 'text/event-stream' });
    expect(JSON.parse(calls[0]!.init.body!).provider).toEqual({ data_collection: 'deny' });
  });

  it('forwards an error body with allow-listed headers only; refuses bad paths and a missing key', async () => {
    const c = savedCall('t8_429_gemma_single');
    const fetch: FetchLike = async () => response(429, { 'content-type': 'application/json', 'x-openrouter-error-origin': 'provider', 'set-cookie': 'x' }, [JSON.stringify({ ...(c.response.json as object), user_id: 'user_zzzzzzzzzzzzzzzzzzzzzz' })]);
    const t = createFetchTransport({ fetch, key: () => 'k', level: () => 'standard' });
    const events = await new Promise<WireEvent[]>((resolve) => {
      const ev: WireEvent[] = [];
      void t.send({ requestId: '1', base: { type: 'openrouter' }, method: 'POST', path: 'chat/completions', stream: true, body: {} }, (e) => {
        ev.push(e);
        if (e.type === 'end') resolve(ev);
      });
    });
    expect(events[0]).toEqual({ type: 'head', status: 429, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'provider' } });
    expect((events[1] as { text: string }).text).not.toContain('user_id');
    await expect(t.send({ requestId: '2', base: { type: 'openrouter' }, method: 'POST', path: 'audio/transcriptions' as never, stream: false }, () => undefined)).rejects.toMatchObject({ code: 'INVALID' });
    const nokey = createFetchTransport({ fetch, key: () => null, level: () => 'standard' });
    await expect(nokey.send({ requestId: '3', base: { type: 'openrouter' }, method: 'GET', path: 'key', stream: false }, () => undefined)).rejects.toMatchObject({ code: 'AI_NO_KEY' });
    await expect(nokey.send({ requestId: '4', base: { type: 'host', hostId: 'h' }, method: 'GET', path: 'models', stream: false }, () => undefined)).rejects.toMatchObject({ code: 'AI_HOST_NOT_ALLOWED' });
  });

  it('a network failure is AI_OFFLINE; cancel is CANCELLED', async () => {
    const t = createFetchTransport({ fetch: async () => { throw new TypeError('fetch failed'); }, key: () => 'k', level: () => 'standard' });
    const ev = await new Promise<WireEvent>((resolve) => void t.send({ requestId: '1', base: { type: 'openrouter' }, method: 'GET', path: 'models', stream: false }, resolve));
    expect(ev).toMatchObject({ type: 'fail', code: 'AI_OFFLINE' });
    const slow = createFetchTransport({ fetch: (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), key: () => 'k', level: () => 'standard' });
    const p = new Promise<WireEvent>((resolve) => void slow.send({ requestId: '9', base: { type: 'openrouter' }, method: 'GET', path: 'models', stream: false }, resolve));
    await slow.cancel('9');
    expect(await p).toMatchObject({ type: 'fail', code: 'CANCELLED' });
  });
});
