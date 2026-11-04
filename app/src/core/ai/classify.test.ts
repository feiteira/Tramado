import { describe, expect, it } from 'vitest';
import { classify, classifyStreamError } from './classify';
import { ERROR_REPLIES, type FakeReply } from './fake';
import { savedCall } from './fixtures.testutil';

const of = (r: FakeReply) => {
  if (r.kind !== 'error') throw new Error('not an error reply');
  return classify(r.status, r.headers, r.body);
};
const saved = (name: string) => {
  const c = savedCall(name);
  return classify(c.response.status, c.response.headers, c.response.json);
};

describe('classify (openrouter-lab §8, critique §8 AI codes)', () => {
  it('401 wrong key → AI_AUTH (saved t8_401_bad_key)', () => expect(saved('t8_401_bad_key').code).toBe('AI_AUTH'));
  it('400 unknown model id → AI_MODEL_UNKNOWN with the id (saved t8_404_no_model)', () => {
    const c = saved('t8_404_no_model');
    expect(c.code).toBe('AI_MODEL_UNKNOWN');
    expect(c.data.model).toBe('google/does-not-exist:free');
  });
  it('400 malformed body → AI_BAD_REQUEST (saved t8_400_bad_body)', () => expect(saved('t8_400_bad_body').code).toBe('AI_BAD_REQUEST'));
  it('400 context too long → AI_TOO_LONG (saved t8_400_context)', () => expect(saved('t8_400_context').code).toBe('AI_TOO_LONG'));
  it('402 → AI_NO_CREDIT', () => expect(of(ERROR_REPLIES.noCredit()).code).toBe('AI_NO_CREDIT'));
  it('403 agentic harness → AI_MODEL_GATED', () => expect(of(ERROR_REPLIES.gated()).code).toBe('AI_MODEL_GATED'));
  it('403 moderation → AI_FLAGGED', () => expect(of(ERROR_REPLIES.flagged()).code).toBe('AI_FLAGGED'));
  it('404 Filter by Parameters → AI_UNSUPPORTED (saved t5_ultra_require_params)', () => expect(saved('t5_ultra_require_params').code).toBe('AI_UNSUPPORTED'));
  it('404 data policy → AI_PRIVACY_BLOCKS (saved t9_super_deny, t9_gemma31_zdr)', () => {
    expect(saved('t9_super_deny').code).toBe('AI_PRIVACY_BLOCKS');
    expect(saved('t9_gemma31_zdr').code).toBe('AI_PRIVACY_BLOCKS');
  });
  it('404 otherwise → AI_MODEL_UNKNOWN', () => expect(classify(404, {}, { error: { message: 'Model not found', code: 404 } }).code).toBe('AI_MODEL_UNKNOWN'));
  it('429 upstream shared pool → AI_BUSY, never exposing metadata.raw (saved t8_429_gemma_single)', () => {
    const c = saved('t8_429_gemma_single');
    expect(c.code).toBe('AI_BUSY');
    expect(c.data.origin).toBe('provider');
    expect(c.data.provider).toBe('Google AI Studio');
    expect(JSON.stringify(c)).not.toMatch(/rate-limited upstream|user_/);
  });
  it('429 chain + deny (saved t9_fallback_deny) → AI_BUSY', () => expect(saved('t9_fallback_deny').code).toBe('AI_BUSY'));
  it('429 platform free limit → AI_FREE_LIMIT with resetAt and remaining', () => {
    const c = of(ERROR_REPLIES.freeLimit(1_793_808_000_000));
    expect(c.code).toBe('AI_FREE_LIMIT');
    expect(c.data).toMatchObject({ resetAt: 1_793_808_000_000, remaining: 0 });
  });
  it('502 upstream → AI_UPSTREAM', () => expect(of(ERROR_REPLIES.upstream()).code).toBe('AI_UPSTREAM'));
  it('503 → AI_UNAVAILABLE with retryAfterMs', () => {
    const c = of(ERROR_REPLIES.unavailable(3));
    expect(c.code).toBe('AI_UNAVAILABLE');
    expect(c.data.retryAfterMs).toBe(3000);
  });
  it('408 / 504 → AI_TIMEOUT', () => {
    expect(classify(408, {}, null).code).toBe('AI_TIMEOUT');
    expect(classify(504, {}, null).code).toBe('AI_TIMEOUT');
  });
  it('a 422 → AI_BAD_REQUEST; a 500 without a body → AI_UPSTREAM', () => {
    expect(classify(422, {}, null).code).toBe('AI_BAD_REQUEST');
    expect(classify(500, {}, 'oops').code).toBe('AI_UPSTREAM');
  });
  it('prefers metadata.error_type when present', () => {
    expect(classify(400, {}, { error: { message: 'x', metadata: { error_type: 'context_length_exceeded' } } }).code).toBe('AI_TOO_LONG');
    expect(classify(403, {}, { error: { message: 'x', metadata: { error_type: 'authentication' } } }).code).toBe('AI_AUTH');
  });
  it('header names are case-insensitive', () => {
    expect(classify(429, { 'X-OpenRouter-Error-Origin': 'provider' }, { error: { message: 'Provider returned error' } }).code).toBe('AI_BUSY');
  });
  it('mid-stream errors: rate limits → AI_BUSY, others → AI_UPSTREAM', () => {
    expect(classifyStreamError({ code: 'rate_limit_exceeded', message: 'Rate limit exceeded' }).code).toBe('AI_BUSY');
    expect(classifyStreamError({ code: 'server_error', message: 'Provider disconnected unexpectedly' }).code).toBe('AI_UPSTREAM');
  });
});
