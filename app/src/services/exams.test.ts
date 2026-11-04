import { describe, expect, it } from 'vitest';
import { createServices, type AppServicesImpl } from './index';
import { createTestContext } from './testing/context';
import { createFakeSearch, testPassage, type FakeSearch } from './testing/fakeSearch';
import { createFakeAi, DEMO_OCR_TEXT, type FakeAi } from '../platform/memory/ai';
import { bodyOf } from '../core/ai/fake';
import { sha256Hex } from '../core/util/sha256';
import { manifestJson } from '../core/json';
import type { ExamService } from './types/exams';
import type { AnswersFile, ExamEditLine, ExamFile, MarksFile } from '../core/model/files';
import type { ReadableStore } from './store';
import type { MemoryPlatform } from '../platform/memory';
import type { ClassId } from '../core/model/ids';

const OTHER = 'BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB';
const dec = new TextDecoder();
const enc = new TextEncoder();

const CORPUS = [
  testPassage({ id: 'lf#18', label: 'Lei Fundamental de Exemplo · p. 9 · art. 18.º', source: { kind: 'document', path: 'Documents/Lei Fundamental.pdf', sha256: 'a'.repeat(64) }, locator: { type: 'article', article: '18.º', pages: [9, 9] }, text: 'Artigo 18.º (Força jurídica) 2. A lei só pode restringir os direitos, liberdades e garantias nos casos expressamente previstos nesta Lei Fundamental. 3. As leis restritivas têm de revestir caráter geral e abstrato e não podem diminuir o conteúdo essencial.' }),
  testPassage({ id: 'l6@2472000', label: 'Aula 6 · 41:12', source: { kind: 'lecture', lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', audioSha256: null, transcriptRevision: 1 }, locator: { type: 'segment', segmentId: 's_l6a00', startMs: 2472000, endMs: 2479500 }, text: 'A restrição de direitos nunca pode atingir o conteúdo essencial do direito; é o princípio da proporcionalidade.' }),
  testPassage({ id: 'mine#1', label: 'My notes · restrições', source: { kind: 'note', path: 'private/restricoes.md', sha256: 'c'.repeat(64) }, text: 'SEGREDO PRIVADO: as restrições de direitos e a proporcionalidade, os meus apontamentos.' }),
];
const TYPED = `Frequência — Direito Constitucional I
GRUPO I (8 valores)
1. Em que condições pode a lei restringir direitos, liberdades e garantias? (4 valores)
2. Escolha a opção correta. A lei restritiva deve ter caráter: (A) individual; (B) geral e abstrato; (C) retroativo. (4 valores)
GRUPO II (12 valores)
3. O que é o conteúdo essencial de um direito? (12 valores)`;

interface Bed { s: AppServicesImpl; classId: ClassId; exams: ExamService & { idle(): Promise<void> }; ai: FakeAi; search: FakeSearch; platform: MemoryPlatform; clock: { advance(ms: number): void }; idle(): Promise<void> }

async function bed(opts: { ai?: FakeAi; key?: boolean; realSearch?: boolean } = {}): Promise<Bed> {
  const ai = opts.ai ?? createFakeAi({ mode: 'fake' });
  const { ctx, platform, clock } = await createTestContext({ name: 'Ana Ribeiro', ai });
  if (opts.key !== false) await platform.secrets.set('openrouter', 'test-key-0001');
  const s = createServices(ctx);
  const search = createFakeSearch(CORPUS);
  // G1: `realSearch` keeps T-DOCS' SearchService (inline index and extraction hosts) instead of the fake.
  if (!opts.realSearch) (s as { search: unknown }).search = search;
  await s.ai.ready();
  const classId = await s.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'en', share: false });
  const cls = s.forClass(classId);
  const store = cls.store as unknown as { idle(): Promise<void> };
  const exams = cls.exams as ExamService & { idle(): Promise<void> };
  const idle = async () => {
    for (let i = 0; i < 4; i++) {
      await store.idle();
      await exams.idle();
    }
  };
  await idle();
  return { s, classId, exams, ai, search, platform, clock, idle };
}

const until = async <T>(store: ReadableStore<T>, pred: (v: T) => boolean, tick?: () => void): Promise<T> => {
  for (let i = 0; i < 400; i++) {
    const v = store.get();
    if (pred(v)) return v;
    tick?.();
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`timed out: ${JSON.stringify(store.get()).slice(0, 300)}`);
};
const chatRequests = (ai: FakeAi) => ai.requests.filter((r) => r.path === 'chat/completions');

describe('ExamService: import → review', () => {
  it('reads a photo (OCR cached by hash) → pre-split → extraction → review; saveReview writes exam.json with me as importer', async () => {
    const b = await bed();
    b.platform.mem.queueDialog({ picks: [{ name: 'exame.jpg', bytes: new Uint8Array([0xff, 0xd8, 1, 2, 3]) }] });
    const picks = await b.platform.dialogs.pickFiles({ title: 'x', filters: [], multiple: true });
    const id = await b.exams.startImport(picks, { type: 'final' });
    const d = await until(b.exams.draft(id), (v) => v?.step === 'review' || v?.step === 'failed');
    expect(d?.error).toBeNull();
    expect(d!.questions.map((q) => q.number)).toEqual(['I', 'II', 'II.a', 'II.b', 'II.c', 'III']);
    expect(d!.questions.find((q) => q.number === 'II')).toMatchObject({ kind: 'container', choose: 2, points: 6 });
    expect(d!.text).toBe(DEMO_OCR_TEXT);
    expect(d!.cost.requests).toBe(2);                         // 1 page read + 1 extraction
    expect(d!.model).toBe('google/gemma-4-31b-it:free');
    expect(d!.meta).toMatchObject({ rules: ['Permitida a consulta de legislação não anotada.'], durationMin: 120, scale: { max: 20, unit: 'valores' } });
    expect(chatRequests(b.ai)[0]!.activity).toMatchObject({ action: 'examOcr' });
    expect(bodyOf(chatRequests(b.ai)[0]! as never).models?.[0]).toBe('google/gemma-4-31b-it:free');   // the vision chain starts with Gemma (it reads images)
    expect(await b.platform.cache.read(`ocr/${sha256Hex(new Uint8Array())}.json`)).not.toBeNull();
    expect(b.exams.list.get().papers.find((p) => p.examId === id)?.state).toBe('review');

    const examId = await b.exams.saveReview(id, d!.questions, { title: 'Exame — época normal' });
    await b.idle();
    const paper = b.exams.list.get().papers.find((p) => p.examId === examId)!;
    expect(paper).toMatchObject({ title: 'Exame — época normal', kind: 'final', state: 'ready', scale: 'pt20' });
    expect(paper.questions.map((q) => q.number)).toEqual(['I', 'II.a', 'II.b', 'II.c', 'III']);
    expect(paper.questions[1]!.group).toMatchObject({ choose: 2, label: 'II' });
    expect(paper.importedBy.self).toBe(true);
    const file = JSON.parse(dec.decode(await b.platform.fs.read(b.classId, `${paper.sourceRelPath!.slice(0, paper.sourceRelPath!.lastIndexOf('/'))}/exam.json`))) as ExamFile;
    expect(file.importedBy.deviceId).toBe(b.platform.mem.deviceId);
    expect(file.extraction).toMatchObject({ method: 'ocr', model: 'google/gemma-4-31b-it:free' });
    expect(file.extraction!.reviewedAt).not.toBeNull();
    expect(file.files[0]!.mime).toBe('image/jpeg');

    // The same photo again: the OCR cache answers, only the extraction is a request.
    b.platform.mem.queueDialog({ picks: [{ name: 'exame.jpg', bytes: new Uint8Array([0xff, 0xd8, 1, 2, 3]) }] });
    const id2 = await b.exams.startImport(await b.platform.dialogs.pickFiles({ title: 'x', filters: [], multiple: true }));
    expect((await until(b.exams.draft(id2), (v) => v?.step === 'review'))!.cost.requests).toBe(1);
    b.exams.cancelDraft(id2);
    expect(b.exams.draft(id2).get()).toBeNull();
    b.s.dispose();
  });

  it('a scanned PDF: every page without text is read (2 pages + 1 extraction); questions keep their page', async () => {
    const b = await bed();
    const ctx = b.s.ctx as { pdfRender: unknown; extractHost: unknown };
    ctx.pdfRender = { pages: async () => 2, renderJpeg: async (_b: Uint8Array, page: number) => new Uint8Array([0xff, 0xd8, page]) };
    ctx.extractHost = { extract: async () => ({ sha256: '', extractor: 'x', kind: 'pdf', text: '', units: [], warnings: [], imagePages: [1, 2], pageStarts: [0, 0] }) };
    b.ai.controls.next('Exame de recurso\nGRUPO I (10 valores)\nComente: «A lei é geral.»');
    b.ai.controls.next('GRUPO II (10 valores)\n1. Defina direito subjetivo. (5 valores)\n2. Explique a proporcionalidade. (5 valores)');
    b.platform.mem.queueDialog({ picks: [{ name: 'recurso.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }] });
    const id = await b.exams.startImport(await b.platform.dialogs.pickFiles({ title: 'x', filters: [], multiple: false }));
    const d = (await until(b.exams.draft(id), (v) => v?.step === 'review' || v?.step === 'failed'))!;
    expect(d.error).toBeNull();
    expect(d.cost.requests).toBe(3);
    expect(d.ocrDone).toBe(2);
    expect(d.questions.map((q) => [q.number, q.source?.page])).toEqual([['I', 1], ['1', 2], ['2', 2]]);
    expect(d.questions.every((q) => q.source?.file.endsWith('/recurso.pdf'))).toBe(true);
    b.s.dispose();
  });

  it('typed questions skip the AI; review validation refuses duplicate numbers and empty texts', async () => {
    const b = await bed();
    const id = await b.exams.startTyped(TYPED, { type: 'midterm' });
    const d = b.exams.draft(id).get()!;
    expect(d.step).toBe('review');
    expect(d.questions.map((q) => [q.number, q.kind])).toEqual([['1', 'short'], ['2', 'multiple_choice'], ['3', 'short']]);
    expect(chatRequests(b.ai)).toHaveLength(0);
    const bad = d.questions.map((q, i) => (i === 1 ? { ...q, number: '1' } : q));
    await expect(b.exams.saveReview(id, bad, {})).rejects.toMatchObject({ code: 'INVALID' });
    const examId = await b.exams.saveReview(id, d.questions, { title: 'Frequência' });
    expect(b.exams.list.get().papers.find((p) => p.examId === examId)!.questions).toHaveLength(3);
    b.s.dispose();
  });
});

describe('ExamService: answers (critique C17)', () => {
  async function paper(b: Bed) {
    const id = await b.exams.startTyped(TYPED, { type: 'midterm' });
    return b.exams.saveReview(id, b.exams.draft(id).get()!.questions, { title: 'Frequência' });
  }

  it('Quick answer: 1 expansion + 1 request per question; the answers file holds the latest per question; private notes never leave', async () => {
    const b = await bed();
    const examId = await paper(b);
    const qids = b.exams.list.get().papers[0]!.questions.map((q) => q.id);
    const p = b.exams.answer(examId, qids, 'quick', 'materials');
    const done = await until(p, (v) => v.done === v.total && v.current === null);
    expect(done).toEqual({ done: 3, total: 3, current: null, error: null });
    const reqs = chatRequests(b.ai);
    expect(reqs).toHaveLength(4);
    expect(reqs.map((r) => r.activity?.action)).toEqual(['examAnswer', 'examAnswer', 'examAnswer', 'examAnswer']);
    expect(JSON.stringify(reqs.map((r) => r.body))).not.toContain('SEGREDO PRIVADO');
    const file = JSON.parse(dec.decode(await b.platform.fs.read(b.classId, `.tramado/answers/${examId}/${b.platform.mem.deviceId}.json`))) as AnswersFile;
    expect(file.answers).toHaveLength(3);
    expect(file.answers.every((a) => a.model === 'google/gemma-4-31b-it:free' && a.mode === 'quick' && a.scope === 'materials' && /^[0-9a-f]{40}$/.test(a.questionSha1))).toBe(true);
    const mc = file.answers.find((a) => a.questionId === qids[1])!;
    expect(mc.choice).toBe('B');
    expect(mc.citations.length).toBeGreaterThan(0);
    expect(mc.citations.every((c) => c.source.kind !== 'note')).toBe(true);
    const q1 = b.exams.list.get().papers[0]!.questions[0]!;
    expect(q1.ai).toMatchObject({ mode: 'quick', fallback: false, model: { id: 'google/gemma-4-31b-it:free', free: true } });
    expect(q1.ai!.citations[0]).toMatchObject({ n: 1, ref: 'S1', status: 'ok' });
    expect(q1.ai!.grounded).toBeGreaterThan(0.5);
    expect(b.exams.list.get().papers[0]!.answers).toHaveLength(1);

    // Answering one question again: latest wins, still one answer per question.
    await until(b.exams.answer(examId, [qids[0]!], 'quick', 'materials+general'), (v) => v.done === 1);
    const again = JSON.parse(dec.decode(await b.platform.fs.read(b.classId, `.tramado/answers/${examId}/${b.platform.mem.deviceId}.json`))) as AnswersFile;
    expect(again.answers).toHaveLength(3);
    expect(again.answers.find((a) => a.questionId === qids[0])!.scope).toBe('materials+general');
    b.s.dispose();
  });

  it('a classmate\'s answers file shows as an existing set ("Answers already exist", G11)', async () => {
    const b = await bed();
    const examId = await paper(b);
    const q = b.exams.list.get().papers[0]!.questions[2]!;
    const theirs: AnswersFile = {
      format: 'tramado.answers', version: 1, examId, deviceId: OTHER, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', hlc: '001793721438157-00000-bbbbbbb', updatedAt: '2026-11-01T10:00:00.000Z',
      answers: [{ id: '01JBXA7J0P5E2V7C9B3N8M1K4Q', questionId: q.id, questionSha1: 'f'.repeat(40), examRevision: 1, hlc: '001793721438157-00000-bbbbbbb', at: '2026-11-01T10:00:00.000Z', text: 'É o núcleo que nenhuma restrição atinge [S1] [S9].', citations: [{ ref: 'S1', source: CORPUS[0]!.source, locator: CORPUS[0]!.locator, quote: null, label: 'Lei Fundamental de Exemplo · p. 9 · art. 18.º' }], generalKnowledge: [], model: 'dots-studio/dots-3-note-preview:free', requestedModel: 'google/gemma-4-31b-it:free', privacy: 'no-training', mode: 'quick', scope: 'materials' }],
    };
    b.platform.mem.applyRemote(b.classId, `.tramado/answers/${examId}/${OTHER}.json`, enc.encode(JSON.stringify(theirs)), { modifiedBy: 'BBBBBBB', mtimeMs: 1 });
    await b.idle();
    const v = b.exams.list.get().papers[0]!;
    expect(v.answers).toHaveLength(1);
    expect(v.answers[0]).toMatchObject({ count: 1, by: { deviceId: OTHER, self: false }, model: { id: 'dots-studio/dots-3-note-preview:free' } });
    const ai = v.questions[2]!.ai!;
    expect(ai).toMatchObject({ fallback: true, requested: { id: 'google/gemma-4-31b-it:free' } });
    expect(ai.citations.map((c) => [c.n, c.status])).toEqual([[1, 'ok'], [2, 'hallucinated']]);
    b.s.dispose();
  });

  it('Deep answer runs the tool loop and stores mode "deep"', async () => {
    const b = await bed();
    const examId = await paper(b);
    const qid = b.exams.list.get().papers[0]!.questions[0]!.id;
    await until(b.exams.answer(examId, [qid], 'deep', 'materials'), (v) => v.done === 1 || v.error !== null);
    const reqs = chatRequests(b.ai);
    expect(reqs).toHaveLength(2);                              // tool call, then the answer
    expect(bodyOf(reqs[0]! as never).tools).toHaveLength(2);
    const file = JSON.parse(dec.decode(await b.platform.fs.read(b.classId, `.tramado/answers/${examId}/${b.platform.mem.deviceId}.json`))) as AnswersFile;
    expect(file.answers[0]).toMatchObject({ mode: 'deep' });
    expect(file.answers[0]!.citations.length).toBeGreaterThan(0);
    b.s.dispose();
  });

  it('a busy chain stops the batch with AI_BUSY (the chooser); "use NVIDIA for this request" answers', async () => {
    const b = await bed({ ai: createFakeAi({ mode: 'busy' }) });
    const examId = await paper(b);
    const qid = b.exams.list.get().papers[0]!.questions[0]!.id;
    const p = b.exams.answer(examId, [qid], 'quick', 'materials');
    expect((await until(p, (v) => v.error !== null, () => b.clock.advance(0))).error).toBe('AI_BUSY');
    const ok = await until(b.exams.answer(examId, [qid], 'quick', 'materials', { busyFallback: true }), (v) => v.done === 1 || v.error !== null, () => b.clock.advance(0));
    expect(ok.error).toBeNull();
    const last = chatRequests(b.ai).at(-1)!;
    expect(last).toMatchObject({ busyFallback: true, privacyOverride: 'standard' });
    expect(last.overrideText?.title).toBe('Use NVIDIA free models for this request');
    const file = JSON.parse(dec.decode(await b.platform.fs.read(b.classId, `.tramado/answers/${examId}/${b.platform.mem.deviceId}.json`))) as AnswersFile;
    expect(file.answers[0]).toMatchObject({ model: 'nvidia/nemotron-3.5-super-vl:free', privacy: 'standard' });
    b.s.dispose();
  });
});

describe('ExamService over the real SearchService (G1)', () => {
  const LAW = [
    '# Lei Fundamental de Exemplo',
    '',
    '## Artigo 18.º (Força jurídica)',
    '',
    '2. A lei só pode restringir os direitos, liberdades e garantias nos casos expressamente previstos nesta Lei Fundamental.',
    '3. As leis restritivas têm de revestir caráter geral e abstrato e não podem diminuir a extensão e o alcance do conteúdo essencial dos preceitos.',
    '',
    '## Artigo 19.º (Suspensão do exercício de direitos)',
    '',
    '1. Os órgãos de soberania não podem suspender o exercício dos direitos, salvo em caso de estado de sítio ou de estado de emergência.',
  ].join('\n');

  it('Quick answer cites the class document the index found, never the private note', async () => {
    const b = await bed({ realSearch: true });
    const cls = b.s.forClass(b.classId);
    await cls.store.writeBytes('Documents/Lei Fundamental de Exemplo.md', enc.encode(LAW), { own: true });
    const note = await cls.notes.create('private', 'Restrições');
    await cls.notes.save('private', note, 'SEGREDO PRIVADO: as leis restritivas e o conteúdo essencial, os meus apontamentos.');
    await b.idle();
    b.s.search.refresh?.(b.classId);
    const status = await b.s.search.settled!(b.classId);
    expect(status.docs).toBeGreaterThanOrEqual(1);
    const hits = await b.s.search.passages(b.classId, 'leis restritivas conteúdo essencial', { limit: 5 });
    // The student's own search finds both; the private note is flagged (never cited in shared content).
    expect(hits.some((h) => h.source.kind === 'document' && 'path' in h.source && h.source.path === 'Documents/Lei Fundamental de Exemplo.md')).toBe(true);
    expect(hits.filter((h) => h.source.kind === 'note').every((h) => h.private === true)).toBe(true);

    const id = await b.exams.startTyped(TYPED, { type: 'midterm' });
    const examId = await b.exams.saveReview(id, b.exams.draft(id).get()!.questions, { title: 'Frequência' });
    const qid = b.exams.list.get().papers[0]!.questions[0]!.id;
    const done = await until(b.exams.answer(examId, [qid], 'quick', 'materials'), (v) => v.done === 1 || v.error !== null);
    expect(done.error).toBeNull();
    expect(JSON.stringify(chatRequests(b.ai).map((r) => r.body))).not.toContain('SEGREDO PRIVADO');
    expect(JSON.stringify(chatRequests(b.ai).map((r) => r.body))).toContain('Artigo 18.º');
    const file = JSON.parse(dec.decode(await b.platform.fs.read(b.classId, `.tramado/answers/${examId}/${b.platform.mem.deviceId}.json`))) as AnswersFile;
    const cites = file.answers[0]!.citations;
    expect(cites.length).toBeGreaterThan(0);
    expect(cites.every((c) => c.source.kind === 'document' && 'path' in c.source && c.source.path === 'Documents/Lei Fundamental de Exemplo.md')).toBe(true);
    b.s.dispose();
  });
});

describe('ExamService: dates, private state, edits', () => {
  it('upcoming dates: create, update (importer only), list', async () => {
    const b = await bed();
    const id = await b.exams.createUpcoming({ title: 'Frequência', type: 'midterm', date: '2026-11-12T10:00:00+00:00', allDay: false, durationMin: 90, room: 'Anfiteatro 1.02', weight: 40, weightText: '40 %', covers: [], coversText: 'Aulas 1–8' });
    await b.idle();
    expect(b.exams.list.get().dates).toEqual([{ examId: id, classId: b.classId, title: 'Frequência', kind: 'midterm', at: '2026-11-12T10:00:00+00:00', allDay: false, room: 'Anfiteatro 1.02', covers: 'Aulas 1–8', weight: '40 %', practiceCount: 0 }]);
    await b.exams.updateUpcoming(id, { room: 'Sala 2' });
    expect(b.exams.list.get().dates[0]!.room).toBe('Sala 2');
    expect(b.exams.list.get().papers).toEqual([]);
    b.s.dispose();
  });

  it('marks, my answer, the correct answer, hints, reveal and practice live in private/<classId>/exams/<examId>.json', async () => {
    const b = await bed();
    const id = await b.exams.startTyped(TYPED);
    const examId = await b.exams.saveReview(id, b.exams.draft(id).get()!.questions, { title: 'Frequência' });
    const qid = b.exams.list.get().papers[0]!.questions[0]!.id;
    await b.exams.setMyAnswer(examId, qid, 'Nos casos previstos.');
    await b.exams.setCorrect(examId, qid, 'Só nos casos expressamente previstos.');
    await b.exams.setMark(examId, qid, 'unsure');
    await b.exams.reveal(examId, qid);
    await b.exams.practise(examId, qid, 'again');
    await b.exams.practise(examId, qid, 'gotIt');
    await b.exams.hint(examId, qid);
    const f = JSON.parse(dec.decode((await b.platform.privateFiles.read(b.classId, `exams/${examId}.json`))!)) as MarksFile;
    expect(f).toMatchObject({ format: 'tramado.exam-private', myAnswers: { [qid]: 'Nos casos previstos.' }, marks: { [qid]: 'unsure' }, revealed: { [qid]: true }, inPractice: { [qid]: true } });
    expect(f.practice[qid]).toMatchObject({ result: 'gotIt', count: 2 });
    expect(f.hints[qid]!.model).toBe('google/gemma-4-31b-it:free');
    expect(chatRequests(b.ai).at(-1)!.activity?.action).toBe('hint');
    const mine = b.exams.list.get().papers[0]!.questions[0]!;
    expect(mine.mine).toMatchObject({ draft: 'Nos casos previstos.', mark: 'unsure', revealed: true, inPractice: true, practice: { lastResult: 'gotIt', count: 2 } });
    expect(mine.hint?.mode).toBe('hint');
    // Nothing private went into the class folder.
    expect([...b.platform.mem.list(b.classId).keys()].some((p) => p.includes('exam-private') || p.includes('/exams/'))).toBe(false);
    b.s.dispose();
  });

  it('only the importer edits; exam-edits of others are applied for display and folded after 5 minutes', async () => {
    const b = await bed();
    const id = await b.exams.startTyped(TYPED);
    const examId = await b.exams.saveReview(id, b.exams.draft(id).get()!.questions, { title: 'Frequência' });
    const v = b.exams.list.get().papers[0]!;
    await b.exams.editQuestion(examId, v.questions[0]!.id, 'points', 5);
    expect(b.exams.list.get().papers[0]!.questions[0]!.points).toBe(5);
    await expect(b.exams.editQuestion(examId, v.questions[0]!.id, 'nope', 1)).rejects.toMatchObject({ code: 'INVALID' });
    const line: ExamEditLine = { format: 'tramado.exam-edit', version: 1, id: '01JC1T9WQ2N8B5V3H7X4M6R0ZA', hlc: '009993721438157-00000-bbbbbbb', ms: 1, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', examId, baseRevision: 2, op: 'set_question', questionId: v.questions[2]!.id, field: 'text', value: 'Corrigido por Bruno.' };
    b.platform.mem.applyRemote(b.classId, `.tramado/exam-edits/${examId}/${OTHER}.jsonl`, enc.encode(`${JSON.stringify(line)}\n`), { modifiedBy: 'BBBBBBB', mtimeMs: 2 });
    await b.idle();
    expect(b.exams.list.get().papers[0]!.questions[2]!.text).toBe('Corrigido por Bruno.');
    const dir = v.sourceRelPath ?? '';
    void dir;
    b.clock.advance(5 * 60_000);
    await b.idle();
    const path = [...b.platform.mem.list(b.classId).keys()].find((p) => p.endsWith('/exam.json'))!;
    const f = JSON.parse(dec.decode(await b.platform.fs.read(b.classId, path))) as ExamFile;
    expect(f.questions[2]!.text).toBe('Corrigido por Bruno.');
    expect(f.folded[OTHER]).toBe(line.hlc);
    expect(f.revision).toBe(3);
    b.s.dispose();
  });
});

describe('ExamService: UI-EXAMS additions (wave 2)', () => {
  async function paper(b: Bed) {
    const id = await b.exams.startTyped(TYPED, { type: 'midterm' });
    return b.exams.saveReview(id, b.exams.draft(id).get()!.questions, { title: 'Frequência' });
  }

  it('importer() and raw(): who added the exam and its stored questions (containers included)', async () => {
    const b = await bed();
    const examId = await paper(b);
    expect(b.exams.importer(examId)).toMatchObject({ deviceId: b.platform.mem.deviceId, self: true });
    expect(b.exams.raw(examId)!.questions.map((q) => q.number)).toEqual(['1', '2', '3']);
    expect(b.exams.importer('01JBX0000000000000000NOPE0')).toBeNull();
    b.s.dispose();
  });

  it('saveQuestions(): the Review screen saves a reviewed paper in one write; duplicates and empty texts are refused', async () => {
    const b = await bed();
    const examId = await paper(b);
    const raw = b.exams.raw(examId)!;
    const qs = raw.questions.map((q, i) => (i === 0 ? { ...q, text: 'Texto corrigido.' } : q));
    await b.exams.saveQuestions(examId, qs, { title: 'Frequência (corrigida)', rules: ['Sem consulta'] });
    await b.idle();
    const v = b.exams.list.get().papers.find((p) => p.examId === examId)!;
    expect(v).toMatchObject({ title: 'Frequência (corrigida)', rules: ['Sem consulta'], state: 'ready' });
    expect(v.questions[0]!.text).toBe('Texto corrigido.');
    await expect(b.exams.saveQuestions(examId, qs.map((q) => ({ ...q, number: '1' })), {})).rejects.toMatchObject({ code: 'INVALID' });
    await expect(b.exams.saveQuestions(examId, qs.map((q, i) => (i === 1 ? { ...q, text: ' ' } : q)), {})).rejects.toMatchObject({ code: 'INVALID' });
    b.s.dispose();
  });

  it('running: the exam ids with a batch running (the answers view follows a batch started elsewhere)', async () => {
    const b = await bed();
    const examId = await paper(b);
    const qids = b.exams.list.get().papers[0]!.questions.map((q) => q.id);
    const p = b.exams.answer(examId, qids, 'quick', 'materials');
    expect(b.exams.running.get()).toEqual([examId]);
    expect(b.exams.progress(examId)).toBe(p);
    await until(p, (v) => v.current === null && v.done === v.total);
    await until(b.exams.running, (v) => v.length === 0);
    b.s.dispose();
  });

  it('INT: answerLater keeps the rest for the quota reset (also after a restart) and answers it then', async () => {
    const b = await bed();
    const examId = await paper(b);
    const qids = b.exams.list.get().papers[0]!.questions.map((q) => q.id);
    const at = new Date(Date.now() + 3_600_000).toISOString();
    await b.exams.answerLater(examId, qids.slice(1), 'materials', at);
    expect(b.exams.later.get()).toEqual([{ examId, qids: qids.slice(1), scope: 'materials', at }]);
    const saved = JSON.parse(dec.decode((await b.platform.privateFiles.read(b.classId, 'exams-later.json'))!));
    expect(saved).toMatchObject({ format: 'tramado.exams-later', later: [{ examId, qids: qids.slice(1) }] });
    // Cancelling forgets it; scheduling again re-arms it.
    await b.exams.cancelLater(examId);
    expect(b.exams.later.get()).toEqual([]);
    expect(await b.platform.privateFiles.read(b.classId, 'exams-later.json')).toBeNull();
    const soon = new Date(b.s.ctx.clock.now() + 60_000).toISOString();
    await b.exams.answerLater(examId, qids.slice(1), 'materials', soon);
    expect(chatRequests(b.ai)).toHaveLength(0);
    b.clock.advance(61_000);
    await until(b.exams.later, (v) => v.length === 0);
    for (let i = 0; i < 400 && chatRequests(b.ai).length < 3; i++) await new Promise((r) => setTimeout(r, 0));
    // 1 search-words expansion + the 2 questions left.
    expect(chatRequests(b.ai)).toHaveLength(3);
    await until(b.exams.running, (v) => v.length === 0);
    b.s.dispose();
  });

  it('INT review: the answers for later die with their services (no batch from a disposed instance)', async () => {
    const b = await bed();
    const examId = await paper(b);
    const qids = b.exams.list.get().papers[0]!.questions.map((q) => q.id);
    await b.exams.answerLater(examId, qids.slice(1), 'materials', new Date(b.s.ctx.clock.now() + 60_000).toISOString());
    b.s.dispose();
    b.clock.advance(120_000);
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
    expect(chatRequests(b.ai)).toHaveLength(0);
    // Still on disk: the next services of this class answer them.
    expect(await b.platform.privateFiles.read(b.classId, 'exams-later.json')).not.toBeNull();
  });

  it('remove(): "Delete for everyone" deletes the folder, my answers and the private marks (importer only)', async () => {
    const b = await bed();
    const examId = await paper(b);
    const qid = b.exams.list.get().papers[0]!.questions[0]!.id;
    await b.exams.setMark(examId, qid, 'right');
    const p = b.exams.answer(examId, [qid], 'quick', 'materials');
    await until(p, (v) => v.current === null && v.done === v.total);
    await b.idle();
    expect([...b.platform.mem.list(b.classId).keys()].some((k) => k.startsWith(`.tramado/answers/${examId}/`))).toBe(true);
    await b.exams.remove(examId);
    await b.idle();
    const keys = [...b.platform.mem.list(b.classId).keys()];
    expect(keys.some((k) => k.endsWith('/exam.json'))).toBe(false);
    expect(keys.some((k) => k.startsWith(`.tramado/answers/${examId}/`))).toBe(false);
    expect(await b.platform.privateFiles.read(b.classId, `exams/${examId}.json`)).toBeNull();
    expect(b.exams.list.get().papers).toHaveLength(0);
    // A classmate's exam: refused.
    const other: ExamFile = { ...b.exams.raw(await paper(b))! };
    await b.idle();
    const theirs = { ...other, importedBy: { memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', deviceId: OTHER, name: 'Bruno' } };
    const path = [...b.platform.mem.list(b.classId).keys()].find((k) => k.endsWith('/exam.json'))!;
    b.platform.mem.applyRemote(b.classId, path, enc.encode(manifestJson(theirs)), { modifiedBy: 'BBBBBBB', mtimeMs: 3 });
    await b.idle();
    const id2 = b.exams.list.get().papers[0]?.examId;
    if (id2 && b.exams.importer(id2)?.deviceId === OTHER) await expect(b.exams.remove(id2)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    b.s.dispose();
  });
});

void manifestJson;
