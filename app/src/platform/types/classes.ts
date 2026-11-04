// Architecture §9 (verbatim): the TypeScript side of the IPC contract (§6–§7). A field added here MUST be
// added to the Rust twin in the same change (§19.2: additive changes only, by the owning work package).
import type { ClassId, ClassPath, Hex64, Instant, PickToken } from './common';
export interface ClassEntry {
  classId: ClassId; path: string; dirName: string;
  shared: boolean; joining: boolean; archived: boolean; skipAudio: boolean;
  aliases: ClassId[]; localIgnores: ClassPath[] /* class paths; Rust emits "(?d)/" + path */; addedAt: Instant;
  /** INT (wave 3): `audio.webm` paths fetched although `skipAudio` ("Get the recording"); Rust emits "!/" + path first. */
  localIncludes?: ClassPath[];
  leaving: { since: Instant; afterwards: 'keepLocal' | 'trash' } | null;   // sync spec §17 (hidden from the UI)
  available: boolean;                      // root and .tramado/class.json present (false → the folder-missing card)
}
export interface AdoptedClass { entry: ClassEntry; foreignMembers: boolean }   // true → TS forks it (sync spec §17)
export interface ClassesRoot { path: string; names: string[] }
export interface CreatedClass { entry: ClassEntry; warnings: Array<'cloudFolder'> }
export interface ClassFileEntry { path: ClassPath; name: string; isDir: boolean; size: number; mtimeMs: number; conflictOf: ClassPath | null }
export interface FileStamp { path: ClassPath; size: number; mtimeMs: number; sha256: Hex64 | null }
export interface ClassChangedEvent { classId: ClassId; paths: ClassPath[]; selfWrite: boolean; rescan: boolean }
export interface Picked { token: PickToken; name: string; path: string; size: number | null; isDir: boolean }

