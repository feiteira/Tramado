// Architecture §9 (verbatim): the TypeScript side of the IPC contract (§6–§7). A field added here MUST be
// added to the Rust twin in the same change (§19.2: additive changes only, by the owning work package).
import type { ClassId, ClassPath, DeviceId, ShortId, MemberId, Ulid, Hex64, Instant, EpochMs, Lang } from '../../core/model/ids';
import type { ClaimFile } from '../../core/model/files';
import type { ErrorCode } from '../../core/errors';

// Re-exported for the other platform type files.
export type { ClassId, ClassPath, DeviceId, ShortId, MemberId, Ulid, Hex64, Instant, EpochMs, Lang, ClaimFile, ErrorCode };
export type Unsubscribe = () => void;
export type PickToken = string;                       // opaque, 32 hex chars, valid until quit (D-4)
export interface ConfirmText { title: string; message: string; confirm: string; cancel: string }   // message may contain {host}
export interface FileFilter { name: string; extensions: string[] }  // extensions without the dot

