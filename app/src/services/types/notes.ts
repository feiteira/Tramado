// Architecture §11.2 (verbatim declarations): service contracts of the `notes` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassPath, EpochMs, MemberId, Ulid } from '../../core/model/ids';
import type { AnnotationLine, SourceRef } from '../../core/model/files';
import type { ReadableStore } from '../store';

export interface NoteSummary { scope: 'class' | 'private'; path: string; title: string; mtimeMs: number; conflict: boolean; editingBy: string[] }

export interface NotesService {
  list: ReadableStore<NoteSummary[]>;
  read(scope: 'class' | 'private', path: string): Promise<string>;
  save(scope: 'class' | 'private', path: string, text: string): Promise<void>;   // caller debounces 2 s
  create(scope: 'class' | 'private', title: string): Promise<string>;
  rename(scope: 'class' | 'private', path: string, title: string): Promise<string>; remove(scope: 'class' | 'private', path: string): Promise<void>;
  conflicts(path: ClassPath): Promise<{ base: string; copies: Array<{ path: ClassPath; text: string }> }>;
  resolve(path: ClassPath, choice: { keep: 'base' | ClassPath } | { merged: string } | { keepBoth: true }): Promise<void>;
  editing(path: ClassPath | null): void;                    // presence activity.editing
}

export interface Annotation { id: Ulid; visibility: 'private' | 'class'; author: { memberId: MemberId; name: string }; kind: 'comment' | 'highlight'; target: AnnotationLine['target']; colour?: AnnotationLine['colour']; body?: string; ai?: { model: string }; ms: EpochMs; anchor: 'exact' | 'moved' | 'approximate' | 'lost' }

export interface AnnotationService {
  forSource(source: SourceRef): ReadableStore<Annotation[]>;
  add(a: Omit<Annotation, 'id' | 'author' | 'ms' | 'anchor'>): Promise<Ulid>; edit(id: Ulid, body: string): Promise<void>; remove(id: Ulid): Promise<void>;
}
