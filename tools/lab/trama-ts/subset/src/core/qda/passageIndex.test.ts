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
  const docs = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, text: doc(6_000_000 / 60) }));
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
      console.log(`build ${build.toFixed(0)} ms | rankPassages ${ta.toFixed(0)} ms | index.search ${tb.toFixed(1)} ms`);
      expect(b.map((p) => [p.documentId, p.start, p.end, p.score.toFixed(9)])).toEqual(a.map((p) => [p.documentId, p.start, p.end, p.score.toFixed(9)]));
      expect(b.map((p) => p.hits)).toEqual(a.map((p) => p.hits));
    }
  });
});
