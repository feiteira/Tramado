// Quote matching for cited passages and highlights (UX §3.7.2): whitespace, case and accents are ignored.
import { describe, expect, it } from 'vitest';
import { contextOf, findQuote, firstWords, normalizeWithMap, pageOfQuote } from './locate';

describe('findQuote', () => {
  const text = 'Artigo 18.º\n3. As leis restritivas devem ser gerais e abstratas, não podem ter efeito retroativo e nunca podem\natingir o conteúdo essencial do direito restringido.';
  it('finds a quote across line breaks, case and accents', () => {
    const hit = findQuote(text, 'nunca podem atingir o CONTEUDO essencial');
    expect(hit).not.toBeNull();
    expect(text.slice(hit!.start, hit!.end)).toBe('nunca podem\natingir o conteúdo essencial');
  });
  it('falls back to the first 8 words when the quote does not match as a whole', () => {
    const hit = findQuote(text, 'As leis restritivas devem ser gerais e abstratas, e mais um texto que não está lá');
    expect(text.slice(hit!.start, hit!.end)).toBe('As leis restritivas devem ser gerais e abstratas,');
  });
  it('returns null when absent', () => {
    expect(findQuote(text, 'estado de exceção declarado')).toBeNull();
  });
  it('maps folded characters back to the source', () => {
    const n = normalizeWithMap('Ação  Já');
    expect(n.text).toBe('acaoja');
    expect(n.map).toEqual([0, 1, 2, 3, 6, 7]);
    expect(firstWords('um dois três quatro cinco seis sete oito nove', 8)).toBe('um dois três quatro cinco seis sete oito');
  });
});

describe('pageOfQuote', () => {
  const pages = ['Página um. Igualdade.', 'Página dois. Força jurídica.', 'Página três. nunca podem atingir o conteúdo essencial.'];
  const starts: number[] = [];
  let text = '';
  for (const p of pages) {
    starts.push(text.length);
    text += `${p}\n\n`;
  }
  it('prefers the page asked for and its neighbours, then the whole document', () => {
    expect(pageOfQuote(text, starts, 'nunca podem atingir', 2)).toBe(3);
    expect(pageOfQuote(text, starts, 'Igualdade', 3)).toBe(1);
    expect(pageOfQuote(text, starts, 'não existe', 1)).toBeNull();
  });
});

describe('contextOf', () => {
  it('gives up to 32 characters around the quote', () => {
    const c = contextOf('Antes do texto citado: o conteúdo essencial do direito, e depois.', 'conteúdo essencial');
    expect(c.prefix).toBe('Antes do texto citado: o ');
    expect(c.suffix).toBe(' do direito, e depois.');
  });
});
