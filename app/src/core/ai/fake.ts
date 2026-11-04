// A scripted transport that emits the same wire events as Rust's pipe (architecture §10, plan §4.2): `head`, `line`s
// carrying real `chat.completion.chunk` JSON, `: OPENROUTER PROCESSING` heartbeats, `[DONE]`, and the real
// OpenRouter error bodies of openrouter-lab §8 (with `metadata.raw` already redacted, as fixtures are). Used by core
// tests, the memory platform's fake AI (demo) and the service tests, so `sse.ts` and `classify.ts` run unchanged.
import type { ErrorCode } from '../errors';
import type { AiTransport, PipeRequest, Usage, WireEvent } from './types';

export type FakeReply =
  | { kind: 'text'; text: string; model?: string; provider?: string; reasoning?: string; finish?: string; usage?: Usage; heartbeats?: number; noDone?: boolean; chunk?: number }
  | { kind: 'tools'; calls: Array<{ name: string; args: unknown; id?: string }>; model?: string; content?: string }
  | { kind: 'error'; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: 'midstream'; text: string; error: { code: string | number; message: string }; model?: string }
  | { kind: 'fail'; code: ErrorCode; message?: string }
  | { kind: 'json'; status?: number; body: unknown; headers?: Record<string, string> }
  | { kind: 'hang' };
export type FakeScript = (req: PipeRequest, n: number) => FakeReply | Promise<FakeReply>;

export const FAKE_GEN_ID = 'gen-1793720888-FakeFixture00000000';
const created = 1793720888;

/** The real error bodies (openrouter-lab §8; `metadata.raw` redacted like the fixtures). */
export const ERROR_REPLIES = {
  busy: (model = 'google/gemma-4-31b-it:free'): FakeReply => ({
    kind: 'error', status: 429, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'provider' },
    body: { error: { message: 'Provider returned error', code: 429, metadata: { raw: '<redacted>', provider_name: model.startsWith('google/') ? 'Google AI Studio' : 'AtlasCloud', is_byok: false, provider_error_code: '429', limit_source: 'upstream_provider_shared_pool', remedy_hint: 'Retry shortly, add your own provider key to use your own limits (https://openrouter.ai/workspaces/default/byok), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing.' } } },
  }),
  freeLimit: (resetAt: number, remaining = 0): FakeReply => ({
    kind: 'error', status: 429,
    headers: { 'content-type': 'application/json', 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-reset': String(resetAt) },
    body: { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day', metadata: { error_type: 'rate_limit_exceeded' } } },
  }),
  auth: (): FakeReply => ({ kind: 'error', status: 401, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'client' }, body: { error: { message: 'User not found.', code: 401 } } }),
  noCredit: (): FakeReply => ({ kind: 'error', status: 402, headers: { 'content-type': 'application/json' }, body: { error: { message: 'Insufficient credits. Add more using https://openrouter.ai/credits', code: 402 } } }),
  modelUnknown: (id = 'google/does-not-exist:free'): FakeReply => ({ kind: 'error', status: 400, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'client' }, body: { error: { message: `${id} is not a valid model ID`, code: 400 } } }),
  badRequest: (): FakeReply => ({ kind: 'error', status: 400, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'client' }, body: { error: { message: 'Input required: specify "prompt" or "messages"', code: 400 } } }),
  tooLong: (): FakeReply => ({ kind: 'error', status: 400, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'client' }, body: { error: { message: "This endpoint's maximum context length is 65536 tokens. However, you requested about 77013 tokens (76963 of text input, 50 in the output). Please reduce the length of either one, or use the context-compression plugin to compress your prompt automatically.", code: 400, metadata: { provider_name: null } } } }),
  gated: (): FakeReply => ({ kind: 'error', status: 403, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'client' }, body: { error: { message: 'thinkingmachines/inkling-small:free is only available on agentic harnesses. Learn more: https://openrouter.ai/docs', code: 403, metadata: { failed_routing_step: 'Gate Free Endpoints by Agentic Harness' } } } }),
  flagged: (): FakeReply => ({ kind: 'error', status: 403, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'provider' }, body: { error: { message: 'Input was flagged by moderation', code: 403, metadata: { reasons: ['policy'], flagged_input: '<redacted>' } } } }),
  privacy: (zdr = false): FakeReply => ({ kind: 'error', status: 404, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'client' }, body: { error: { message: `No endpoints found matching your data policy (${zdr ? 'Zero data retention' : 'Free model training'}). Configure: https://openrouter.ai/settings/privacy`, code: 404, metadata: { routing_funnel: [{ step: 'Initial Endpoints', endpoint_count: 1 }], failed_routing_step: 'Filter by Data Policy' } } } }),
  unsupported: (): FakeReply => ({ kind: 'error', status: 404, headers: { 'content-type': 'application/json', 'x-openrouter-error-origin': 'client' }, body: { error: { message: 'No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection', code: 404, metadata: { routing_funnel: [{ step: 'Initial Endpoints', endpoint_count: 1 }], failed_routing_step: 'Filter by Parameters' } } } }),
  upstream: (): FakeReply => ({ kind: 'error', status: 502, headers: { 'content-type': 'application/json' }, body: { error: { message: 'HTTP 500: {"object":"error","message":"service inference failed","type":"server_error"}', code: 502 } } }),
  unavailable: (retryAfterS = 3): FakeReply => ({ kind: 'error', status: 503, headers: { 'content-type': 'application/json', 'retry-after': String(retryAfterS) }, body: { error: { message: 'No provider is available to serve this request', code: 503 } } }),
} as const;

const chunkJson = (model: string, provider: string, delta: Record<string, unknown>, finish: string | null, usage?: Usage): string =>
  JSON.stringify({
    id: FAKE_GEN_ID, object: 'chat.completion.chunk', created, model, provider,
    choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: finish, native_finish_reason: finish }],
    ...(usage ? { usage: { cost: 0, is_byok: false, ...usage } } : {}),
  });

/** The SSE lines of a streamed reply, exactly as Rust forwards them (no blank lines). */
export function sseLinesFor(reply: Extract<FakeReply, { kind: 'text' | 'tools' | 'midstream' }>): string[] {
  const model = reply.model ?? 'google/gemma-4-31b-it:free';
  const provider = 'provider' in reply && reply.provider ? reply.provider : model.startsWith('google/') ? 'Google AI Studio' : model.startsWith('nvidia/') ? 'Nvidia' : 'AtlasCloud';
  const lines: string[] = [];
  const pieces = (s: string, n: number) => {
    const out: string[] = [];
    for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
    return out;
  };
  if (reply.kind === 'text') {
    for (let i = 0; i < (reply.heartbeats ?? 1); i++) lines.push(': OPENROUTER PROCESSING');
    for (const r of pieces(reply.reasoning ?? '', 24)) lines.push(`data: ${chunkJson(model, provider, { content: '', reasoning: r, reasoning_details: [{ type: 'reasoning.text', text: r, format: 'unknown', index: 0 }] }, null)}`);
    for (const c of pieces(reply.text, reply.chunk ?? 16)) lines.push(`data: ${chunkJson(model, provider, { content: c }, null)}`);
    const finish = reply.finish ?? 'stop';
    const usage: Usage = reply.usage ?? { prompt_tokens: 120, completion_tokens: Math.max(1, Math.ceil(reply.text.length / 4)), total_tokens: 120 + Math.ceil(reply.text.length / 4), completion_tokens_details: { reasoning_tokens: 0 } };
    lines.push(`data: ${chunkJson(model, provider, { content: '' }, finish)}`);
    lines.push(`data: ${chunkJson(model, provider, { content: '' }, finish, usage)}`);
    if (!reply.noDone) lines.push('data: [DONE]');
    return lines;
  }
  if (reply.kind === 'tools') {
    lines.push(': OPENROUTER PROCESSING');
    if (reply.content) lines.push(`data: ${chunkJson(model, provider, { content: reply.content }, null)}`);
    reply.calls.forEach((c, index) => {
      const id = c.id ?? `call-fake-${index}`;
      lines.push(`data: ${chunkJson(model, provider, { content: '', tool_calls: [{ index, id, type: 'function', function: { name: c.name, arguments: '' } }] }, null)}`);
      for (const a of pieces(JSON.stringify(c.args), 20)) lines.push(`data: ${chunkJson(model, provider, { content: '', tool_calls: [{ index, function: { arguments: a } }] }, null)}`);
    });
    lines.push(`data: ${chunkJson(model, provider, { content: '' }, 'tool_calls')}`);
    lines.push(`data: ${chunkJson(model, provider, { content: '' }, 'tool_calls', { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 })}`);
    lines.push('data: [DONE]');
    return lines;
  }
  for (const c of pieces(reply.text, 16)) lines.push(`data: ${chunkJson(model, provider, { content: c }, null)}`);
  lines.push(`data: ${JSON.stringify({ id: FAKE_GEN_ID, object: 'chat.completion.chunk', created, model, provider, error: reply.error, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })}`);
  return lines;
}

/** The wire events of one reply to one request. */
export function wireEventsFor(reply: FakeReply, req: PipeRequest): WireEvent[] {
  switch (reply.kind) {
    case 'hang': return [];
    case 'fail': return [{ type: 'fail', code: reply.code, message: reply.message ?? reply.code }];
    case 'error': return [{ type: 'head', status: reply.status, headers: reply.headers ?? { 'content-type': 'application/json' } }, { type: 'body', text: JSON.stringify(reply.body) }, { type: 'end' }];
    case 'json': return [{ type: 'head', status: reply.status ?? 200, headers: reply.headers ?? { 'content-type': 'application/json' } }, { type: 'body', text: JSON.stringify(reply.body) }, { type: 'end' }];
    default: {
      if (!req.stream) {
        // A non-streamed completion: one JSON body.
        const r = reply.kind === 'tools' ? { content: reply.content ?? null, tool_calls: reply.calls.map((c, i) => ({ id: c.id ?? `call-fake-${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : { content: reply.text };
        const model = reply.model ?? 'google/gemma-4-31b-it:free';
        const body = { id: FAKE_GEN_ID, object: 'chat.completion', created, model, provider: 'Google AI Studio', choices: [{ index: 0, finish_reason: reply.kind === 'tools' ? 'tool_calls' : 'stop', message: { role: 'assistant', ...r } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
        return [{ type: 'head', status: 200, headers: { 'content-type': 'application/json' } }, { type: 'body', text: JSON.stringify(body) }, { type: 'end' }];
      }
      return [{ type: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } }, ...sseLinesFor(reply).map((line): WireEvent => ({ type: 'line', line })), { type: 'end' }];
    }
  }
}

export interface ScriptedTransport extends AiTransport {
  readonly requests: PipeRequest[];
  readonly cancelled: string[];
}

/**
 * A transport answering each request from a script (a function, or a queue of replies; the last reply of a queue
 * repeats). Events are delivered asynchronously, after `send` resolved, like the Rust channel.
 */
export function createScriptedTransport(script: FakeScript | FakeReply[]): ScriptedTransport {
  const requests: PipeRequest[] = [];
  const cancelled: string[] = [];
  const live = new Map<string, (e: WireEvent) => void>();
  const next: FakeScript = Array.isArray(script) ? (_req, n) => script[Math.min(n, script.length - 1)] ?? { kind: 'fail', code: 'AI_OFFLINE' } : script;
  return {
    requests, cancelled,
    async send(req, onEvent) {
      const n = requests.length;
      requests.push(req);
      live.set(req.requestId, onEvent);
      void Promise.resolve().then(async () => {
        const reply = await next(req, n);
        for (const e of wireEventsFor(reply, req)) {
          await Promise.resolve();
          if (!live.has(req.requestId)) return;
          onEvent(e);
        }
        live.delete(req.requestId);
      });
    },
    async cancel(id) {
      cancelled.push(id);
      const cb = live.get(id);
      live.delete(id);
      cb?.({ type: 'fail', code: 'CANCELLED', message: 'cancelled' });
    },
  };
}

/** The parsed body of a POST request (tests and the fake AI read messages and tools from it). */
export function bodyOf(req: PipeRequest): { model?: string; models?: string[]; messages?: Array<{ role: string; content?: unknown }>; tools?: unknown[]; tool_choice?: string; provider?: unknown; response_format?: unknown; max_tokens?: number; reasoning?: unknown; stream?: boolean } {
  return (req.body ?? {}) as ReturnType<typeof bodyOf>;
}
