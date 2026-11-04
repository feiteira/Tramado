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
  // ── UI-DOCS (additive, wave 2) ──
  /** Kept only on this computer through the class's local ignores ("Keep private", UX §3.7.1 "Only on this computer"). */
  localOnly?: boolean;
  /** Who added it (Syncthing's modifiedBy → device → member, UX §3.7.1 "Added by"); null = unknown, absent = not known yet. */
  addedBy?: { name: string; self: boolean } | null;
}

/** UI-DOCS (additive): what an Undo of "Delete for everyone" needs (UX §3.7.1; sync spec §22.1). */
export interface RemovedDoc { path: ClassPath; at: number; bytes: Uint8Array | null }

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
  // ── UI-DOCS (additive, wave 2) ──
  /** Folders under the documents directory (empty ones included), class paths, sorted. */
  folders: ReadableStore<ClassPath[]>;
  /** Creates a folder (sanitised, unique) in `parent` (default: the documents directory); returns its path. */
  mkdir(name: string, parent?: ClassPath): Promise<ClassPath>;
  /**
   * "Keep private (only you)" (UX §3.7.1, lead brief G2): deletes the file for everyone else and keeps it on this
   * computer only, through the class's local ignores (folder spec §11.2): bytes kept → delete (+ scan) → ignore
   * line → written back. In a class that is not shared it only adds the ignore line.
   */
  keepPrivate(path: ClassPath): Promise<void>;
  /** Shares a file kept private again: the ignore line is dropped and the file is scanned. */
  share(path: ClassPath): Promise<void>;
  /** `remove(path, 'everyone')` that keeps what Undo needs (the bytes, when ≤ 64 MB). */
  removeForUndo(path: ClassPath): Promise<RemovedDoc>;
  /** Undo of `removeForUndo`: through the versions API when Syncthing kept a copy, else the kept bytes. */
  restore(removed: RemovedDoc): Promise<void>;
}

export interface ExtractionService {       // services/extraction.ts; writes cache/text/<sha256>.json through ctx.extractHost
  status: ReadableStore<{ running: number; queued: number; bySha: Readonly<Record<Hex64, 'pending' | 'running' | 'ready' | 'scan' | 'failed' | 'unsupported'>>;
    progress?: Readonly<Record<Hex64, number>>;                      // T-DOCS (additive): 0..1 of running jobs ("Reading text… {n} %")
    pages?: Readonly<Record<Hex64, number>>;                         // T-DOCS (additive): pages/slides of extracted files
  }>;
  ensure(classId: ClassId, path: ClassPath): Promise<TextCache>;
  cancel(sha256: Hex64): void;
  // ── UI-DOCS (additive, wave 2) ──
  /**
   * "Read the text with AI" (UX §3.7.2): a scanned PDF of ≤ 20 pages, one vision request per image page (each page
   * image cached in cache/ocr/), the text written to the text cache (never into the class). Errors: INVALID
   * (`data.reason: 'tooLong'`), UNSUPPORTED_FILE, the AI codes.
   */
  ocr?(classId: ClassId, path: ClassPath, opts?: { onProgress?(done: number, total: number): void; signal?: AbortSignal }): Promise<TextCache>;
  /** "Describe with AI" for an image (UX §3.7.2): one vision request; nothing is stored. */
  describe?(classId: ClassId, path: ClassPath, opts?: { signal?: AbortSignal }): Promise<{ text: string; model: string }>;
}
