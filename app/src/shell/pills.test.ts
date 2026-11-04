import { describe, expect, it } from 'vitest';
import { EMPTY_SYNC_STATE } from '../services/sync';
import type { ClassView } from '../services/types/viewModels';
import type { SyncStatus } from '../platform/types';
import { aiPillState, modelLabelOf, modelShort, syncPillState } from './pills';

const cls = (p: Partial<ClassView>): ClassView => ({
  id: 'c', name: 'C', shortName: 'C', color: '#12a594', icon: 'scale', lecturer: null, term: null, language: 'en', vocabulary: '',
  shared: true, archived: false, path: '/x', sync: { kind: 'upToDate' }, onlineMembers: 0, memberCount: 1, unread: 0, mentions: 0,
  recordingBy: null, nextExams: [], pins: [], notify: 'important', askBeforeJoin: false, skipAudio: false, organisers: [], newerFormat: false, ...p,
});
const status = (p: Partial<SyncStatus>): SyncStatus => ({
  state: 'running', deviceId: null, version: null, syncPort: null, localOnly: false, paused: false, startedAt: null, restarts: 0, error: null, ...p,
});

describe('syncPillState (UX §2.4, first match wins)', () => {
  it('is local when no class is shared', () => {
    expect(syncPillState(EMPTY_SYNC_STATE, [cls({ shared: false })], true)).toEqual({ id: 'local' });
    expect(syncPillState(EMPTY_SYNC_STATE, [], true)).toEqual({ id: 'local' });
  });
  it('orders starting, error, paused, attention, offline, syncing, waiting, up to date', () => {
    const s = (p: Partial<SyncStatus>) => ({ ...EMPTY_SYNC_STATE, status: status(p) });
    expect(syncPillState(s({ state: 'starting', paused: true }), [cls({})], true).id).toBe('starting');
    expect(syncPillState(s({ error: 'SYNC_PORT', paused: true }), [cls({})], true).id).toBe('error');
    expect(syncPillState(s({ paused: true }), [cls({})], false).id).toBe('paused');
    expect(syncPillState({ ...s({}), massDelete: [{ classId: 'c', count: 3, sample: [] }] }, [cls({})], false)).toEqual({ id: 'attention', n: 1 });
    expect(syncPillState(s({}), [cls({ sync: { kind: 'syncing', files: 3, bytesLeft: null } })], false).id).toBe('offline');
    expect(syncPillState(s({}), [cls({ sync: { kind: 'syncing', files: 3, bytesLeft: null } }), cls({ sync: { kind: 'syncing', files: 2, bytesLeft: 1 } })], true)).toEqual({ id: 'syncing', n: 5 });
    expect(syncPillState(s({}), [cls({ sync: { kind: 'syncing', files: null, bytesLeft: null } })], true)).toEqual({ id: 'syncing', n: null });
    expect(syncPillState(s({}), [cls({})], true).id).toBe('waiting');
    expect(syncPillState(s({}), [cls({ onlineMembers: 2 })], true)).toEqual({ id: 'upToDate', n: 2 });
  });
  it('counts distinct classmates over every shared class, and conflicts as attention', () => {
    const s = { ...EMPTY_SYNC_STATE, status: status({}) };
    // Bruno online in law, Jamie in bio: "2 online", not the largest class's 1.
    expect(syncPillState(s, [cls({ id: 'law', onlineMembers: 1 }), cls({ id: 'bio', onlineMembers: 1 })], true, { online: 2, conflicts: 0 })).toEqual({ id: 'upToDate', n: 2 });
    expect(syncPillState(s, [cls({ onlineMembers: 1 })], true, { online: 1, conflicts: 1 })).toEqual({ id: 'attention', n: 1 });
  });
});

describe('aiPillState (UX §2.5)', () => {
  const base = {
    key: { set: true, last4: null, store: 'memory' as const }, privacy: 'no-training' as const, model: 'google/gemma-4-31b-it:free', fallbacks: [], chain: [],
    customHost: null, answerLanguage: 'question' as const, quota: null, catalogAge: null, lastAnswerModel: null, enabled: true,
  };
  it('derives the label', () => {
    expect(modelLabelOf('google/gemma-4-31b-it:free')).toBe('Gemma 4 31B');
    expect(modelShort('Gemma 4 31B (free)')).toBe('Gemma 4 31B');
    expect(modelShort('A very long model name indeed').length).toBeLessThanOrEqual(15);
    expect(modelShort('Nemotron 3.5 Super (free)')).toBe('Nemotron 3.5…');
    expect(modelShort('Supercalifragilisticexpialidocious')).toBe('Supercalifragi…');
  });
  it('picks the state', () => {
    expect(aiPillState({ ...base, enabled: false }).id).toBe('off');
    expect(aiPillState({ ...base, key: { ...base.key, set: false } }).id).toBe('off');
    expect(aiPillState({ ...base, customHost: { id: 'h', base: 'http://localhost:11434', label: 'Ollama' } }).id).toBe('local');
    expect(aiPillState(base, 'AI_AUTH').id).toBe('checkKey');
    expect(aiPillState(base)).toEqual({ id: 'modelOnly', model: 'Gemma 4 31B' });
    expect(aiPillState({ ...base, quota: { remaining: 38, limit: 50, used: 12, resetsAt: '', isFreeTier: true, creditLeft: null } })).toEqual({ id: 'model', model: 'Gemma 4 31B', n: 38 });
  });
});
