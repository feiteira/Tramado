// Record types of v1 (folder spec §7.1) and the version negotiation of §7.2.

export const FORMATS = {
  'tramado.class': 1,
  'tramado.meta': 1,
  'tramado.member': 1,
  'tramado.presence': 1,
  'tramado.consent': 1,
  'tramado.lecture': 1,
  'tramado.transcript': 1,
  'tramado.transcript-edit': 1,
  'tramado.claim': 1,
  'tramado.markers': 1,
  'tramado.exam': 1,
  'tramado.exam-edit': 1,
  'tramado.answers': 1,
  'tramado.chat': 1,
  'tramado.annotation': 1,
  'tramado.mod': 1,
  'tramado.bans': 1,
} as const;
export type FormatName = keyof typeof FORMATS;

/** The highest version of each format this app reads (what the member file's `formats` lists). */
export const KNOWN_VERSION: Readonly<Record<FormatName, number>> = FORMATS;

export const isFormatName = (s: unknown): s is FormatName => typeof s === 'string' && s in FORMATS;

/** Whether a record of `format` at `version` is newer than this app reads (NEWER_FORMAT, §7.3). */
export function isNewer(format: string, version: number): boolean {
  return isFormatName(format) ? version > KNOWN_VERSION[format] : true;
}

/**
 * §7.2: write the highest version every roster device can read, but never more than this app
 * writes, and never below the oldest it can still write (1 in v1).
 */
export function negotiate(format: FormatName, rosterFormats: Array<Record<string, number> | undefined>): number {
  let v: number = KNOWN_VERSION[format];
  for (const f of rosterFormats) {
    const theirs = f?.[format];
    if (typeof theirs === 'number' && Number.isInteger(theirs) && theirs >= 1) v = Math.min(v, theirs);
  }
  return Math.max(1, v);
}
