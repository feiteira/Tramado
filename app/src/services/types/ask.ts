// Architecture §11.2 (verbatim declarations): service contracts of the `ask` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassPath, Instant, Ulid } from '../../core/model/ids';
import type { Citation, Locator, MsgRef, SourceRef } from '../../core/model/files';
import type { ErrorCode } from '../../platform/types';
import type { ReadableStore } from '../store';
import type { Passage } from './search';

export interface AskTurn { id: Ulid; question: string; scope: { kinds: Array<SourceRef['kind']>; lectureId?: Ulid; docPath?: ClassPath }; answer: string; citations: Citation[]; model: string | null; status: 'running' | 'ok' | 'error'; error: ErrorCode | null; at: Instant;
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
}

/** Additive options of `ask` (T-AI): the [Allow general knowledge] chip, the per-thread model, Deep answer, the busy chooser. */
export interface AskOptions { general?: boolean; model?: string; mode?: 'quick' | 'deep'; busyFallback?: boolean }
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
}
