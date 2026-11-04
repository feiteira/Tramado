import { describe, expect, it } from 'vitest';
import { citationLabel, clockLabel, labelLang, locatorLabel } from './labels';
import { passageLocator, sameLocator, unitContaining } from './locators';

describe('citation labels', () => {
  it('labels every locator in PT, ES and EN', () => {
    expect(locatorLabel({ type: 'page', page: 9 }, 'pt-PT')).toBe('p. 9');
    expect(locatorLabel({ type: 'page', page: 11, pageLabel: 'ix' }, 'en')).toBe('p. ix');
    expect(locatorLabel({ type: 'article', article: '18.º', pages: [9, 9] }, 'pt')).toBe('art. 18.º (p. 9)');
    expect(locatorLabel({ type: 'article', article: '2.º', pages: [1, 2] }, 'pt')).toBe('art. 2.º (pp. 1–2)');
    expect(locatorLabel({ type: 'article', article: '1902', pages: null }, 'es-ES')).toBe('art. 1902');
    expect(locatorLabel({ type: 'slide', slide: 3 }, 'pt')).toBe('diapositivo 3');
    expect(locatorLabel({ type: 'slide', slide: 3 }, 'es')).toBe('diapositiva 3');
    expect(locatorLabel({ type: 'segment', segmentId: 's_abcde', startMs: 2_472_000, endMs: 2_480_000 }, 'en')).toBe('41:12');
    expect(locatorLabel({ type: 'heading', path: ['Resumo', 'Restrições'], paragraph: 2 }, 'en')).toBe('§ Restrições');
    expect(locatorLabel({ type: 'whole' }, 'en')).toBe('');
    expect(clockLabel(3_725_000)).toBe('1:02:05');
    expect(labelLang('pt-BR')).toBe('pt');
    expect(labelLang('fr')).toBe('en');
  });
  it('joins the title and the place', () => {
    expect(citationLabel({ kind: 'document', path: 'Documentos/Código Civil.pdf', sha256: 'a'.repeat(64) }, { type: 'article', article: '251.º', pages: [52, 52] }, 'pt'))
      .toBe('Código Civil.pdf · art. 251.º (p. 52)');
    expect(citationLabel({ kind: 'lecture', lectureId: 'x', audioSha256: null, transcriptRevision: 1 }, { type: 'segment', segmentId: 's_abcde', startMs: 61_000, endMs: 62_000 }, 'pt', 'Aula 6'))
      .toBe('Aula 6 · 1:01');
  });
});

describe('locators', () => {
  const units = [
    { start: 0, end: 10, locator: { type: 'segment' as const, segmentId: 's_aaaaa', startMs: 0, endMs: 1000 } },
    { start: 11, end: 30, locator: { type: 'text' as const, start: 11, end: 30, extractor: 'x/1' } },
  ];
  it('finds the unit of an offset and narrows the locator to the passage', () => {
    expect(unitContaining(units, 5)).toBe(units[0]);
    expect(unitContaining(units, 10)).toBeNull();
    expect(passageLocator(units[0]!, 0, 10, [{ start: 4, end: 8 }], 'x/1')).toEqual({ type: 'segment', segmentId: 's_aaaaa', startMs: 0, endMs: 1000, charStart: 4, charEnd: 8 });
    expect(passageLocator(units[1]!, 12, 20, [], 'x/1')).toEqual({ type: 'text', start: 12, end: 20, extractor: 'x/1' });
    expect(passageLocator(null, 1, 2, [], 'x/2')).toEqual({ type: 'text', start: 1, end: 2, extractor: 'x/2' });
    expect(sameLocator({ type: 'page', page: 2 }, { type: 'page', page: 2, pageLabel: 'ii' })).toBe(true);
    expect(sameLocator({ type: 'page', page: 2 }, { type: 'slide', slide: 2 })).toBe(false);
  });
});
