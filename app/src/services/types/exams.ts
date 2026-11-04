// Architecture §11.2 (verbatim declarations): service contracts of the `exams` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, QuestionId, Ulid } from '../../core/model/ids';
import type { Answer, ExamFile, Question } from '../../core/model/files';
import type { ErrorCode, Picked } from '../../platform/types';
import type { DeviceRef, ExamDateView, ExamPaperView } from './viewModels';
import type { ReadableStore } from '../store';

export interface ExamDraft {
  id: string; classId: ClassId; step: 'ocr' | 'presplit' | 'extracting' | 'review' | 'saving' | 'failed';
  pages: number; ocrDone: number; text: string; questions: Question[]; meta: Partial<ExamFile>; cost: { requests: number }; error: ErrorCode | null; model: string | null;
  /** UI-EXAMS (additive): the files copied into the exam's folder (the Review screen's original preview). */
  files?: ExamFile['files'];
}

export interface ExamService {
  list: ReadableStore<{ dates: ExamDateView[]; papers: ExamPaperView[] }>;   // UX view models
  open(id: Ulid): ReadableStore<ExamPaperView | null>;
  createUpcoming(input: Pick<ExamFile, 'title' | 'type' | 'date' | 'allDay' | 'durationMin' | 'room' | 'weight' | 'weightText' | 'covers' | 'coversText'>): Promise<Ulid>;
  updateUpcoming(examId: Ulid, patch: Partial<Pick<ExamFile, 'title' | 'type' | 'date' | 'allDay' | 'room' | 'weight' | 'weightText' | 'coversText'>>): Promise<void>;   // importer only in 0.1
  startImport(picks: Picked[], meta?: Partial<ExamFile>): Promise<string>;          // returns draft id
  draft(id: string): ReadableStore<ExamDraft | null>;
  saveReview(draftId: string, questions: Question[], meta: Partial<ExamFile>): Promise<Ulid>;   // writes exam.json (reviewedAt set)
  editQuestion(examId: Ulid, qid: QuestionId, field: string, value: unknown): Promise<void>;   // importer only in 0.1 (others: v1.1 exam-edit lines)
  addQuestion(examId: Ulid, q: Question, after: QuestionId | null): Promise<void>; deleteQuestion(examId: Ulid, qid: QuestionId): Promise<void>;
  answer(examId: Ulid, qids: QuestionId[], mode: 'quick' | 'deep', scope: Answer['scope'], opts?: AnswerOptions): ReadableStore<{ done: number; total: number; current: QuestionId | null; error: ErrorCode | null }>;
  setMyAnswer(examId: Ulid, qid: QuestionId, text: string): Promise<void>;
  setCorrect(examId: Ulid, qid: QuestionId, text: string): Promise<void>;     // "the correct answer", private
  setMark(examId: Ulid, qid: QuestionId, m: 'right' | 'partly' | 'wrong' | 'unsure' | null): Promise<void>;
  reveal(examId: Ulid, qid: QuestionId): Promise<void>;                       // try-first: marks the AI answer revealed
  hint(examId: Ulid, qid: QuestionId): Promise<void>;                         // private hint (never in answers/)
  practise(examId: Ulid, qid: QuestionId, result: 'again' | 'gotIt'): Promise<void>;
  setInPractice(examId: Ulid, qid: QuestionId, on: boolean): Promise<void>;
  // ── Additive (T-AI, wave 1) ──
  /** "Type or paste the questions" (UX §3.9.4): a draft at the review step, the pre-split applied, no AI. */
  startTyped(text: string, meta?: Partial<ExamFile>): Promise<string>;
  /** [Cancel] while extracting (UX §3.9.5): stops the draft's requests and forgets it (copied files stay). */
  cancelDraft(draftId: string): void;
  /** [Try again] after a failed step (UX §3.9.5): runs the draft again from its files. */
  retryDraft(draftId: string): Promise<void>;
  /** [Cancel] of "Answering… {i} of {n}" (UX §3.9.8). */
  cancelAnswers(examId: Ulid): void;
  /** The progress of a running batch, if any (the dock and the question list after a remount). */
  progress(examId: Ulid): ReadableStore<{ done: number; total: number; current: QuestionId | null; error: ErrorCode | null }> | null;
  // ── Additive (UI-EXAMS, wave 2) ──
  /** Exam ids with an answering batch running now (the answers view and the dock follow it). */
  running: ReadableStore<Ulid[]>;
  /** The exam as stored with the exam-edits folded in (the Review screen edits its raw questions); null when unknown. */
  raw(examId: Ulid): ExamFile | null;
  /** Who added an exam date or paper (only that computer edits it in 0.1, UX §3.9.3); null when unknown. */
  importer(examId: Ulid): DeviceRef | null;
  /**
   * "Delete for everyone…" (UX §3.9.2, §3.9.8): removes the exam's folder (exam.json and its original files), this
   * computer's answers and edits of it, and the private marks. Importer only (PERMISSION_DENIED otherwise).
   */
  remove(examId: Ulid): Promise<void>;
  /**
   * "Edit questions…" (UX §3.9.8 ⋯ → back to Review): saves the reviewed questions and the rules of a saved paper in one
   * write (importer only; INVALID with `{ problems }` when numbers repeat or a text is empty).
   */
  saveQuestions(examId: Ulid, questions: Question[], meta: Partial<Pick<ExamFile, 'title' | 'type' | 'academicYear' | 'rules' | 'durationMin' | 'extraPoints' | 'scale'>>): Promise<void>;
  // ── Additive (INT, wave 3) ──
  /**
   * More questions than the free requests left today (UX §3.9.7 "Tramado will answer {left} now and the rest after
   * {time}"): the rest is answered at `at` (the quota's reset), also after a restart (`private/<classId>/exams-later.json`).
   * A second call for the same exam replaces the first.
   */
  answerLater(examId: Ulid, qids: QuestionId[], scope: Answer['scope'], at: string): Promise<void>;
  /** Forgets the answers scheduled for an exam. */
  cancelLater(examId: Ulid): Promise<void>;
  /** The answers scheduled for later, per exam. */
  later: ReadableStore<LaterAnswers[]>;
}

/** INT: answers waiting for the free requests of the next day (`ExamService.answerLater`). */
export interface LaterAnswers { examId: Ulid; qids: QuestionId[]; scope: Answer['scope']; at: string }

/** Additive options of `answer` (T-AI): the busy chooser's "Use NVIDIA free models for this request". */
export interface AnswerOptions { busyFallback?: boolean }
