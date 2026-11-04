// The retry, backoff and fallback policy of openrouter-lab §11.5: what to do after a failed attempt.
import type { ErrorCode } from '../errors';
import { TRANSIENT } from './classify';

export const MAX_TRANSIENT_RETRIES = 3;
export const FREE_LIMIT_WAIT_MAX_MS = 90_000;

export type RetryAction =
  | { kind: 'fail' }
  | { kind: 'retry'; delayMs: number }                 // same request after a backoff
  | { kind: 'shrink' }                                  // AI_TOO_LONG: once, after trimming passages/history
  | { kind: 'moreTokens' }                              // AI_LENGTH: once, max_tokens × 2 and effort one step lower
  | { kind: 'dropStrict' };                             // AI_UNSUPPORTED: once, without response_format

export interface RetryState {
  transient: number;      // transient retries done so far
  shrunk: boolean; moreTokens: boolean; droppedStrict: boolean; waitedLimit: boolean;
}
export const freshRetryState = (): RetryState => ({ transient: 0, shrunk: false, moreTokens: false, droppedStrict: false, waitedLimit: false });

/** `min(30 s, 2^n s) ± 30 %` for the n-th retry (1-based): about 2, 4, 8 s. */
export function backoffMs(n: number, rand: () => number): number {
  const base = Math.min(30_000, 1000 * 2 ** n);
  return Math.round(base * (0.7 + 0.6 * rand()));
}

export function decide(
  code: ErrorCode,
  data: { retryAfterMs?: number; resetAt?: number; remaining?: number },
  st: RetryState,
  ctx: { nowMs: number; rand: () => number; maxRetries?: number },
): RetryAction {
  const max = ctx.maxRetries ?? MAX_TRANSIENT_RETRIES;
  if (TRANSIENT.has(code)) {
    if (st.transient >= max) return { kind: 'fail' };
    const n = st.transient + 1;
    const delay = data.retryAfterMs !== undefined ? Math.min(60_000, data.retryAfterMs) : backoffMs(n, ctx.rand);
    return { kind: 'retry', delayMs: delay };
  }
  switch (code) {
    case 'AI_FREE_LIMIT': {
      // Per-minute: wait until the reset when it is near; per-day (or unknown): stop and show the message.
      if (st.waitedLimit || data.resetAt === undefined) return { kind: 'fail' };
      const wait = data.resetAt - ctx.nowMs;
      if (data.remaining === 0 && wait >= 0 && wait < FREE_LIMIT_WAIT_MAX_MS) return { kind: 'retry', delayMs: wait + 250 };
      return { kind: 'fail' };
    }
    case 'AI_TOO_LONG': return st.shrunk ? { kind: 'fail' } : { kind: 'shrink' };
    case 'AI_LENGTH': return st.moreTokens ? { kind: 'fail' } : { kind: 'moreTokens' };
    case 'AI_UNSUPPORTED': return st.droppedStrict ? { kind: 'fail' } : { kind: 'dropStrict' };
    default: return { kind: 'fail' };   // AI_AUTH, AI_MODEL_UNKNOWN, AI_BAD_REQUEST, AI_NO_CREDIT, AI_MODEL_GATED, AI_FLAGGED, AI_PRIVACY_BLOCKS, …
  }
}
