// Shim so Trama's core/import parsers compile unchanged (research trama-ts §9): the two names they
// imported from Trama's core/model/types.

/** A time anchor inside a transcript text: character position → milliseconds. */
export interface SyncPoint {
  pos: number;
  ms: number;
}

export const LIMITS = { nameMax: 200, textMax: 20_000_000 } as const;
