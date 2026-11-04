import { describe, expect, it } from 'vitest';
import { paragraphUnits } from '../search/passageIndex';
import { buildUnits, headingAt, paragraphSpans, unitAt } from './units';

describe('buildUnits', () => {
  it('splits paragraphs exactly like PassageIndex.paragraphUnits (identical ranking)', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Frase ${i} sobre o contrato.`).join(' ');
    const text = `Primeiro.\n\n${long}\nÚltimo?`;
    expect(paragraphSpans(text)).toEqual(paragraphUnits(text).map((u) => ({ start: u.start, end: u.end })));
  });

  it('gives slides, pages (with labels), headings or text locators', () => {
    expect(buildUnits({ kind: 'pptx', text: 'Título\nA\n\nB', slideStarts: [0, 10] }, 'x/1').map((u) => u.locator))
      .toEqual([{ type: 'slide', slide: 1 }, { type: 'slide', slide: 1 }, { type: 'slide', slide: 2 }]);
    expect(buildUnits({ kind: 'pdf', text: 'Um\n\nDois', pageStarts: [0, 4], pageLabels: [null, 'ii'] }, 'x/1').map((u) => u.locator))
      .toEqual([{ type: 'page', page: 1 }, { type: 'page', page: 2, pageLabel: 'ii' }]);
    const md = 'Intro\nTítulo\nA\nB\nSub\nC';
    const headings = [{ start: 6, level: 1, text: 'Título' }, { start: 17, level: 2, text: 'Sub' }];
    expect(buildUnits({ kind: 'md', text: md, headings }, 'x/1').map((u) => u.locator)).toEqual([
      { type: 'text', start: 0, end: 5, extractor: 'x/1' },
      { type: 'heading', path: ['Título'], paragraph: 1 }, { type: 'heading', path: ['Título'], paragraph: 2 }, { type: 'heading', path: ['Título'], paragraph: 3 },
      { type: 'heading', path: ['Título', 'Sub'], paragraph: 1 }, { type: 'heading', path: ['Título', 'Sub'], paragraph: 2 },
    ]);
    expect(headingAt(headings, 3)).toBeNull();
    // A law typed as plain text still gets article units (no pages).
    expect(buildUnits({ kind: 'txt', text: 'Artigo 1.º A\nArtigo 2.º B' }, 'x/1').map((u) => u.locator))
      .toEqual([{ type: 'article', article: '1.º', pages: null }, { type: 'article', article: '2.º', pages: null }]);
    const units = buildUnits({ kind: 'txt', text: 'a\nb' }, 'x/1');
    expect(unitAt(units, 2)).toBe(units[1]);
  });
});
