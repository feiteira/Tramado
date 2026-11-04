// The palette's pure search logic (UX §3.13): snippets with marks, rows and their routes, grouping, chat
// matching, recent searches and items.
import { describe, expect, it } from 'vitest';
import {
  chatRows, findHits, groupRows, matchesAll, parseRecentItems, parseRecentSearches, pushRecentItem, pushRecentSearch, rowOf, snippetOf,
  type PassageLike, type RecentItem,
} from './model';

const marked = (s: { text: string; marks: Array<[number, number]> }) => s.marks.map(([a, b]) => s.text.slice(a, b));

describe('snippetOf', () => {
  it('cuts a window around the first hit at word boundaries, with ellipses and the hits re-based', () => {
    const text = `${'palavra '.repeat(30)}as leis restritivas nunca podem atingir o conteúdo essencial do direito restringido ${'fim '.repeat(40)}`;
    const a = text.indexOf('conteúdo essencial');
    const s = snippetOf(text, [[a, a + 'conteúdo essencial'.length]]);
    expect(s.text.startsWith('…')).toBe(true);
    expect(s.text.endsWith('…')).toBe(true);
    expect(s.text.length).toBeLessThanOrEqual(175);
    expect(marked(s)).toEqual(['conteúdo essencial']);
  });

  it('collapses whitespace and keeps short texts whole', () => {
    const s = snippetOf('Bom   dia.\n\nHoje   vamos', [[12, 16]]);
    expect(s.text).toBe('Bom dia. Hoje vamos');
    expect(marked(s)).toEqual(['Hoje']);
  });
});

describe('findHits and matchesAll', () => {
  it('match every word accent- and case-insensitively, with offsets in the original text', () => {
    const text = 'O CONTEÚDO essencial é o limite dos limites.';
    expect(matchesAll(text, 'conteudo essencial')).toBe(true);
    expect(matchesAll(text, 'conteudo proporcional')).toBe(false);
    expect(findHits(text, 'conteudo limite').map(([a, b]) => text.slice(a, b))).toEqual(['CONTEÚDO', 'limite', 'limite']);
  });
});

const doc: PassageLike = {
  id: 'document:Documentos/Lei.pdf#10-200', classId: 'law', source: { kind: 'document', path: 'Documentos/Legislação/Lei.pdf', sha256: 'a'.repeat(64) },
  locator: { type: 'article', article: '18.º', pages: [9, 9] }, label: 'Lei.pdf · art. 18.º', text: 'As leis restritivas nunca podem atingir o conteúdo essencial do direito.',
  score: 3, hits: [[42, 50], [51, 60]], title: 'Lei',
};
const lec: PassageLike = {
  id: 'lecture:L1#0-80', classId: 'law', source: { kind: 'lecture', lectureId: 'L1', audioSha256: null, transcriptRevision: 1 },
  locator: { type: 'segment', segmentId: 's_l6d00', startMs: 2_472_000, endMs: 2_485_000 }, label: 'Aula 6 · 41:12',
  text: 'Isto costuma sair no exame: a lei restritiva nunca pode atingir o conteúdo essencial do direito.', score: 5, hits: [[66, 74]], title: 'Aula 6',
};

describe('rowOf', () => {
  it('opens a document at its page with the hit as the quote', () => {
    const r = rowOf(doc, 'pt')!;
    expect(r).toMatchObject({ kind: 'document', title: 'Lei', classId: 'law' });
    expect(r.route).toEqual({ name: 'document', classId: 'law', relPath: 'Documentos/Legislação/Lei.pdf', sha256: 'a'.repeat(64), page: 9, quote: 'conteúdo essencial' });
    expect(r.locator).toContain('18.º');
  });

  it('opens a lecture at the time and plays on Enter, not on Shift+Enter', () => {
    const r = rowOf(lec, 'pt')!;
    expect(r.locator).toBe('41:12');
    expect(r.route).toMatchObject({ name: 'lecture', lectureId: 'L1', at: 2_472_000, segmentId: 's_l6d00', play: true });
    expect('play' in r.altRoute).toBe(false);
  });

  it('marks private notes and opens exam questions', () => {
    const note = rowOf({ ...doc, id: 'private:notes/a.md#0-5', source: { kind: 'note', path: 'notes/a.md', sha256: 'b'.repeat(64) }, locator: { type: 'whole' }, private: true, title: 'Notas' }, 'en')!;
    expect(note).toMatchObject({ kind: 'note', private: true, route: { name: 'note', relPath: 'notes/a.md', private: true } });
    const exam = rowOf({ ...doc, id: 'exam:E1#0-5', source: { kind: 'exam', examId: 'E1', questionId: 'q_1' }, locator: { type: 'whole' }, title: 'Frequência' }, 'en')!;
    expect(exam.route).toEqual({ name: 'exam', classId: 'law', examId: 'E1', questionId: 'q_1' });
  });
});

describe('groupRows', () => {
  it('orders groups as UX §3.13 and drops duplicate places', () => {
    const rows = [rowOf(doc, 'en')!, rowOf(lec, 'en')!, rowOf({ ...doc, id: 'other' }, 'en')!];
    const g = groupRows(rows);
    expect(g.map((x) => x.kind)).toEqual(['lecture', 'document']);
    expect(g[1]!.rows).toHaveLength(1);
  });
});

describe('chatRows', () => {
  it('finds messages with every word, newest first, skipping deleted and system lines', () => {
    const items = [
      { id: 'd:1', text: 'O conteúdo essencial sai no exame?', kind: 'message', deleted: false, at: '2026-11-02T10:00:00Z', author: { memberName: 'Bruno', self: false } },
      { id: 'd:2', text: 'conteúdo essencial', kind: 'message', deleted: true, at: '2026-11-02T10:01:00Z', author: { memberName: 'Bruno', self: false } },
      { id: 'd:3', text: 'Sobre o conteudo ESSENCIAL: art. 18.º', kind: 'message', deleted: false, at: '2026-11-03T10:00:00Z', author: { memberName: 'Carla', self: false } },
    ];
    const rows = chatRows('law', items, 'conteúdo essencial', (m) => m.author.memberName);
    expect(rows.map((r) => r.id)).toEqual(['chat:law:d:3', 'chat:law:d:1']);
    expect(rows[0]!.route).toEqual({ name: 'class', classId: 'law', tab: 'chat', messageId: 'd:3' });
    expect(marked(rows[0]!.snippet)).toEqual(['conteudo', 'ESSENCIAL']);
  });
});

describe('recent searches and items', () => {
  it('keeps the last 5 searches, newest first, without folded duplicates', () => {
    let list: string[] = [];
    for (const q of ['um', 'dois', 'três', 'Conteúdo', 'cinco', 'seis', 'conteudo']) list = pushRecentSearch(list, q);
    expect(list).toEqual(['conteudo', 'seis', 'cinco', 'três', 'dois']);
    expect(pushRecentSearch(list, 'x')).toEqual(list);
    expect(parseRecentSearches('nope')).toEqual([]);
  });

  it('keeps the last 8 opened items, one per place', () => {
    const base: RecentItem = { kind: 'document', classId: 'law', title: 'Lei', locator: 'p. 9', private: false, route: { name: 'document', classId: 'law', relPath: 'Lei.pdf', page: 9 }, at: 1 };
    let list = pushRecentItem([], base);
    list = pushRecentItem(list, { ...base, route: { name: 'document', classId: 'law', relPath: 'Lei.pdf', page: 12 }, at: 2 });
    expect(list).toHaveLength(1);
    for (let i = 0; i < 10; i++) list = pushRecentItem(list, { ...base, title: `D${i}`, route: { name: 'document', classId: 'law', relPath: `d${i}.pdf` } });
    expect(list).toHaveLength(8);
    expect(parseRecentItems(JSON.stringify(list))).toHaveLength(8);
    expect(parseRecentItems('[{"kind":"bad"}]')).toEqual([]);
  });
});
