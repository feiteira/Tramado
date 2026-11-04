import { describe, expect, it } from 'vitest';
import { createMemoryPlatform } from '../platform/memory';
import { createPrefsStore, isValidPref, parsePrefs, PREF_DEFAULTS } from './prefs';
import { createIdentityService, parseIdentity } from './identity';

const CLASS = 'tramado-mde5jfv46prdf2fjxvmbjr4242';

describe('prefs', () => {
  it('returns defaults, validates values and persists', async () => {
    const p = createMemoryPlatform();
    const prefs = await createPrefsStore(p);
    expect(prefs.get('ai.model')).toBe('google/gemma-4-31b-it:free');
    expect(prefs.get(`record.${CLASS}`)).toBe('');
    await prefs.set('ui.theme', 'dark');
    await expect(prefs.set('ui.theme', 'purple')).rejects.toMatchObject({ code: 'INVALID' });
    await prefs.set(`notify.class.${CLASS}`, 'all');
    await prefs.set(`record.${CLASS}`, JSON.stringify({ mode: 'room', includeMic: true, share: 'audio+transcript', language: 'pt-PT' }));
    expect(JSON.parse((await p.appFiles.read('prefs.json'))!)).toMatchObject({ 'ui.theme': 'dark', [`notify.class.${CLASS}`]: 'all' });
    expect((await createPrefsStore(p)).get('ui.theme')).toBe('dark');
  });

  it('accepts every default and drops junk when parsing', () => {
    for (const [k, v] of Object.entries(PREF_DEFAULTS)) expect(isValidPref(k, v), k).toBe(true);
    expect(parsePrefs('{"ui.theme":"dark","x":"y","ui.textSize":2}')).toEqual({ 'ui.theme': 'dark' });
    expect(parsePrefs('nope')).toEqual({});
  });

  it('accepts a custom service model name as ai.model, not as a fallback (G2)', () => {
    for (const v of ['qwen3:8b', 'llama3.1:8b-instruct-q4_K_M', 'hf.co/acme/model:Q4', 'google/gemma-4-31b-it:free']) expect(isValidPref('ai.model', v), v).toBe(true);
    for (const v of ['', ' qwen3', 'a b', ':x', 'x'.repeat(121)]) expect(isValidPref('ai.model', v), v).toBe(false);
    expect(isValidPref('ai.fallbacks', '["qwen3:8b"]')).toBe(false);
  });
});

describe('identity', () => {
  it('creates the person key, writes identity.json and updates it', async () => {
    const p = createMemoryPlatform();
    const ids = await createIdentityService(p);
    expect(ids.identity.get()).toBeNull();
    const me = await ids.create({ name: '  Ana   Ribeiro ', deviceName: '' }, 0);
    expect(me).toMatchObject({ name: 'Ana Ribeiro', deviceName: 'Ana Ribeiro', createdAt: '1970-01-01T00:00:00.000Z' });
    expect(parseIdentity(await p.appFiles.read('identity.json'))).toEqual(me);
    await ids.update({ colour: '#12a594', deviceName: "Ana's laptop" });
    expect(ids.identity.get()).toMatchObject({ colour: '#12a594', deviceName: "Ana's laptop" });
    expect(parseIdentity('{"format":"tramado.identity","version":1,"memberId":"aaaaaaaaaaaaaaaaaaaaaaaaaa","name":"x","personPub":"AAAA"}')).toBeNull();
  });
});
