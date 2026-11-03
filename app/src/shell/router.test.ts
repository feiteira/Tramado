import { describe, expect, it } from 'vitest';
import { dropEntries, type Entry, isRouteName, MAX_STEPS, popEntry, pushEntry, replaceTop, type Route, routeId, sameRoute } from './router';

const C = 'tramado-mde5jfv46prdf2fjxvmbjr4242';
const e = (key: number, route: Route): Entry => ({ key, route });
const names = (s: Entry[]) => s.map((x) => x.route.name);

describe('routes', () => {
  it('compares routes whatever their key order and unset or empty fields', () => {
    expect(sameRoute({ name: 'class', classId: C, tab: undefined }, { name: 'class', classId: C })).toBe(true);
    expect(sameRoute({ name: 'ask', query: '' }, { name: 'ask' })).toBe(true);
    expect(sameRoute({ tab: 'chat', name: 'class', classId: C } as Route, { name: 'class', classId: C, tab: 'chat' })).toBe(true);
    expect(sameRoute({ name: 'lecture', classId: C, lectureId: 'l', at: 1 }, { name: 'lecture', classId: C, lectureId: 'l', at: 2 })).toBe(false);
  });

  it('handles Unicode in queries', () => {
    const a: Route = { name: 'ask', query: 'conteúdo essencial 💬' };
    expect(routeId(a)).toContain('conteúdo essencial 💬');
  });

  it('knows its route names', () => {
    expect(isRouteName('today')).toBe(true);
    expect(isRouteName('Today')).toBe(false);
    expect(isRouteName(null)).toBe(false);
  });
});

describe('history', () => {
  it('skips a step to the place already showing', () => {
    const s = [e(0, { name: 'today' }), e(1, { name: 'class', classId: C })];
    expect(pushEntry(s, { name: 'class', classId: C }, 2)).toBe(s);
    expect(names(pushEntry(s, { name: 'settings' }, 2))).toEqual(['today', 'class', 'settings']);
  });

  it(`keeps at most ${MAX_STEPS} steps, dropping the oldest`, () => {
    let s: Entry[] = [e(0, { name: 'today' })];
    for (let i = 1; i <= 200; i++) s = pushEntry(s, { name: 'ask', threadId: String(i) }, i);
    expect(s).toHaveLength(MAX_STEPS);
    expect(s[s.length - 1]!.route).toEqual({ name: 'ask', threadId: '200' });
  });

  it('replaces the current place in place, keeping its key', () => {
    const s = [e(0, { name: 'today' }), e(4, { name: 'settings' })];
    const out = replaceTop(s, { name: 'settings', section: 'ai' }, 9);
    expect(out).toEqual([e(0, { name: 'today' }), e(4, { name: 'settings', section: 'ai' })]);
  });

  it('goes back but never past the first place', () => {
    const s = [e(0, { name: 'today' }), e(1, { name: 'settings' })];
    expect(names(popEntry(s))).toEqual(['today']);
    const one = [e(0, { name: 'today' })];
    expect(popEntry(one)).toBe(one);
  });

  it('drops places that no longer exist and joins what becomes equal', () => {
    const s = [e(0, { name: 'class', classId: C }), e(1, { name: 'lecture', classId: C, lectureId: 'x' }), e(2, { name: 'class', classId: C }), e(3, { name: 'today' })];
    const out = dropEntries(s, (r) => r.name === 'lecture', e(9, { name: 'today' }));
    expect(names(out)).toEqual(['class', 'today']);
    expect(out[0]!.key).toBe(2);
    expect(dropEntries([e(0, { name: 'today' })], () => true, e(9, { name: 'today' }))).toEqual([e(9, { name: 'today' })]);
  });
});
