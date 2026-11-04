// HTTP status + body + headers → one code of the taxonomy (critique §8, openrouter-lab §8 / §11.4), with the data
// the UI and the retry policy need. `user_id` and `metadata.raw` are never copied into the result.
import type { ErrorCode } from '../errors';

export interface Classified {
  code: ErrorCode;
  /** A short, safe message for logs (never `metadata.raw`, never `user_id`). */
  message: string;
  data: {
    status?: number;
    retryAfterMs?: number;        // Retry-After (503, 429 when present)
    resetAt?: number;             // X-RateLimit-Reset (epoch ms) of the platform limit
    remaining?: number;           // X-RateLimit-Remaining
    origin?: string;              // x-openrouter-error-origin
    provider?: string;            // metadata.provider_name
    model?: string;               // the model id named by an unknown/gated-model error
    step?: string;                // metadata.failed_routing_step
  };
}

interface ErrBody { error?: { code?: unknown; message?: unknown; metadata?: Record<string, unknown> } }

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Lower-cases header names (Rust forwards them lower-case already; the fetch transport may not). */
export function lowerHeaders(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v;
  return out;
}

/** Parses a JSON body leniently (null when it is not JSON). */
export function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function classify(status: number, headersIn: Record<string, string> | undefined, body: unknown): Classified {
  const headers = lowerHeaders(headersIn);
  const e = ((body ?? {}) as ErrBody).error ?? {};
  const msg = typeof e.message === 'string' ? e.message : '';
  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  const step = typeof meta.failed_routing_step === 'string' ? meta.failed_routing_step : '';
  const etype = typeof meta.error_type === 'string' ? meta.error_type : '';
  const origin = headers['x-openrouter-error-origin'];
  const data: Classified['data'] = { status };
  if (origin) data.origin = origin;
  if (typeof meta.provider_name === 'string') data.provider = meta.provider_name;
  if (step) data.step = step;
  const retryAfter = num(headers['retry-after']);
  if (retryAfter !== undefined) data.retryAfterMs = Math.max(0, retryAfter * 1000);
  const reset = num(headers['x-ratelimit-reset']);
  if (reset !== undefined) data.resetAt = reset;
  const remaining = num(headers['x-ratelimit-remaining']);
  if (remaining !== undefined) data.remaining = remaining;
  const modelOf = /^(\S+) is (?:not a valid model ID|only available)/.exec(msg)?.[1];
  if (modelOf) data.model = modelOf;
  const safe = msg.slice(0, 300);
  const out = (code: ErrorCode): Classified => ({ code, message: safe || `HTTP ${status}`, data });

  // Prefer the typed error_type when present (openrouter-lab §8).
  if (etype === 'authentication') return out('AI_AUTH');
  if (etype === 'context_length_exceeded') return out('AI_TOO_LONG');
  if (etype === 'rate_limit_exceeded' && status === 429 && meta.limit_source === undefined && origin !== 'provider') return out('AI_FREE_LIMIT');

  switch (true) {
    case status === 401: return out('AI_AUTH');
    case status === 402: return out('AI_NO_CREDIT');
    case status === 403 && /agentic harness/i.test(step + ' ' + msg): return out('AI_MODEL_GATED');
    case status === 403: return out('AI_FLAGGED');
    case status === 404 && (step === 'Filter by Data Policy' || /data policy/i.test(msg)): return out('AI_PRIVACY_BLOCKS');
    case status === 404 && step === 'Filter by Parameters': return out('AI_UNSUPPORTED');
    case status === 404: return out('AI_MODEL_UNKNOWN');
    case status === 400 && /not a valid model id/i.test(msg): return out('AI_MODEL_UNKNOWN');
    case status === 400 && /maximum context length|context length|too many tokens/i.test(msg): return out('AI_TOO_LONG');
    case status === 400 || status === 422: return out('AI_BAD_REQUEST');
    case status === 408 || status === 504: return out('AI_TIMEOUT');
    case status === 429 && (meta.limit_source !== undefined || origin === 'provider'): return out('AI_BUSY');
    case status === 429: return out('AI_FREE_LIMIT');
    case status === 503: return out('AI_UNAVAILABLE');
    case status >= 500: return out('AI_UPSTREAM');
    default: return out('AI_UPSTREAM');
  }
}

/** A 2xx stream that carried a top-level `error` (mid-stream failure, openrouter-lab §2). */
export function classifyStreamError(err: { code: string | number | null; message: string }): Classified {
  const c = String(err.code ?? '');
  if (c === 'rate_limit_exceeded' || c === '429' || /rate.?limit/i.test(err.message)) {
    return { code: 'AI_BUSY', message: err.message.slice(0, 300), data: {} };
  }
  return { code: 'AI_UPSTREAM', message: err.message.slice(0, 300), data: {} };
}

/** Codes the retry policy may retry (openrouter-lab §11.5 rule 2). */
export const TRANSIENT: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['AI_BUSY', 'AI_UPSTREAM', 'AI_TIMEOUT', 'AI_UNAVAILABLE', 'AI_OFFLINE']);
