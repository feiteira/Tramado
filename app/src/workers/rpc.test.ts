// The worker protocol (architecture §11.7) over a real MessageChannel: the same engine answers through
// rpc.ts as inline, progress events arrive, errors keep their code.
import { describe, expect, it } from 'vitest';
import { createIndexEngine, parsePassageId, sourceOfKey } from './engine';
import { createRpcClient, serveRpc } from './rpc';

function channel() {
  const { port1, port2 } = new MessageChannel();
  const wrap = (p: MessagePort) => ({
    postMessage: (m: unknown, t?: Transferable[]) => p.postMessage(m, t ?? []),
    addEventListener: (type: 'message', l: (e: MessageEvent) => void) => {
      p.addEventListener(type, l as EventListener);
      p.start();
    },
  });
  return { a: wrap(port1), b: wrap(port2), close: () => { port1.close(); port2.close(); } };
}

describe('rpc + engine', () => {
  it('answers IndexHost calls through the channel exactly like the inline engine', async () => {
    const ch = channel();
    const engine = createIndexEngine();
    serveRpc(ch.a, Object.fromEntries((['load', 'upsert', 'remove', 'query', 'passage', 'find', 'stats'] as const).map((k) => [k, (args: unknown[]) => (engine[k] as (...a: unknown[]) => unknown)(...args)])));
    const rpc = createRpcClient(ch.b);
    const text = 'Artigo 1.º Objeto da lei.\nArtigo 2.º As leis restritivas nunca podem atingir o conteúdo essencial.';
    await rpc.call('load', ['c1', [{ key: 'document:Documentos/Lei.pdf', text, units: [
      { start: 0, end: 25, locator: { type: 'article', article: '1.º', pages: [1, 1] } },
      { start: 26, end: text.length, locator: { type: 'article', article: '2.º', pages: [1, 2] } },
    ] }]]);
    const ps = await rpc.call<Array<{ id: string; locator: unknown; source: unknown; hits: Array<[number, number]>; text: string }>>('query', ['c1', 'conteúdo essencial', {}]);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ locator: { type: 'article', article: '2.º', pages: [1, 2] }, source: { kind: 'document', path: 'Documentos/Lei.pdf' } });
    expect(ps[0]!.text.slice(...ps[0]!.hits[0]!)).toBe('conteúdo');
    expect(parsePassageId(ps[0]!.id)).toEqual({ key: 'document:Documentos/Lei.pdf', start: 26, end: text.length });
    expect(await rpc.call('stats', ['c1'])).toEqual({ docs: 1, chars: text.length });
    expect(await rpc.call('find', ['c1', 'leis restritivas', {}])).toEqual([expect.objectContaining({ classId: 'c1', key: 'document:Documentos/Lei.pdf', match: 'leis' }), expect.objectContaining({ match: 'restritivas' })]);
    await expect(rpc.call('nope', [])).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    ch.close();
  });

  it('reports progress and maps errors to platform codes', async () => {
    const ch = channel();
    serveRpc(ch.a, {
      async work(_args, progress) {
        progress(0.5);
        progress(1);
        return 'done';
      },
      fail() {
        throw Object.assign(new Error('x'), { code: 'CANCELLED' });
      },
    });
    const rpc = createRpcClient(ch.b);
    const seen: number[] = [];
    expect(await rpc.call('work', [], { onProgress: (p) => seen.push(p) })).toBe('done');
    expect(seen).toEqual([0.5, 1]);
    await expect(rpc.call('fail', [])).rejects.toMatchObject({ code: 'CANCELLED' });
    ch.close();
  });

  it('derives sources from keys', () => {
    expect(sourceOfKey('lecture:01JBX4Q7Z5W8M2E3C9R6T0YH2K')).toEqual({ kind: 'lecture', lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', audioSha256: null, transcriptRevision: 0 });
    expect(sourceOfKey('private:notes/a.md')).toEqual({ kind: 'note', path: 'notes/a.md', sha256: '' });
    expect(sourceOfKey(JSON.stringify({ kind: 'exam', examId: 'E' }))).toEqual({ kind: 'exam', examId: 'E' });
    expect(sourceOfKey('Documentos/x.pdf')).toEqual({ kind: 'document', path: 'Documentos/x.pdf', sha256: '' });
  });
});
