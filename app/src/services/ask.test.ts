import { describe, expect, it } from 'vitest';
import { createServices, type AppServicesImpl } from './index';
import { createTestContext } from './testing/context';
import { createFakeSearch, testPassage, type FakeSearch } from './testing/fakeSearch';
import { createFakeAi, type FakeAi } from '../platform/memory/ai';
import { bodyOf } from '../core/ai/fake';
import { chatMonthPath, createAskService, createGlobalAsk } from './ask';
import { manifestJson } from '../core/json';
import type { AskService, AskTurn } from './types/ask';
import type { AnnotationLine, ChatAi, ChatMessage, LectureFile, TranscriptFile } from '../core/model/files';
import type { MemoryPlatform } from '../platform/memory';
import type { AppContext } from './context';
import type { ClassId } from '../core/model/ids';

const dec = new TextDecoder();
const enc = new TextEncoder();
const LECTURE = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';
const PRIVATE_NOTE = testPassage({ id: 'mine#1', label: 'My notes · artigo 18', source: { kind: 'note', path: 'private/a.md', sha256: 'c'.repeat(64) }, text: 'O artigo 18 restringe direitos: os meus apontamentos privados sobre restrições.' });
const CORPUS = [
  testPassage({ id: 'lf#18', label: 'Lei Fundamental · p. 9 · art. 18.º', source: { kind: 'document', path: 'Documents/LF.pdf', sha256: 'a'.repeat(64) }, locator: { type: 'article', article: '18.º', pages: [9, 9] }, text: 'Artigo 18.º A lei só pode restringir direitos nos casos expressamente previstos; as restrições não podem atingir o conteúdo essencial.' }),
  testPassage({ id: 'l6@1', label: 'Aula 6 · 41:12', source: { kind: 'lecture', lectureId: LECTURE, audioSha256: null, transcriptRevision: 1 }, locator: { type: 'segment', segmentId: 's_l6a00', startMs: 2472000, endMs: 2479500 }, text: 'O artigo 18 diz que a restrição tem de ser proporcional e nunca atinge o conteúdo essencial.' }),
  PRIVATE_NOTE,
];

interface Bed { s: AppServicesImpl; ctx: AppContext; classId: ClassId; ask: AskService & { idle(): Promise<void> }; ai: FakeAi; search: FakeSearch; platform: MemoryPlatform; idle(): Promise<void> }

async function bed(language = 'pt-PT', mode: 'fake' | 'ratelimit' | 'cut' = 'fake'): Promise<Bed> {
  const ai = createFakeAi({ mode });
  const { ctx, platform } = await createTestContext({ name: 'Ana Ribeiro', ai });
  await platform.secrets.set('openrouter', 'test-key-0002');
  const s = createServices(ctx);
  const search = createFakeSearch(CORPUS);
  (s as { search: unknown }).search = search;
  await s.ai.ready();
  const classId = await s.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language, share: false });
  const cls = s.forClass(classId);
  const store = cls.store as unknown as { idle(): Promise<void> };
  const ask = cls.ask as AskService & { idle(): Promise<void> };
  const idle = async () => {
    await store.idle();
    await ask.idle();
    await store.idle();
  };
  await idle();
  return { s, ctx, classId, ask, ai, search, platform, idle };
}
const chat = (ai: FakeAi) => ai.requests.filter((r) => r.path === 'chat/completions');

async function addLecture(b: Bed) {
  const dir = 'Lectures/2026-10-20 1000 Aula 6';
  const lecture = { format: 'tramado.lecture', version: 1, id: LECTURE, idNonce: 'z2k7m4q9x3v5bnw6r2yjc7hefa', title: 'Aula 6 — Restrições', startedAt: '2026-10-20T10:00:00.000Z', durationMs: 3_600_000, mode: 'room', language: 'pt-PT', recordedBy: { memberId: 'm', deviceId: b.platform.mem.deviceId, name: 'Ana' }, audio: null, channels: [{ index: 0, speaker: 'lecture' }], pauses: [], consent: [], updatedAt: '2026-10-20T11:00:00.000Z' } as unknown as LectureFile;
  const seg = (i: number, startMs: number, text: string) => ({ id: `s_l6a${String(i).padStart(2, '0')}`, startMs, endMs: startMs + 8000, speaker: 'lecture', text });
  const transcript: TranscriptFile = {
    format: 'tramado.transcript', version: 1, lectureId: LECTURE, round: 1, revision: 2, audioSha256: null, language: 'pt-PT',
    writer: { deviceId: b.platform.mem.deviceId, memberId: 'm' }, transcribedBy: { deviceId: b.platform.mem.deviceId, memberId: 'm', name: 'Ana', at: '2026-10-20T12:00:00.000Z' },
    engine: { kind: 'local', name: 'whisper.cpp' }, speakers: [{ id: 'lecture', label: 'Lecturer' }],
    segments: [
      seg(0, 0, 'Bom dia. Hoje falamos de restrições de direitos.'),
      seg(1, 70_000, 'A proporcionalidade exige que a restrição seja necessária, adequada e proporcional em sentido estrito.'),
      seg(2, 2_472_000, 'O conteúdo essencial é o limite dos limites: nenhuma restrição o pode atingir.'),
      seg(3, 2_560_000, 'Para a próxima aula leiam o artigo 18.º da Lei Fundamental.'),
    ],
    folded: {}, updatedAt: '2026-10-20T12:00:00.000Z',
  };
  const s = b.s.forClass(b.classId).store;
  await s.mkdir(dir);
  await s.writeJson(`${dir}/lecture.json`, lecture, { own: true, manifest: true });
  await s.writeJson(`${dir}/transcript.json`, transcript, { own: true, manifest: true });
  await b.idle();
}

const settle = async (b: Bed, tid: string): Promise<AskTurn[]> => {
  await b.idle();
  return b.ask.thread(tid).get();
};

describe('AskService (UX §3.11)', () => {
  it('asks in a new private thread: streams, cites, saves the turn, lists the thread; history survives a restart', async () => {
    const b = await bed();
    const seen: string[] = [];
    const tid = await b.ask.ask(null, 'O que diz o artigo 18 sobre as restrições?', { kinds: [] });
    b.ask.thread(tid).subscribe(() => seen.push(b.ask.thread(tid).get()[0]?.answer ?? ''));
    const [turn] = await settle(b, tid);
    expect(turn).toMatchObject({ status: 'ok', error: null, model: 'google/gemma-4-31b-it:free', question: 'O que diz o artigo 18 sobre as restrições?' });
    expect(turn!.citations.map((c) => c.ref)).toContain('S1');
    expect(turn!.sent!.length).toBeGreaterThan(0);
    expect(seen.filter(Boolean).length).toBeGreaterThan(1);                 // it streamed
    expect(chat(b.ai)).toHaveLength(1);                                     // same language: 1 request
    expect(chat(b.ai)[0]!.activity).toMatchObject({ action: 'ask', classId: b.classId });
    expect(b.ask.threads.get()).toEqual([{ threadId: tid, title: 'O que diz o artigo 18 sobre as restrições?', at: turn!.at }]);
    const raw = dec.decode((await b.platform.privateFiles.read(b.classId, `ask/${tid}.jsonl`))!);
    expect(JSON.parse(raw.trim())).toMatchObject({ format: 'tramado.ask', version: 1, id: turn!.id, status: 'ok' });
    // A fresh service reads the history back.
    const again = createAskService(b.ctx, () => b.s, { store: b.s.forClass(b.classId).store, classId: b.classId }) as AskService & { idle(): Promise<void> };
    await again.idle();
    expect(again.threads.get().map((t) => t.threadId)).toEqual([tid]);
    expect(again.thread(tid).get()[0]!.answer).toBe(turn!.answer);
    await b.ask.removeThread(tid);
    expect(b.ask.threads.get()).toEqual([]);
    b.s.dispose();
  });

  it('expands the query across languages (2 requests) when the class language differs from the question\'s', async () => {
    const b = await bed('pt-PT');
    (b.s.forClass(b.classId).info as { detail: unknown }).detail = { get: () => ({ meta: { language: 'pt-PT' }, people: [] }), subscribe: () => () => undefined };
    const tid = await b.ask.ask(null, 'What does the restrictions article say about the essential content?', { kinds: [] });
    const [turn] = await settle(b, tid);
    expect(turn!.status).toBe('ok');
    expect(chat(b.ai)).toHaveLength(2);
    expect(String(bodyOf(chat(b.ai)[0]! as never).messages?.[0]?.content)).toContain('"queries"');
    b.s.dispose();
  });

  it('records errors on the turn (AI off → AI_NO_KEY) without throwing', async () => {
    const b = await bed();
    await b.s.ai.setEnabled(false);
    const tid = await b.ask.ask(null, 'Pergunta?', { kinds: [] });
    const [turn] = await settle(b, tid);
    expect(turn).toMatchObject({ status: 'error', error: 'AI_NO_KEY' });
    b.s.dispose();
  });

  it('INT: a rate limit keeps its Retry-After; a cut-off answer is marked and can be asked again with more room', async () => {
    const limited = await bed('pt-PT', 'ratelimit');
    const tid = await limited.ask.ask(null, 'O que diz o artigo 18?', { kinds: [] });
    const [turn] = await settle(limited, tid);
    expect(turn).toMatchObject({ status: 'error', error: 'AI_FREE_LIMIT', retryAfterS: 120 });
    // Kept in the private history too.
    const again = createAskService(limited.ctx, () => limited.s, { store: limited.s.forClass(limited.classId).store, classId: limited.classId });
    await again.idle();
    await new Promise((r) => setTimeout(r, 0));
    expect(again.thread(tid).get()[0]).toMatchObject({ retryAfterS: 120 });
    limited.s.dispose();

    const b = await bed('pt-PT', 'cut');
    const t2 = await b.ask.ask(null, 'O que diz o artigo 18?', { kinds: [] });
    const [cut] = await settle(b, t2);
    expect(cut).toMatchObject({ status: 'ok', cut: true });
    await b.ask.ask(t2, 'O que diz o artigo 18?', { kinds: [] }, { moreRoom: true });
    await settle(b, t2);
    const bodies = chat(b.ai).map((r) => (r.body as { max_tokens?: number }).max_tokens);
    expect(bodies.at(-1)).toBe(8000);
    b.s.dispose();
  });

  it('Post to class chat: an `ai` line with `question`; refused when the answer cites a private note', async () => {
    const b = await bed();
    b.search.setPassages([PRIVATE_NOTE]);
    const tPrivate = await b.ask.ask(null, 'O que dizem os meus apontamentos sobre o artigo 18?', { kinds: ['note'] });
    const [priv] = await settle(b, tPrivate);
    expect(priv!.citations[0]!.source.kind).toBe('note');
    await expect(b.ask.postToChat(tPrivate, priv!.id)).rejects.toMatchObject({ code: 'INVALID', data: { private: true } });
    b.search.setPassages(CORPUS.slice(0, 2));
    const tid = await b.ask.ask(null, 'O que diz o artigo 18?', { kinds: [] });
    const [turn] = await settle(b, tid);
    await b.ask.postToChat(tid, turn!.id);
    const file = [...b.platform.mem.list(b.classId).keys()].find((p) => p.startsWith(`.tramado/chat/${b.platform.mem.deviceId}/`))!;
    const line = JSON.parse(dec.decode(await b.platform.fs.read(b.classId, file)).trim()) as ChatAi;
    expect(line).toMatchObject({ format: 'tramado.chat', type: 'ai', status: 'ok', question: 'O que diz o artigo 18?', model: 'google/gemma-4-31b-it:free', privacy: 'no-training' });
    expect(line.replyTo).toBeUndefined();
    expect(file).toBe(chatMonthPath(b.platform.mem.deviceId, line.hlc));
    b.s.dispose();
  });

  it('@AI in chat answers the question with shared sources only and replies to it', async () => {
    const b = await bed();
    const store = b.s.forClass(b.classId).store;
    const hlc = b.ctx.hlc.tick();
    const msg: ChatMessage = { format: 'tramado.chat', version: 1, type: 'message', id: '01JBXA7D1W3Q8K5N2M9R4T6Y0C', hlc, ms: 1, memberId: b.ctx.identity.get()!.memberId, text: '<@ai> o que diz o artigo 18 sobre restrições?', mentions: ['ai'] };
    await store.appendLine(chatMonthPath(b.platform.mem.deviceId, hlc), msg);
    await b.idle();
    await b.ask.askInChat({ deviceId: b.platform.mem.deviceId, id: msg.id });
    expect(JSON.stringify(chat(b.ai).map((r) => r.body))).not.toContain('apontamentos privados');
    expect(String(bodyOf(chat(b.ai)[0]! as never).messages?.at(-1)?.content)).toMatch(/^o que diz o artigo 18/);
    const lines = dec.decode(await b.platform.fs.read(b.classId, chatMonthPath(b.platform.mem.deviceId, hlc))).trim().split('\n').map((l) => JSON.parse(l) as ChatAi);
    const ai = lines.find((l) => l.type === 'ai')!;
    expect(ai).toMatchObject({ status: 'ok', replyTo: { deviceId: b.platform.mem.deviceId, id: msg.id } });
    expect(ai.citations.every((c) => c.source.kind !== 'note')).toBe(true);
    await expect(b.ask.askInChat({ deviceId: b.platform.mem.deviceId, id: '01JBXA7D1W3Q8K5N2M9R4T6Y0Z' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    b.s.dispose();
  });

  it('explains a passage with related passages; returns a turn', async () => {
    const b = await bed();
    const t = await b.ask.explain(CORPUS[0]!, 'simpler');
    expect(t.status).toBe('ok');
    expect(t.citations[0]!.ref).toBe('S1');
    expect(t.sent![0]!.label).toBe('Lei Fundamental · p. 9 · art. 18.º');
    expect(chat(b.ai)[0]!.activity?.action).toBe('explain');
    b.s.dispose();
  });
});

describe('AskService: lectures (UX §3.5.4)', () => {
  it('summary and key terms cite transcript times and are saved privately per lecture', async () => {
    const b = await bed();
    await addLecture(b);
    const sum = await b.ask.summarize(LECTURE);
    expect(sum).toMatchObject({ status: 'ok', scope: { kinds: ['lecture'], lectureId: LECTURE } });
    expect(sum.citations[0]).toMatchObject({ source: { kind: 'lecture', lectureId: LECTURE, transcriptRevision: 2 }, locator: { type: 'segment' } });
    expect(sum.citations[0]!.label).toMatch(/^Aula 6 — Restrições · \d+:\d\d$/);
    const terms = await b.ask.keyTerms(LECTURE);
    const saved = JSON.parse(dec.decode((await b.platform.privateFiles.read(b.classId, `lectures/${LECTURE}.json`))!));
    expect(saved).toMatchObject({ format: 'tramado.lecture-private', version: 1, summary: { id: sum.id }, terms: { id: terms.id }, removedAutoMarks: [] });
    expect(await b.ask.lectureNotes(LECTURE)).toMatchObject({ summary: { id: sum.id }, terms: { id: terms.id } });
    expect(chat(b.ai).map((r) => r.activity?.action)).toEqual(['summary', 'terms']);
    b.s.dispose();
  });

  it('Annotate with AI writes private annotation lines with ai:{model}, anchored to segments', async () => {
    const b = await bed();
    await addLecture(b);
    const n = await b.ask.annotate(LECTURE);
    expect(n).toBeGreaterThan(0);
    const lines = dec.decode((await b.platform.privateFiles.read(b.classId, 'annotations.jsonl'))!).trim().split('\n').map((l) => JSON.parse(l) as AnnotationLine);
    expect(lines).toHaveLength(n);
    expect(lines[0]).toMatchObject({ format: 'tramado.annotation', type: 'add', kind: 'comment', ai: { model: 'google/gemma-4-31b-it:free' }, target: { source: { kind: 'lecture', lectureId: LECTURE }, locator: { type: 'segment' } } });
    expect(lines[0]!.annotationId).toBe(lines[0]!.id);
    expect([...b.platform.mem.list(b.classId).keys()].some((p) => p.startsWith('.tramado/annotations'))).toBe(false);
    b.s.dispose();
  });

  it('study notes: a private note with tramado:lecture time links', async () => {
    const b = await bed();
    await addLecture(b);
    const path = await b.ask.studyNotes(LECTURE);
    expect(path).toMatch(/^notes\/Apontamentos — Aula 6 — Restrições\.md$/);
    const md = dec.decode((await b.platform.privateFiles.read(b.classId, path))!);
    expect(md).toMatch(new RegExp(`\\(tramado:lecture/${LECTURE}\\?t=\\d+\\)`));
    expect(md).not.toMatch(/\[S\d+\]/);
    b.s.dispose();
  });
});

describe('AskService: UI-EXAMS additions (wave 2)', () => {
  it('lecture AI reads the EFFECTIVE transcript: a correction not folded yet is what the summary sees', async () => {
    const b = await bed();
    await addLecture(b);
    const lectures = b.s.forClass(b.classId).lectures as unknown as { edit: { setText(id: string, seg: string, t: string): Promise<void> }; idle(): Promise<void> };
    await lectures.edit.setText(LECTURE, 's_l6a02', 'O núcleo intocável é o limite dos limites: nenhuma restrição o pode atingir.');
    await b.idle();
    await lectures.idle();
    await b.ask.summarize(LECTURE);
    const body = JSON.stringify(bodyOf(chat(b.ai).at(-1)! as never).messages);
    expect(body).toContain('O núcleo intocável é o limite dos limites');
    expect(body).not.toContain('O conteúdo essencial é o limite dos limites');
    b.s.dispose();
  });

  it('study notes link the class documents they cite (tramado:doc) as well as transcript times', async () => {
    const b = await bed();
    await addLecture(b);
    b.ai.controls.next((req) => {
      const user = String(((req as { messages: Array<{ role: string; content: string }> }).messages.at(-1) ?? { content: '' }).content);
      const doc = /\[(S\d+)\] \(Lei Fundamental/.exec(user)?.[1] ?? 'S9';
      return `# Aula 6\n\n## Restrições\n\n- O conteúdo essencial é o limite dos limites [S3] (ver art. 18.º [${doc}]).`;
    });
    const path = await b.ask.studyNotes(LECTURE);
    const md = dec.decode((await b.platform.privateFiles.read(b.classId, path))!);
    expect(md).toMatch(new RegExp(`\\(tramado:lecture/${LECTURE}\\?t=\\d+\\)`));
    expect(md).toContain('(tramado:doc/Documents%2FLF.pdf?page=9)');
    expect(md).not.toMatch(/\[S\d+\]/);
    const sys = String(bodyOf(chat(b.ai).at(-1)! as never).messages?.[0]?.content);
    expect(sys).toMatch(/documentos da cadeira|class documents/i);
    b.s.dispose();
  });

  it('renameThread keeps a private title across restarts; removeThread forgets it', async () => {
    const b = await bed();
    const tid = await b.ask.ask(null, 'O que diz o artigo 18 sobre as restrições?', { kinds: [] });
    await settle(b, tid);
    await b.ask.renameThread(tid, '  Artigo   18  ');
    expect(b.ask.threads.get()[0]!.title).toBe('Artigo 18');
    const again = createAskService(b.ctx, () => b.s, { store: b.s.forClass(b.classId).store, classId: b.classId }) as AskService & { idle(): Promise<void> };
    await again.idle();
    expect(again.threads.get()[0]!.title).toBe('Artigo 18');
    await expect(b.ask.renameThread(tid, '   ')).rejects.toMatchObject({ code: 'INVALID' });
    await b.ask.removeThread(tid);
    const titles = JSON.parse(dec.decode((await b.platform.privateFiles.read(b.classId, 'ask/titles.json'))!)) as { titles: Record<string, string> };
    expect(titles.titles[tid]).toBeUndefined();
    b.s.dispose();
  });

  it('the "My notes" chip off (privateNotes: false) keeps private notes out of what is sent', async () => {
    const b = await bed();
    const tid = await b.ask.ask(null, 'O artigo 18 e as restrições nos meus apontamentos', { kinds: [] }, { privateNotes: false });
    await settle(b, tid);
    expect(JSON.stringify(chat(b.ai).map((r) => r.body))).not.toContain('apontamentos privados');
    const t2 = await b.ask.ask(null, 'O artigo 18 e as restrições nos meus apontamentos', { kinds: [] });
    await settle(b, t2);
    expect(JSON.stringify(chat(b.ai).at(-1)!.body)).toContain('apontamentos privados');
    b.s.dispose();
  });

  it('postTurn posts a finished turn of another thread store; refuses private sources and other classes', async () => {
    const b = await bed();
    b.search.setPassages(CORPUS.slice(0, 2));
    const tid = await b.ask.ask(null, 'O que diz o artigo 18?', { kinds: [] });
    const [turn] = await settle(b, tid);
    await expect(b.ask.postTurn({ ...turn!, classOf: { S1: 'zzzzzzzzzzzzzzzzzzzzzzzzzz' } })).rejects.toMatchObject({ code: 'INVALID' });
    await b.ask.postTurn(turn!);
    expect([...b.platform.mem.list(b.classId).keys()].some((p) => p.startsWith(`.tramado/chat/${b.platform.mem.deviceId}/`))).toBe(true);
    b.s.dispose();
  });
});

describe('GlobalAskService: Ask across all classes (route ask)', () => {
  it('searches every class, records the class of each citation, keeps threads in the home class, survives a restart', async () => {
    const b = await bed();
    const other = await b.s.library.create({ name: 'Biology 101', colour: '#30a46c', icon: 'dna', language: 'en', share: false });
    await b.idle();
    const bio = testPassage({ id: 'primer#4', label: 'Cell Biology Primer · p. 4', source: { kind: 'document', path: 'Readings/Primer.pdf', sha256: 'd'.repeat(64) }, locator: { type: 'page', page: 4 }, text: 'Small non-polar molecules diffuse directly across the lipid bilayer, artigo 18 restrições.' });
    b.search.setPassages([...CORPUS.slice(0, 2), { ...bio, classId: other }]);
    const g = createGlobalAsk(b.ctx, () => b.s);
    const tid = await g.ask(null, 'O artigo 18 e as restrições', { kinds: [] });
    await g.idle();
    const [turn] = g.thread(tid).get();
    expect(turn).toMatchObject({ status: 'ok', scope: { classes: [] } });
    expect(Object.keys(turn!.classOf ?? {}).length).toBe(turn!.citations.length);
    expect(Object.values(turn!.classOf ?? {})).toContain(other);
    expect(chat(b.ai).at(-1)!.activity).toMatchObject({ action: 'ask', classId: null });
    const home = g.threads.get()[0]!.home;
    expect(await b.platform.privateFiles.read(home, `ask-all/${tid}.jsonl`)).not.toBeNull();
    // The class's own Ask tab does not list it.
    await b.ask.idle();
    expect(b.ask.threads.get().map((t) => t.threadId)).not.toContain(tid);
    const again = createGlobalAsk(b.ctx, () => b.s);
    await again.idle();
    await again.renameThread(tid, 'Restrições');
    expect(again.threads.get()[0]).toMatchObject({ threadId: tid, title: 'Restrições', home });
    expect(again.thread(tid).get()[0]!.classOf).toEqual(turn!.classOf);
    // Narrowed to one class: only its passages are sent.
    const t2 = await again.ask(null, 'non-polar molecules bilayer', { kinds: [], classes: [other] });
    await again.idle();
    expect(Object.values(again.thread(t2).get()[0]!.classOf ?? {})).toEqual([other]);
    await again.removeThread(tid);
    expect(again.threads.get().map((t) => t.threadId)).toEqual([t2]);
    expect(await b.platform.privateFiles.read(home, `ask-all/${tid}.jsonl`)).toBeNull();
    b.s.dispose();
  });
});

void manifestJson;
void enc;
