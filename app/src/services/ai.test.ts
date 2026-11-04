import { describe, expect, it } from 'vitest';
import { createServices } from './index';
import { createTestContext } from './testing/context';
import { createFakeAi, DEMO_CATALOG } from '../platform/memory/ai';
import { localIso, nextUtcMidnight, quotaFromKey, viewCitations, viewLocator } from './ai';
import { AI_DEFAULTS } from '../core/ai/defaults';
import type { Citation } from '../core/model/files';

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
