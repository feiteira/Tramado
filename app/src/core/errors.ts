// The error taxonomy shared by Rust and TypeScript (architecture §15; critique §8 + D-2).
// test-vectors/error-codes.json lists the same codes; errors.test.ts and a Rust test compare them.

export const ERROR_CODES = [
  // common
  'INVALID', 'NOT_FOUND', 'PERMISSION_DENIED', 'IO_ERROR', 'DISK_FULL', 'CANCELLED', 'JOB_BUSY', 'PATH_OUTSIDE_CLASS',
  'SYMLINK_REFUSED', 'CONFLICT', 'NEWER_FORMAT', 'UNSUPPORTED_FILE', 'NOT_IMPLEMENTED',
  // AI
  'AI_NO_KEY', 'AI_AUTH', 'AI_NO_CREDIT', 'AI_MODEL_GATED', 'AI_FLAGGED', 'AI_PRIVACY_BLOCKS', 'AI_UNSUPPORTED',
  'AI_MODEL_UNKNOWN', 'AI_TOO_LONG', 'AI_BAD_REQUEST', 'AI_BUSY', 'AI_FREE_LIMIT', 'AI_UPSTREAM', 'AI_UNAVAILABLE',
  'AI_TIMEOUT', 'AI_OFFLINE', 'AI_LENGTH', 'AI_HOST_NOT_ALLOWED', 'AI_BAD_ADDRESS',
  // speech
  'SPEECH_NO_DEVICE', 'SPEECH_PERMISSION', 'SPEECH_NO_SYSTEM_AUDIO', 'SPEECH_UNSUPPORTED_AUDIO', 'SPEECH_NO_SPEECH',
  'SPEECH_UNSUPPORTED_CPU', 'MODEL_NOT_DOWNLOADED', 'MODEL_UNREADABLE', 'MODEL_DOWNLOAD_FAILED', 'MODEL_INTEGRITY',
  // sync
  'SYNC_UNAVAILABLE', 'SYNC_LOCKED', 'SYNC_PORT', 'SYNC_FOLDER_MARKER_MISSING', 'SYNC_INVITE_INVALID', 'SYNC_FOREIGN_WRITE',
  'SYNC_IDENTITY_COPIED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const isErrorCode = (s: unknown): s is ErrorCode => typeof s === 'string' && (ERROR_CODES as readonly string[]).includes(s);

export class PlatformError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

// Tauri's own rejections are plain strings: a missing command or a bad argument is the caller's
// mistake (INVALID); anything about files is IO_ERROR.
const TAURI_INVALID = /command .* not found|missing required key|invalid args|invalid type|unknown variant|expected/i;

/** Maps Rust `{code, message, data}` objects, Tauri strings and stray errors to a PlatformError. */
export function toPlatformError(e: unknown): PlatformError {
  if (e instanceof PlatformError) return e;
  if (e && typeof e === 'object' && 'code' in e) {
    const o = e as { code: unknown; message?: unknown; data?: unknown };
    const code = isErrorCode(o.code) ? o.code : 'IO_ERROR';
    const message = typeof o.message === 'string' ? o.message : String(o.code);
    const data = o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {};
    return new PlatformError(code, message, data);
  }
  if (typeof e === 'string') return new PlatformError(TAURI_INVALID.test(e) ? 'INVALID' : 'IO_ERROR', e);
  if (e instanceof Error) return new PlatformError('IO_ERROR', e.message);
  return new PlatformError('IO_ERROR', String(e));
}

/** The `data` payload of an error (empty for anything that is not a PlatformError). */
export function errorData(e: unknown): Record<string, unknown> {
  return e instanceof PlatformError ? e.data : {};
}

/** The code of any thrown value (IO_ERROR for unknown ones). */
export const errorCode = (e: unknown): ErrorCode => toPlatformError(e).code;

/** The error every scaffold stub throws until its work package implements it (D-2). */
export const notImplemented = (what: string): PlatformError => new PlatformError('NOT_IMPLEMENTED', `${what} is not implemented yet`);
