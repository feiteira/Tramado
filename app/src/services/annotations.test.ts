// AnnotationService over the memory platform (architecture §11.2, §13.2, Q5; folder spec §8.17;
// research audio-pipeline §5.5): private comments and highlights, re-anchored when shown.
import { describe, expect, it } from 'vitest';
import { itemIdOf } from '../core/model/derive';
import type { AnnotationServiceImpl } from './annotations';
import { createServices } from './index';
import { createTestContext } from './testing/context';

const enc = (s: string) => new TextEncoder().encode(s);
const NONCE = 'q4m2zx7k3v5hbnw6r2yjc7aefg';
const LAW = 'Artigo 18.º\nAs leis restritivas nunca podem atingir o conteúdo essencial do direito restringido.\n';

async function setup() {
  const t = await createTestContext({ name: 'Ana Ribeiro' });
  const s = createServices(t.ctx);
  const classId = await s.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'en', share: false });
  const cls = s.forClass(classId);
  const ann = cls.annotations as AnnotationServiceImpl;
  const idle = async () => {
    await (cls.store as unknown as { idle(): Promise<void> }).idle();
    await ann.idle();
  };
  const add = async (path: string, text: string) => {
    t.platform.mem.addFile(classId, path, enc(text));
    await idle();
  };
  await idle();
  return { ...t, s, classId, cls, ann, idle, add };
}

describe('AnnotationService', () => {
  it('keeps highlights private (annotations.jsonl), edits and deletes them, refuses shared ones (v1.1)', async () => {
    const env = await setup();
    const { ann, platform, classId } = env;
    await env.add('Documents/lei.txt', LAW);
    const sha = await platform.fs.hash(classId, 'Documents/lei.txt');
    const source = { kind: 'document' as const, path: 'Documents/lei.txt', sha256: sha };
    const at = LAW.indexOf('nunca podem atingir');
    const target = { source, locator: { type: 'text' as const, start: at, end: at + 19, extractor: 'tramado-extract/1' }, quote: { exact: 'nunca podem atingir', prefix: 'As leis restritivas ', suffix: ' o conteúdo' } };
    const view = ann.forSource(source);
    const id = await ann.add({ visibility: 'private', kind: 'highlight', target, colour: 'exam' });
    await env.idle();
    expect(view.get()).toEqual([expect.objectContaining({ id, kind: 'highlight', colour: 'exam', anchor: 'exact', visibility: 'private', author: { memberId: env.ctx.identity.get()!.memberId, name: 'Ana Ribeiro' } })]);
    await ann.edit(id, 'Cai no exame');
    await env.idle();
    expect(view.get()[0]!.body).toBe('Cai no exame');
    // Everything stays in private data; nothing in the class folder.
    const lines = new TextDecoder().decode((await platform.privateFiles.read(classId, 'annotations.jsonl'))!).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(['add', 'edit']);
    expect(lines[0]).toMatchObject({ format: 'tramado.annotation', version: 1, annotationId: id, memberId: env.ctx.identity.get()!.memberId });
    expect([...platform.mem.list(classId).keys()].some((p) => p.includes('annotations'))).toBe(false);
    await expect(ann.add({ visibility: 'class', kind: 'comment', target, body: 'x' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(ann.add({ visibility: 'private', kind: 'comment', target, body: 'x'.repeat(8001) })).rejects.toMatchObject({ code: 'INVALID' });
    await ann.remove(id);
    await env.idle();
    expect(view.get()).toEqual([]);
    env.s.dispose();
  });

  it('re-anchors document highlights: moved file (SHA-256), changed text (quote), fuzzy (approximate), gone (lost)', async () => {
    const env = await setup();
    const { ann, platform, classId, cls } = env;
    await env.add('Documents/lei.txt', LAW);
    const sha = await platform.fs.hash(classId, 'Documents/lei.txt');
    const source = { kind: 'document' as const, path: 'Documents/lei.txt', sha256: sha };
    const at = LAW.indexOf('nunca podem atingir');
    await ann.add({ visibility: 'private', kind: 'highlight', target: { source, locator: { type: 'text', start: at, end: at + 19, extractor: 'tramado-extract/1' }, quote: { exact: 'nunca podem atingir o conteúdo essencial', prefix: '', suffix: '' } } });
    const view = ann.forSource(source);
    await env.idle();
    expect(view.get()[0]!.anchor).toBe('exact');

    await platform.fs.mkdir(classId, 'Documents/Leis');
    await cls.store.move('Documents/lei.txt', 'Documents/Leis/lei.txt');
    await env.idle();
    expect(view.get()[0]).toMatchObject({ anchor: 'moved', target: { source: { path: 'Documents/Leis/lei.txt' } } });

    await cls.store.move('Documents/Leis/lei.txt', 'Documents/lei.txt');
    await cls.store.writeText('Documents/lei.txt', `Nova redação.\n${LAW}`, { own: false });
    await env.idle();
    const changed = view.get()[0]!;
    expect(changed.anchor).toBe('moved');
    expect(changed.target!.locator).toMatchObject({ type: 'text', start: at + 'Nova redação.\n'.length });

    await cls.store.writeText('Documents/lei.txt', LAW.replace('nunca podem atingir', 'jamais poderão atingir'), { own: false });
    await env.idle();
    expect(view.get()[0]!.anchor).toBe('approximate');

    await cls.store.writeText('Documents/lei.txt', 'Outro texto completamente diferente.\n', { own: false });
    await env.idle();
    expect(view.get()[0]!.anchor).toBe('lost');
    env.s.dispose();
  });

  it('re-anchors transcript highlights by segment, quote and time (audio-pipeline §5.5)', async () => {
    const env = await setup();
    const { ann, platform } = env;
    const dev = platform.mem.deviceId;
    const lectureId = itemIdOf(1_792_483_200_000, dev, NONCE);
    const dir = 'Lectures/2026-10-14 1015 Aula 6';
    const transcript = (segments: unknown[]) => JSON.stringify({ format: 'tramado.transcript', version: 1, lectureId, round: 1, revision: 1, audioSha256: null, language: 'pt-PT', writer: { deviceId: dev, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg' }, speakers: [], folded: {}, updatedAt: '2026-10-14T11:00:00.000Z', segments });
    await env.add(`${dir}/lecture.json`, JSON.stringify({ format: 'tramado.lecture', version: 1, id: lectureId, title: 'Aula 6' }));
    await env.add(`${dir}/transcript.json`, transcript([
      { id: 's_aaaaa', startMs: 0, endMs: 4000, speaker: 'lecture', text: 'Bom dia.' },
      { id: 's_bbbbb', startMs: 4000, endMs: 9000, speaker: 'lecture', text: 'Vamos ver o artigo 483.º do Código Civil.' },
    ]));
    const source = { kind: 'lecture' as const, lectureId, audioSha256: null, transcriptRevision: 1 };
    await ann.add({ visibility: 'private', kind: 'comment', body: 'Responsabilidade civil', target: { source, locator: { type: 'segment', segmentId: 's_bbbbb', startMs: 4000, endMs: 9000, charStart: 12, charEnd: 40 }, quote: { exact: 'artigo 483.º do Código Civil', prefix: 'Vamos ver o ', suffix: '.' } } });
    const view = ann.forSource(source);
    await env.idle();
    expect(view.get()[0]!.anchor).toBe('exact');
    // A correction merged the segment into another one: the merged redirect finds it.
    await env.add(`${dir}/transcript.json`, transcript([
      { id: 's_aaaaa', startMs: 0, endMs: 9000, speaker: 'lecture', text: 'Bom dia. Vamos ver hoje o artigo 483.º do Código Civil.', merged: ['s_bbbbb'] },
    ]));
    expect(view.get()[0]).toMatchObject({ anchor: 'moved', target: { locator: { segmentId: 's_aaaaa', charStart: 26 } } });
    await env.add(`${dir}/transcript.json`, transcript([{ id: 's_ccccc', startMs: 0, endMs: 9000, speaker: 'lecture', text: 'Texto transcrito de novo, sem a frase.' }]));
    expect(view.get()[0]).toMatchObject({ anchor: 'approximate', target: { locator: { segmentId: 's_ccccc', startMs: 4000 } } });
    env.s.dispose();
  });
});
