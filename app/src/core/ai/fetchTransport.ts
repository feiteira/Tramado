// An AiTransport over `fetch` that follows the rules of Rust's AiPipe (architecture §5.2): allow-listed paths,
// attribution headers, `provider` overwritten from the privacy level, `user` removed, allow-listed response headers,
// one `line` per SSE line, top-level `user_id` stripped. Used by the browser demo's `?ai=real` (a session-only key;
// OpenRouter answers CORS with `*`) and by the opt-in live test. The desktop never uses it: there Rust holds the key.
import { PlatformError } from '../errors';
import { OPENROUTER_BASE } from './defaults';
import type { AiTransport, PipeRequest, PrivacyLevel, WireEvent } from './types';

export interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(): Promise<void> } } | null;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<ResponseLike>;

export interface FetchTransportOptions {
  fetch: FetchLike;
  /** The OpenRouter key (session only; never stored by this module). */
  key: () => string | null;
  /** The stored privacy level, as Rust's PrivacyStore would hold it. */
  level: () => PrivacyLevel;
  /** OpenAI-compatible hosts by id (`{type:'host'}` requests). */
  hosts?: Record<string, { base: string; key?: string }>;
  base?: string;
}

const PATHS = /^(chat\/completions|embeddings|key|models|models\/[\w.:/-]{1,120}\/endpoints)$/;
const FORWARD = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-openrouter-error-origin', 'content-type'];
const BODY_CAP = 32 << 20;

/** Rust's body rewriting (arch §5.2 rule 5). */
export function rewriteBody(body: unknown, level: PrivacyLevel, openRouter: boolean): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const b = { ...(body as Record<string, unknown>) };
  delete b.user;
  delete b.provider;
  if (openRouter) {
    if (level === 'no-training') b.provider = { data_collection: 'deny' };
    else if (level === 'zdr') b.provider = { data_collection: 'deny', zdr: true };
  }
  return b;
}

/** Removes a top-level `user_id` from a JSON body (never shown or logged, openrouter-lab §8). */
export function stripUserId(text: string): string {
  try {
    const j = JSON.parse(text) as unknown;
    if (j && typeof j === 'object' && !Array.isArray(j) && 'user_id' in j) {
      const { user_id: _drop, ...rest } = j as Record<string, unknown>;
      void _drop;
      return JSON.stringify(rest);
    }
  } catch {
    // not JSON: forwarded as is
  }
  return text;
}

export function createFetchTransport(o: FetchTransportOptions): AiTransport {
  const live = new Map<string, AbortController>();
  return {
    async send(req: PipeRequest, onEvent: (e: WireEvent) => void) {
      if (!PATHS.test(req.path)) throw new PlatformError('INVALID', `path not allowed: ${req.path}`);
      const getLike = req.path === 'key' || req.path.startsWith('models');
      if ((req.method === 'GET') !== getLike) throw new PlatformError('INVALID', `${req.method} not allowed for ${req.path}`);
      const openRouter = req.base.type === 'openrouter';
      const host = req.base.type === 'host' ? o.hosts?.[req.base.hostId] : null;
      if (req.base.type === 'host' && !host) throw new PlatformError('AI_HOST_NOT_ALLOWED', 'host not allowed');
      const key = openRouter ? o.key() : host?.key ?? null;
      if (openRouter && !key) throw new PlatformError('AI_NO_KEY', 'AI is not set up');
      const level: PrivacyLevel = req.privacyOverride === 'standard' && req.busyFallback ? 'standard' : o.level();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (key) headers.Authorization = `Bearer ${key}`;
      if (req.stream) headers.Accept = 'text/event-stream';
      if (openRouter) {
        headers['HTTP-Referer'] = 'https://github.com/feiteira/Tramado';
        headers['X-OpenRouter-Title'] = 'Tramado';
      }
      const url = `${(openRouter ? o.base ?? OPENROUTER_BASE : host!.base).replace(/\/+$/, '')}/${req.path}`;
      const ac = new AbortController();
      live.set(req.requestId, ac);
      const body = req.method === 'POST' ? JSON.stringify(rewriteBody(req.body, level, openRouter)) : undefined;
      void (async () => {
        try {
          const res = await o.fetch(url, { method: req.method, headers, ...(body !== undefined ? { body } : {}), signal: ac.signal });
          const fwd: Record<string, string> = {};
          for (const h of FORWARD) {
            const v = res.headers.get(h);
            if (v !== null) fwd[h] = v;
          }
          onEvent({ type: 'head', status: res.status, headers: fwd });
          const sse = (fwd['content-type'] ?? '').includes('text/event-stream');
          if (req.stream && res.status < 300 && sse && res.body) {
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            let total = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value?.length ?? 0;
              if (total > BODY_CAP) throw new PlatformError('AI_UPSTREAM', 'response too large');
              buf += dec.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl).replace(/\r$/, '');
                buf = buf.slice(nl + 1);
                if (line !== '') onEvent({ type: 'line', line });
              }
            }
            const rest = (buf + dec.decode()).replace(/\r$/, '');
            if (rest !== '') onEvent({ type: 'line', line: rest });
          } else {
            const text = await res.text();
            onEvent({ type: 'body', text: stripUserId(text.slice(0, BODY_CAP)) });
          }
          onEvent({ type: 'end' });
        } catch (e) {
          const name = (e as { name?: string })?.name;
          if (ac.signal.aborted || name === 'AbortError') onEvent({ type: 'fail', code: 'CANCELLED', message: 'cancelled' });
          else if (e instanceof PlatformError) onEvent({ type: 'fail', code: e.code, message: e.message });
          else if (name === 'TimeoutError') onEvent({ type: 'fail', code: 'AI_TIMEOUT', message: 'timed out' });
          else onEvent({ type: 'fail', code: 'AI_OFFLINE', message: String((e as Error)?.message ?? e).slice(0, 200) });
        } finally {
          live.delete(req.requestId);
        }
      })();
    },
    async cancel(id: string) {
      live.get(id)?.abort();
    },
  };
}
