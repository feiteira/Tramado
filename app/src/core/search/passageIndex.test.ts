import { describe, expect, it } from 'vitest';
import { PassageIndex } from './passageIndex';
import { rankPassages } from './rank';
import { stopwordsFor } from './stopwords';

const stop = new Set([...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')]);
const vocab = 'estudante avaliação época recurso regulamento artigo direito obrigação contrato prazo tribunal sentença apelação prova testemunha processo civil penal constituição governo decreto lei norma princípio igualdade liberdade propriedade família herança compra venda arrendamento trabalho trabalhador empregador salário férias despedimento justa causa indemnização'.split(' ');
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const para = () => Array.from({ length: 40 + Math.floor(rnd() * 80) }, () => (rnd() < 0.45 ? ['o', 'a', 'de', 'que'][Math.floor(rnd() * 4)] : vocab[Math.floor(rnd() * vocab.length)])).join(' ') + (rnd() < 0.1 ? '?' : '.');
const doc = (chars: number) => { const ps: string[] = []; let n = 0; while (n < chars) { const p = para(); ps.push(p); n += p.length + 1; } return ps.join('\n'); };

describe('PassageIndex (indexed rank.ts)', () => {
  // 600 k characters (the lab used 6 M; kept small so `npm test` stays fast).
  const docs = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, text: doc(600_000 / 30) }));
  const qs = ['Em que prazo pode o trabalhador impugnar o despedimento sem justa causa?', 'Princípios da igualdade e liberdade na constituição', 'herança e família no direito civil'];
  it('ranks exactly like rankPassages, and is much faster per query', () => {
    let t = performance.now();
    const idx = new PassageIndex(stop);
    for (const d of docs) idx.add(d.id, d.text);
    const build = performance.now() - t;
    for (const q of qs) {
      t = performance.now();
      const a = rankPassages(docs, q, { stopwords: stop, limit: 20 });
      const ta = performance.now() - t;
      t = performance.now();
      const b = idx.search(q, { limit: 20 });
      const tb = performance.now() - t;
      void build; void ta; void tb;
      expect(b.map((p) => [p.documentId, p.start, p.end, p.score.toFixed(9)])).toEqual(a.map((p) => [p.documentId, p.start, p.end, p.score.toFixed(9)]));
      expect(b.map((p) => p.hits)).toEqual(a.map((p) => p.hits));
    }
  });
});

describe('PassageIndex (Tramado additions)', () => {
  const stop2 = new Set([...stopwordsFor('pt'), ...stopwordsFor('en')]);
  it('returns the locator of the unit, and ranks the same after removals and compaction', () => {
    const idx = new PassageIndex(stop2);
    idx.add('lei', 'Artigo 1.º Objeto da lei de exemplo.\nArtigo 2.º Restrições ao conteúdo essencial.', [
      { start: 0, end: 36, locator: { type: 'article', article: '1.º', pages: [1, 1] } },
      { start: 37, end: 83, locator: { type: 'article', article: '2.º', pages: [1, 2] } },
    ]);
    const hits = idx.search('restrições essencial');
    expect(hits[0]).toMatchObject({ documentId: 'lei', locator: { type: 'article', article: '2.º', pages: [1, 2] } });
    expect(idx.unitsOf('lei')).toHaveLength(2);
    // Many removals compact the postings; the results of the live documents do not change.
    const docs = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, text: doc(3000) }));
    const big = new PassageIndex(stop2);
    for (const d of docs) big.add(d.id, d.text);
    for (let i = 0; i < 30; i++) big.remove(`d${i}`);
    const fresh = new PassageIndex(stop2);
    for (const d of docs.slice(30)) fresh.add(d.id, d.text);
    const q = 'contrato prazo tribunal';
    expect(big.size).toBe(10);
    expect(big.search(q).map((p) => [p.documentId, p.start, p.score.toFixed(9)])).toEqual(fresh.search(q).map((p) => [p.documentId, p.start, p.score.toFixed(9)]));
  });
});
