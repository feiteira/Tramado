// Authorship verification (folder spec §6, sync spec §12.1): the verdict is bound to the bytes read. A version of a
// machine file is trusted when Syncthing says the writer's device made that version (`local.modifiedBy` equals the
// writer's ShortId and `local.blocksHash` equals the block hash of the bytes), or its SHA-256 equals the last trusted
// content, or (JSONL) it keeps the last trusted prefix byte for byte. Signed records additionally need a valid
// signature, person proof and no rollback; manifests a valid derived ID; transcripts a valid writer change. Pure:
// the async checks (signatures, derived IDs) are made by the caller and passed in.
import { toBase64 } from '../bytes';
import { sha256, sha256Hex } from '../util/sha256';
import { classifyPath, type PathKind } from '../model/paths';
import { isDeviceId, shortIdOf, type ClassPath, type DeviceId, type Hex64, type ShortId } from '../model/ids';
import type { TrustCacheEntry } from '../model/files';

/** Syncthing's block size for files below 250 MiB (sync spec §12.1). */
export const BLOCK_SIZE = 128 * 1024;

/** `base64(SHA-256(h_1 || … || h_n))` with `h_i` = SHA-256 of the i-th 128 KiB block (sync spec §12.1). */
export function blocksHash(bytes: Uint8Array): string {
  const n = Math.max(1, Math.ceil(bytes.length / BLOCK_SIZE));
  const cat = new Uint8Array(32 * n);
  for (let i = 0; i < n; i++) cat.set(sha256(bytes.subarray(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE)), i * 32);
  return toBase64(sha256(cat));
}

/** Kinds of machine files (folder spec §6.1); everything else (documents, notes) is not authorship-checked. */
const MACHINE_KINDS: ReadonlySet<PathKind> = new Set<PathKind>([
  'classFile', 'meta', 'members', 'presence', 'consent', 'chat', 'annotations', 'claims', 'edits', 'markers', 'examEdits',
  'answers', 'mod', 'bans', 'invites', 'lectureManifest', 'transcriptJson', 'transcriptMd', 'transcriptVtt', 'audio', 'examManifest',
]);
/** Whole-file signed records (§6.1). `consent` and `mod` are signed per line. */
export const SIGNED_FILE_KINDS: ReadonlySet<PathKind> = new Set<PathKind>(['classFile', 'meta', 'members', 'bans']);
/** Signed whole-file records with an `hlc` (no-rollback rule, §6.2 rule 7). */
export const NO_ROLLBACK_KINDS: ReadonlySet<PathKind> = new Set<PathKind>(['meta', 'members', 'bans']);
/** Files whose last trusted bytes are kept (≤ 64 KiB, §6.2 rule 4). */
export const KEPT_KINDS: ReadonlySet<PathKind> = new Set<PathKind>(['classFile', 'meta', 'members', 'bans', 'mod']);
/** Files whose deletions are always ignored in v1 (writers never delete them, §6.2 rule 4). */
export const NEVER_DELETED_KINDS: ReadonlySet<PathKind> = new Set<PathKind>(['classFile', 'meta', 'bans', 'mod', 'consent']);

export const isMachinePath = (p: ClassPath): boolean => MACHINE_KINDS.has(classifyPath(p).kind);
export const isJsonlPath = (p: ClassPath): boolean => p.endsWith('.jsonl');

/**
 * The writer device of a machine file (§6.1): the device in the path, or the device named inside the manifest
 * (`createdBy`, `recordedBy`, `importedBy`, `writer`). `parsed` is the file's JSON (null when not parsed).
 */
export function writerOf(path: ClassPath, parsed: unknown): DeviceId | null {
  const info = classifyPath(path);
  if (info.deviceId) return info.deviceId;
  const o = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, Record<string, unknown> | undefined>;
  const pick = (k: string) => {
    const v = o[k]?.deviceId;
    return isDeviceId(v) ? v : null;
  };
  switch (info.kind) {
    case 'classFile': return pick('createdBy');
    case 'lectureManifest': return pick('recordedBy');
    case 'examManifest': return pick('importedBy');
    case 'transcriptJson': return pick('writer');
    default: return null;
  }
}

/** What Syncthing's database says about the local version (platform.sync.fileInfo, architecture §9). */
export interface LocalVersionInfo { localModifiedBy: ShortId | null; localBlocksHash: string | null; localDeleted: boolean }

/** Extra checks made by the caller for special files; `undefined` = not applicable. */
export interface JudgeExtras {
  sigOk?: boolean;          // signed records: signature (and, for members, the person proof shape) verifies
  noRollback?: boolean;     // signed whole-file records: hlc ≥ the trusted one
  derivedOk?: boolean;      // manifests: the derived ID matches the named writer (§2.1)
  writerChangeOk?: boolean; // transcript.json: the writer is the pinned one or a valid change (§6.2 rule 3)
}

export interface JudgeInput {
  path: ClassPath;
  bytes: Uint8Array;
  /** null: no Syncthing holds this class (local-only, folder spec §6.3) */
  info: LocalVersionInfo | null;
  writer: DeviceId | null;
  cache: TrustCacheEntry | undefined;
  extras: JudgeExtras;
}

export type JudgeResult =
  | { kind: 'trusted'; how: 'writer' | 'same' | 'local' }
  | { kind: 'prefix'; length: number }
  | { kind: 'pending' }
  | { kind: 'untrusted'; reason: 'foreign-write' | 'writer-changed' | 'signature' | 'rollback' | 'derived-id' };

function extrasFail(x: JudgeExtras): JudgeResult | null {
  if (x.sigOk === false) return { kind: 'untrusted', reason: 'signature' };
  if (x.derivedOk === false) return { kind: 'untrusted', reason: 'derived-id' };
  if (x.noRollback === false) return { kind: 'untrusted', reason: 'rollback' };
  if (x.writerChangeOk === false) return { kind: 'untrusted', reason: 'writer-changed' };
  return null;
}

/** The verdict of sync spec §12.1 for the bytes read. */
export function judge(j: JudgeInput): JudgeResult {
  const sha = sha256Hex(j.bytes);
  // Same content as the last trusted version: still trusted (§6.2 rule 1); its checks passed before.
  if (j.cache && j.cache.sha256 === sha) return { kind: 'trusted', how: 'same' };
  if (j.info === null) {
    // Without Syncthing only signatures and derived IDs can be checked (§6.3); the local class trusts itself.
    return extrasFail(j.extras) ?? { kind: 'trusted', how: 'local' };
  }
  if (j.info.localBlocksHash !== blocksHash(j.bytes)) return { kind: 'pending' };
  const writerShort = j.writer ? shortIdOf(j.writer) : null;
  if (writerShort !== null && j.info.localModifiedBy === writerShort) return extrasFail(j.extras) ?? { kind: 'trusted', how: 'writer' };
  if (j.cache && isJsonlPath(j.path) && j.bytes.length >= j.cache.length && j.cache.length > 0
    && sha256Hex(j.bytes.subarray(0, j.cache.length)) === j.cache.prefixSha256) {
    return { kind: 'prefix', length: j.cache.length };
  }
  return { kind: 'untrusted', reason: 'foreign-write' };
}

/** The deletion rule (§6.2 rule 4): a deletion counts only when the writer's device made it. */
export function deletionHonoured(path: ClassPath, writer: DeviceId | null, info: LocalVersionInfo | null): boolean {
  const kind = classifyPath(path).kind;
  if (NEVER_DELETED_KINDS.has(kind)) return false;
  if (info === null) return true;
  return info.localDeleted && writer !== null && info.localModifiedBy === shortIdOf(writer);
}

/** A trust-cache entry for bytes that are now trusted in full (prefixSha256 = sha256). */
export function cacheEntry(bytes: Uint8Array, extra: { size?: number; mtimeMs?: number; hlc?: string } = {}): TrustCacheEntry {
  const sha: Hex64 = sha256Hex(bytes);
  return {
    sha256: sha, length: bytes.length, prefixSha256: sha, blocksHash: blocksHash(bytes), size: extra.size ?? bytes.length,
    mtimeMs: extra.mtimeMs ?? 0, ...(extra.hlc ? { hlc: extra.hlc } : {}),
  };
}
