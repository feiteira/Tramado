// Architecture §11.2 (verbatim declarations): service contracts of the `search` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ClassPath } from '../../core/model/ids';
import type { Citation, Locator, SourceRef } from '../../core/model/files';
import type { ReadableStore } from '../store';

export interface Passage { id: string; classId: ClassId; source: SourceRef; locator: Locator; label: string; text: string; score: number; hits: Array<[number, number]>
  title?: string;      // T-DOCS (additive): the source's title (file name without extension, lecture or exam title, note title)
  private?: boolean;   // T-DOCS (additive): a private note (My notes) — never cite it in shared content
}

export interface IndexStatus { classId: ClassId; state: 'idle' | 'building' | 'ready' | 'error'; docs: number; pending: number; chars: number }

export interface SearchService {
  status(classId: ClassId): ReadableStore<IndexStatus>;
  ensure(classId: ClassId): Promise<void>;
  passages(scope: ClassId | 'all', query: string, opts?: { limit?: number; kinds?: Array<SourceRef['kind']>; exclude?: string[] }): Promise<Passage[]>;
  passage(classId: ClassId, id: string, opts?: { offset?: number; max?: number }): Promise<(Passage & { hasMore: boolean }) | null>;
  find(scope: ClassId | 'all', query: string, opts?: { limit?: number }): Promise<Array<{ classId: ClassId; source: SourceRef; label: string; before: string; match: string; after: string; locator: Locator }>>;
  resolve(classId: ClassId, c: Citation): Promise<{ status: 'exact' | 'moved' | 'changed' | 'missing'; route: unknown | null; label: string; path?: ClassPath }>;
  // T-DOCS (additive): resolves when no file of the class is waiting for extraction (tests, exam answering).
  settled?(classId: ClassId): Promise<IndexStatus>;
  // T-DOCS (additive): re-read the class's sources now (private notes have no file events).
  refresh?(classId: ClassId): void;
  // UI-DOCS (additive): index one document again although its file did not change (its text cache did: AI OCR).
  reindex?(classId: ClassId, path: ClassPath): void;
}
