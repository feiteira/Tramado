import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findQuote, fuzzyFind, makeQuote, reanchorSegment } from './anchor';

describe('findQuote', () => {
  const text = 'O conteúdo essencial é o limite. Nunca se pode atingir o conteúdo essencial do direito.';
  it('picks the occurrence whose prefix/suffix agree, then the nearest to the hint', () => {
    const q = makeQuote(text, text.lastIndexOf('conteúdo essencial'), text.lastIndexOf('conteúdo essencial') + 18);
    expect(q).toEqual({ exact: 'conteúdo essencial', prefix: 'limite. Nunca se pode atingir o ', suffix: ' do direito.' });
    expect(findQuote(text, q)).toEqual({ start: text.lastIndexOf('conteúdo essencial'), end: text.lastIndexOf('conteúdo essencial') + 18, how: 'nearest' });
    expect(findQuote(text, { exact: 'conteúdo essencial', prefix: '', suffix: '' }, { hint: 0 })!.start).toBe(text.indexOf('conteúdo essencial'));
    expect(findQuote(text, { exact: 'é o limite', prefix: '', suffix: '' })!.how).toBe('exact');
  });
  it('matches across different spacing, then fuzzily (≤ 25 % of the characters wrong), else null', () => {
    expect(findQuote('nunca  podem\natingir o conteúdo', { exact: 'nunca podem atingir', prefix: '', suffix: '' })).toEqual({ start: 0, end: 20, how: 'spacing' });
    const hit = findQuote(text, { exact: 'Nunca se poderá atingir o conteúdo', prefix: '', suffix: '' })!;
    expect(hit.how).toBe('fuzzy');
    expect(text.slice(hit.start, hit.end)).toMatch(/^Nunca se pode atingir o conteúdo/);
    expect(findQuote(text, { exact: 'texto totalmente diferente aqui', prefix: '', suffix: '' })).toBeNull();
    expect(findQuote(text, { exact: 'Nunca se poderá', prefix: '', suffix: '' }, { fuzzy: false })).toBeNull();
  });
  it('fuzzyFind finds an exact substring with zero errors (property)', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 60 }), fc.string({ minLength: 1, maxLength: 12 }), fc.string({ maxLength: 60 }), (a, p, b) => {
      const hit = fuzzyFind(a + p + b, p, 0);
      expect(hit?.errors).toBe(0);
      expect((a + p + b).slice(hit!.start, hit!.end).toLowerCase()).toBe(p.toLowerCase());
    }), { numRuns: Number(process.env.TRAMADO_PROPERTY_RUNS) || 200 });
  });
});

describe('reanchorSegment (audio-pipeline §5.5)', () => {
  const segs = [
    { id: 's_aaaaa', startMs: 0, endMs: 4000, text: 'Bom dia a todos.' },
    { id: 's_bbbbb', startMs: 4000, endMs: 9000, text: 'Vamos ver o artigo 483.º do Código Civil.', merged: ['s_ccccc'] },
    { id: 's_ddddd', startMs: 9000, endMs: 15000, text: 'A responsabilidade civil depende da culpa.' },
  ];
  const quote = { exact: 'artigo 483.º do Código Civil', prefix: 'Vamos ver o ', suffix: '.' };
  it('exact at the same characters; moved within the segment; through merged redirects', () => {
    expect(reanchorSegment(segs, { type: 'segment', segmentId: 's_bbbbb', startMs: 4000, endMs: 9000, charStart: 12, charEnd: 40 }, quote).status).toBe('exact');
    const moved = reanchorSegment(segs, { type: 'segment', segmentId: 's_bbbbb', startMs: 4000, endMs: 9000, charStart: 2, charEnd: 30 }, quote);
    expect(moved).toMatchObject({ status: 'moved', locator: { segmentId: 's_bbbbb', charStart: 12, charEnd: 40 } });
    const merged = reanchorSegment(segs, { type: 'segment', segmentId: 's_ccccc', startMs: 6000, endMs: 9000, charStart: 0, charEnd: 10 }, quote);
    expect(merged).toMatchObject({ status: 'moved', locator: { segmentId: 's_bbbbb' } });
  });
  it('finds the quote in an overlapping segment, else falls back to the time (approximate)', () => {
    const other = reanchorSegment(segs, { type: 'segment', segmentId: 's_gone1', startMs: 9500, endMs: 12000 }, { exact: 'depende da culpa', prefix: '', suffix: '' });
    expect(other).toMatchObject({ status: 'moved', locator: { segmentId: 's_ddddd' } });
    const lost = reanchorSegment(segs, { type: 'segment', segmentId: 's_gone1', startMs: 10_000, endMs: 12_000 }, { exact: 'algo que já não existe no texto', prefix: '', suffix: '' });
    expect(lost).toEqual({ status: 'approximate', locator: { type: 'segment', segmentId: 's_ddddd', startMs: 10_000, endMs: 12_000 } });
  });
});
