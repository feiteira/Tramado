// How long does Trama's rankPassages take on a semester-sized class (it re-tokenises every query)?
import { rankPassages } from './src/core/qda/rank';
import { stopwordsFor } from './src/core/qda/stopwords';

const vocab = ('estudante avaliação época recurso regulamento artigo direito obrigação contrato prazo ' +
  'tribunal sentença recurso apelação prova testemunha processo civil penal administrativo ' +
  'constituição república assembleia governo ministro decreto lei norma princípio igualdade ' +
  'liberdade propriedade família sucessão herança doação compra venda arrendamento renda ' +
  'trabalho trabalhador empregador salário férias despedimento justa causa indemnização').split(' ');
const stop = new Set([...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')]);
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const para = () => Array.from({ length: 40 + Math.floor(rnd() * 80) }, () => (rnd() < 0.45 ? ['o', 'a', 'de', 'que', 'em', 'para'][Math.floor(rnd() * 6)] : vocab[Math.floor(rnd() * vocab.length)])).join(' ') + '.';
const doc = (chars: number) => {
  const ps: string[] = [];
  let n = 0;
  while (n < chars) { const p = para(); ps.push(p); n += p.length + 1; }
  return ps.join('\n');
};
for (const total of [1_000_000, 6_000_000]) {
  const docs = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, text: doc(total / 60) }));
  const q = 'Em que prazo pode o trabalhador impugnar o despedimento sem justa causa e que indemnização recebe?';
  const t0 = performance.now();
  const r = rankPassages(docs, q, { stopwords: stop, limit: 12 });
  const t1 = performance.now();
  rankPassages(docs, 'Quais os princípios da igualdade e liberdade na constituição?', { stopwords: stop, limit: 12 });
  const t2 = performance.now();
  console.log(`${(total / 1e6).toFixed(0)}M chars, ${docs.length} docs: query1 ${(t1 - t0).toFixed(0)} ms, query2 ${(t2 - t1).toFixed(0)} ms, top=${r[0]?.score.toFixed(2)}`);
}
