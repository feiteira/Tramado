import { describe, expect, it } from 'vitest';
import { createAiClient } from './client';
import { bodyOf, createScriptedTransport, type FakeReply } from './fake';
import { createTestClock } from './clock.testutil';
import { citationsFor, parseCitations } from './citations';
import { runToolLoop, type ToolHost } from './toolLoop';
import { RefTable, quoteOf, type PassageLike } from './tools';
import { PACKS } from './prompts';
import type { PipeRequest } from './types';

const P = (id: string, label: string, text: string): PassageLike => ({
  id, label, text, source: { kind: 'document', path: 'Documentos/LF.pdf', sha256: 'b'.repeat(64) }, locator: { type: 'article', article: id, pages: [9, 9] },
});
const CORPUS = [
  P('art37', 'LF · p. 9 · art. 37.º', 'Artigo 37.º (Liberdade de expressão) 1. Todos têm o direito de exprimir e divulgar livremente o seu pensamento.'),
  P('art13', 'LF · p. 4 · art. 13.º', 'Artigo 13.º (Igualdade) 2. Ninguém pode ser privilegiado ou prejudicado em razão das convicções políticas.'),
  P('art18', 'LF · p. 6 · art. 18.º', 'Artigo 18.º (Força jurídica) 3. As leis restritivas não podem diminuir o conteúdo essencial.'),
];
function host(): ToolHost & { searches: string[] } {
  const searches: string[] = [];
  return {
    searches,
    async search(q) {
      searches.push(q);
      return q.includes('igualdade') ? [CORPUS[1]!] : [CORPUS[0]!, CORPUS[2]!];
    },
    async read(id) {
      const p = CORPUS.find((x) => x.id === id);
      return p ? { ...p, hasMore: false } : null;
    },
  };
}
const settings = () => ({ level: 'no-training' as const, model: 'google/gemma-4-31b-it:free', fallbacks: [], customHost: null, busyRelax: false });
const sys = [{ role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: 'Pergunta 2: panfletos?' }];
const toolsMsgs = (req: PipeRequest) => (bodyOf(req).messages ?? []).filter((m) => m.role === 'tool').map((m) => JSON.parse(String(m.content)));

describe('tool loop (openrouter-lab §4, §11.7)', () => {
  it('runs parallel calls, dedupes searches, pins the model and answers with valid refs', async () => {
    const clock = createTestClock();
    const script: FakeReply[] = [
      { kind: 'tools', model: 'nvidia/nemotron-3.5-super-vl:free', calls: [{ name: 'search_materials', args: { query: 'liberdade de expressão panfletos', limit: 6 } }, { name: 'search_materials', args: { query: 'igualdade partidos' } }] },
      { kind: 'tools', model: 'nvidia/nemotron-3.5-super-vl:free', calls: [{ name: 'search_materials', args: { query: '  Liberdade de EXPRESSÃO panfletos ' } }, { name: 'read_passage', args: { id: 'S1' } }, { name: 'read_passage', args: { id: 'nope' } }] },
      { kind: 'text', model: 'nvidia/nemotron-3.5-super-vl:free', text: 'A medida viola o art. 37.º [S1] e a igualdade [S3], sem respeitar o conteúdo essencial [S2, n.º 3]. Também [S9].' },
    ];
    const t = createScriptedTransport(script);
    const client = createAiClient({ transport: t, clock, rand: () => 0.5, settings });
    const h = host();
    const r = await runToolLoop({ client, messages: sys, host: h, lang: 'pt', activity: { classId: 'c', action: 'deep', passages: 0 } });
    expect(r.turns).toBe(3);
    expect(r.calls).toBe(5);
    expect(h.searches).toHaveLength(2);                      // the third search was answered from cache
    expect(toolsMsgs(t.requests[2]!).some((m) => m.note?.startsWith('already searched'))).toBe(true);
    expect(toolsMsgs(t.requests[2]!).some((m) => String(m.error ?? '').startsWith('unknown id'))).toBe(true);
    expect(bodyOf(t.requests[1]!).model).toBe('nvidia/nemotron-3.5-super-vl:free');   // pinned after turn 0
    expect(bodyOf(t.requests[0]!).tools).toHaveLength(2);
    expect(r.model).toBe('nvidia/nemotron-3.5-super-vl:free');
    expect(r.requestedModel).toBe('google/gemma-4-31b-it:free');
    const p = parseCitations(r.content, r.refs.refs());
    expect(p.hallucinated).toEqual(['S9']);
    const cs = citationsFor(r.content, r.refs.table());
    expect(cs.map((c) => c.label)).toEqual(['LF · p. 9 · art. 37.º', 'LF · p. 4 · art. 13.º', 'LF · p. 6 · art. 18.º']);
    expect(cs[2]!.pin).toBe('n.º 3');
  });

  it('forces the final turn with tool_choice none and the nudge, keeping tools in the request', async () => {
    const clock = createTestClock();
    let n = 0;
    const t = createScriptedTransport((req): FakeReply => {
      n++;
      if (bodyOf(req).tool_choice === 'none') return { kind: 'text', text: 'Resposta final [S1].' };
      return { kind: 'tools', calls: [{ name: 'search_materials', args: { query: `consulta ${n}` } }] };
    });
    const client = createAiClient({ transport: t, clock, rand: () => 0.5, settings });
    const r = await runToolLoop({ client, messages: sys, host: host(), lang: 'pt', activity: { classId: 'c', action: 'deep', passages: 0 } });
    expect(r.turns).toBe(8);
    const last = bodyOf(t.requests.at(-1)!);
    expect(last.tool_choice).toBe('none');
    expect(last.tools).toHaveLength(2);
    expect(last.messages!.at(-1)).toEqual({ role: 'user', content: PACKS.pt.nudge });
    expect(r.content).toBe('Resposta final [S1].');
  });

  it('stops after 16 tool calls even before 8 turns', async () => {
    const clock = createTestClock();
    let n = 0;
    const t = createScriptedTransport((req): FakeReply => {
      if (bodyOf(req).tool_choice === 'none') return { kind: 'text', text: 'Feito [S1].' };
      n++;
      return { kind: 'tools', calls: Array.from({ length: 6 }, (_, i) => ({ name: 'search_materials', args: { query: `q${n}-${i}` } })) };
    });
    const r = await runToolLoop({ client: createAiClient({ transport: t, clock, rand: () => 0.5, settings }), messages: sys, host: host(), lang: 'en', activity: { classId: 'c', action: 'deep', passages: 0 } });
    expect(r.calls).toBe(18);
    expect(r.turns).toBe(4);
    expect(bodyOf(t.requests.at(-1)!).messages!.at(-1)).toEqual({ role: 'user', content: PACKS.en.nudge });
  });
});

describe('ref table and quotes', () => {
  it('assigns S# once per passage and builds quotes around the first hit', () => {
    const refs = new RefTable();
    expect(refs.add(CORPUS[0]!)).toBe('S1');
    expect(refs.add(CORPUS[1]!)).toBe('S2');
    expect(refs.add(CORPUS[0]!)).toBe('S1');
    expect(refs.get('art13')?.id).toBe('art13');
    const q = quoteOf({ text: 'Primeira frase longa sobre nada. A lei restritiva não pode diminuir o conteúdo essencial. Fim.', hits: [[45, 55]] });
    expect(q?.exact.startsWith('A lei restritiva')).toBe(true);
    expect(q!.exact.length).toBeLessThanOrEqual(300);
    expect(q!.prefix.length).toBeLessThanOrEqual(32);
  });
});
