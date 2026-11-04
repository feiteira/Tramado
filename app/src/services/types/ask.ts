// Architecture §11.2 (verbatim declarations): service contracts of the `ask` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ClassPath, Instant, Ulid } from '../../core/model/ids';
import type { Citation, Locator, MsgRef, SourceRef } from '../../core/model/files';
import type { ErrorCode } from '../../platform/types';
import type { ReadableStore } from '../store';
import type { Passage } from './search';

export interface AskTurn { id: Ulid; question: string; scope: { kinds: Array<SourceRef['kind']>; lectureId?: Ulid; docPath?: ClassPath
    /** UI-EXAMS (additive): Ask across classes — the classes searched (absent: this class; empty: all classes). */
    classes?: ClassId[] }; answer: string; citations: Citation[]; model: string | null; status: 'running' | 'ok' | 'error'; error: ErrorCode | null; at: Instant;
  // ── Additive (T-AI, wave 1) ──
  /** What was sent ("Sent: your question and {n} passages. [See what was sent]", UX §3.11). */
  sent?: Array<{ ref: string; label: string; excerpt: string }>;
  /** The first model of the chain, when another model answered (the "answered because … was busy" line). */
  requestedModel?: string | null;
  /** General knowledge was allowed for this turn (unverified sentences are marked). */
  general?: boolean;
  mode?: 'quick' | 'deep';
  /** The privacy level the answer was made under (an `ai` chat line needs it, folder spec §8.16). */
  privacy?: 'standard' | 'no-training' | 'zdr' | 'custom-host';
  // ── Additive (UI-EXAMS, wave 2) ──
  /** Ask across classes: the class of each cited ref (absent: the thread's class). */
  classOf?: Record<string, ClassId>;
  // ── Additive (INT, wave 3) ──
  /** The model stopped at its length limit (`finish_reason: "length"`): the answer is cut off ([Answer again with more room]). */
  cut?: boolean;
  /** A rate limit that said when to come back (429/503 `Retry-After`), in seconds from `at`. */
  retryAfterS?: number;
}

/** Additive options of `ask` (T-AI): the [Allow general knowledge] chip, the per-thread model, Deep answer, the busy chooser. */
export interface AskOptions { general?: boolean; model?: string; mode?: 'quick' | 'deep'; busyFallback?: boolean
  /** UI-EXAMS (additive): the "My notes" scope chip; false keeps private notes out of what is sent (default true). */
  privateNotes?: boolean;
  /** INT: twice the room for the answer (the [Answer again with more room] of a cut-off answer). */
  moreRoom?: boolean }
export type ExplainStyle = 'simpler' | 'example' | 'translate' | 'detail' | 'exam';

export interface AskService {
  threads: ReadableStore<Array<{ threadId: Ulid; title: string; at: Instant }>>;   // private: data/private/<classId>/ask/<threadId>.jsonl (UX §3.11)
  thread(threadId: Ulid): ReadableStore<AskTurn[]>;
  ask(threadId: Ulid | null, question: string, scope: AskTurn['scope'], opts?: AskOptions): Promise<Ulid>;   // null = new thread
  explain(passage: Passage | { text: string; source: SourceRef; locator: Locator }, style: ExplainStyle): Promise<AskTurn>;
  summarize(lectureId: Ulid): Promise<AskTurn>; keyTerms(lectureId: Ulid): Promise<AskTurn>;   // saved in private lectures/<id>.json
  annotate(lectureId: Ulid): Promise<number>;                // "Annotate with AI": key terms → private AnnotationLines with ai:{model}
  studyNotes(lectureId: Ulid): Promise<string>;              // "Make study notes": a private note (headings, tramado:lecture time links, doc links)
  askInChat(question: MsgRef): Promise<void>;                // @AI in chat → writes an `ai` chat line replying to it
  postToChat(threadId: Ulid, turnId: Ulid): Promise<void>;   // an `ai` line with `question`, no replyTo; refused (INVALID) when it cites a private source
  clear(): Promise<void>;
  // ── Additive (T-AI, wave 1) ──
  /** Deletes one thread (the ⋯ menu's Delete, UX §3.11). */
  removeThread(threadId: Ulid): Promise<void>;
  /** The saved summary and key terms of a lecture (private `lectures/<id>.json`). */
  lectureNotes(lectureId: Ulid): Promise<{ summary: AskTurn | null; terms: AskTurn | null }>;
  // ── Additive (UI-EXAMS, wave 2) ──
  /** The ⋯ menu's Rename (UX §3.11): a private title kept in `private/<classId>/ask/titles.json`. */
  renameThread(threadId: Ulid, title: string): Promise<void>;
  /**
   * Posts a finished turn as an `ai` chat line of this class (the [Post to class chat] of Ask across classes, whose
   * threads live elsewhere). Refused (INVALID, `{ private: true }`) when it cites a private source.
   */
  postTurn(turn: AskTurn): Promise<void>;
}

/**
 * Ask across all classes (route `ask`, UX §3.11; UI-EXAMS). Threads are private and live in
 * `private/<home classId>/ask-all/<threadId>.jsonl` (the class chosen when the thread started); answers search every
 * class (or the classes of `scope.classes`) and record the class of each citation in `AskTurn.classOf`.
 */
export interface GlobalAskService {
  threads: ReadableStore<Array<{ threadId: Ulid; title: string; at: Instant; home: ClassId }>>;
  thread(threadId: Ulid): ReadableStore<AskTurn[]>;
  ask(threadId: Ulid | null, question: string, scope: AskTurn['scope'], opts?: AskOptions): Promise<Ulid>;
  removeThread(threadId: Ulid): Promise<void>;
  renameThread(threadId: Ulid, title: string): Promise<void>;
  /** Resolves when the history was read and no answer is running (tests). */
  idle(): Promise<void>;
}
