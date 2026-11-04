import { describe, expect, it } from 'vitest';
import { articleStructure, articleUnits, findArticleHeads, windows } from './articles';

describe('article headings (PT, ES, EN)', () => {
  it('reads PT `Artigo 483.º`, ES `Artículo 1902`, EN `Article 6` and their variants at a paragraph start', () => {
    const text = [
      'Artigo 483.º Princípio geral', 'Aquele que, com dolo ou mera culpa…',
      'Art. 251.º-A Regime especial', 'Texto.',
      'Artículo 1902', 'El que por acción u omisión causa daño a otro…',
      'Artículo 3 bis. Excepciones', 'Texto.',
      'Article 6 Lawfulness of processing', 'Processing shall be lawful only if…',
      'ARTIGO 2º Âmbito', 'Texto.',
      'Nos termos do artigo 483.º do Código Civil, o dano…',   // a mention, not a heading
    ].join('\n');
    expect(findArticleHeads(text).map((h) => h.article)).toEqual(['483.º', '251.º-A', '1902', '3 bis', '6', '2.º']);
  });

  it('needs at least two headings mostly in order (a code, not a mention)', () => {
    expect(articleStructure('Artigo 5.º só uma vez.\nTexto.')).toEqual([]);
    expect(articleStructure('Artigo 9.º A\nArtigo 3.º B\nArtigo 1.º C')).toEqual([]);
    expect(articleStructure('Artigo 1.º A\nArtigo 2.º B\nArtigo 3.º C').map((h) => h.n)).toEqual([1, 2, 3]);
  });

  it('makes one unit per article with its physical page range, text before the first article apart', () => {
    const text = 'Preâmbulo da lei.\n\nArtigo 1.º Objeto\nA lei define…\nArtigo 2.º Restrições\nAs leis restritivas…\n\nA restrição deve limitar-se…';
    const p2 = text.indexOf('\n\nA restrição') + 2;
    const r = articleUnits(text, [0, text.indexOf('Artigo 1.º'), p2])!;
    expect(r.before).toEqual({ start: 0, end: text.indexOf('Artigo 1.º') });
    expect(r.units.map((u) => [text.slice(u.start, u.end).split('\n')[0], u.locator])).toEqual([
      ['Artigo 1.º Objeto', { type: 'article', article: '1.º', pages: [2, 2] }],
      ['Artigo 2.º Restrições', { type: 'article', article: '2.º', pages: [2, 3] }],
    ]);
    expect(articleUnits('Sem artigos.', null)).toBeNull();
  });

  it('windows a long article (~1 500 chars), every window keeping the article locator', () => {
    const body = Array.from({ length: 60 }, (_, i) => `Frase número ${i} do artigo longo sobre restrições.`).join(' ');
    const text = `Artigo 1.º Longo\n${body}\nArtigo 2.º Curto\nFim.`;
    const r = articleUnits(text, null)!;
    const first = r.units.filter((u) => u.locator.article === '1.º');
    expect(first.length).toBeGreaterThan(1);
    expect(first.every((u) => u.end - u.start <= 1500 * 1.25)).toBe(true);
    expect(first.every((u) => u.locator.pages === null)).toBe(true);
    const w = windows(text, 0, text.length, 200);
    expect(w[0]!.start).toBe(0);
    expect(w.every((x, i) => i === 0 || x.start >= w[i - 1]!.end)).toBe(true);
  });
});
