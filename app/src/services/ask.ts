// AskService (architecture §11.2; UX §3.11, §3.5.4, §3.10): Ask threads kept privately in
// `private/<classId>/ask/<threadId>.jsonl`, Explain, lecture summary and key terms (`private/<classId>/lectures/<id>.json`),
// "Annotate with AI" (private annotation lines with `ai: {model}`), study notes (a private note with time links), `@AI`
// in chat (an `ai` line replying to the question) and "Post to class chat" (an `ai` line with `question`; refused when
// the answer cites a private source). One request per question; two with cross-language query expansion.
import { PlatformError, errorCode, errorData, type ErrorCode } from '../core/errors';
import { readAnswer, retrieve } from '../core/ai/answer';
import { citeRegex } from '../core/ai/citations';
import { lectureParts, lectureSource, lectureTitle, noteLinks, transcriptWindows } from '../core/ai/lecture';
import { PACKS, answerMessages, answerSystem, detectLang, languageRule, promptLang, sourcesBlock, type PromptLang } from '../core/ai/prompts';
import { runToolLoop } from '../core/ai/toolLoop';
import { tolerantParse } from '../core/ai/tolerantJson';
import { RefTable, type PassageLike } from '../core/ai/tools';
import type { RunResult } from '../core/ai/client';
import type { AiEvent } from '../core/ai/types';
import { expansionMessages, parseExpansion } from '../core/exam/quick';
import { parseHlc } from '../core/hlc';
import { newUlid } from '../core/ids';
import { jsonlLine, manifestJson } from '../core/json';
import type { AnnotationLine, AskHistoryLine, ChatAi, ChatLine, ChatMessage, Citation, LectureFile, MsgRef, SourceRef, TranscriptFile } from '../core/model/files';
import type { ClassId, ClassPath, Ulid } from '../core/model/ids';
import { parserFor } from '../core/model/parse';
import { sanitize, unique } from '../core/model/sanitize';
import { instant } from '../core/model/time';
import { fold } from '../core/text/normalize';
import { isPrivateSource } from './ai';
import { Store } from './store';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { AskOptions, AskService, AskTurn, ExplainStyle, GlobalAskService } from './types/ask';
import type { LectureService } from './types/lectures';
import type { Passage } from './types/search';

const CHAT_PARSE = parserFor('tramado.chat');
const LECTURE_PARSE = parserFor('tramado.lecture');
const TRANSCRIPT_PARSE = parserFor('tramado.transcript');
const TITLE_MAX = 60;

interface LecturePrivate { format: 'tramado.lecture-private'; version: 1; summary: AskTurn | null; terms: AskTurn | null; removedAutoMarks: number[] }
type Stored = AskHistoryLine & Pick<AskTurn, 'sent' | 'requestedModel' | 'general' | 'mode' | 'privacy' | 'classOf' | 'cut' | 'retryAfterS'>;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The month file of a chat line: the UTC month of its HLC's ms (folder spec §8.16). */
export const chatMonthPath = (deviceId: string, hlc: string): ClassPath => `.tramado/chat/${deviceId}/${new Date(parseHlc(hlc).ms).toISOString().slice(0, 7)}.jsonl`;

/** `<@ai>`, `<@member>` and `<@everyone>` tokens out of a chat question. */
export const stripTokens = (text: string): string => text.replace(/<@(?:ai|everyone|[a-z2-7]{26})>/g, ' ').replace(/\s+/g, ' ').trim();

function parseLines(bytes: Uint8Array | null): Stored[] {
  if (!bytes) return [];
  const out: Stored[] = [];
  for (const line of dec.decode(bytes).split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as Stored;
      if (v && v.format === 'tramado.ask' && typeof v.id === 'string') out.push(v);
    } catch {
      // a broken line (a crash mid-append) is skipped
    }
  }
  return out;
}
const toTurn = (l: Stored): AskTurn => ({
  id: l.id, question: l.question, scope: l.scope, answer: l.answer, citations: l.citations, model: l.model, status: l.status === 'running' ? 'error' : l.status,
  error: (l.status === 'running' ? 'CANCELLED' : l.error) as ErrorCode | null, at: l.at,
  ...(l.sent ? { sent: l.sent } : {}), ...(l.requestedModel !== undefined ? { requestedModel: l.requestedModel } : {}),
  ...(l.general !== undefined ? { general: l.general } : {}), ...(l.mode ? { mode: l.mode } : {}), ...(l.privacy ? { privacy: l.privacy } : {}),
  ...(l.classOf ? { classOf: l.classOf } : {}), ...(l.cut ? { cut: true } : {}), ...(typeof l.retryAfterS === 'number' ? { retryAfterS: l.retryAfterS } : {}),
});
const toLine = (t: AskTurn): Stored => ({
  format: 'tramado.ask', version: 1, id: t.id, question: t.question, scope: t.scope, answer: t.answer, citations: t.citations, model: t.model,
  status: t.status, error: t.error, at: t.at,
  ...(t.sent ? { sent: t.sent } : {}), ...(t.requestedModel !== undefined ? { requestedModel: t.requestedModel } : {}),
  ...(t.general !== undefined ? { general: t.general } : {}), ...(t.mode ? { mode: t.mode } : {}), ...(t.privacy ? { privacy: t.privacy } : {}),
  ...(t.classOf ? { classOf: t.classOf } : {}), ...(t.cut ? { cut: true } : {}), ...(typeof t.retryAfterS === 'number' ? { retryAfterS: t.retryAfterS } : {}),
});

/** INT: what a failed turn keeps besides its code — when a rate limit said to come back (Retry-After). */
export function failedTurn(e: unknown): Pick<AskTurn, 'status' | 'error' | 'retryAfterS'> {
  const after = errorData(e).retryAfterMs;
  return { status: 'error', error: errorCode(e), ...(typeof after === 'number' && after > 0 ? { retryAfterS: Math.ceil(after / 1000) } : {}) };
}

/** Private thread titles set with Rename (`ask/titles.json`, `ask-all/titles.json`). */
async function readTitles(platform: AppContext['platform'], classId: ClassId, dir: string): Promise<Record<string, string>> {
  try {
    const b = await platform.privateFiles.read(classId, `${dir}/titles.json`);
    if (!b) return {};
    const j = JSON.parse(dec.decode(b)) as { format?: string; titles?: Record<string, unknown> };
    if (j.format !== 'tramado.ask-titles' || !j.titles) return {};
    return Object.fromEntries(Object.entries(j.titles).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}
async function writeTitles(platform: AppContext['platform'], classId: ClassId, dir: string, titles: Record<string, string>): Promise<void> {
  await platform.privateFiles.write(classId, `${dir}/titles.json`, enc.encode(manifestJson({ format: 'tramado.ask-titles', version: 1, titles })));
}
const cleanTitle = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);

/** Frequent content words of a text (study notes look up the documents a lecture talks about). */
export function topWords(text: string, n: number): string[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}º]{6,}/gu) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([w]) => w);
}

/** INT: the room of [Answer again with more room] (the `chat` profile's 4 000 tokens, doubled). */
const MORE_ROOM_TOKENS = 8_000;

export function createAskService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): AskService & { idle(): Promise<void> } {
  const { platform } = ctx;
  const { store, classId } = cls;
  const threads = new Store<Array<{ threadId: Ulid; title: string; at: string }>>([]);
  const turns = new Map<Ulid, Store<AskTurn[]>>();
  const pending = new Set<Promise<unknown>>();
  const now = () => ctx.clock.now();
  const ai = () => app().ai;
  const notesDir = () => store.dir('notes');
  const track = <T>(p: Promise<T>): Promise<T> => {
    pending.add(p);
    void p.finally(() => pending.delete(p)).catch(() => undefined);
    return p;
  };

  // ── Threads (private, one JSONL file per thread) ───────────────────────────────────────────────────
  let titles: Record<string, string> = {};
  const loaded = track((async () => {
    try {
      titles = await readTitles(platform, classId, 'ask');
      const names = await platform.privateFiles.list(classId, 'ask');
      const rows: Array<{ threadId: Ulid; title: string; at: string }> = [];
      for (const n of names.filter((x) => x.endsWith('.jsonl'))) {
        const threadId = n.replace(/^.*\//, '').replace(/\.jsonl$/, '');
        const lines = parseLines(await platform.privateFiles.read(classId, `ask/${threadId}.jsonl`));
        if (!lines.length) continue;
        turns.set(threadId, new Store(lines.map(toTurn)));
        rows.push({ threadId, title: titles[threadId] ?? lines[0]!.question.slice(0, TITLE_MAX), at: lines.at(-1)!.at });
      }
      threads.set(rows.sort((a, b) => b.at.localeCompare(a.at)));
    } catch (e) {
      if (errorCode(e) !== 'NOT_FOUND') ctx.log('warn', 'Ask history unreadable', { error: String(e) });
    }
  })());

  function threadStore(id: Ulid): Store<AskTurn[]> {
    let s = turns.get(id);
    if (!s) {
      s = new Store<AskTurn[]>([]);
      turns.set(id, s);
    }
    return s;
  }
  function touchThread(id: Ulid, title: string, at: string) {
    const rest = threads.get().filter((t) => t.threadId !== id);
    const prev = threads.get().find((t) => t.threadId === id);
    threads.set([{ threadId: id, title: prev?.title ?? title.slice(0, TITLE_MAX), at }, ...rest]);
  }
  const setTurn = (threadId: Ulid, turn: AskTurn) => threadStore(threadId).update((ts) => ts.map((t) => (t.id === turn.id ? turn : t)));

  // ── Language and sources ───────────────────────────────────────────────────────────────────────────
  function classLang(): string | null {
    try {
      const l = app().forClass(classId).info.detail.get().meta.language;
      return l && l !== 'auto' ? l : null;
    } catch {
      return null;
    }
  }
  const uiLang = (): PromptLang => promptLang(ctx.prefs.get('ui.locale') || 'en');
  const answerLanguage = (): 'question' | PromptLang => (ctx.prefs.get('ai.answerLanguage') === 'ui' ? uiLang() : 'question');
  const langOf = (text: string): PromptLang => detectLang(text) ?? promptLang(classLang() ?? ctx.prefs.get('ui.locale'));

  async function findPassages(query: string, scope: AskTurn['scope'], opts: { sharedOnly: boolean; limit?: number }): Promise<PassageLike[]> {
    const kinds = scope.kinds.length ? scope.kinds : undefined;
    const ps = await app().search.passages(classId, query, { limit: opts.limit ?? 30, ...(kinds ? { kinds } : {}) });
    return ps.filter((p) => {
      if (opts.sharedOnly && isPrivateSource(p.source, notesDir())) return false;
      if (scope.lectureId && !(p.source.kind === 'lecture' && p.source.lectureId === scope.lectureId)) return false;
      if (scope.docPath && !(p.source.kind === 'document' && p.source.path === scope.docPath)) return false;
      return true;
    });
  }

  /** Cross-language query expansion (UX §3.11: 2 requests when the class language differs from the question's). */
  async function expand(question: string, lang: PromptLang, busyFallback: boolean): Promise<string[]> {
    const cl = classLang();
    if (!cl || promptLang(cl) === lang) return [];
    try {
      const r = await ai().client.run({
        task: 'expand', activity: { classId, action: 'ask', passages: 0 }, ...(busyFallback ? { busyFallback: true } : {}),
        messages: expansionMessages(lang, [{ id: 'q_ask0000', number: '1', parent: null, group: null, kind: 'other', text: question, points: null, options: [], choose: null, source: null, answerKey: null }], PACKS[lang].languageNames[promptLang(cl)]),
      });
      return parseExpansion(r.content, ['q_ask0000']).q_ask0000 ?? [];
    } catch (e) {
      if (errorCode(e) === 'CANCELLED') throw e;
      return [];
    }
  }

  interface Answered { text: string; citations: Citation[]; run: Pick<RunResult, 'model' | 'requestedModel' | 'privacy'> & { finish?: string }; sent: AskTurn['sent'] }

  /** Retrieval + one answer (or the tool loop for Deep), streaming into `onText`. */
  async function answer(question: string, scope: AskTurn['scope'], o: { general: boolean; mode: 'quick' | 'deep'; model?: string; busyFallback?: boolean; sharedOnly: boolean; action: 'ask' | 'chat'; moreRoom?: boolean; onText?: (t: string) => void }): Promise<Answered> {
    const lang = langOf(question);
    let streamed = '';
    const onEvent = (e: AiEvent) => {
      if (e.kind === 'content') {
        streamed += e.text;
        o.onText?.(streamed);
      } else if (e.kind === 'retrying') {
        streamed = '';
        o.onText?.('');
      }
    };
    if (o.mode === 'deep') {
      const r = await runToolLoop({
        client: ai().client, lang, activity: { classId, action: 'deep', passages: 0 }, onEvent, ...(o.busyFallback ? { busyFallback: true } : {}),
        messages: [{ role: 'system', content: answerSystem({ lang, answerLanguage: answerLanguage(), general: o.general, role: 'tools' }) }, { role: 'user', content: question }],
        host: {
          search: (q, limit) => findPassages(q, scope, { sharedOnly: o.sharedOnly, limit }),
          read: async (id, offset, max) => {
            const p = await app().search.passage(classId, id, { offset, max });
            return p && !(o.sharedOnly && isPrivateSource(p.source, notesDir())) ? p : null;
          },
        },
      });
      const a = readAnswer(r.content, r.refs, o.general);
      return { text: a.text, citations: a.citations, run: r, sent: r.refs.entries().map(([ref, p]) => ({ ref, label: p.label, excerpt: p.text.slice(0, 200) })) };
    }
    const keywords = await expand(question, lang, !!o.busyFallback);
    const ret = retrieve(await findPassages([question, ...keywords].join(' '), scope, { sharedOnly: o.sharedOnly }));
    const r = await ai().client.run({
      task: 'chat', activity: { classId, action: o.action, passages: ret.sources.length }, onEvent,
      messages: answerMessages({ lang, answerLanguage: answerLanguage(), general: o.general, role: 'ask' }, question, ret.sources),
      ...(o.model ? { model: o.model } : {}), ...(o.busyFallback ? { busyFallback: true } : {}), ...(o.moreRoom ? { maxTokens: MORE_ROOM_TOKENS } : {}),
    });
    const a = readAnswer(r.content, ret.refs, o.general);
    return { text: a.text, citations: a.citations, run: r, sent: ret.sources.map((s) => ({ ref: s.ref, label: s.label, excerpt: s.text.slice(0, 200) })) };
  }

  async function persist(threadId: Ulid, turn: AskTurn) {
    await platform.privateFiles.append(classId, `ask/${threadId}.jsonl`, enc.encode(jsonlLine(toLine(turn))));
  }

  // ── Lectures (summary, key terms, annotate, study notes) ───────────────────────────────────────────
  /**
   * The EFFECTIVE transcript (LectureService's corrected view: transcript.json + the corrections not folded yet,
   * folder spec §8.9), so summaries, key terms, annotations and study notes read what the class corrected.
   */
  async function effectiveTranscript(lectureId: Ulid): Promise<TranscriptFile | null> {
    try {
      const lectures = app().forClass(classId).lectures as LectureService & { idle?(): Promise<void> };
      const st = lectures.open(lectureId);
      if (!st.get()?.transcript) await lectures.idle?.();
      const t = st.get()?.transcript ?? null;
      if (!t || t.lectureId !== lectureId) return null;
      const { concurrent: _c, unfolded: _u, stale: _s, newer: _n, correctedBy: _b, ...file } = t;
      return file;
    } catch {
      return null;
    }
  }

  async function lectureData(lectureId: Ulid): Promise<{ t: TranscriptFile; title: string; windows: PassageLike[] }> {
    const item = store.state.get().index.lectures.get(lectureId);
    if (!item) throw new PlatformError('NOT_FOUND', `lecture ${lectureId}`);
    const lec = await store.readJson<LectureFile>(item.manifest, LECTURE_PARSE);
    const effective = await effectiveTranscript(lectureId);
    const tr = effective ? null : await store.readJson<TranscriptFile>(`${item.dir}/transcript.json`, TRANSCRIPT_PARSE);
    const t = effective ?? (tr && tr.value.lectureId === lectureId ? tr.value : null);
    if (!t) throw new PlatformError('NOT_FOUND', `no transcript for ${lectureId}`);
    const title = lectureTitle(lec?.value ?? null, item.dir.slice(item.dir.lastIndexOf('/') + 1));
    return { t, title, windows: transcriptWindows(t, title) };
  }

  /** Documents of the class the lecture talks about (study notes link them): top content words + the lecture title. */
  async function relatedDocuments(title: string, t: TranscriptFile, max = 6): Promise<PassageLike[]> {
    try {
      const query = [title, ...topWords(t.segments.map((x) => x.text).join(' '), 12)].join(' ');
      const ps = await app().search.passages(classId, query, { limit: 20, kinds: ['document'] });
      return ps.filter((p) => p.source.kind === 'document' && !isPrivateSource(p.source, notesDir())).slice(0, max);
    } catch {
      return [];
    }
  }

  /** One request per ≤ 40k-character part, plus a merge when there are several (critique G11). */
  async function overLecture(lectureId: Ulid, role: 'summaryRole' | 'termsRole' | 'studyNotesRole', action: 'summary' | 'terms' | 'studyNotes', opts: { documents?: boolean } = {}): Promise<{ text: string; refs: RefTable; model: string; requested: string; privacy: RunResult['privacy']; title: string; t: TranscriptFile }> {
    const { t, title, windows } = await lectureData(lectureId);
    if (!windows.length) throw new PlatformError('NOT_FOUND', 'the transcript is empty');
    const lang = promptLang(t.language);
    const p = PACKS[lang];
    const refs = new RefTable();
    for (const w of windows) refs.add(w);   // transcript refs first: S1…Sn in time order
    const docs = opts.documents ? await relatedDocuments(title, t) : [];
    const docSources = docs.map((d) => ({ ref: refs.add(d), label: d.label, text: d.text.slice(0, 1200) }));
    const outs: string[] = [];
    let last: RunResult | null = null;
    for (const part of lectureParts(windows)) {
      const sources = part.map((w) => ({ ref: refs.add(w), label: w.label, text: w.text }));
      const user = `${p.labels.transcript} — ${title}:\n\n${sourcesBlock(p, sources)}${docSources.length ? `\n\n${p.labels.documents}:\n\n${sourcesBlock(p, docSources)}` : ''}`;
      last = await ai().client.run({
        task: 'summary', priority: 'bulk', activity: { classId, action, passages: sources.length + docSources.length },
        messages: [
          { role: 'system', content: [p.role, p[role], ...(docSources.length ? [p.studyNotesDocs] : []), p.citeRule, languageRule(p, answerLanguage())].join(' ') },
          { role: 'user', content: user },
        ],
      });
      outs.push(last.content.trim());
    }
    if (outs.length > 1) {
      last = await ai().client.run({
        task: 'summary', priority: 'bulk', activity: { classId, action, passages: 0 },
        messages: [{ role: 'system', content: [p.role, p.mergeRole, p[role], languageRule(p, answerLanguage())].join(' ') }, { role: 'user', content: outs.join('\n\n---\n\n') }],
      });
    }
    return { text: last!.content.trim(), refs, model: last!.model, requested: last!.requestedModel, privacy: last!.privacy, title, t };
  }

  async function readLecturePrivate(lectureId: Ulid): Promise<LecturePrivate> {
    const empty: LecturePrivate = { format: 'tramado.lecture-private', version: 1, summary: null, terms: null, removedAutoMarks: [] };
    try {
      const b = await platform.privateFiles.read(classId, `lectures/${lectureId}.json`);
      if (!b) return empty;
      const j = JSON.parse(dec.decode(b)) as Partial<LecturePrivate>;
      return j.format === 'tramado.lecture-private' ? { ...empty, ...j } as LecturePrivate : empty;
    } catch {
      return empty;
    }
  }
  async function lectureTurn(lectureId: Ulid, kind: 'summary' | 'terms'): Promise<AskTurn> {
    const r = await overLecture(lectureId, kind === 'summary' ? 'summaryRole' : 'termsRole', kind);
    const a = readAnswer(r.text, r.refs, false);
    const p = PACKS[promptLang(r.t.language)];
    const turn: AskTurn = {
      id: newUlid(now(), ctx.rand), question: `${kind === 'summary' ? p.labels.summary : p.labels.terms} — ${r.title}`, scope: { kinds: ['lecture'], lectureId },
      answer: a.text, citations: a.citations, model: r.model, status: 'ok', error: null, at: instant(now()), requestedModel: r.requested, privacy: r.privacy,
    };
    // Rewrites only its own field; `removedAutoMarks` belongs to LectureService and is kept (read just before writing).
    const cur = await readLecturePrivate(lectureId);
    await platform.privateFiles.write(classId, `lectures/${lectureId}.json`, enc.encode(manifestJson({ ...cur, [kind]: turn })));
    return turn;
  }

  // ── Chat (`ai` lines, folder spec §8.16) ───────────────────────────────────────────────────────────
  async function findChatMessage(ref: MsgRef): Promise<ChatMessage | null> {
    const prefix = `.tramado/chat/${ref.deviceId}/`;
    const files = [...store.state.get().index.machine.keys()].filter((p) => p.startsWith(prefix) && p.endsWith('.jsonl')).sort().reverse();
    for (const f of files) {
      const r = await store.readJsonl<ChatLine>(f, CHAT_PARSE);
      const hit = r.lines.find((l) => l.value.id === ref.id && l.value.type === 'message' && !l.value.redacted);
      if (hit) return hit.value as ChatMessage;
    }
    return null;
  }
  async function writeAiLine(fields: Pick<ChatAi, 'status' | 'text' | 'citations' | 'model' | 'requestedModel' | 'privacy'> & { replyTo?: MsgRef; question?: string; error?: string }) {
    const d = ctx.device.get();
    const id = ctx.identity.get();
    if (!d || !id) throw new PlatformError('INVALID', 'this computer has no identity yet');
    const hlc = ctx.hlc.tick();
    const line: ChatAi = {
      format: 'tramado.chat', version: 1, type: 'ai', id: newUlid(now(), ctx.rand), hlc, ms: parseHlc(hlc).ms, memberId: id.memberId,
      ...(fields.replyTo ? { replyTo: fields.replyTo } : {}), ...(fields.question !== undefined ? { question: fields.question.slice(0, 2000) } : {}),
      status: fields.status, text: fields.text, citations: fields.citations, model: fields.model, requestedModel: fields.requestedModel, privacy: fields.privacy,
      ...(fields.error ? { error: fields.error } : {}),
    };
    await store.appendLine(chatMonthPath(d.deviceId, hlc), line);
  }
  const settingsPrivacy = (): ChatAi['privacy'] => {
    const s = ai().settings.get();
    return s.customHost ? 'custom-host' : s.privacy;
  };
  async function postTurn(turn: AskTurn): Promise<void> {
    if (turn.status !== 'ok') throw new PlatformError('INVALID', 'only a finished answer can be posted');
    if (turn.citations.some((c) => isPrivateSource(c.source, notesDir()))) throw new PlatformError('INVALID', 'answers that use your private notes can’t be posted', { private: true });
    if (turn.classOf && Object.values(turn.classOf).some((c) => c !== classId)) throw new PlatformError('INVALID', 'the answer cites another class', { otherClass: true });
    await writeAiLine({
      question: turn.question, status: 'ok', text: turn.answer, citations: turn.citations, model: turn.model ?? '', requestedModel: turn.requestedModel ?? turn.model ?? '',
      privacy: turn.privacy ?? settingsPrivacy(),
    });
  }

  return {
    threads,
    thread: (threadId) => threadStore(threadId),
    async idle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    async ask(threadId, question, scope, opts: AskOptions = {}) {
      await loaded;
      const q = question.trim();
      if (!q) throw new PlatformError('INVALID', 'an empty question');
      const tid = threadId ?? newUlid(now(), ctx.rand);
      const general = opts.general ?? ctx.prefs.get('ai.generalDefault') === '1';
      const mode = opts.mode ?? 'quick';
      let turn: AskTurn = { id: newUlid(now(), ctx.rand), question: q, scope, answer: '', citations: [], model: null, status: 'running', error: null, at: instant(now()), general, mode };
      threadStore(tid).update((ts) => [...ts, turn]);
      touchThread(tid, q, turn.at);
      void track((async () => {
        try {
          const a = await answer(q, scope, {
            general, mode, sharedOnly: opts.privateNotes === false, action: 'ask', ...(opts.model ? { model: opts.model } : {}), ...(opts.busyFallback ? { busyFallback: true } : {}),
            ...(opts.moreRoom ? { moreRoom: true } : {}),
            onText: (t) => setTurn(tid, (turn = { ...turn, answer: t })),
          });
          turn = {
            ...turn, answer: a.text, citations: a.citations, model: a.run.model, requestedModel: a.run.requestedModel, privacy: a.run.privacy, status: 'ok', sent: a.sent ?? [],
            ...(a.run.finish === 'length' ? { cut: true } : {}),
          };
        } catch (e) {
          turn = { ...turn, answer: '', ...failedTurn(e) };
        }
        setTurn(tid, turn);
        await persist(tid, turn).catch((e: unknown) => ctx.log('warn', 'Ask turn not saved', { error: String(e) }));
      })());
      return tid;
    },
    async explain(passage, style: ExplainStyle) {
      const text = passage.text.trim();
      const lang = langOf(text);
      const self: PassageLike = 'id' in passage ? (passage as Passage) : { id: 'explain-selection', label: '', text, source: passage.source, locator: passage.locator };
      const turn: AskTurn = { id: newUlid(now(), ctx.rand), question: text.slice(0, 2000), scope: { kinds: [] }, answer: '', citations: [], model: null, status: 'running', error: null, at: instant(now()) };
      try {
        const related = (await findPassages(text.split(/\s+/).slice(0, 30).join(' '), { kinds: [] }, { sharedOnly: false, limit: 8 })).filter((p) => p.id !== self.id);
        const ret = retrieve([self, ...related], { max: 5 });
        const r = await ai().client.run({
          task: 'explain', activity: { classId, action: 'explain', passages: ret.sources.length },
          messages: answerMessages({ lang, answerLanguage: style === 'translate' ? uiLang() : answerLanguage(), general: true, role: 'explain', explain: style }, `${PACKS[lang].labels.passage} [S1]: «${text.slice(0, 3000)}»`, ret.sources),
        });
        const a = readAnswer(r.content, ret.refs, true);
        return { ...turn, answer: a.text, citations: a.citations, model: r.model, requestedModel: r.requestedModel, privacy: r.privacy, status: 'ok', sent: ret.sources.map((s) => ({ ref: s.ref, label: s.label, excerpt: s.text.slice(0, 200) })) };
      } catch (e) {
        return { ...turn, status: 'error', error: errorCode(e) };
      }
    },
    summarize: (lectureId) => lectureTurn(lectureId, 'summary'),
    keyTerms: (lectureId) => lectureTurn(lectureId, 'terms'),
    async lectureNotes(lectureId) {
      const f = await readLecturePrivate(lectureId);
      return { summary: f.summary, terms: f.terms };
    },
    async annotate(lectureId) {
      const { t, title, windows } = await lectureData(lectureId);
      const d = ctx.device.get();
      const me = ctx.identity.get();
      if (!d || !me) throw new PlatformError('INVALID', 'this computer has no identity yet');
      const lang = promptLang(t.language);
      const p = PACKS[lang];
      const refs = new RefTable();
      const src: SourceRef = lectureSource(t);
      let count = 0;
      for (const part of lectureParts(windows)) {
        const sources = part.map((w) => ({ ref: refs.add(w), label: w.label, text: w.text }));
        const r = await ai().client.run({
          task: 'summary', priority: 'bulk', activity: { classId, action: 'annotate', passages: sources.length },
          messages: [{ role: 'system', content: [p.role, p.annotateRole, languageRule(p, answerLanguage())].join(' ') }, { role: 'user', content: `${p.labels.transcript} — ${title}:\n\n${sourcesBlock(p, sources)}` }],
        });
        const json = tolerantParse(r.content) as { terms?: Array<{ term?: unknown; note?: unknown; ref?: unknown }> } | null;
        for (const term of (json?.terms ?? []).slice(0, 15)) {
          const name = typeof term.term === 'string' ? term.term.trim().slice(0, 80) : '';
          const note = typeof term.note === 'string' ? term.note.trim().slice(0, 400) : '';
          const w = typeof term.ref === 'string' ? refs.get(term.ref.trim()) : null;
          if (!name || !w || w.locator.type !== 'segment') continue;
          const loc = w.locator;
          const segs = t.segments.filter((s) => s.startMs >= loc.startMs && s.endMs <= loc.endMs);
          const needle = fold(name);
          const seg = segs.find((s) => fold(s.text).includes(needle)) ?? segs[0];
          if (!seg) continue;
          const at = fold(seg.text).indexOf(needle);
          const exact = at >= 0 ? seg.text.slice(at, at + name.length) : seg.text.slice(0, 300);
          const hlc = ctx.hlc.tick();
          const id = newUlid(now(), ctx.rand);
          const line: AnnotationLine = {
            format: 'tramado.annotation', version: 1, type: 'add', id, annotationId: id, hlc, ms: now(), memberId: me.memberId, kind: 'comment',
            target: {
              source: src,
              locator: { type: 'segment', segmentId: seg.id, startMs: seg.startMs, endMs: seg.endMs, ...(at >= 0 ? { charStart: at, charEnd: at + name.length } : {}) },
              quote: { exact, prefix: at >= 0 ? seg.text.slice(Math.max(0, at - 32), at) : '', suffix: at >= 0 ? seg.text.slice(at + name.length, at + name.length + 32) : '' },
            },
            body: note ? `**${name}** — ${note}` : `**${name}**`, ai: { model: r.model },
          };
          await platform.privateFiles.append(classId, 'annotations.jsonl', enc.encode(jsonlLine(line)));
          count++;
        }
      }
      return count;
    },
    async studyNotes(lectureId) {
      const r = await overLecture(lectureId, 'studyNotesRole', 'studyNotes', { documents: true });
      const p = PACKS[promptLang(r.t.language)];
      const body = noteLinks(r.text, lectureId, (ref) => r.refs.get(ref)).replace(citeRegex(), '');
      const header = `<!-- ${p.labels.studyNotes} · AI · ${r.model} -->\n`;
      let names: string[] = [];
      try {
        names = (await platform.privateFiles.list(classId, 'notes')).map((n) => n.replace(/^.*\//, ''));
      } catch {
        names = [];
      }
      const name = unique(names, `${sanitize(`${p.labels.studyNotes} — ${r.title}`, p.labels.studyNotes)}.md`);
      const path = `notes/${name}`;
      await platform.privateFiles.write(classId, path, enc.encode(`${header}${body.trim()}\n`));
      return path;
    },
    async askInChat(question) {
      const msg = await findChatMessage(question);
      if (!msg) throw new PlatformError('NOT_FOUND', 'the question is not in the chat (yet)');
      const q = stripTokens(msg.text);
      try {
        const a = await answer(q, { kinds: [] }, { general: ctx.prefs.get('ai.generalDefault') === '1', mode: 'quick', sharedOnly: true, action: 'chat' });
        await writeAiLine({ replyTo: question, status: 'ok', text: a.text, citations: a.citations, model: a.run.model, requestedModel: a.run.requestedModel, privacy: a.run.privacy });
      } catch (e) {
        const code = errorCode(e);
        if (code === 'CANCELLED') throw e;
        const s = ai().settings.get();
        await writeAiLine({ replyTo: question, status: 'error', text: '', citations: [], model: s.chain[0] ?? s.model, requestedModel: s.chain[0] ?? s.model, privacy: settingsPrivacy(), error: code });
      }
    },
    async postToChat(threadId, turnId) {
      await loaded;
      const turn = threadStore(threadId).get().find((t) => t.id === turnId);
      if (!turn) throw new PlatformError('NOT_FOUND', `turn ${turnId}`);
      await postTurn(turn);
    },
    postTurn: (turn) => postTurn(turn),
    async renameThread(threadId, title) {
      await loaded;
      const clean = cleanTitle(title);
      if (!clean) throw new PlatformError('INVALID', 'an empty title');
      if (!threads.get().some((t) => t.threadId === threadId)) throw new PlatformError('NOT_FOUND', `thread ${threadId}`);
      titles = { ...titles, [threadId]: clean };
      await writeTitles(platform, classId, 'ask', titles);
      threads.set(threads.get().map((t) => (t.threadId === threadId ? { ...t, title: clean } : t)));
    },
    async removeThread(threadId) {
      await loaded;
      await platform.privateFiles.remove(classId, `ask/${threadId}.jsonl`).catch((e: unknown) => {
        if (errorCode(e) !== 'NOT_FOUND') throw e;
      });
      if (titles[threadId]) {
        const { [threadId]: _gone, ...rest } = titles;
        titles = rest;
        await writeTitles(platform, classId, 'ask', titles).catch(() => undefined);
      }
      turns.delete(threadId);
      threads.set(threads.get().filter((t) => t.threadId !== threadId));
    },
    async clear() {
      await loaded;
      await platform.privateFiles.remove(classId, 'ask', true).catch((e: unknown) => {
        if (errorCode(e) !== 'NOT_FOUND') throw e;
      });
      for (const s of turns.values()) s.set([]);
      turns.clear();
      threads.set([]);
    },
  };
}


// ── Ask across all classes (route `ask`, UX §3.11; UI-EXAMS) ─────────────────────────────────────────

const GLOBAL_DIR = 'ask-all';
const globals = new WeakMap<AppServices, GlobalAskService>();

/** The one GlobalAskService of an AppServices (created on first use by the `ask` route). */
export function globalAskFor(app: AppServices): GlobalAskService {
  let g = globals.get(app);
  if (!g) {
    g = createGlobalAsk(app.ctx, () => app);
    globals.set(app, g);
  }
  return g;
}

export function createGlobalAsk(ctx: AppContext, app: () => AppServices): GlobalAskService {
  const { platform } = ctx;
  type Row = { threadId: Ulid; title: string; at: string; home: ClassId };
  const threads = new Store<Row[]>([]);
  const turns = new Map<Ulid, Store<AskTurn[]>>();
  const homes = new Map<Ulid, ClassId>();
  const titles = new Map<ClassId, Record<string, string>>();
  const pending = new Set<Promise<unknown>>();
  const now = () => ctx.clock.now();
  const track = <T>(p: Promise<T>): Promise<T> => {
    pending.add(p);
    void p.finally(() => pending.delete(p)).catch(() => undefined);
    return p;
  };
  const registered = () => app().library.classes.get();

  const loaded = track((async () => {
    const rows: Row[] = [];
    for (const c of registered()) {
      try {
        const t = await readTitles(platform, c.id, GLOBAL_DIR);
        titles.set(c.id, t);
        const names = await platform.privateFiles.list(c.id, GLOBAL_DIR);
        for (const n of names.filter((x) => x.endsWith('.jsonl'))) {
          const threadId = n.replace(/^.*\//, '').replace(/\.jsonl$/, '');
          const lines = parseLines(await platform.privateFiles.read(c.id, `${GLOBAL_DIR}/${threadId}.jsonl`));
          if (!lines.length) continue;
          turns.set(threadId, new Store(lines.map(toTurn)));
          homes.set(threadId, c.id);
          rows.push({ threadId, title: t[threadId] ?? lines[0]!.question.slice(0, TITLE_MAX), at: lines.at(-1)!.at, home: c.id });
        }
      } catch (e) {
        if (errorCode(e) !== 'NOT_FOUND') ctx.log('warn', 'Ask history (all classes) unreadable', { classId: c.id, error: String(e) });
      }
    }
    threads.set(rows.sort((a, b) => b.at.localeCompare(a.at)));
  })());

  const threadStore = (id: Ulid): Store<AskTurn[]> => {
    let s = turns.get(id);
    if (!s) {
      s = new Store<AskTurn[]>([]);
      turns.set(id, s);
    }
    return s;
  };
  const setTurn = (threadId: Ulid, turn: AskTurn) => threadStore(threadId).update((ts) => ts.map((t) => (t.id === turn.id ? turn : t)));
  const uiLang = (): PromptLang => promptLang(ctx.prefs.get('ui.locale') || 'en');
  const answerLanguage = (): 'question' | PromptLang => (ctx.prefs.get('ai.answerLanguage') === 'ui' ? uiLang() : 'question');
  const shortOf = (classId: ClassId) => registered().find((c) => c.id === classId)?.shortName ?? '';

  /** Passages of the chosen classes; a private note of a class stays allowed here (the thread is private). */
  async function find(query: string, classes: ClassId[], kinds: Array<SourceRef['kind']>, limit: number, seen: Map<string, ClassId>, privateNotes: boolean): Promise<PassageLike[]> {
    const wanted = new Set(classes);
    const ps = await app().search.passages(classes.length === 1 ? classes[0]! : 'all', query, { limit, ...(kinds.length ? { kinds } : {}) });
    const notesDirOf = (c: ClassId) => {
      try {
        return app().forClass(c).store.dir('notes');
      } catch {
        return '';
      }
    };
    const out = ps.filter((p) => wanted.has(p.classId) && (privateNotes || !(p.private || isPrivateSource(p.source, notesDirOf(p.classId)))));
    for (const p of out) seen.set(p.id, p.classId);
    return out;
  }

  async function answerAll(question: string, classes: ClassId[], kinds: Array<SourceRef['kind']>, o: { general: boolean; mode: 'quick' | 'deep'; model?: string; busyFallback?: boolean; privateNotes: boolean; moreRoom?: boolean; onText(t: string): void }) {
    const lang = detectLang(question) ?? uiLang();
    const seen = new Map<string, ClassId>();
    let streamed = '';
    const onEvent = (e: AiEvent) => {
      if (e.kind === 'content') {
        streamed += e.text;
        o.onText(streamed);
      } else if (e.kind === 'retrying') {
        streamed = '';
        o.onText('');
      }
    };
    const prefixed = (ref: string, label: string, id: string) => {
      const c = seen.get(id);
      return c && classes.length > 1 ? `${shortOf(c)} · ${label}` : label;
    };
    if (o.mode === 'deep') {
      const r = await runToolLoop({
        client: app().ai.client, lang, activity: { classId: null, action: 'deep', passages: 0 }, onEvent, ...(o.busyFallback ? { busyFallback: true } : {}),
        messages: [{ role: 'system', content: answerSystem({ lang, answerLanguage: answerLanguage(), general: o.general, role: 'tools' }) }, { role: 'user', content: question }],
        host: {
          search: (q, limit) => find(q, classes, kinds, limit, seen, o.privateNotes),
          read: async (id, offset, max) => {
            const c = seen.get(id);
            return c ? app().search.passage(c, id, { offset, max }) : null;
          },
        },
      });
      const a = readAnswer(r.content, r.refs, o.general);
      const classOf = Object.fromEntries(a.citations.map((c) => [c.ref, seen.get(r.refs.get(c.ref)?.id ?? '') ?? classes[0]!]));
      return { a, run: r as Pick<RunResult, 'model' | 'requestedModel' | 'privacy'> & { finish?: string }, classOf, sent: r.refs.entries().map(([ref, p]) => ({ ref, label: prefixed(ref, p.label, p.id), excerpt: p.text.slice(0, 200) })) };
    }
    const ret = retrieve(await find(question, classes, kinds, 30, seen, o.privateNotes));
    const sources = ret.sources.map((s) => ({ ...s, label: prefixed(s.ref, s.label, ret.refs.get(s.ref)?.id ?? '') }));
    const r = await app().ai.client.run({
      task: 'chat', activity: { classId: null, action: 'ask', passages: sources.length }, onEvent,
      messages: answerMessages({ lang, answerLanguage: answerLanguage(), general: o.general, role: 'ask' }, question, sources),
      ...(o.model ? { model: o.model } : {}), ...(o.busyFallback ? { busyFallback: true } : {}), ...(o.moreRoom ? { maxTokens: MORE_ROOM_TOKENS } : {}),
    });
    const a = readAnswer(r.content, ret.refs, o.general);
    const classOf = Object.fromEntries(a.citations.map((c) => [c.ref, seen.get(ret.refs.get(c.ref)?.id ?? '') ?? classes[0]!]));
    return { a, run: r, classOf, sent: sources.map((s) => ({ ref: s.ref, label: s.label, excerpt: s.text.slice(0, 200) })) };
  }

  return {
    threads,
    thread: (threadId) => threadStore(threadId),
    async idle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    async ask(threadId, question, scope, opts: AskOptions = {}) {
      await loaded;
      const q = question.trim();
      if (!q) throw new PlatformError('INVALID', 'an empty question');
      const live = registered().filter((c) => !c.archived);
      const known = new Set(registered().map((c) => c.id));
      const classes = (scope.classes?.length ? scope.classes.filter((c) => known.has(c)) : live.map((c) => c.id));
      if (!classes.length) throw new PlatformError('NOT_FOUND', 'no class to ask about');
      const tid = threadId ?? newUlid(now(), ctx.rand);
      const home = homes.get(tid) ?? classes[0]!;
      homes.set(tid, home);
      const general = opts.general ?? ctx.prefs.get('ai.generalDefault') === '1';
      const mode = opts.mode ?? 'quick';
      let turn: AskTurn = { id: newUlid(now(), ctx.rand), question: q, scope: { ...scope, classes: scope.classes ?? [] }, answer: '', citations: [], model: null, status: 'running', error: null, at: instant(now()), general, mode };
      threadStore(tid).update((ts) => [...ts, turn]);
      const prev = threads.get().find((t) => t.threadId === tid);
      threads.set([{ threadId: tid, title: prev?.title ?? q.slice(0, TITLE_MAX), at: turn.at, home }, ...threads.get().filter((t) => t.threadId !== tid)]);
      void track((async () => {
        try {
          const r = await answerAll(q, classes, scope.kinds, {
            general, mode, ...(opts.model ? { model: opts.model } : {}), ...(opts.busyFallback ? { busyFallback: true } : {}), privateNotes: opts.privateNotes !== false,
            ...(opts.moreRoom ? { moreRoom: true } : {}),
            onText: (t) => setTurn(tid, (turn = { ...turn, answer: t })),
          });
          turn = {
            ...turn, answer: r.a.text, citations: r.a.citations, model: r.run.model, requestedModel: r.run.requestedModel, privacy: r.run.privacy, status: 'ok', sent: r.sent, classOf: r.classOf,
            ...(r.run.finish === 'length' ? { cut: true } : {}),
          };
        } catch (e) {
          turn = { ...turn, answer: '', ...failedTurn(e) };
        }
        setTurn(tid, turn);
        await platform.privateFiles.append(home, `${GLOBAL_DIR}/${tid}.jsonl`, enc.encode(jsonlLine(toLine(turn)))).catch((e: unknown) => ctx.log('warn', 'Ask turn not saved', { error: String(e) }));
      })());
      return tid;
    },
    async removeThread(threadId) {
      await loaded;
      const home = homes.get(threadId);
      if (home) {
        await platform.privateFiles.remove(home, `${GLOBAL_DIR}/${threadId}.jsonl`).catch((e: unknown) => {
          if (errorCode(e) !== 'NOT_FOUND') throw e;
        });
        const t = titles.get(home);
        if (t?.[threadId]) {
          const { [threadId]: _gone, ...rest } = t;
          titles.set(home, rest);
          await writeTitles(platform, home, GLOBAL_DIR, rest).catch(() => undefined);
        }
      }
      turns.delete(threadId);
      homes.delete(threadId);
      threads.set(threads.get().filter((t) => t.threadId !== threadId));
    },
    async renameThread(threadId, title) {
      await loaded;
      const clean = cleanTitle(title);
      const home = homes.get(threadId);
      if (!clean) throw new PlatformError('INVALID', 'an empty title');
      if (!home) throw new PlatformError('NOT_FOUND', `thread ${threadId}`);
      const next = { ...(titles.get(home) ?? {}), [threadId]: clean };
      titles.set(home, next);
      await writeTitles(platform, home, GLOBAL_DIR, next);
      threads.set(threads.get().map((t) => (t.threadId === threadId ? { ...t, title: clean } : t)));
    },
  };
}
