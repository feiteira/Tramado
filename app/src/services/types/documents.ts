// Architecture §11.2 (verbatim declarations): service contracts of the `documents` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ClassPath, Hex64, Ulid } from '../../core/model/ids';
import type { Locator } from '../../core/model/files';
import type { ErrorCode, Picked } from '../../platform/types';
import type { ReadableStore } from '../store';

export interface DocSummary {
  path: ClassPath; name: string; dir: ClassPath; size: number; mtimeMs: number; sha256: Hex64 | null;
  kind: 'pdf' | 'docx' | 'pptx' | 'odt' | 'md' | 'txt' | 'html' | 'rtf' | 'image' | 'audio' | 'video' | 'other';
  extraction: 'pending' | 'running' | 'ready' | 'scan' | 'failed' | 'unsupported'; pages: number | null;
  lectureId: Ulid | null; examId: Ulid | null; conflictOf: ClassPath | null; duplicateOf: ClassPath | null; fromChat: boolean;
}

export interface TextCache {   // cache/text/<sha256>.json, format "tramado.text-cache" v1
  sha256: Hex64; extractor: string; kind: DocSummary['kind']; text: string;
  pageStarts?: number[]; pageLabels?: Array<string | null>; imagePages?: number[]; slideStarts?: number[];
  headings?: Array<{ start: number; level: number; text: string }>; units: Array<{ start: number; end: number; locator: Locator }>; warnings: string[];
}

export interface DocumentService {
  list: ReadableStore<DocSummary[]>;
  import(picks: Picked[], destDir?: ClassPath, opts?: { allowDuplicate?: boolean }): Promise<Array<{ name: string; path?: ClassPath; error?: ErrorCode; duplicateOf?: ClassPath }>>;
      // T-DOCS (additive): a file whose SHA-256 is already in the class is not added (duplicateOf set)
      // unless opts.allowDuplicate (UX §3.7.1 [Add anyway]).
  remove(path: ClassPath, mode: 'everyone' | 'thisComputer'): Promise<void>;
  rename(path: ClassPath, name: string): Promise<ClassPath>; move(path: ClassPath, destDir: ClassPath): Promise<ClassPath>;
  text(path: ClassPath): Promise<TextCache>; url(path: ClassPath): string; reveal(path: ClassPath): Promise<void>; open(path: ClassPath): Promise<void>;
}

export interface ExtractionService {       // services/extraction.ts; writes cache/text/<sha256>.json through ctx.extractHost
  status: ReadableStore<{ running: number; queued: number; bySha: Readonly<Record<Hex64, 'pending' | 'running' | 'ready' | 'scan' | 'failed' | 'unsupported'>>;
    progress?: Readonly<Record<Hex64, number>>;                      // T-DOCS (additive): 0..1 of running jobs ("Reading text… {n} %")
    pages?: Readonly<Record<Hex64, number>>;                         // T-DOCS (additive): pages/slides of extracted files
  }>;
  ensure(classId: ClassId, path: ClassPath): Promise<TextCache>;
  cancel(sha256: Hex64): void;
}
