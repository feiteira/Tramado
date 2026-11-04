import { describe, expect, it } from 'vitest';
import { runningKey, stripRunningLines } from './headers';

describe('stripRunningLines (≥ 50 % rule)', () => {
  const header = (n: number) => `Diário da República, 1.ª série — N.º ${100 + n} — página ${n}`;
  it('drops a header and a page-number footer present on at least half of the pages, digits ignored', () => {
    const pages = [1, 2, 3, 4].map((n) => [header(n), `Corpo da página ${n} com texto próprio.`, `- ${n} -`]);
    const r = stripRunningLines(pages);
    expect(r.pages).toEqual([1, 2, 3, 4].map((n) => [`Corpo da página ${n} com texto próprio.`]));
    expect(r.removed).toBe(8);
    expect(r.keys).toContain(runningKey(header(1)));
  });

  it('needs at least half the pages: a line on 1 of 4 pages stays', () => {
    const pages = [['Título único', 'Primeiro parágrafo.'], ['Segundo parágrafo.', 'Fim da segunda.'], ['Terceira página.', 'Mais texto aqui.'], ['Quarta página.', 'Conclusão.']];
    expect(stripRunningLines(pages).pages).toEqual(pages);
  });

  it('keeps short documents, article headings and the last line of a page', () => {
    expect(stripRunningLines([['Cabeçalho', 'a'], ['Cabeçalho', 'b']]).removed).toBe(0);
    const law = [['Artigo 1.º', 'O objeto da lei.'], ['Artigo 2.º', 'As restrições.'], ['Artigo 3.º', 'A época de recurso.']];
    expect(stripRunningLines(law).pages).toEqual(law);
    const lonely = [['Cabeçalho'], ['Cabeçalho', 'b'], ['Cabeçalho', 'c'], ['Cabeçalho', 'd']];
    expect(stripRunningLines(lonely).pages).toEqual([['Cabeçalho'], ['b'], ['c'], ['d']]);
  });

  it('compares lines with their numbers ignored: lines that differ only in numbers count as one (page counters)', () => {
    const pages = [1, 2, 3].map((n) => [`Corpo ${String.fromCharCode(64 + n)}.`, `Página ${n} de 3`]);
    expect(stripRunningLines(pages).pages).toEqual([['Corpo A.'], ['Corpo B.'], ['Corpo C.']]);
  });

  it('strips two levels (a header line and a date line) and roman page numbers', () => {
    const pages = ['i', 'ii', 'iii', 'iv'].map((r, k) => ['Código de Exemplo', `Atualizado em 2026-0${k + 1}-01`, `Texto ${k}`, r]);
    expect(stripRunningLines(pages).pages).toEqual([0, 1, 2, 3].map((k) => [`Texto ${k}`]));
  });
});
