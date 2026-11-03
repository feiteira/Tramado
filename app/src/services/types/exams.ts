// Architecture §11.2 (verbatim declarations): service contracts of the `exams` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, QuestionId, Ulid } from '../../core/model/ids';
import type { Answer, ExamFile, Question } from '../../core/model/files';
import type { ErrorCode, Picked } from '../../platform/types';
import type { ExamDateView, ExamPaperView } from './viewModels';
import type { ReadableStore } from '../store';

export interface ExamDraft {
  id: string; classId: ClassId; step: 'ocr' | 'presplit' | 'extracting' | 'review' | 'saving' | 'failed';
  pages: number; ocrDone: number; text: string; questions: Question[]; meta: Partial<ExamFile>; cost: { requests: number }; error: ErrorCode | null; model: string | null;
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
  answer(examId: Ulid, qids: QuestionId[], mode: 'quick' | 'deep', scope: Answer['scope']): ReadableStore<{ done: number; total: number; current: QuestionId | null; error: ErrorCode | null }>;
  setMyAnswer(examId: Ulid, qid: QuestionId, text: string): Promise<void>;
  setCorrect(examId: Ulid, qid: QuestionId, text: string): Promise<void>;     // "the correct answer", private
  setMark(examId: Ulid, qid: QuestionId, m: 'right' | 'partly' | 'wrong' | 'unsure' | null): Promise<void>;
  reveal(examId: Ulid, qid: QuestionId): Promise<void>;                       // try-first: marks the AI answer revealed
  hint(examId: Ulid, qid: QuestionId): Promise<void>;                         // private hint (never in answers/)
  practise(examId: Ulid, qid: QuestionId, result: 'again' | 'gotIt'): Promise<void>;
  setInPractice(examId: Ulid, qid: QuestionId, on: boolean): Promise<void>;
}
