// Errors the computer reports, in the reader's language (Trama's problems.ts, adapted to Tramado's
// taxonomy, architecture §15). The UI translates codes (`errors.<CODE>`), never raw messages; OS
// texts that slip through as IO_ERROR are recognised for disk full and permissions. Pure (no DOM).
import { isErrorCode, PlatformError, type ErrorCode } from '../core/errors';
import type { MessageKey } from './i18n';

// ENOSPC is error 28 on Linux and macOS; Windows says 112 or 39.
const DISK_FULL = /os error (28|39|112)\b|no space left|not enough space|disk (is )?full/i;
const NO_PERMISSION = /os error (13|5|1)\b|permission denied|access is denied|operation not permitted|read-only file system/i;

/** The error code a person can be told about, or null for anything else. */
export function problemOf(e: unknown): ErrorCode | null {
  if (e instanceof PlatformError) {
    if (e.code === 'IO_ERROR') {
      if (DISK_FULL.test(e.message)) return 'DISK_FULL';
      if (NO_PERMISSION.test(e.message)) return 'PERMISSION_DENIED';
      return 'IO_ERROR';
    }
    return e.code;
  }
  if (e && typeof e === 'object' && 'code' in e && isErrorCode((e as { code: unknown }).code)) return (e as { code: ErrorCode }).code;
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (DISK_FULL.test(message)) return 'DISK_FULL';
  return null;
}

/** The sentence for a known problem (`errors.<CODE>`), or null. */
export function problemKey(e: unknown): MessageKey | null {
  const p = problemOf(e);
  return p ? (`errors.${p}` as MessageKey) : null;
}
