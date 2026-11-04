// ExamService (architecture §11.2; folder spec §8.12–§8.14; UX §3.9): exam dates, exam papers (import → OCR → pre-split
// → extraction → mandatory review), shared AI answers (Quick answer = 1 expansion + BM25 + 1 request per question,
// Deep answer = tool loop; critique C17), the importer's fold of exam-edits (debounced 5 min), and the private
// answers, marks, hints and practice state of `private/<classId>/exams/<examId>.json` (architecture §13.2).
import { PlatformError, errorCode, toPlatformError, type ErrorCode } from '../core/errors';
import { readAnswer, retrieve } from '../core/ai/answer';
import { answerMessages, answerSystem, detectLang, PACKS, promptLang, questionText, type PromptLang } from '../core/ai/prompts';
import { runToolLoop } from '../core/ai/toolLoop';
import { tolerantParse } from '../core/ai/tolerantJson';
import type { PassageLike } from '../core/ai/tools';
import type { RunResult } from '../core/ai/client';
import { EXTRACTION_FORMAT, extractionPrompt, normalizeExtraction, readExtraction, repairPrompt, typedQuestions } from '../core/exam/extraction';
import { FOLD_DEBOUNCE_MS, QUESTION_FIELDS, foldExamEdits, type EditFrom } from '../core/exam/fold';
import { presplit } from '../core/exam/presplit';
import { expansionMessages, parseExpansion, queryFor, quickPlan } from '../core/exam/quick';
import { sha1Hex } from '../core/exam/sha1';
import { newUlid } from '../core/ids';
import { manifestJson } from '../core/json';
import { itemIdOf, newNonce } from '../core/model/derive';
import type { Answer, AnswersFile, ExamEditLine, ExamFile, MarksFile, Question } from '../core/model/files';
import type { ClassId, ClassPath, DeviceId, QuestionId, Ulid } from '../core/model/ids';
import { mergeUnknown, parserFor } from '../core/model/parse';
import { baseName } from '../core/model/paths';
import { fitClassPath, sanitize, unique } from '../core/model/sanitize';
import { instant } from '../core/model/time';
import { sha256Hex } from '../core/util/sha256';
import type { Picked } from '../platform/types';
import { answerView, deviceRef, isPrivateSource } from './ai';
import { Store, derived, type ReadableStore } from './store';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { AnswerOptions, ExamDraft, ExamService, LaterAnswers } from './types/exams';
import type { AiAnswerView, DeviceRef, ExamDateView, ExamKind, ExamPaperView, QuestionView } from './types/viewModels';

type Progress = { done: number; total: number; current: QuestionId | null; error: ErrorCode | null };
type ImportFile = ExamFile['files'][number];
interface Entry {
  raw: ExamFile; exam: ExamFile; manifest: ClassPath; dir: ClassPath; newer: boolean;
  answers: Map<DeviceId, AnswersFile>; edits: EditFrom[];
}
interface DraftState {
  draft: Store<ExamDraft | null>;
  dir: ClassPath | null;
  files: ImportFile[];
  picks: Picked[];
  typed: string | null;
  method: NonNullable<ExamFile['extraction']>['method'];
  createdMs: number;
  ac: AbortController;
  pages: Array<{ offset: number; file: ClassPath; page: number }>;
}

const EXAM_PARSE = parserFor('tramado.exam');
const ANSWERS_PARSE = parserFor('tramado.answers');
const EDIT_PARSE = parserFor('tramado.exam-edit');
const IMAGE = /\.(jpe?g|png|webp)$/i;
/** AI OCR is for exams and short documents (critique G10, D15): one request per page, at most 20 pages. */
export const MAX_OCR_PAGES = 20;
const MIME: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const extOf = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase();

export const emptyMarks = (): MarksFile => ({ format: 'tramado.exam-private', version: 1, myAnswers: {}, correct: {}, marks: {}, revealed: {}, inPractice: {}, hints: {}, practice: {} });

/** exam.json `type` → the UX ExamKind (assignment/other show as practice; the 1.0 value "exam" reads as final). */
export function examKind(type: string): ExamKind {
  if (type === 'exam') return 'final';
  if (type === 'assignment' || type === 'other') return 'practice';
  return (['quiz', 'test', 'midterm', 'final', 'resit', 'special', 'oral', 'practice'] as const).includes(type as ExamKind) ? (type as ExamKind) : 'practice';
}
export function scaleOf(s: ExamFile['scale']): ExamPaperView['scale'] {
  if (s?.max === 20 && /^valor/i.test(s.unit)) return 'pt20';
  if (s?.max === 10 && /^punto/i.test(s.unit)) return 'es10';
  return 'points';
}
const yearOf = (e: ExamFile): number | null => {
  const a = /^(\d{4})/.exec(e.academicYear ?? '')?.[1];
  if (a) return Number(a);
  const d = /^(\d{4})/.exec(e.date ?? '')?.[1];
  return d ? Number(d) : null;
};
/** Folder spec §8.12 limits and the review screen's validation (unique numbers, non-empty texts). */
export function reviewProblems(questions: readonly Question[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    if (!q.number.trim()) out.push(`${q.id}: empty number`);
    else if (seen.has(q.number.trim())) out.push(`${q.id}: duplicate number ${q.number}`);
    seen.add(q.number.trim());
    if (!q.text.trim()) out.push(`${q.id}: empty text`);
    if (!/^q_[0-9A-Za-z]{6,8}$/.test(q.id)) out.push(`${q.id}: bad id`);
  }
  const ids = new Set(questions.map((q) => q.id));
  for (const q of questions) if (q.parent && !ids.has(q.parent)) out.push(`${q.id}: unknown parent`);
  return out;
}

export function createExamService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): ExamService & { idle(): Promise<void>; dispose(): void } {
  const { platform } = ctx;
  // Set by dispose() (the services' phase ended, or the class left the library): no timer may start a batch after it.
  let disposed = false;
  const { store, classId } = cls;
  const entries = new Map<Ulid, Entry>();
  const privates = new Map<Ulid, MarksFile>();
  const drafts = new Map<string, DraftState>();
  const batches = new Map<Ulid, { ac: AbortController; progress: Store<Progress> }>();
  const running = new Store<Ulid[]>([]);
  const publishRunning = () => running.set([...batches.keys()]);
  // INT: answers scheduled for when the free requests come back (`answerLater`), with their timers.
  const later = new Store<LaterAnswers[]>([]);
  const laterTimers = new Map<Ulid, () => void>();
  const LATER_PATH = 'exams-later.json';
  const sent = new Map<string, { passages: number; chars: number }>();   // per answer id, this session
  const foldTimers = new Map<Ulid, () => void>();
  const list = new Store<{ dates: ExamDateView[]; papers: ExamPaperView[] }>({ dates: [], papers: [] });
  let loading: Promise<void> | null = null;
  let again = false;
  let lastSeen = '';

  const me = () => {
    const d = ctx.device.get();
    const id = ctx.identity.get();
    if (!d || !id) throw new PlatformError('INVALID', 'this computer has no identity yet');
    return { deviceId: d.deviceId, memberId: id.memberId, name: id.name };
  };
  const myDevice = () => ctx.device.get()?.deviceId ?? null;
  const ai = () => app().ai;
  const notesDir = () => store.dir('notes');
  const now = () => ctx.clock.now();

  // ── Answers for later (INT) ──────────────────────────────────────────────────────────────────────
  async function saveLater(list: LaterAnswers[]) {
    later.set(list);
    const body = { format: 'tramado.exams-later', version: 1, later: list };
    if (list.length) await platform.privateFiles.write(classId, LATER_PATH, new TextEncoder().encode(JSON.stringify(body)));
    else await platform.privateFiles.remove(classId, LATER_PATH).catch(() => undefined);
  }
  function armLater(item: LaterAnswers) {
    if (disposed) return;
    laterTimers.get(item.examId)?.();
    const at = Date.parse(item.at);
    // Overdue (the app was closed at the reset): a few seconds after start, once the class is read.
    const wait = Math.max(5_000, Math.min(Number.isFinite(at) ? at - now() : 0, 2_000_000_000));
    laterTimers.set(item.examId, ctx.clock.setTimeout(() => {
      laterTimers.delete(item.examId);
      if (disposed) return;
      void (async () => {
        await saveLater(later.get().filter((x) => x.examId !== item.examId));
        if (!entries.has(item.examId)) await load().catch(() => undefined);
        if (!entries.has(item.examId)) return;
        startBatch(item.examId, item.qids, 'quick', item.scope);
      })().catch((e: unknown) => ctx.log('warn', 'exams: the answers for later did not start', { examId: item.examId, error: String(e) }));
    }, wait));
  }
  async function cancelLater(examId: Ulid) {
    laterTimers.get(examId)?.();
    laterTimers.delete(examId);
    if (later.get().some((x) => x.examId === examId)) await saveLater(later.get().filter((x) => x.examId !== examId));
  }
  void (async () => {
    try {
      const bytes = await platform.privateFiles.read(classId, LATER_PATH);
      if (!bytes || disposed) return;
      const j = JSON.parse(new TextDecoder().decode(bytes)) as { format?: string; later?: LaterAnswers[] };
      const list = j.format === 'tramado.exams-later' && Array.isArray(j.later) ? j.later.filter((x) => x && typeof x.examId === 'string' && Array.isArray(x.qids) && typeof x.at === 'string') : [];
      later.set(list);
      list.forEach(armLater);
    } catch (e) {
      ctx.log('warn', 'exams: answers for later unreadable', { error: String(e) });
    }
  })();

  // ── Loading ──────────────────────────────────────────────────────────────────────────────────────
  async function readPrivate(examId: Ulid): Promise<MarksFile> {
    const hit = privates.get(examId);
    if (hit) return hit;
    let f = emptyMarks();
    try {
      const bytes = await platform.privateFiles.read(classId, `exams/${examId}.json`);
      if (bytes) {
        const j = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MarksFile>;
        if (j && j.format === 'tramado.exam-private') f = { ...emptyMarks(), ...j } as MarksFile;
      }
    } catch (e) {
      ctx.log('warn', 'exam private file unreadable', { examId, error: String(e) });
    }
    privates.set(examId, f);
    return f;
  }
  async function writePrivate(examId: Ulid, f: MarksFile) {
    privates.set(examId, f);
    await platform.privateFiles.write(classId, `exams/${examId}.json`, new TextEncoder().encode(manifestJson(f)));
    rebuild();
  }

  async function loadOne(id: Ulid, manifest: ClassPath, dir: ClassPath, machine: ClassPath[]): Promise<Entry | null> {
    const loaded = await store.readJson(manifest, EXAM_PARSE);
    if (!loaded || loaded.value.id !== id) return null;
    const answers = new Map<DeviceId, AnswersFile>();
    for (const p of machine.filter((x) => x.startsWith(`.tramado/answers/${id}/`) && x.endsWith('.json'))) {
      const a = await store.readJson(p, ANSWERS_PARSE).catch(() => null);
      const dev = baseName(p).replace(/\.json$/, '');
      if (a && !a.newer && a.value.examId === id && a.value.deviceId === dev) answers.set(dev, a.value);
    }
    const edits: EditFrom[] = [];
    for (const p of machine.filter((x) => x.startsWith(`.tramado/exam-edits/${id}/`) && x.endsWith('.jsonl'))) {
      const dev = baseName(p).replace(/\.jsonl$/, '');
      const lines = await store.readJsonl<ExamEditLine>(p, EDIT_PARSE).catch(() => null);
      for (const l of lines?.lines ?? []) edits.push({ deviceId: dev, line: l.value });
    }
    const raw = loaded.value.type === ('exam' as ExamFile['type']) ? { ...loaded.value, type: 'final' as const } : loaded.value;
    const exam = foldExamEdits(raw, edits).exam;
    return { raw, exam, manifest, dir, newer: loaded.newer, answers, edits };
  }

  // Names of classmates (DeviceRef) come from the class info, which may load after the exams: rebuild when it changes.
  let watchingInfo = false;
  function watchInfo() {
    if (watchingInfo) return;
    try {
      app().forClass(classId).info.detail.subscribe(() => rebuild());
      watchingInfo = true;
    } catch {
      // the class service is not available yet (tests, a class being added)
    }
  }

  async function load(): Promise<void> {
    const st = store.state.get();
    if (st.status !== 'ready') return;
    await Promise.resolve();
    watchInfo();
    const machine = [...st.index.machine.keys()];
    const next = new Map<Ulid, Entry>();
    for (const [id, item] of st.index.exams) {
      try {
        const e = await loadOne(id, item.manifest, item.dir, machine);
        if (e) {
          next.set(id, e);
          await readPrivate(id);
          scheduleFold(e);
        }
      } catch (err) {
        ctx.log('warn', 'exam not loaded', { examId: id, error: String(err) });
      }
    }
    entries.clear();
    for (const [k, v] of next) entries.set(k, v);
    rebuild();
  }
  function reload(): Promise<void> {
    if (loading) {
      again = true;
      return loading;
    }
    loading = (async () => {
      do {
        again = false;
        await load();
      } while (again);
    })().finally(() => {
      loading = null;
    });
    return loading;
  }
  store.state.subscribe(() => {
    const st = store.state.get();
    const key = `${st.status}:${st.kinds.exam}:${st.kinds.answers}:${st.kinds.examEdits}:${st.index.exams.size}`;
    if (key === lastSeen) return;
    lastSeen = key;
    void reload();
  });
  void reload();

  // ── The importer folds exam-edits (folder spec §8.13; never written by 0.1, but read and folded) ──────────
  function scheduleFold(e: Entry) {
    const mine = myDevice();
    if (disposed || !mine || e.raw.importedBy.deviceId !== mine || foldTimers.has(e.raw.id)) return;
    if (!foldExamEdits(e.raw, e.edits).changed) return;
    foldTimers.set(e.raw.id, ctx.clock.setTimeout(() => {
      foldTimers.delete(e.raw.id);
      const cur = entries.get(e.raw.id);
      if (!cur) return;
      const r = foldExamEdits(cur.raw, cur.edits);
      if (r.changed) void writeExam(cur, r.exam).catch((err: unknown) => ctx.log('warn', 'exam fold failed', { error: String(err) }));
    }, FOLD_DEBOUNCE_MS));
  }

  // ── Views ─────────────────────────────────────────────────────────────────────────────────────────
  const ref = (deviceId: DeviceId, memberId: string, name: string): DeviceRef => deviceRef(app, classId, deviceId, memberId, name, myDevice());
  const meRef = (): DeviceRef => {
    const d = myDevice() ?? '';
    const i = ctx.identity.get();
    return ref(d, i?.memberId ?? '', i?.name ?? '');
  };
  const label = (id: string) => ai().label(id);

  function answerFor(e: Entry, qid: QuestionId): { a: Answer; by: DeviceId; memberId: string } | null {
    const mine = myDevice();
    let best: { a: Answer; by: DeviceId; memberId: string } | null = null;
    for (const [dev, f] of e.answers) {
      for (const a of f.answers) {
        if (a.questionId !== qid) continue;
        const cand = { a, by: dev, memberId: f.memberId };
        if (!best) best = cand;
        else if (dev === mine && best.by !== mine) best = cand;
        else if ((dev === mine) === (best.by === mine) && a.hlc > best.a.hlc) best = cand;
      }
    }
    return best;
  }

  function aiView(e: Entry, qid: QuestionId): AiAnswerView | null {
    const hit = answerFor(e, qid);
    if (!hit) return null;
    const name = hit.by === myDevice() ? ctx.identity.get()?.name ?? '' : '';
    return answerView({ ...hit.a, mode: hit.a.mode }, {
      classId, notesDir: notesDir(), askedBy: ref(hit.by, hit.memberId, name), label,
      ...(sent.has(hit.a.id) ? { sent: sent.get(hit.a.id)! } : {}),
    });
  }

  function questionView(e: Entry, q: Question, pf: MarksFile): QuestionView {
    const parent = q.parent ? e.exam.questions.find((x) => x.id === q.parent) : undefined;
    const siblings = parent ? e.exam.questions.filter((x) => x.parent === parent.id) : [];
    const hint = pf.hints[q.id];
    const pr = pf.practice[q.id];
    return {
      id: q.id, number: q.number, text: q.text, points: q.points, kind: q.kind === 'container' ? 'other' : q.kind,
      group: parent && parent.kind === 'container' ? { id: parent.id, choose: parent.choose ?? siblings.length, label: parent.number } : null,
      ai: aiView(e, q.id),
      hint: hint ? answerView({ text: hint.text, citations: hint.citations, model: hint.model, requestedModel: hint.model, at: hint.at, mode: 'hint' }, { classId, notesDir: notesDir(), askedBy: meRef(), label }) : null,
      mine: {
        draft: pf.myAnswers[q.id] ?? '', correct: pf.correct[q.id] ?? '', mark: pf.marks[q.id] ?? null, inPractice: !!pf.inPractice[q.id], revealed: !!pf.revealed[q.id],
        practice: { lastResult: pr?.result ?? null, lastAt: pr?.last ?? null, count: pr?.count ?? 0 },
      },
    };
  }

  function paperView(e: Entry): ExamPaperView {
    const x = e.exam;
    const pf = privates.get(x.id) ?? emptyMarks();
    const sets = [...e.answers].filter(([, f]) => f.answers.length).map(([dev, f]) => {
      const counts = new Map<string, number>();
      for (const a of f.answers) counts.set(a.model, (counts.get(a.model) ?? 0) + 1);
      const model = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
      return { by: ref(dev, f.memberId, dev === myDevice() ? ctx.identity.get()?.name ?? '' : ''), model: label(model), at: f.updatedAt, count: f.answers.length };
    });
    return {
      examId: x.id, classId, title: x.title, kind: examKind(x.type), year: yearOf(x), date: x.date,
      sourceRelPath: x.files[0]?.path ?? null, state: x.extraction && !x.extraction.reviewedAt ? 'review' : 'ready',
      rules: x.rules, durationMin: x.durationMin, scale: scaleOf(x.scale), extraPoints: x.extraPoints ?? [],
      questions: x.questions.filter((q) => q.kind !== 'container').map((q) => questionView(e, q, pf)),
      importedBy: ref(x.importedBy.deviceId, x.importedBy.memberId, x.importedBy.name), newerFormat: e.newer, answers: sets,
    };
  }

  function draftView(d: DraftState): ExamPaperView | null {
    const v = d.draft.get();
    if (!v) return null;
    return {
      examId: v.id, classId, title: v.meta.title ?? '', kind: examKind(v.meta.type ?? 'other'), year: v.meta.academicYear ? Number(v.meta.academicYear.slice(0, 4)) || null : null,
      date: v.meta.date ?? null, sourceRelPath: d.files[0]?.path ?? null, state: v.step === 'review' ? 'review' : 'extracting',
      rules: v.meta.rules ?? [], durationMin: v.meta.durationMin ?? null, scale: scaleOf(v.meta.scale ?? null), extraPoints: v.meta.extraPoints ?? [],
      questions: [], importedBy: meRef(), newerFormat: false, answers: [],
    };
  }

  function rebuild() {
    const practiceCount = [...entries.values()].reduce((n, e) => n + Object.keys(privates.get(e.raw.id)?.inPractice ?? {}).length, 0);
    const dates: ExamDateView[] = [...entries.values()]
      .filter((e) => e.exam.status === 'upcoming' && e.exam.date)
      .map((e) => ({
        examId: e.exam.id, classId, title: e.exam.title, kind: examKind(e.exam.type), at: e.exam.date!, allDay: e.exam.allDay, room: e.exam.room,
        covers: e.exam.coversText, weight: e.exam.weightText ?? (e.exam.weight !== null ? `${e.exam.weight} %` : null), practiceCount,
      }))
      .sort((a, b) => a.at.localeCompare(b.at));
    const papers = [
      ...[...entries.values()].filter((e) => e.exam.status === 'paper').map(paperView),
      ...[...drafts.values()].map(draftView).filter((v): v is ExamPaperView => v !== null),
    ];
    list.set({ dates, papers });
  }

  // ── Writing exam.json (the importer only, in 0.1) ──────────────────────────────────────────────────
  function entryOf(examId: Ulid): Entry {
    const e = entries.get(examId);
    if (!e) throw new PlatformError('NOT_FOUND', `exam ${examId}`);
    return e;
  }
  function importerOnly(e: Entry) {
    if (e.raw.importedBy.deviceId !== myDevice()) throw new PlatformError('PERMISSION_DENIED', 'only the computer that added this exam can change it in 0.1', { importer: e.raw.importedBy.name });
    if (e.newer) throw new PlatformError('NEWER_FORMAT', 'this exam was saved by a newer Tramado');
  }
  async function writeExam(e: Entry, next: ExamFile): Promise<void> {
    const out = mergeUnknown(e.raw, { ...next, revision: e.raw.revision + 1, updatedAt: instant(now()) });
    await store.writeJson(e.manifest, out, { own: true, manifest: true });
    const updated = { ...e, raw: out, exam: foldExamEdits(out, e.edits).exam };
    entries.set(out.id, updated);
    rebuild();
  }

  async function examDir(title: string): Promise<ClassPath> {
    const root = store.dir('exams');
    let siblings: string[] = [];
    try {
      siblings = (await platform.fs.list(classId, root, { recursive: false })).map((x) => x.name);
    } catch (e) {
      if (errorCode(e) !== 'NOT_FOUND') throw e;
      await store.mkdir(root);
    }
    const name = unique(siblings, sanitize(title, 'Exam'));
    const path = fitClassPath(root, name);
    if (!path) throw new PlatformError('INVALID', 'the exam title is too long for a path');
    await store.mkdir(path);
    return path;
  }

  // ── Language of prompts ────────────────────────────────────────────────────────────────────────────
  function classLang(): string | null {
    try {
      const l = app().forClass(classId).info.detail.get().meta.language;
      return l && l !== 'auto' ? l : null;
    } catch {
      return null;
    }
  }
  function langFor(text: string): PromptLang {
    return detectLang(text) ?? promptLang(classLang() ?? ctx.prefs.get('ui.locale'));
  }
  const answerLanguage = (): 'question' | PromptLang => (ctx.prefs.get('ai.answerLanguage') === 'ui' ? promptLang(ctx.prefs.get('ui.locale') || 'en') : 'question');

  // ── Import pipeline (UX §3.9.4–§3.9.6) ────────────────────────────────────────────────────────────
  function patch(d: DraftState, p: Partial<ExamDraft>) {
    const cur = d.draft.get();
    if (cur) d.draft.set({ ...cur, ...p, cost: p.cost ?? cur.cost, files: [...d.files] });
    rebuild();
  }
  const bump = (d: DraftState) => patch(d, { cost: { requests: (d.draft.get()?.cost.requests ?? 0) + 1 } });

  async function ocr(d: DraftState, jpeg: Uint8Array, lang: PromptLang): Promise<string> {
    const keyName = `ocr/${sha256Hex(jpeg)}.json`;
    try {
      const hit = await platform.cache.read(keyName);
      if (hit) {
        const j = JSON.parse(new TextDecoder().decode(hit)) as { format?: string; text?: string; model?: string };
        if (j.format === 'tramado.ocr-cache' && typeof j.text === 'string') {
          if (j.model) patch(d, { model: j.model });
          return j.text;
        }
      }
    } catch {
      // a broken cache entry is read again
    }
    let b64 = '';
    const chunk = 0x8000;
    for (let i = 0; i < jpeg.length; i += chunk) b64 += String.fromCharCode(...jpeg.subarray(i, i + chunk));
    b64 = btoa(b64);
    bump(d);
    const r = await ai().client.run({
      task: 'ocr', vision: true, activity: { classId, action: 'examOcr', passages: 0 }, signal: d.ac.signal,
      messages: [{ role: 'user', content: [{ type: 'text', text: PACKS[lang].ocrPrompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] }],
    });
    const text = r.content.trim();
    patch(d, { model: r.model });
    await platform.cache.write(keyName, new TextEncoder().encode(JSON.stringify({ format: 'tramado.ocr-cache', version: 1, model: r.model, text, at: instant(now()) }))).catch(() => undefined);
    return text;
  }

  async function textOf(d: DraftState, f: ImportFile, bytes: Uint8Array, lang: PromptLang): Promise<string> {
    const ext = extOf(f.path);
    if (IMAGE.test(f.path)) {
      const prep = await ctx.imagePrep.prepare(bytes, f.mime, 1400, 0.7);
      d.method = 'ocr';
      const t = await ocr(d, prep.jpeg, lang);
      patch(d, { ocrDone: (d.draft.get()?.ocrDone ?? 0) + 1 });
      return t;
    }
    if (ext === 'txt' || ext === 'md') {
      d.method = 'typed';
      return new TextDecoder().decode(bytes);
    }
    const kind = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : 'other';
    let text = '';
    let imagePages: number[] = [];
    let pageStarts: number[] = [];
    try {
      const tc = await ctx.extractHost.extract(bytes, kind, baseName(f.path), () => undefined, d.ac.signal);
      text = tc.text;
      imagePages = tc.imagePages ?? [];
      pageStarts = tc.pageStarts ?? [];
    } catch (e) {
      if (kind !== 'pdf') throw toPlatformError(e);
    }
    if (kind === 'docx') {
      d.method = 'docx';
      return text;
    }
    // PDFs: pages without text are read by the vision model (critique G10), one request per page.
    const pages = await ctx.pdfRender.pages(bytes).catch(() => Math.max(1, pageStarts.length));
    f.pages = pages;
    const scan = !text.trim() ? Array.from({ length: pages }, (_, i) => i + 1) : imagePages;
    if (!scan.length) {
      if (d.method !== 'ocr') d.method = 'pdf-text';
      pageStarts.forEach((s, i) => d.pages.push({ offset: s, file: f.path, page: i + 1 }));
      return text;
    }
    if (scan.length > MAX_OCR_PAGES) throw new PlatformError('INVALID', `AI can read at most ${MAX_OCR_PAGES} pages of an exam`, { pages: scan.length, max: MAX_OCR_PAGES });
    d.method = 'ocr';
    patch(d, { pages: (d.draft.get()?.pages ?? 0) + scan.length - 1 });
    const parts: string[] = [];
    for (const p of scan) {
      const jpeg = await ctx.pdfRender.renderJpeg(bytes, p, 1400);
      parts.push(await ocr(d, jpeg, lang));
      patch(d, { ocrDone: (d.draft.get()?.ocrDone ?? 0) + 1 });
    }
    // Where each page starts in the file's text (the question's `source.page`): text pages first, read pages after.
    const whole = scan.length === pages;
    if (!whole) pageStarts.forEach((s, i) => d.pages.push({ offset: s, file: f.path, page: i + 1 }));
    let at = whole ? 0 : text.length + 2;
    parts.forEach((t, i) => {
      d.pages.push({ offset: at, file: f.path, page: scan[i]! });
      at += t.length + 2;
    });
    return whole ? parts.join('\n\n') : `${text}\n\n${parts.join('\n\n')}`;
  }

  async function runDraft(d: DraftState): Promise<void> {
    const v = d.draft.get();
    if (!v) return;
    patch(d, { step: d.typed !== null ? 'presplit' : 'ocr', error: null, ocrDone: 0, pages: d.files.length, cost: { requests: 0 } });
    try {
      let lang = promptLang(classLang() ?? ctx.prefs.get('ui.locale'));
      const parts: string[] = [];
      let offset = 0;
      if (d.typed !== null) parts.push(d.typed);
      for (const f of d.files) {
        const bytes = await platform.fs.read(classId, f.path);
        const before = d.pages.length;
        const t = await textOf(d, f, bytes, lang);
        for (const pg of d.pages.slice(before)) pg.offset += offset;
        if (d.pages.length === before) d.pages.push({ offset, file: f.path, page: 1 });
        parts.push(t);
        offset += t.length + 2;
      }
      const text = parts.join('\n\n');
      lang = detectLang(text) ?? lang;
      patch(d, { step: 'presplit', text });
      const pre = presplit(text);
      const sourceOf = (o: number): Question['source'] => {
        const pg = [...d.pages].reverse().find((p) => p.offset <= o);
        return pg ? { file: pg.file, page: pg.page } : null;
      };
      let questions: Question[];
      const meta: Partial<ExamFile> = {
        ...v.meta,
        title: v.meta.title ?? (pre.title ? pre.title.slice(0, 200) : d.files[0] ? baseName(d.files[0].path).replace(/\.[^.]+$/, '') : 'Exam'),
        rules: v.meta.rules ?? pre.rules,
        durationMin: v.meta.durationMin ?? pre.durationMin,
        ...(pre.extraPoints.length || v.meta.extraPoints ? { extraPoints: v.meta.extraPoints ?? pre.extraPoints } : {}),
        scale: v.meta.scale ?? (pre.unit && /^valor/.test(pre.unit) ? { max: 20, unit: 'valores' } : pre.unit && /^punto/.test(pre.unit) ? { max: 10, unit: 'puntos' } : null),
      };
      const aiOn = ctx.prefs.get('ai.enabled') !== '0' && ai().settings.get().key.set;
      if (d.typed !== null || !aiOn || !text.trim()) {
        questions = normalizeExtraction(null, pre, text, { rand: ctx.rand, sourceOf });
      } else {
        patch(d, { step: 'extracting' });
        bump(d);
        const run = (msgs: ReturnType<typeof extractionPrompt>) => ai().client.run({
          task: 'extract-questions', messages: msgs, responseFormat: EXTRACTION_FORMAT, activity: { classId, action: 'examExtract', passages: 0 }, signal: d.ac.signal,
        });
        let r = await run(extractionPrompt(lang, text, pre.blocks));
        let model = readExtraction(tolerantParse(r.content));
        if (!model.questions.length && model.errors.length) {
          bump(d);
          r = await run(repairPrompt(lang, r.content, model.errors));
          model = readExtraction(tolerantParse(r.content));
        }
        patch(d, { model: r.model });
        questions = normalizeExtraction(model, pre, text, { rand: ctx.rand, sourceOf });
        if (!meta.title && model.title) meta.title = model.title.slice(0, 200);
      }
      patch(d, { step: 'review', questions, meta });
    } catch (e) {
      const code = errorCode(e);
      if (code === 'CANCELLED') return;
      patch(d, { step: 'failed', error: code });
    }
  }

  function newDraft(meta: Partial<ExamFile>, typed: string | null): DraftState {
    const id = newUlid(now(), ctx.rand);
    const d: DraftState = {
      draft: new Store<ExamDraft | null>({ id, classId, step: typed !== null ? 'presplit' : 'ocr', pages: 0, ocrDone: 0, text: typed ?? '', questions: [], meta, cost: { requests: 0 }, error: null, model: null }),
      dir: null, files: [], picks: [], typed, method: typed !== null ? 'typed' : 'pdf-text', createdMs: now(), ac: new AbortController(), pages: [],
    };
    drafts.set(id, d);
    return d;
  }

  // ── Answers (Quick and Deep; critique C17) ────────────────────────────────────────────────────────
  async function searchPassages(query: string, exclude: string[], limit: number): Promise<PassageLike[]> {
    const ps = await app().search.passages(classId, query, { limit, exclude });
    return ps.filter((p) => !isPrivateSource(p.source, notesDir()));   // shared answers never cite private notes
  }

  async function saveAnswer(examId: Ulid, q: Question, a: ReturnType<typeof readAnswer>, r: Pick<RunResult, 'model' | 'requestedModel' | 'privacy' | 'usage'>, mode: Answer['mode'], scope: Answer['scope'], s: { passages: number; chars: number }) {
    const who = me();
    const e = entryOf(examId);
    const t = now();
    const hlc = ctx.hlc.tick();
    const answer: Answer = {
      id: newUlid(t, ctx.rand), questionId: q.id, questionSha1: sha1Hex(q.text), examRevision: e.exam.revision, hlc, at: instant(t),
      text: a.text, citations: a.citations,
      ...(a.choice && (q.kind === 'multiple_choice' || q.kind === 'true_false') ? { choice: a.choice } : {}),
      generalKnowledge: scope === 'materials+general' ? a.generalKnowledge : [],
      model: r.model, requestedModel: r.requestedModel, privacy: r.privacy, mode, scope,
      ...(r.usage ? { usage: { promptTokens: r.usage.prompt_tokens ?? 0, completionTokens: r.usage.completion_tokens ?? 0, ...(r.usage.completion_tokens_details?.reasoning_tokens !== undefined ? { reasoningTokens: r.usage.completion_tokens_details.reasoning_tokens } : {}) } } : {}),
    };
    sent.set(answer.id, s);
    const prev = e.answers.get(who.deviceId);
    const file: AnswersFile = mergeUnknown(prev, {
      format: 'tramado.answers', version: 1, examId, deviceId: who.deviceId, memberId: who.memberId, hlc, updatedAt: instant(t),
      answers: [...(prev?.answers ?? []).filter((x) => x.questionId !== q.id), answer],
    });
    await store.writeJson(`.tramado/answers/${examId}/${who.deviceId}.json`, file, { own: true });
    e.answers.set(who.deviceId, file);
    rebuild();
  }

  function startBatch(examId: Ulid, qids: QuestionId[], mode: 'quick' | 'deep', scope: Answer['scope'], opts: AnswerOptions = {}): ReadableStore<Progress> {
    const running = batches.get(examId);
    if (running) return running.progress;
    const progress = new Store<Progress>({ done: 0, total: qids.length, current: null, error: null });
    const ac = new AbortController();
    batches.set(examId, { ac, progress });
    publishRunning();
    void (async () => {
      try {
        const e = entryOf(examId);
        const plan = quickPlan(e.exam.questions, qids);
        progress.set({ done: 0, total: plan.order.length, current: null, error: null });
        const general = scope === 'materials+general';
        const exclude = e.exam.files.map((f) => f.path);
        const lang = langFor(plan.order.map((q) => q.text).join(' '));
        const unit = e.exam.scale?.unit;
        const groupOf = (q: Question) => {
          const p = q.parent ? e.exam.questions.find((x) => x.id === q.parent) : undefined;
          return p && p.kind === 'container' ? { choose: p.choose ?? 0, numbers: e.exam.questions.filter((x) => x.parent === p.id).map((x) => x.number) } : null;
        };
        const qText = (q: Question) => {
          const g = groupOf(q);
          return questionText(PACKS[lang], { number: q.number, text: q.text, points: q.points, options: q.options, group: g && g.choose ? g : null }, e.exam.rules, unit);
        };
        let keywords: Record<QuestionId, string[]> = {};
        if (mode === 'quick' && plan.order.length) {
          try {
            const r = await ai().client.run({
              task: 'expand', messages: expansionMessages(lang, plan.order, classLang()), activity: { classId, action: 'examAnswer', passages: 0 },
              priority: 'bulk', signal: ac.signal, ...(opts.busyFallback ? { busyFallback: true } : {}),
            });
            keywords = parseExpansion(r.content, plan.order.map((q) => q.id));
          } catch (err) {
            const code = errorCode(err);
            if (code === 'CANCELLED' || !['AI_LENGTH', 'AI_UPSTREAM', 'AI_BAD_REQUEST'].includes(code)) throw err;
          }
        }
        for (const q of plan.order) {
          if (ac.signal.aborted) throw new PlatformError('CANCELLED', 'cancelled');
          progress.update((p) => ({ ...p, current: q.id }));
          if (mode === 'quick') {
            const ret = retrieve(await searchPassages(queryFor(q, keywords[q.id]), exclude, 30));
            const r = await ai().client.run({
              task: 'exam-answer', priority: 'bulk', signal: ac.signal, ...(opts.busyFallback ? { busyFallback: true } : {}),
              messages: answerMessages({ lang, answerLanguage: answerLanguage(), general, role: 'exam', kind: q.kind }, qText(q), ret.sources),
              activity: { classId, action: 'examAnswer', passages: ret.sources.length },
            });
            await saveAnswer(examId, q, readAnswer(r.content, ret.refs, general), r, 'quick', scope, { passages: ret.sources.length, chars: ret.chars });
          } else {
            const r = await runToolLoop({
              client: ai().client, lang, activity: { classId, action: 'deep', passages: 0 }, priority: 'bulk', signal: ac.signal, ...(opts.busyFallback ? { busyFallback: true } : {}),
              messages: [{ role: 'system', content: answerSystem({ lang, answerLanguage: answerLanguage(), general, role: 'tools', kind: q.kind }) }, { role: 'user', content: qText(q) }],
              host: {
                search: (query, limit) => searchPassages(query, exclude, limit),
                read: async (id, offset, max) => {
                  const p = await app().search.passage(classId, id, { offset, max });
                  return p && !isPrivateSource(p.source, notesDir()) ? p : null;
                },
              },
            });
            const chars = r.refs.entries().reduce((n, [, p]) => n + p.text.length, 0);
            await saveAnswer(examId, q, readAnswer(r.content, r.refs, general), { model: r.model, requestedModel: r.requestedModel, privacy: r.privacy, usage: r.usage }, 'deep', scope, { passages: r.refs.size, chars });
          }
          progress.update((p) => ({ ...p, done: p.done + 1 }));
        }
        progress.update((p) => ({ ...p, current: null }));
      } catch (err) {
        progress.update((p) => ({ ...p, current: null, error: errorCode(err) }));
      } finally {
        batches.delete(examId);
        publishRunning();
        void ai().refreshQuota().catch(() => undefined);
      }
    })();
    return progress;
  }

  // ── Private state ─────────────────────────────────────────────────────────────────────────────────
  async function updatePrivate(examId: Ulid, f: (m: MarksFile) => void) {
    entryOf(examId);
    const cur = structuredClone(await readPrivate(examId));
    f(cur);
    await writePrivate(examId, cur);
  }

  return {
    list,
    open: (id) => derived(list, (l) => l.papers.find((p) => p.examId === id) ?? null),
    async idle() {
      await Promise.resolve();
      while (loading) await loading;
    },
    /** INT review: the timers of answers for later and of folds stop with the services (no batch from a dead instance). */
    dispose() {
      disposed = true;
      for (const off of laterTimers.values()) off();
      laterTimers.clear();
      for (const off of foldTimers.values()) off();
      foldTimers.clear();
    },
    async createUpcoming(input) {
      const who = me();
      const t = now();
      const idNonce = newNonce(ctx.rand);
      const title = (input.title ?? '').trim().slice(0, 200);
      if (!title) throw new PlatformError('INVALID', 'an exam needs a title');
      const dir = await examDir(title);
      const exam: ExamFile = {
        format: 'tramado.exam', version: 1, id: itemIdOf(t, who.deviceId, idNonce), idNonce, title, type: input.type, status: 'upcoming',
        date: input.date ?? null, allDay: input.allDay ?? false, durationMin: input.durationMin ?? null, room: input.room ? input.room.slice(0, 80) : null,
        weight: input.weight ?? null, weightText: input.weightText ? input.weightText.slice(0, 20) : null, covers: input.covers ?? [],
        coversText: input.coversText ? input.coversText.slice(0, 500) : null, rules: [], scale: null, files: [],
        importedBy: { memberId: who.memberId, deviceId: who.deviceId, name: who.name }, createdAt: instant(t), extraction: null,
        questions: [], revision: 1, folded: {}, updatedAt: instant(t),
      };
      await store.writeJson(`${dir}/exam.json`, exam, { own: true, manifest: true });
      entries.set(exam.id, { raw: exam, exam, manifest: `${dir}/exam.json`, dir, newer: false, answers: new Map(), edits: [] });
      rebuild();
      return exam.id;
    },
    async updateUpcoming(examId, p) {
      const e = entryOf(examId);
      importerOnly(e);
      const next: ExamFile = { ...e.raw, ...p };
      if (p.title !== undefined) next.title = p.title.trim().slice(0, 200) || e.raw.title;
      await writeExam(e, next);
    },
    async startImport(picks, meta = {}) {
      if (!picks.length) throw new PlatformError('INVALID', 'no file');
      me();
      const d = newDraft({ ...meta }, null);
      d.picks = [...picks];
      const title = meta.title ?? picks[0]!.name.replace(/\.[^.]+$/, '');
      try {
        d.dir = await examDir(title);
        const used: string[] = [];
        for (const p of picks) {
          const name = unique(used, sanitize(p.name, 'file'));
          used.push(name);
          const dest = fitClassPath(d.dir, name) ?? `${d.dir}/${name.slice(-60)}`;
          const stamp = await platform.fs.importFile(classId, p.token, dest);
          const ext = extOf(name);
          d.files.push({ path: dest, sha256: stamp.sha256 ?? sha256Hex(await platform.fs.read(classId, dest)), size: stamp.size, mime: MIME[ext] ?? 'application/octet-stream' });
        }
      } catch (e) {
        drafts.delete(d.draft.get()!.id);
        d.draft.set(null);
        rebuild();
        throw e;
      }
      patch(d, { pages: d.files.length, meta: { ...meta, title } });
      void runDraft(d);
      return d.draft.get()!.id;
    },
    async startTyped(text, meta = {}) {
      me();
      const d = newDraft({ ...meta }, text);
      const { questions, pre } = typedQuestions(text, ctx.rand);
      d.draft.set({
        ...d.draft.get()!, step: 'review', questions, text,
        meta: { ...meta, title: meta.title ?? pre.title?.slice(0, 200) ?? 'Exam', rules: meta.rules ?? pre.rules, durationMin: meta.durationMin ?? pre.durationMin, ...(pre.extraPoints.length ? { extraPoints: pre.extraPoints } : {}) },
      });
      rebuild();
      return d.draft.get()!.id;
    },
    draft: (id) => drafts.get(id)?.draft ?? new Store<ExamDraft | null>(null),
    cancelDraft(id) {
      const d = drafts.get(id);
      if (!d) return;
      d.ac.abort();
      drafts.delete(id);
      d.draft.set(null);
      rebuild();
    },
    async retryDraft(id) {
      const d = drafts.get(id);
      if (!d) throw new PlatformError('NOT_FOUND', `draft ${id}`);
      d.ac = new AbortController();
      d.pages = [];
      await runDraft(d);
    },
    async saveReview(draftId, questions, meta) {
      const d = drafts.get(draftId);
      if (!d) throw new PlatformError('NOT_FOUND', `draft ${draftId}`);
      const problems = reviewProblems(questions);
      if (problems.length) throw new PlatformError('INVALID', 'the questions need fixing', { problems });
      const who = me();
      const v = d.draft.get()!;
      const m = { ...v.meta, ...meta };
      const title = (m.title ?? '').trim().slice(0, 200) || 'Exam';
      d.draft.set({ ...v, step: 'saving' });
      const dir = d.dir ?? (await examDir(title));
      const t = now();
      const idNonce = newNonce(ctx.rand);
      const exam: ExamFile = {
        format: 'tramado.exam', version: 1, id: itemIdOf(t, who.deviceId, idNonce), idNonce, title, type: m.type ?? 'practice', status: 'paper',
        date: m.date ?? null, allDay: m.allDay ?? false, durationMin: m.durationMin ?? null, room: m.room ?? null, weight: m.weight ?? null, weightText: m.weightText ?? null,
        ...(m.academicYear ? { academicYear: m.academicYear } : {}), covers: m.covers ?? [], coversText: m.coversText ?? null, rules: m.rules ?? [], scale: m.scale ?? null,
        ...(m.extraPoints?.length ? { extraPoints: m.extraPoints } : {}), files: d.files,
        importedBy: { memberId: who.memberId, deviceId: who.deviceId, name: who.name }, createdAt: instant(t),
        extraction: { method: d.method, ...(v.model ? { model: v.model } : {}), at: instant(d.createdMs), reviewedAt: instant(t), reviewedBy: who.memberId },
        questions: questions.map((q) => ({ ...q, number: q.number.trim(), text: q.text.trim() })), revision: 1, folded: {}, updatedAt: instant(t),
      };
      try {
        await store.writeJson(`${dir}/exam.json`, exam, { own: true, manifest: true });
      } catch (e) {
        d.draft.set({ ...v, step: 'review', error: errorCode(e) });
        throw e;
      }
      entries.set(exam.id, { raw: exam, exam, manifest: `${dir}/exam.json`, dir, newer: false, answers: new Map(), edits: [] });
      drafts.delete(draftId);
      d.draft.set(null);
      rebuild();
      return exam.id;
    },
    async editQuestion(examId, qid, field, value) {
      const e = entryOf(examId);
      importerOnly(e);
      if (!(QUESTION_FIELDS as readonly string[]).includes(field)) throw new PlatformError('INVALID', `unknown field ${field}`);
      if (!e.raw.questions.some((q) => q.id === qid)) throw new PlatformError('NOT_FOUND', `question ${qid}`);
      const questions = e.raw.questions.map((q) => (q.id === qid ? { ...q, [field]: value } : q));
      const problems = reviewProblems(questions);
      if (problems.length) throw new PlatformError('INVALID', 'invalid question', { problems });
      await writeExam(e, { ...e.raw, questions });
    },
    async addQuestion(examId, q, after) {
      const e = entryOf(examId);
      importerOnly(e);
      if (e.raw.questions.some((x) => x.id === q.id)) throw new PlatformError('CONFLICT', `question ${q.id} exists`);
      const qs = [...e.raw.questions];
      const at = after === null ? 0 : qs.findIndex((x) => x.id === after) + 1 || qs.length;
      qs.splice(at, 0, q);
      const problems = reviewProblems(qs);
      if (problems.length) throw new PlatformError('INVALID', 'invalid question', { problems });
      await writeExam(e, { ...e.raw, questions: qs, status: 'paper' });
    },
    async deleteQuestion(examId, qid) {
      const e = entryOf(examId);
      importerOnly(e);
      const gone = new Set<QuestionId>([qid]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const x of e.raw.questions) if (x.parent && gone.has(x.parent) && !gone.has(x.id)) {
          gone.add(x.id);
          grew = true;
        }
      }
      await writeExam(e, { ...e.raw, questions: e.raw.questions.filter((x) => !gone.has(x.id)) });
    },
    answer: (examId, qids, mode, scope, opts) => startBatch(examId, qids, mode, scope, opts),
    cancelAnswers(examId) {
      batches.get(examId)?.ac.abort();
    },
    progress: (examId) => batches.get(examId)?.progress ?? null,
    later,
    async answerLater(examId, qids, scope, at) {
      await cancelLater(examId);
      if (!qids.length) return;
      const item: LaterAnswers = { examId, qids: [...qids], scope, at };
      await saveLater([...later.get().filter((x) => x.examId !== examId), item]);
      armLater(item);
    },
    cancelLater,
    async setMyAnswer(examId, qid, text) {
      await updatePrivate(examId, (m) => {
        if (text) m.myAnswers[qid] = text;
        else delete m.myAnswers[qid];
      });
    },
    async setCorrect(examId, qid, text) {
      await updatePrivate(examId, (m) => {
        if (text) m.correct[qid] = text;
        else delete m.correct[qid];
      });
    },
    async setMark(examId, qid, mark) {
      await updatePrivate(examId, (m) => {
        if (mark === null) delete m.marks[qid];
        else {
          m.marks[qid] = mark;
          m.inPractice[qid] = true;   // UX §3.9.8: "Add to practice", default on once marked
        }
      });
    },
    async reveal(examId, qid) {
      await updatePrivate(examId, (m) => {
        m.revealed[qid] = true;
      });
    },
    async hint(examId, qid) {
      const e = entryOf(examId);
      const q = e.exam.questions.find((x) => x.id === qid);
      if (!q) throw new PlatformError('NOT_FOUND', `question ${qid}`);
      const lang = langFor(q.text);
      const ret = retrieve(await searchPassages(queryFor(q), e.exam.files.map((f) => f.path), 20), { max: 6 });
      const r = await ai().client.run({
        task: 'chat', activity: { classId, action: 'hint', passages: ret.sources.length },
        messages: answerMessages({ lang, answerLanguage: answerLanguage(), general: false, role: 'hint', kind: q.kind }, questionText(PACKS[lang], { number: q.number, text: q.text, points: q.points, options: q.options }, e.exam.rules), ret.sources),
      });
      const a = readAnswer(r.content, ret.refs, false);
      await updatePrivate(examId, (m) => {
        m.hints[qid] = { text: a.text, citations: a.citations, model: r.model, at: instant(now()) };
      });
    },
    async practise(examId, qid, result) {
      await updatePrivate(examId, (m) => {
        const prev = m.practice[qid];
        m.practice[qid] = { last: instant(now()), result, count: (prev?.count ?? 0) + 1 };
      });
    },
    running,
    raw: (examId) => entries.get(examId)?.exam ?? null,
    importer(examId) {
      const e = entries.get(examId);
      if (!e) return null;
      const by = e.raw.importedBy;
      return ref(by.deviceId, by.memberId, by.name);
    },
    async remove(examId) {
      const e = entryOf(examId);
      if (e.raw.importedBy.deviceId !== myDevice()) throw new PlatformError('PERMISSION_DENIED', 'only the computer that added this exam can delete it in 0.1', { importer: e.raw.importedBy.name });
      batches.get(examId)?.ac.abort();
      foldTimers.get(examId)?.();
      foldTimers.delete(examId);
      await cancelLater(examId);
      if (e.dir && e.dir !== '.') await store.remove(e.dir, { recursive: true });
      else await store.remove(e.manifest);
      const mine = myDevice();
      if (mine) {
        for (const p of [`.tramado/answers/${examId}/${mine}.json`, `.tramado/exam-edits/${examId}/${mine}.jsonl`]) await store.remove(p).catch(() => undefined);
      }
      await platform.privateFiles.remove(classId, `exams/${examId}.json`).catch(() => undefined);
      privates.delete(examId);
      entries.delete(examId);
      rebuild();
    },
    async saveQuestions(examId, questions, meta) {
      const e = entryOf(examId);
      importerOnly(e);
      const qs = questions.map((q) => ({ ...q, number: q.number.trim(), text: q.text.trim() }));
      const problems = reviewProblems(qs);
      if (problems.length) throw new PlatformError('INVALID', 'the questions need fixing', { problems });
      const who = me();
      const t = instant(now());
      const next: ExamFile = {
        ...e.raw, ...meta, questions: qs, status: qs.length ? 'paper' : e.raw.status,
        ...(meta.title !== undefined ? { title: meta.title.trim().slice(0, 200) || e.raw.title } : {}),
        extraction: e.raw.extraction ? { ...e.raw.extraction, reviewedAt: e.raw.extraction.reviewedAt ?? t, reviewedBy: e.raw.extraction.reviewedBy ?? who.memberId } : { method: 'typed', at: t, reviewedAt: t, reviewedBy: who.memberId },
      };
      await writeExam(e, next);
    },
    async setInPractice(examId, qid, on) {
      await updatePrivate(examId, (m) => {
        if (on) m.inPractice[qid] = true;
        else delete m.inPractice[qid];
      });
    },
  };
}

/** The practice queue of UX §3.9.9: never practised, then last "again", then oldest; "got it" within 20 h excluded. */
export function practiceQueue(questions: readonly QuestionView[], nowMs: number): QuestionView[] {
  const recent = (q: QuestionView) => q.mine.practice.lastResult === 'gotIt' && q.mine.practice.lastAt !== null && nowMs - Date.parse(q.mine.practice.lastAt) < 20 * 3600_000;
  const rank = (q: QuestionView) => (q.mine.practice.count === 0 ? 0 : q.mine.practice.lastResult === 'again' ? 1 : 2);
  return questions
    .filter((q) => q.mine.inPractice && !recent(q))
    .sort((a, b) => rank(a) - rank(b) || (a.mine.practice.lastAt ?? '').localeCompare(b.mine.practice.lastAt ?? ''));
}

