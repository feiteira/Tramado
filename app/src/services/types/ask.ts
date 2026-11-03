// Architecture §11.2 (verbatim declarations): service contracts of the `ask` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassPath, Instant, Ulid } from '../../core/model/ids';
import type { Citation, Locator, MsgRef, SourceRef } from '../../core/model/files';
import type { ErrorCode } from '../../platform/types';
import type { ReadableStore } from '../store';
import type { Passage } from './search';

export interface AskTurn { id: Ulid; question: string; scope: { kinds: Array<SourceRef['kind']>; lectureId?: Ulid; docPath?: ClassPath }; answer: string; citations: Citation[]; model: string | null; status: 'running' | 'ok' | 'error'; error: ErrorCode | null; at: Instant }

export interface AskService {
  threads: ReadableStore<Array<{ threadId: Ulid; title: string; at: Instant }>>;   // private: data/private/<classId>/ask/<threadId>.jsonl (UX §3.11)
  thread(threadId: Ulid): ReadableStore<AskTurn[]>;
  ask(threadId: Ulid | null, question: string, scope: AskTurn['scope']): Promise<Ulid>;   // null = new thread
  explain(passage: Passage | { text: string; source: SourceRef; locator: Locator }, style: 'simpler' | 'example' | 'translate'): Promise<AskTurn>;
  summarize(lectureId: Ulid): Promise<AskTurn>; keyTerms(lectureId: Ulid): Promise<AskTurn>;   // saved in private lectures/<id>.json
  annotate(lectureId: Ulid): Promise<number>;                // "Annotate with AI": key terms → private AnnotationLines with ai:{model}
  studyNotes(lectureId: Ulid): Promise<string>;              // "Make study notes": a private note (headings, tramado:lecture time links, doc links)
  askInChat(question: MsgRef): Promise<void>;                // @AI in chat → writes an `ai` chat line replying to it
  postToChat(threadId: Ulid, turnId: Ulid): Promise<void>;   // an `ai` line with `question`, no replyTo; refused (INVALID) when it cites a private source
  clear(): Promise<void>;
}
