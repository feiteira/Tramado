// Architecture §11.2 (verbatim declarations): service contracts of the `common` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ClassPath, Hex64, Ulid } from '../../core/model/ids';
import type { ClassEntry, ClassFileEntry, ErrorCode, FileStamp } from '../../platform/types';
import type { Parsed } from '../../core/model/parse';
import type { AppContext } from '../context';
import type { ReadableStore } from '../store';
import type { AiService } from './ai';
import type { AskService } from './ask';
import type { ChatService } from './chat';
import type { ClassService, NotificationService } from './class';
import type { DocumentService, ExtractionService } from './documents';
import type { ExamService } from './exams';
import type { LectureService } from './lectures';
import type { ClassLibrary } from './library';
import type { AnnotationService, NotesService } from './notes';
import type { RecordingService } from './recording';
import type { SearchService } from './search';
import type { ClaimEngine, PresenceService, SyncService, TrustService } from './sync';
import type { ModelsService, TranscriptionQueue } from './transcription';

export interface AppServices {
  ctx: AppContext;
  library: ClassLibrary;          // services/library.ts
  sync: SyncService;              // services/sync.ts
  ai: AiService;                  // services/ai.ts
  search: SearchService;          // services/search.ts
  models: ModelsService;          // services/models.ts
  recording: RecordingService;    // services/recording.ts
  transcription: TranscriptionQueue;   // services/transcription.ts
  notifications: NotificationService;  // services/notifications.ts
  extraction: ExtractionService;  // services/extraction.ts
  forClass(classId: ClassId): ClassServices;     // created on first use, kept while the class is registered
}

export interface ClassServices {
  store: ClassStore;              // services/classStore.ts (M0, implemented)
  info: ClassService;             // services/class.ts
  lectures: LectureService;       // services/lectures.ts
  documents: DocumentService;     // services/documents.ts
  notes: NotesService;            // services/notes.ts
  annotations: AnnotationService; // services/annotations.ts
  exams: ExamService;             // services/exams.ts
  ask: AskService;                // services/ask.ts
  chat: ChatService;              // services/chat.ts
  presence: PresenceService;      // services/presence.ts
  claims: ClaimEngine;            // services/claims.ts
  trust: TrustService;            // services/trust.ts (installed as the store's TrustGate for shared classes)
}

export type ChangeKind = 'classFile' | 'meta' | 'members' | 'presence' | 'consent' | 'chat' | 'annotations' | 'claims'
  | 'edits' | 'markers' | 'examEdits' | 'answers' | 'mod' | 'bans' | 'lecture' | 'transcript' | 'audio' | 'exam'
  | 'document' | 'note' | 'conflict';

export interface IndexedItem { id: Ulid; dir: ClassPath; manifest: ClassPath; size: number; mtimeMs: number }

export interface ClassIndex {
  lectures: ReadonlyMap<Ulid, IndexedItem>; exams: ReadonlyMap<Ulid, IndexedItem>;
  documents: readonly (ClassFileEntry & { lectureId?: Ulid; examId?: Ulid })[];
  notes: readonly ClassFileEntry[]; machine: ReadonlyMap<ClassPath, ClassFileEntry>;
  conflicts: readonly { path: ClassPath; of: ClassPath }[]; duplicates: readonly { id: Ulid; paths: ClassPath[] }[];
}

export interface ClassStoreState {
  classId: ClassId; entry: ClassEntry; status: 'loading' | 'ready' | 'missing' | 'error'; error: ErrorCode | null;
  index: ClassIndex; revision: number; kinds: Readonly<Record<ChangeKind, number>>;   // per-kind change counters
}

export type TrustVerdict = { kind: 'trusted' } | { kind: 'prefix'; length: number } | { kind: 'untrusted'; reason: 'foreign-write' | 'writer-changed' | 'pending' } | { kind: 'unverified' };

export interface TrustGate {
  verify(path: ClassPath, bytes: Uint8Array, parsed: unknown | null): Promise<TrustVerdict>;
  noteOwnWrite(path: ClassPath, bytes: Uint8Array): void;
}

export interface Loaded<T> { value: T; verdict: TrustVerdict; newer: boolean; sha256: Hex64; size: number; mtimeMs: number }

export interface LoadedLines<T> { lines: Array<{ value: T; offset: number }>; consumed: number; verdict: TrustVerdict; skipped: number; newer: number }

export interface ClassStore {
  readonly state: ReadableStore<ClassStoreState>;
  start(): Promise<void>; stop(): void;
  setTrustGate(g: TrustGate): void;                   // default: everything 'trusted' (local-only classes, folder spec §6.3)
  setDirs(d: { lectures: string; documents: string; exams: string; notes: string; fromChat: string }): void;
  dir(key: 'lectures' | 'documents' | 'exams' | 'notes' | 'fromChat'): ClassPath;
  onChange(kinds: ChangeKind[], cb: (paths: ClassPath[]) => void): () => void;
  readBytes(path: ClassPath): Promise<Uint8Array | null>;
  readJson<T>(path: ClassPath, parse: (raw: unknown) => Parsed<T>): Promise<Loaded<T> | null>;
  readJsonl<T>(path: ClassPath, parse: (raw: unknown) => Parsed<T>, from?: { offset: number; prefixSha256: Hex64 }): Promise<LoadedLines<T>>;
  writeJson(path: ClassPath, value: object, opts: { own: boolean; manifest?: boolean }): Promise<FileStamp>;
  writeText(path: ClassPath, text: string, opts: { own: boolean }): Promise<FileStamp>;
  writeBytes(path: ClassPath, bytes: Uint8Array, opts: { own: boolean }): Promise<FileStamp>;
  appendLine(path: ClassPath, value: object): Promise<FileStamp>;   // always own
  remove(path: ClassPath, opts?: { recursive?: boolean }): Promise<void>;
  move(from: ClassPath, to: ClassPath): Promise<void>;
  mkdir(path: ClassPath): Promise<void>;
}
