import { describe, expect, it } from 'vitest';
import type { Command } from './commands';
import { buildSections, flatRows, nothingFound, pushRecent, pushRecentSearch, type PaletteInput, type ResultGroup } from './paletteModel';

const cmd = (id: string): Command => ({ id, label: id, run: () => undefined });
const item = (id: string) => ({ id, label: id, run: () => undefined });
const group = (id: string, n: number): ResultGroup => ({ provider: 'search', id, label: id, items: Array.from({ length: n }, (_, i) => item(`${id}${i}`)) });
const base: PaletteInput = {
  query: '', commands: [cmd('a'), cmd('b'), cmd('c'), cmd('d'), cmd('e')], groups: [], expanded: new Set(), recent: [], recentSearches: [], ask: true,
  labels: { commands: 'Commands', recent: 'Recent', recentSearches: 'Recent searches' },
};

describe('palette sections (UX §2.9, §3.13)', () => {
  it('shows recent items, recent searches and the commands for an empty query, without the Ask row', () => {
    const s = buildSections({ ...base, recent: [{ key: 'l6', label: 'Aula 6', kind: 'lecture', route: {} }], recentSearches: ['art. 18'] });
    expect(s.map((x) => x.kind)).toEqual(['recent', 'recentSearches', 'commands']);
  });

  it('puts content first, then at most 3 commands, then Ask', () => {
    const s = buildSections({ ...base, query: 'x', groups: [group('lectures', 2), group('documents', 1)] });
    expect(s.map((x) => x.id)).toEqual(['search:lectures', 'search:documents', 'commands', 'ask']);
    expect(s.find((x) => x.id === 'commands')!.rows).toHaveLength(3);
  });

  it('lists every matching command first when no content matched', () => {
    const s = buildSections({ ...base, query: 'x' });
    expect(s.map((x) => x.kind)).toEqual(['commands', 'ask']);
    expect(s[0]!.rows).toHaveLength(5);
  });

  it('caps a group at 5 rows with "Show all", and expands it to 50', () => {
    const g = group('lectures', 70);
    const folded = buildSections({ ...base, query: 'x', groups: [g] });
    expect(folded[0]!.rows).toHaveLength(6);
    expect(folded[0]!.rows[5]).toMatchObject({ type: 'more', n: 70 });
    const open = buildSections({ ...base, query: 'x', groups: [g], expanded: new Set(['search:lectures']) });
    expect(open[0]!.rows).toHaveLength(50);
    expect(flatRows(open).at(-1)?.type).toBe('ask');
  });

  it('uses a provider\'s held-back rows (total, more) and drops the groups the frame draws itself (G2)', () => {
    const all = Array.from({ length: 12 }, (_, i) => item(`d${i}`));
    const held: ResultGroup = { provider: 'search', id: 'documents', kind: 'document', label: 'Documents', items: all.slice(0, 5), total: 12, more: () => all };
    const own = (kind: string): ResultGroup => ({ provider: 'search', id: kind, kind, label: '', items: [item(kind)] });
    const folded = buildSections({ ...base, query: 'x', groups: [held, own('ask'), own('none'), own('recent')] });
    expect(folded.map((x) => x.id)).toEqual(['search:documents', 'commands', 'ask']);
    expect(folded[0]!.rows.at(-1)).toMatchObject({ type: 'more', n: 12 });
    expect(folded[0]!.total).toBe(12);
    const open = buildSections({ ...base, query: 'x', groups: [held], expanded: new Set(['search:documents']) });
    expect(open[0]!.rows.map((r) => r.type)).toEqual(Array(12).fill('result'));
  });

  it('knows when nothing was found', () => {
    expect(nothingFound('zz', buildSections({ ...base, query: 'zz', commands: [] }))).toBe(true);
    expect(nothingFound('', buildSections({ ...base, commands: [] }))).toBe(false);
    expect(nothingFound('a', buildSections({ ...base, query: 'a' }))).toBe(false);
  });

  it('keeps the last 5 searches and the last 8 items, newest first, without duplicates', () => {
    let s: string[] = [];
    for (const q of ['a', 'b', 'c', 'A', 'd', 'e', 'f']) s = pushRecentSearch(s, q);
    expect(s).toEqual(['f', 'e', 'd', 'A', 'c']);
    expect(pushRecentSearch(['x'], '   ')).toEqual(['x']);
    let r: Parameters<typeof pushRecent>[0] = [];
    for (let i = 0; i < 10; i++) r = pushRecent(r, { key: `k${i % 9}`, label: String(i), kind: 'lecture', route: {} });
    expect(r.map((x) => x.key)).toEqual(['k0', 'k8', 'k7', 'k6', 'k5', 'k4', 'k3', 'k2']);
  });
});
