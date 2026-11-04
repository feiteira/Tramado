// SearchService over the memory platform with the inline hosts (architecture §11.2, §11.7): every
// source of a class is indexed (documents through extraction, notes, private notes, transcripts,
// exam questions), kept up to date, searched by BM25 and by boolean search, and citations resolve.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { itemIdOf } from '../core/model/derive';
import type { Citation } from '../core/model/files';
import { createServices } from './index';
import type { SearchServiceImpl } from './search';
import { createTestContext } from './testing/context';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test-fixtures/tramado/docs/${name}`, import.meta.url)));
const enc = (s: string) => new TextEncoder().encode(s);
const NONCE = 'q4m2zx7k3v5hbnw6r2yjc7aefg';

async function setup() {
  const t = await createTestContext({ name: 'Ana Ribeiro' });
  const s = createServices(t.ctx);
  const classId = await s.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'en', share: false });
  const cls = s.forClass(classId);
  const idle = () => (cls.store as unknown as { idle(): Promise<void> }).idle();
  await idle();
  const search = s.search as SearchServiceImpl;
  const add = async (path: string, bytes: Uint8Array) => {
    t.platform.mem.addFile(classId, path, bytes);
    await idle();
  };
  return { ...t, s, classId, cls, idle, search, add };
}

async function addLecture(env: Awaited<ReturnType<typeof setup>>) {
  const dev = env.platform.mem.deviceId;
  const id = itemIdOf(1_792_483_200_000, dev, NONCE);
  const dir = 'Lectures/2026-10-14 1015 Aula 6';
  await env.add(`${dir}/lecture.json`, enc(JSON.stringify({ format: 'tramado.lecture', version: 1, id, idNonce: NONCE, title: 'Aula 6 — Restrições', recordedBy: { deviceId: dev } })));
  await env.add(`${dir}/transcript.json`, enc(JSON.stringify({
    format: 'tramado.transcript', version: 1, lectureId: id, round: 1, revision: 1, audioSha256: null, language: 'pt-PT',
    writer: { deviceId: dev, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg' }, speakers: [{ id: 'lecture', label: 'Docente' }], folded: {}, updatedAt: '2026-10-14T11:00:00.000Z',
    segments: [
      { id: 's_l6a00', startMs: 0, endMs: 4000, speaker: 'lecture', text: 'Bom dia a todos.' },
      { id: 's_l6a01', startMs: 2_472_000, endMs: 2_480_000, speaker: 'lecture', text: 'A lei restritiva nunca pode atingir o conteúdo essencial do direito.' },
    ],
  })));
  return id;
}

async function addExam(env: Awaited<ReturnType<typeof setup>>) {
  const dev = env.platform.mem.deviceId;
  const id = itemIdOf(1_792_500_000_000, env.platform.mem.deviceId, 'aaaaaaaaaaaaaaaaaaaaaaaaaa');
  await env.add('Exams/Frequência/exam.json', enc(JSON.stringify({
    format: 'tramado.exam', version: 1, id, idNonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', title: 'Frequência 2025', importedBy: { deviceId: dev },
    questions: [
      { id: 'q_aaaaaa1', number: '1', parent: null, group: null, kind: 'short', text: 'O que é a reserva de lei restritiva?', points: 2, options: [], choose: null, source: null, answerKey: null },
      { id: 'q_aaaaaa2', number: '2', parent: null, group: null, kind: 'multiple_choice', text: 'Qual o prazo de recurso?', points: 1, options: [{ key: 'A', text: 'Dez dias' }, { key: 'B', text: 'Trinta dias' }], choose: null, source: null, answerKey: null },
    ],
  })));
  return id;
}

describe('SearchService (inline host)', () => {
  it('indexes documents, notes, private notes, transcripts and exams with locators and labels', async () => {
    const env = await setup();
    const { search, classId, platform } = env;
    await env.add('Documents/law.pdf', fixture('law.pdf'));
    await env.add('Documents/slides.pptx', fixture('slides.pptx'));
    await env.add('Notes/Resumo.md', enc('# Resumo da semana\n\nO conteúdo essencial é o limite das restrições.\n'));
    await platform.privateFiles.write(classId, 'notes/Minhas notas.md', enc('# Só minhas\n\nAs restrições têm um limite: o conteúdo essencial.\n'));
    const lectureId = await addLecture(env);
    const examId = await addExam(env);
    await search.ensure(classId);
    const st = await search.settled(classId);
    expect(st).toMatchObject({ state: 'ready', pending: 0, docs: 6 });

    const ps = await search.passages(classId, 'conteúdo essencial restrições', { limit: 20 });
    const doc = ps.find((p) => p.source.kind === 'document' && p.source.path === 'Documents/law.pdf')!;
    expect(doc.locator).toEqual({ type: 'article', article: '2.º', pages: [3, 4] });
    expect(doc.label).toBe('law.pdf · art. 2.º (pp. 3–4)');
    expect(doc.source).toEqual({ kind: 'document', path: 'Documents/law.pdf', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(doc.text.slice(doc.hits[0]![0], doc.hits[0]![1]).toLowerCase()).toMatch(/restri|conte|essen/);
    const lec = ps.find((p) => p.source.kind === 'lecture')!;
    expect(lec.source).toEqual({ kind: 'lecture', lectureId, audioSha256: null, transcriptRevision: 1 });
    expect(lec.locator).toMatchObject({ type: 'segment', segmentId: 's_l6a01', startMs: 2_472_000, endMs: 2_480_000, charStart: expect.any(Number) });
    expect(lec.label).toBe('Aula 6 — Restrições · 41:12');
    expect(ps.find((p) => p.private)?.source).toMatchObject({ kind: 'note', path: 'notes/Minhas notas.md' });
    expect(ps.find((p) => p.source.kind === 'note' && !p.private)?.locator).toMatchObject({ type: 'heading', path: ['Resumo da semana'] });
    const slide = (await search.passages(classId, 'artigo 18 lei exemplo lembrar', { kinds: ['document'] })).find((p) => p.source.kind === 'document' && p.source.path.endsWith('.pptx'));
    expect(slide?.locator).toEqual({ type: 'slide', slide: 2 });

    const exam = await search.passages(classId, 'prazo de recurso trinta dias', { kinds: ['exam'] });
    expect(exam[0]?.source).toEqual({ kind: 'exam', examId, questionId: 'q_aaaaaa2' });
    expect(exam[0]?.title).toBe('Frequência 2025');
    // exclude by path or id
    expect((await search.passages(classId, 'conteúdo essencial', { exclude: ['Documents/law.pdf', lectureId] })).some((p) => p.source.kind === 'document' && p.source.path === 'Documents/law.pdf' || p.source.kind === 'lecture')).toBe(false);
    env.s.dispose();
  });

  it('reads more of a passage, and finds words with the boolean search (with context and locators)', async () => {
    const env = await setup();
    const { search, classId } = env;
    await env.add('Documents/law.pdf', fixture('law.pdf'));
    await search.settled(classId);
    const [p] = await search.passages(classId, 'época de recurso taxa');
    expect(p!.locator).toMatchObject({ type: 'article', article: '3.º' });
    const more = await search.passage(classId, p!.id, { offset: 0, max: 20 });
    expect(more).toMatchObject({ hasMore: true, text: p!.text.slice(0, 20), label: p!.label });
    const found = await search.find(classId, '"conteúdo essencial"');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ match: 'conteúdo essencial', locator: { type: 'article', article: '2.º' }, label: 'law.pdf · art. 2.º (pp. 3–4)' });
    expect(found[0]!.before).toMatch(/atingir o $/);
    expect(await search.find(classId, '(')).toEqual([]);
    expect(await search.find(classId, 'recurso NOT taxa')).toEqual([]);
    env.s.dispose();
  });

  it('follows changes: new, changed and removed documents; private notes on refresh', async () => {
    const env = await setup();
    const { search, classId, platform, cls } = env;
    await search.ensure(classId);
    expect(await search.passages(classId, 'proporcionalidade')).toEqual([]);
    await env.add('Documents/slides.pptx', fixture('slides.pptx'));
    await search.settled(classId);
    expect((await search.passages(classId, 'proporcionalidade'))[0]?.locator).toEqual({ type: 'slide', slide: 3 });
    await cls.store.remove('Documents/slides.pptx');
    await env.idle();
    await search.settled(classId);
    expect(await search.passages(classId, 'proporcionalidade')).toEqual([]);
    await platform.privateFiles.write(classId, 'notes/a.md', enc('# Nota\n\nproporcionalidade em sentido estrito\n'));
    search.refresh(classId);
    await search.settled(classId);
    expect((await search.passages(classId, 'proporcionalidade'))[0]).toMatchObject({ private: true, title: 'Nota' });
    expect(search.status(classId).get()).toMatchObject({ state: 'ready', docs: 1, pending: 0 });
    env.s.dispose();
  });

  it('searches all classes', async () => {
    const env = await setup();
    const other = await env.s.library.create({ name: 'Biologia Celular', colour: '#e5484d', icon: 'dna', language: 'en', share: false });
    const cls2 = env.s.forClass(other);
    await (cls2.store as unknown as { idle(): Promise<void> }).idle();
    env.platform.mem.addFile(other, 'Notes/Célula.md', enc('# Célula\n\nA mitocôndria produz energia.\n'));
    await (cls2.store as unknown as { idle(): Promise<void> }).idle();
    await env.add('Notes/Lei.md', enc('# Lei\n\nA mitocôndria não é matéria de direito.\n'));
    const all = await env.search.passages('all', 'mitocôndria');
    expect(new Set(all.map((p) => p.classId))).toEqual(new Set([env.classId, other]));
    expect((await env.search.find('all', 'mitocôndria')).length).toBe(2);
    env.s.dispose();
  });

  it('resolves citations: exact, moved by SHA-256, changed by quote, missing — with the route of UX §4.5', async () => {
    const env = await setup();
    const { search, classId, cls, platform } = env;
    await env.add('Documents/law.pdf', fixture('law.pdf'));
    await search.settled(classId);
    const [p] = await search.passages(classId, 'conteúdo essencial restringido');
    const text = p!.text;
    const at = text.indexOf('nunca podem atingir');
    const citation: Citation = {
      ref: 'S1', source: p!.source, locator: p!.locator,
      quote: { exact: 'nunca podem atingir o conteúdo essencial', prefix: text.slice(Math.max(0, at - 20), at), suffix: ' do direito' }, label: p!.label,
    };
    const exact = await search.resolve(classId, citation);
    expect(exact).toMatchObject({ status: 'exact', path: 'Documents/law.pdf', label: 'law.pdf · art. 2.º (pp. 3–4)' });
    expect(exact.route).toEqual({ name: 'document', classId, relPath: 'Documents/law.pdf', sha256: (p!.source as { sha256: string }).sha256, page: 3, quote: 'nunca podem atingir o conteúdo essencial' });

    await platform.fs.mkdir(classId, 'Documents/Legislação');
    await cls.store.move('Documents/law.pdf', 'Documents/Legislação/Lei fundamental.pdf');
    await env.idle();
    const moved = await search.resolve(classId, citation);
    expect(moved).toMatchObject({ status: 'moved', path: 'Documents/Legislação/Lei fundamental.pdf', route: { relPath: 'Documents/Legislação/Lei fundamental.pdf' } });

    // The same path with other content that still holds the quote → changed.
    await env.add('Documents/law.pdf', enc('Nova versão.\nArtigo 2.º As leis restritivas nunca podem atingir o conteúdo essencial do direito.\n').slice());
    await platform.fs.remove(classId, 'Documents/Legislação/Lei fundamental.pdf');
    await env.idle();
    const txt: Citation = { ...citation, source: { kind: 'document', path: 'Documents/notas.txt', sha256: 'f'.repeat(64) } };
    await env.add('Documents/notas.txt', enc('Resumo: as leis restritivas nunca podem atingir o conteúdo essencial do direito.\n'));
    expect(await search.resolve(classId, txt)).toMatchObject({ status: 'changed', path: 'Documents/notas.txt' });
    await platform.fs.remove(classId, 'Documents/notas.txt');
    await env.idle();
    expect(await search.resolve(classId, { ...txt, quote: { exact: 'uma frase que não existe em lado nenhum', prefix: '', suffix: '' } })).toEqual({ status: 'missing', route: null, label: citation.label });

    const lectureId = await addLecture(env);
    const lec = await search.resolve(classId, { ref: 'S2', source: { kind: 'lecture', lectureId, audioSha256: null, transcriptRevision: 1 }, locator: { type: 'segment', segmentId: 's_l6a01', startMs: 2_472_000, endMs: 2_480_000 }, quote: { exact: 'nunca pode atingir', prefix: '', suffix: '' }, label: 'Aula 6 · 41:12' });
    expect(lec).toEqual({ status: 'exact', label: 'Aula 6 · 41:12', route: { name: 'lecture', classId, lectureId, at: 2_472_000, segmentId: 's_l6a01', quote: 'nunca pode atingir' } });
    env.s.dispose();
  });
});

describe('SearchService and transcript corrections (UI-DOCS)', () => {
  it('indexes the effective transcript (pending corrections applied) without the lecture being opened', async () => {
    const env = await setup();
    const id = await addLecture(env);
    await env.search.settled(env.classId);
    expect((await env.search.passages(env.classId, 'Bom dia a todos')).some((p) => p.source.kind === 'lecture')).toBe(true);
    const lectures = env.cls.lectures as unknown as { refresh(): Promise<void>; idle(): Promise<void> } & typeof env.cls.lectures;
    await lectures.refresh();
    await lectures.edit.setText(id, 's_l6a00', 'Boa tarde, turma de Direito.');
    await env.idle();
    await lectures.idle();
    await env.search.settled(env.classId);
    const hits = await env.search.passages(env.classId, 'boa tarde turma');
    expect(hits.find((p) => p.source.kind === 'lecture')?.text).toContain('Boa tarde, turma de Direito.');
    env.s.dispose();
  });
});
