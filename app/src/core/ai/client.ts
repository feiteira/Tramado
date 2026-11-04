// AiClient (architecture §11.1, critique C1): throttle → build → pipe → SSE parse → classify → retry/fallback →
// the result with the model that actually answered. One client for the desktop (transport = Rust's `ai_send`), the
// demo (the fake AI or the fetch transport) and Vitest. It never sees the key.
import { PlatformError, toPlatformError, type ErrorCode } from '../errors';
import { uuid } from '../ids';
import { buildChat, type BuildExtra } from './build';
import { shrinkMessages } from './budget';
import type { Catalog } from './catalog';
import { classify, classifyStreamError, parseBody } from './classify';
import { MAX_CHAIN, isFreeId, trainingChain } from './defaults';
import { decide, freshRetryState } from './retry';
import { createSseParser, resultFromBody, type SseResult } from './sse';
import { createThrottle, type Throttle } from './throttle';
import type {
  ActivityTag, AiEvent, AiTransport, ConfirmTextLike, Msg, PipePath, PipeRequest, PrivacyLevel, Priority, ResponseFormat, Task,
  ToolCall, ToolDef, Usage,
} from './types';

export interface ClientSettings {
  level: PrivacyLevel;               // the stored privacy level (Rust's `config/ai.json`, mirrored by AiService)
  model: string;
  fallbacks: string[];               // [] = the level's defaults
  customHost: string | null;         // hostId of an OpenAI-compatible service, else OpenRouter
  busyRelax: boolean;                // "Use NVIDIA free models when the others are busy" (D-10)
  showReasoning?: boolean;
}
export interface ClientClock { now(): number; mono(): number; setTimeout(f: () => void, ms: number): () => void }
export interface AiClientDeps {
  transport: AiTransport;
  clock: ClientClock;
  rand: () => number;
  settings: () => ClientSettings;
  catalog?: () => Catalog | null;
  throttle?: Throttle;
  /** Called after every successful completion (AiService keeps `lastAnswerModel`). */
  onAnswered?: (r: RunResult) => void;
  /** Called with the final code of every failed run (diagnostics, no content). */
  onFailed?: (code: ErrorCode) => void;
  /** First byte and idle limits of the stall watchdog (openrouter-lab §2: 30 s without a byte = abort and retry). */
  watchdog?: { firstByteMs: number; idleMs: number };
}
export interface RunOptions {
  task: Task;
  messages: Msg[];
  activity: ActivityTag;
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none';
  responseFormat?: ResponseFormat;
  vision?: boolean;
  /** Another first model for this request (Ask's per-thread model); the user's fallbacks still follow. */
  model?: string;
  chain?: string[];
  pinned?: string;
  maxTokens?: number;
  /** The busy chooser's "Use NVIDIA free models for this request" (C14, D9, D-10). */
  busyFallback?: boolean;
  overrideText?: ConfirmTextLike;
  priority?: Priority;
  signal?: AbortSignal;
  onEvent?: (e: AiEvent) => void;
  shrink?: (msgs: Msg[]) => Msg[];
  stream?: boolean;
  maxRetries?: number;
}
export interface RunResult {
  model: string;                     // the model that answered (response `model`)
  requestedModel: string;            // the first model of the chain that was asked for
  chain: string[];
  provider: string | null;
  content: string; reasoning: string; reasoningDetails: unknown[]; toolCalls: ToolCall[];
  finish: string; usage: Usage | null;
  privacy: PrivacyLevel | 'custom-host';
  attempts: number; ms: number;
}
export interface AiClient {
  run(o: RunOptions): Promise<RunResult>;
  /** `GET key`, `GET models`, `GET models/<id>/endpoints`: the parsed JSON body, or a classified PlatformError. */
  get(path: Extract<PipePath, 'key' | 'models'> | `models/${string}/endpoints`, activity?: ActivityTag): Promise<unknown>;
  settings(): ClientSettings;
  readonly throttle: Throttle;
}

type Outcome = { ok: true; r: SseResult; status: number } | { ok: false; code: ErrorCode; message: string; data: Record<string, unknown> };

const DEFAULT_WATCHDOG = { firstByteMs: 120_000, idleMs: 30_000 };

export function createAiClient(deps: AiClientDeps): AiClient {
  const { transport, clock, rand } = deps;
  const throttle = deps.throttle ?? createThrottle(clock);
  const wd = deps.watchdog ?? DEFAULT_WATCHDOG;
  const catalog = () => deps.catalog?.() ?? null;

  function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new PlatformError('CANCELLED', 'cancelled'));
      const onAbort = () => {
        cancelTimer();
        reject(new PlatformError('CANCELLED', 'cancelled'));
      };
      const cancelTimer = clock.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** One request through the pipe; resolves (never rejects) with what came back. */
  function once(req: PipeRequest, o: { signal?: AbortSignal; onEvent?: (e: AiEvent) => void }): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      const parser = createSseParser();
      let status = 0;
      let headers: Record<string, string> = {};
      let body: string | null = null;
      let settled = false;
      let timer: (() => void) | null = null;
      const finish = (out: Outcome) => {
        if (settled) return;
        settled = true;
        timer?.();
        o.signal?.removeEventListener('abort', onAbort);
        resolve(out);
      };
      const fail = (code: ErrorCode, message: string, data: Record<string, unknown> = {}) => finish({ ok: false, code, message, data });
      const arm = (ms: number) => {
        timer?.();
        timer = clock.setTimeout(() => {
          void transport.cancel(req.requestId).catch(() => undefined);
          fail('AI_TIMEOUT', 'no response from the AI service');
        }, ms);
      };
      const onAbort = () => {
        void transport.cancel(req.requestId).catch(() => undefined);
        fail('CANCELLED', 'cancelled');
      };
      if (o.signal?.aborted) return fail('CANCELLED', 'cancelled');
      o.signal?.addEventListener('abort', onAbort, { once: true });
      arm(wd.firstByteMs);
      const evaluate = () => {
        if (status === 0) return fail('AI_UPSTREAM', 'the response ended before it started');
        if (status >= 300) {
          const c = classify(status, headers, body === null ? null : parseBody(body));
          return fail(c.code, c.message, c.data);
        }
        let r: SseResult;
        if (req.stream && body === null) {
          for (const ev of parser.end()) o.onEvent?.(ev);
          r = parser.result();
        } else {
          r = resultFromBody(body === null ? null : parseBody(body));
          if (r.model) o.onEvent?.({ kind: 'started', model: r.model, ...(r.provider ? { provider: r.provider } : {}) });
          if (r.content) o.onEvent?.({ kind: 'content', text: r.content });
          if (r.toolCalls.length) o.onEvent?.({ kind: 'tool_calls', calls: r.toolCalls });
        }
        if (r.error) {
          const c = classifyStreamError(r.error);
          return fail(c.code, c.message, c.data);
        }
        if (r.finish === 'error') return fail('AI_UPSTREAM', 'the provider failed mid-answer');
        if (!r.content.trim() && r.toolCalls.length === 0) {
          return r.finish === 'length' ? fail('AI_LENGTH', 'the model ran out of room') : fail('AI_UPSTREAM', 'empty answer');
        }
        finish({ ok: true, r, status });
      };
      const onEvent = (e: Parameters<Parameters<AiTransport['send']>[1]>[0]) => {
        if (settled) return;
        switch (e.type) {
          case 'head':
            status = e.status;
            headers = e.headers;
            arm(wd.idleMs);
            return;
          case 'line': {
            arm(wd.idleMs);
            for (const ev of parser.push(e.line)) o.onEvent?.(ev);
            const r = parser.result();
            if (r.done && (r.error || r.finish === 'error')) evaluate();
            return;
          }
          case 'body':
            body = (body ?? '') + e.text;
            arm(wd.idleMs);
            return;
          case 'end':
            evaluate();
            return;
          case 'fail':
            fail(e.code, e.message, e.data ?? {});
            return;
        }
      };
      transport.send(req, onEvent).catch((err: unknown) => {
        const pe = toPlatformError(err);
        fail(pe.code, pe.message, pe.data);
      });
    });
  }

  async function run(o: RunOptions): Promise<RunResult> {
    const started = clock.mono();
    const st = freshRetryState();
    let msgs = o.messages;
    const extra: BuildExtra = {
      ...(o.tools ? { tools: o.tools } : {}), ...(o.toolChoice ? { toolChoice: o.toolChoice } : {}),
      ...(o.responseFormat ? { responseFormat: o.responseFormat } : {}), ...(o.vision ? { vision: true } : {}),
      ...(o.chain ? { chain: o.chain } : {}), ...(o.pinned ? { pinned: o.pinned } : {}),
      ...(o.maxTokens ? { maxTokens: o.maxTokens } : {}), ...(o.stream === false ? { stream: false } : {}),
    };
    let busyFallback = Boolean(o.busyFallback);
    let extraChainTried = false;
    let attempts = 0;
    for (;;) {
      attempts++;
      const s = deps.settings();
      const custom = s.customHost !== null;
      const level: PrivacyLevel | 'custom-host' = custom ? 'custom-host' : s.level;
      if (busyFallback && !custom && !extra.chain) extra.chain = trainingChain();
      const built = buildChat(o.task, { level, model: o.model ?? s.model, fallbacks: s.fallbacks, ...(s.showReasoning ? { showReasoning: true } : {}) }, catalog(), msgs, extra);
      const req: PipeRequest = {
        requestId: uuid(rand),
        base: custom ? { type: 'host', hostId: s.customHost! } : { type: 'openrouter' },
        method: 'POST', path: 'chat/completions', body: built.body, stream: built.body.stream,
        activity: o.activity,
        ...(busyFallback && !custom ? { privacyOverride: 'standard' as const, busyFallback: true, ...(o.overrideText ? { overrideText: o.overrideText } : {}) } : {}),
      };
      const free = !custom && built.chain.some(isFreeId);
      const release = await throttle.acquire({ free, priority: o.priority ?? 'interactive', ...(o.signal ? { signal: o.signal } : {}) });
      let out: Outcome;
      try {
        out = await once(req, { ...(o.signal ? { signal: o.signal } : {}), ...(o.onEvent ? { onEvent: o.onEvent } : {}) });
      } finally {
        release();
      }
      if (out.ok) {
        const r = out.r;
        const result: RunResult = {
          model: r.model || built.body.model, requestedModel: built.requested, chain: built.chain, provider: r.provider,
          content: r.content, reasoning: r.reasoning, reasoningDetails: r.reasoningDetails, toolCalls: r.toolCalls,
          finish: r.finish ?? 'unknown', usage: r.usage,
          privacy: custom ? 'custom-host' : busyFallback ? 'standard' : s.level,
          attempts, ms: clock.mono() - started,
        };
        deps.onAnswered?.(result);
        return result;
      }
      const { code, message, data } = out;
      if (code === 'CANCELLED') throw new PlatformError('CANCELLED', message);
      // The lasting busy-only relaxation (D-10): with busyRelax on, a busy chain moves to the NVIDIA chain silently.
      if (code === 'AI_BUSY' && !custom && !busyFallback && s.busyRelax && s.level !== 'standard' && !o.pinned) {
        busyFallback = true;
        extra.chain = trainingChain();
        o.onEvent?.({ kind: 'retrying', code, inMs: 0, attempt: attempts, nextChain: extra.chain });
        continue;
      }
      const action = decide(code, data as { retryAfterMs?: number; resetAt?: number; remaining?: number }, st, {
        nowMs: clock.now(), rand, ...(o.maxRetries !== undefined ? { maxRetries: o.maxRetries } : {}),
      });
      if (action.kind === 'retry') {
        if (code === 'AI_FREE_LIMIT') st.waitedLimit = true;
        else st.transient++;
        // "Free mode" extra chain (openrouter-lab §11.5 rule 3): at `standard`, a busy chain tries the other free models.
        if (code === 'AI_BUSY' && !custom && s.level === 'standard' && !o.pinned && !extraChainTried && !o.chain) {
          extraChainTried = true;
          const next = trainingChain(built.chain);
          if (next.length) extra.chain = next.slice(0, MAX_CHAIN);
        }
        o.onEvent?.({ kind: 'retrying', code, inMs: action.delayMs, attempt: attempts, ...(extra.chain ? { nextChain: extra.chain } : {}) });
        await sleep(action.delayMs, o.signal);
        continue;
      }
      if (action.kind === 'shrink') {
        st.shrunk = true;
        msgs = (o.shrink ?? shrinkMessages)(msgs);
        o.onEvent?.({ kind: 'retrying', code, inMs: 0, attempt: attempts });
        continue;
      }
      if (action.kind === 'moreTokens') {
        st.moreTokens = true;
        const cap = catalog()?.get(built.body.model)?.maxOut ?? 32_000;
        extra.maxTokens = Math.min(built.body.max_tokens * 2, cap);
        extra.effortDown = 1;
        o.onEvent?.({ kind: 'retrying', code, inMs: 0, attempt: attempts });
        continue;
      }
      if (action.kind === 'dropStrict') {
        st.droppedStrict = true;
        delete extra.responseFormat;
        o.onEvent?.({ kind: 'retrying', code, inMs: 0, attempt: attempts });
        continue;
      }
      deps.onFailed?.(code);
      o.onEvent?.({ kind: 'error', code, detail: message });
      throw new PlatformError(code, message, { ...data, tried: built.chain, requested: built.requested, attempts });
    }
  }

  async function get(path: PipePath, activity?: ActivityTag): Promise<unknown> {
    const s = deps.settings();
    const req: PipeRequest = {
      requestId: uuid(rand),
      base: s.customHost !== null ? { type: 'host', hostId: s.customHost } : { type: 'openrouter' },
      method: 'GET', path, stream: false, ...(activity ? { activity } : {}),
    };
    const out = await new Promise<{ status: number; headers: Record<string, string>; body: string | null; fail?: { code: ErrorCode; message: string; data?: Record<string, unknown> } }>((resolve) => {
      let status = 0;
      let headers: Record<string, string> = {};
      let body: string | null = null;
      let done = false;
      const end = (f?: { code: ErrorCode; message: string; data?: Record<string, unknown> }) => {
        if (done) return;
        done = true;
        cancelTimer();
        resolve({ status, headers, body, ...(f ? { fail: f } : {}) });
      };
      const cancelTimer = clock.setTimeout(() => {
        void transport.cancel(req.requestId).catch(() => undefined);
        end({ code: 'AI_TIMEOUT', message: 'no response from the AI service' });
      }, wd.firstByteMs);
      transport.send(req, (e) => {
        if (e.type === 'head') {
          status = e.status;
          headers = e.headers;
        } else if (e.type === 'body') body = (body ?? '') + e.text;
        else if (e.type === 'line') body = (body ?? '') + e.line + '\n';
        else if (e.type === 'end') end();
        else if (e.type === 'fail') end({ code: e.code, message: e.message, ...(e.data ? { data: e.data } : {}) });
      }).catch((err: unknown) => {
        const pe = toPlatformError(err);
        end({ code: pe.code, message: pe.message, data: pe.data });
      });
    });
    if (out.fail) throw new PlatformError(out.fail.code, out.fail.message, out.fail.data ?? {});
    const parsed = out.body === null ? null : parseBody(out.body);
    if (out.status >= 300 || out.status === 0) {
      const c = classify(out.status, out.headers, parsed);
      throw new PlatformError(c.code, c.message, c.data);
    }
    return parsed;
  }

  return { run, get, settings: deps.settings, throttle };
}
