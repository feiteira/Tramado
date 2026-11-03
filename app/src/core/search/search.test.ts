import { describe, expect, it } from 'vitest';
import { type SearchQuery, SearchError, contextAround, kwic, parseQuery, searchTexts, validateQuery } from './search';

const docs = [
  {
    id: 'd1',
    text: [
      'Ana: I trust my family doctor, she listens.',
      'Rui: Confidence comes slowly. Gardening helps me; my garden is small.',
      'Ana: Trust, for me, is about family. Not about money.',
    ].join('\n'),
  },
  { id: 'd2', text: 'Inês: A confiança na médica é tudo. Confiança e família.\nRui: O coração manda.' },
];

const words = (query: string, extra: Partial<SearchQuery> = {}) => searchTexts(docs, { query, mode: 'words', ...extra });
const matches = (r: ReturnType<typeof searchTexts>) => r.hits.map((h) => `${h.documentId}:${h.match}`);

describe('parseQuery', () => {
  it('parses implicit AND, OR, NOT, phrases, wildcards and parentheses', () => {
    expect(parseQuery('trust family')).toEqual({ t: 'and', c: [{ t: 'term', text: 'trust', phrase: false }, { t: 'term', text: 'family', phrase: false }] });
    expect(parseQuery('trust family', { anyWord: true }).t).toBe('or');
    expect(parseQuery('a OR b AND c')).toEqual({
      t: 'or',
      c: [{ t: 'term', text: 'a', phrase: false }, { t: 'and', c: [{ t: 'term', text: 'b', phrase: false }, { t: 'term', text: 'c', phrase: false }] }],
    });
    expect(parseQuery('"health  care" -money')).toEqual({
      t: 'and',
      c: [{ t: 'term', text: 'health care', phrase: true }, { t: 'not', c: { t: 'term', text: 'money', phrase: false } }],
    });
    expect(parseQuery('(trust OR faith) AND doctor')).toEqual({
      t: 'and',
      c: [{ t: 'or', c: [{ t: 'term', text: 'trust', phrase: false }, { t: 'term', text: 'faith', phrase: false }] }, { t: 'term', text: 'doctor', phrase: false }],
    });
    expect(parseQuery('garden*')).toEqual({ t: 'term', text: 'garden*', phrase: false });
    // Lower-case operators are words; punctuation around words is dropped; a hyphen inside a word is kept.
    expect(parseQuery('trust or, well-being!')).toEqual({
      t: 'and',
      c: [{ t: 'term', text: 'trust', phrase: false }, { t: 'term', text: 'or', phrase: false }, { t: 'term', text: 'well-being', phrase: false }],
    });
    expect(parseQuery('“smart quotes”')).toEqual({ t: 'term', text: 'smart quotes', phrase: true });
  });

  it('flattens nested ANDs and ORs', () => {
    expect(parseQuery('a AND (b AND c)')).toEqual({ t: 'and', c: ['a', 'b', 'c'].map((text) => ({ t: 'term', text, phrase: false })) });
  });

  it('tolerates a missing closing parenthesis and an unclosed quote', () => {
    expect(parseQuery('(a OR b')).toEqual({ t: 'or', c: [{ t: 'term', text: 'a', phrase: false }, { t: 'term', text: 'b', phrase: false }] });
    expect(parseQuery('"half typed')).toEqual({ t: 'term', text: 'half typed', phrase: true });
  });

  it('rejects empty, malformed and negative-only queries with typed errors', () => {
    const code = (q: string) => {
      try {
        parseQuery(q);
        return 'ok';
      } catch (e) {
        expect(e).toBeInstanceOf(SearchError);
        return (e as SearchError).code;
      }
    };
    expect(code('')).toBe('empty');
    expect(code('   ')).toBe('empty');
    expect(code('!!! ,')).toBe('empty');
    expect(code('AND OR')).toBe('empty');
    expect(code('trust AND')).toBe('syntax');
    expect(code('OR trust')).toBe('syntax');
    expect(code('trust)')).toBe('syntax');
    expect(code('()')).toBe('empty');
    expect(code('() trust')).toBe('syntax');
    expect(code('NOT trust')).toBe('negative-only');
    expect(code('-trust -money')).toBe('negative-only');
  });

  it('reports where a syntax error is', () => {
    try {
      parseQuery('trust AND');
    } catch (e) {
      expect((e as SearchError).position).toBe(9);
    }
  });
});

describe('searchTexts: words mode', () => {
  it('finds a word case- and accent-insensitively by default', () => {
    expect(matches(words('trust'))).toEqual(['d1:trust', 'd1:Trust']);
    expect(matches(words('confianca'))).toEqual(['d2:confiança', 'd2:Confiança']);
    expect(matches(words('CORACAO'))).toEqual(['d2:coração']);
  });

  it('honours case and accent sensitivity', () => {
    expect(matches(words('Trust', { caseSensitive: true }))).toEqual(['d1:Trust']);
    expect(matches(words('confianca', { accentSensitive: true }))).toEqual([]);
    expect(matches(words('confiança', { accentSensitive: true }))).toEqual(['d2:confiança', 'd2:Confiança']);
  });

  it('matches substrings unless whole words are asked for', () => {
    expect(matches(words('garden'))).toEqual(['d1:Garden', 'd1:garden']);
    expect(matches(words('garden', { wholeWord: true }))).toEqual(['d1:garden']);
  });

  it('expands wildcards to whole words', () => {
    expect(matches(words('garden*'))).toEqual(['d1:Gardening', 'd1:garden']);
    expect(matches(words('*ing'))).toEqual(['d1:Gardening']);
    expect(matches(words('c*e'))).toEqual(['d1:Confidence']);
    expect(matches(words('co*s'))).toEqual(['d1:comes']);
    expect(searchTexts([{ id: 'x', text: 'kindergarden gardens' }], { query: 'garden*', mode: 'words' }).hits.map((h) => h.match)).toEqual(['gardens']);
  });

  it('applies AND within a paragraph', () => {
    // Line 1 has trust + family; line 3 has Trust + family; line 2 has neither.
    expect(matches(words('trust family'))).toEqual(['d1:trust', 'd1:family', 'd1:Trust', 'd1:family']);
    expect(matches(words('trust AND confidence'))).toEqual([]);
    expect(matches(words('trust OR confidence'))).toEqual(['d1:trust', 'd1:Confidence', 'd1:Trust']);
    expect(matches(words('trust confidence', { anyWord: true }))).toEqual(['d1:trust', 'd1:Confidence', 'd1:Trust']);
  });

  it('applies NOT within a paragraph and does not highlight negated words', () => {
    expect(matches(words('trust NOT money'))).toEqual(['d1:trust']);
    expect(matches(words('trust -doctor'))).toEqual(['d1:Trust']);
    expect(matches(words('family AND NOT (doctor OR money)'))).toEqual([]);
  });

  it('finds quoted phrases across any run of spaces, never across lines', () => {
    expect(matches(words('"family doctor"'))).toEqual(['d1:family doctor']);
    expect(matches(searchTexts([{ id: 'x', text: 'family  doctor' }], { query: '"family doctor"', mode: 'words' }))).toEqual(['x:family  doctor']);
    expect(searchTexts([{ id: 'x', text: 'family\ndoctor' }], { query: '"family doctor"', mode: 'words' }).total).toBe(0);
  });

  it('merges overlapping hits of different terms', () => {
    const r = searchTexts([{ id: 'x', text: 'gardening' }], { query: 'garden OR gardening', mode: 'words', anyWord: true });
    expect(r.hits.map((h) => [h.start, h.end])).toEqual([[0, 9]]);
  });

  it('treats curly and straight apostrophes alike', () => {
    expect(matches(searchTexts([{ id: 'x', text: 'I don’t know' }], { query: "don't", mode: 'words' }))).toEqual(['x:don’t']);
  });

  it('matches words next to apostrophes and hyphens as whole words', () => {
    const t = [{ id: 'x', text: "the children's school; l'ami; self-care" }];
    expect(matches(searchTexts(t, { query: 'children', mode: 'words', wholeWord: true }))).toEqual(['x:children']);
    expect(matches(searchTexts(t, { query: 'ami', mode: 'words', wholeWord: true }))).toEqual(['x:ami']);
    expect(matches(searchTexts(t, { query: 'care', mode: 'words', wholeWord: true }))).toEqual(['x:care']);
  });
});

describe('searchTexts: phrase and regex modes', () => {
  it('searches a literal phrase, special characters included', () => {
    const t = [{ id: 'x', text: 'Cost (approx.) was 3*4 = 12 [sic]. cost (approx.)' }];
    expect(matches(searchTexts(t, { query: '(approx.)', mode: 'phrase' }))).toEqual(['x:(approx.)', 'x:(approx.)']);
    expect(matches(searchTexts(t, { query: '3*4', mode: 'phrase' }))).toEqual(['x:3*4']);
    expect(matches(searchTexts(t, { query: '[sic]', mode: 'phrase' }))).toEqual(['x:[sic]']);
    expect(matches(searchTexts(t, { query: 'cost', mode: 'phrase', caseSensitive: true }))).toEqual(['x:cost']);
  });

  it('runs regular expressions with the sensitivity options', () => {
    const t = [{ id: 'x', text: 'Colour and color; COLOR. Médica, medica' }];
    expect(matches(searchTexts(t, { query: 'colou?r', mode: 'regex' }))).toEqual(['x:Colour', 'x:color', 'x:COLOR']);
    expect(matches(searchTexts(t, { query: 'colou?r', mode: 'regex', caseSensitive: true }))).toEqual(['x:color']);
    expect(matches(searchTexts(t, { query: 'm[eé]dica', mode: 'regex', accentSensitive: true }))).toEqual(['x:Médica', 'x:medica']);
    expect(matches(searchTexts(t, { query: 'medica', mode: 'regex' }))).toEqual(['x:Médica', 'x:medica']);
    expect(matches(searchTexts(t, { query: 'médica', mode: 'regex' }))).toEqual(['x:Médica', 'x:medica']);
    expect(matches(searchTexts(t, { query: 'col', mode: 'regex', wholeWord: true }))).toEqual([]);
    expect(matches(searchTexts(t, { query: '\\p{Lu}+', mode: 'regex', caseSensitive: true, accentSensitive: true }))).toEqual(['x:C', 'x:COLOR', 'x:M']);
  });

  it('accepts patterns written for non-Unicode engines', () => {
    const t = [{ id: 'x', text: 'well-being and well being' }];
    expect(matches(searchTexts(t, { query: 'well\\-being', mode: 'regex' }))).toEqual(['x:well-being']);
    expect(matches(searchTexts(t, { query: 'well\\-be', mode: 'regex', wholeWord: true }))).toEqual([]);
  });

  it('throws a typed error for an invalid regex and validates without throwing', () => {
    expect(() => searchTexts(docs, { query: '(unclosed', mode: 'regex' })).toThrow(SearchError);
    const e = validateQuery({ query: '[a-', mode: 'regex' });
    expect(e?.code).toBe('invalid-regex');
    expect(e?.detail).toMatch(/./);
    expect(validateQuery({ query: 'a+', mode: 'regex' })).toBeNull();
    expect(validateQuery({ query: '', mode: 'phrase' })?.code).toBe('empty');
  });

  it('skips zero-width matches instead of looping', () => {
    const r = searchTexts([{ id: 'x', text: 'baab😀' }], { query: 'a*', mode: 'regex' });
    expect(r.hits.map((h) => h.match)).toEqual(['aa']);
    expect(searchTexts([{ id: 'x', text: 'abc' }], { query: '(?=b)', mode: 'regex' }).total).toBe(0);
  });
});

describe('results', () => {
  it('returns context snapped to word boundaries within the paragraph', () => {
    const text = 'Line before.\n' + 'The first words of a long sentence where the word trust appears in the middle of many other words here.' + '\nAfter.';
    const r = searchTexts([{ id: 'x', text }], { query: 'trust', mode: 'words' }, { context: 20 });
    const h = r.hits[0]!;
    expect(h.match).toBe('trust');
    expect(h.before).toBe('where the word ');
    expect(h.after).toBe(' appears in the');
    expect(text.slice(h.start, h.end)).toBe('trust');
    // No partial words and no text from other paragraphs.
    const all = searchTexts([{ id: 'x', text }], { query: 'line', mode: 'words' }, { context: 200 }).hits[0]!;
    expect(all.after).toBe(' before.');
  });

  it('keeps surrogate pairs whole at context edges', () => {
    const text = '😀😀😀😀 key 😀😀😀😀';
    const c = contextAround(text, 9, 12, 3);
    expect(c.before.includes('\ud83d') && !c.before.startsWith('\ude00')).toBe(true);
    expect(c.after.endsWith('\ud83d')).toBe(false);
  });

  it('caps results and flags truncation, still counting everything', () => {
    const text = 'trust '.repeat(50);
    const r = searchTexts([{ id: 'a', text }, { id: 'b', text }], { query: 'trust', mode: 'words' }, { limit: 30 });
    expect(r.hits.length).toBe(30);
    expect(r.total).toBe(100);
    expect(r.truncated).toBe(true);
    expect(r.perDocument.get('a')).toBe(50);
    expect(r.perDocument.get('b')).toBe(50);
    const all = searchTexts([{ id: 'a', text }], { query: 'trust', mode: 'words' });
    expect(all.truncated).toBe(false);
    expect(all.hits.length).toBe(50);
  });

  it('defaults to 5000 hits', () => {
    const r = searchTexts([{ id: 'a', text: 'x '.repeat(6000) }], { query: 'x', mode: 'words', wholeWord: true });
    expect(r.hits.length).toBe(5000);
    expect(r.total).toBe(6000);
  });

  it('handles empty documents and Unicode offsets', () => {
    expect(searchTexts([{ id: 'e', text: '' }], { query: 'x', mode: 'words' }).total).toBe(0);
    const text = '𝒜 Ελλάδα και ΕΛΛΑΔΑ';
    const r = searchTexts([{ id: 'g', text }], { query: 'ελλαδα', mode: 'words' });
    expect(r.hits.map((h) => text.slice(h.start, h.end))).toEqual(['Ελλάδα', 'ΕΛΛΑΔΑ']);
  });

  it('builds KWIC rows with collapsed whitespace and clipped context', () => {
    const r = searchTexts([{ id: 'x', text: 'one two  three\tfour five TRUST six seven eight nine ten' }], { query: 'trust', mode: 'words' });
    const [row] = kwic(r.hits, 12);
    expect(row).toMatchObject({ documentId: 'x', keyword: 'TRUST', left: 'four five ', right: ' six seven' });
    expect(kwic(r.hits)[0]!.left).toBe('one two three four five ');
  });
});

describe('regex search: paragraph anchors and accent folding that respects syntax', () => {
  const docs = (text: string) => [{ id: 'd', text }];
  const matches = (text: string, query: string, extra: Partial<Parameters<typeof searchTexts>[1]> = {}) =>
    searchTexts(docs(text), { query, mode: 'regex', ...extra }).hits.map((h) => h.match);

  it('^ and $ anchor at every paragraph', () => {
    expect(matches('Interviewer: a\nAna: b\nInterviewer: c', '^Interviewer:')).toHaveLength(2);
    expect(matches('one end\ntwo end\nthree', 'end$')).toHaveLength(2);
  });

  it('folds class members and escapes, never widening a class', () => {
    const text = 'bad soup, Straße';
    expect(matches(text, '[à-ú]').join('')).toBe('aouae');
    expect(matches(text, '[ß]')).toEqual(['ß']);
    expect(matches('a café', 'caf\\u00e9')).toEqual(['café']);
    expect(matches('a café', 'caf\\u{e9}')).toEqual(['café']);
    expect(matches('a café, cafe', 'caf[é]')).toEqual(['café', 'cafe']);
    expect(matches('ação', '[^ç]+')).toEqual(['a', 'ão']);
    // Accent-sensitive patterns are left as written.
    expect(matches(text, '[à-ú]', { accentSensitive: true })).toEqual([]);
    expect(matches('à la', '[à-ú]', { accentSensitive: true })).toEqual(['à']);
  });

  it('a phrase matches typographic hyphens as plain ones', () => {
    expect(searchTexts(docs('our well‐being'), { query: 'well-being', mode: 'phrase' }).total).toBe(1);
  });
});
