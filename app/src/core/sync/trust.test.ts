import { describe, expect, it } from 'vitest';
import { toBase64 } from '../bytes';
import { sha256 } from '../util/sha256';
import { blocksHash, cacheEntry, deletionHonoured, isMachinePath, judge, writerOf } from './trust';

const D = (c: string) => `${c.repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`;
const A = D('A'), B = D('B');
const enc = new TextEncoder();

describe('blocksHash (sync spec §12.1)', () => {
  it('a 27-byte file: base64(SHA-256(SHA-256(bytes)))', () => {
    const b = enc.encode('hello tramado, 27 bytes ok!');
    expect(b.length).toBe(27);
    expect(blocksHash(b)).toBe(toBase64(sha256(sha256(b))));
  });
  it('a 1 MiB file has 8 blocks', () => {
    const b = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
    const parts = new Uint8Array(32 * 8);
    for (let i = 0; i < 8; i++) parts.set(sha256(b.subarray(i * 131072, (i + 1) * 131072)), i * 32);
    expect(blocksHash(b)).toBe(toBase64(sha256(parts)));
  });
});

describe('writers and machine paths (folder spec §6.1)', () => {
  it('reads writers from paths and manifests', () => {
    expect(writerOf(`.tramado/chat/${A}/2026-11.jsonl`, null)).toBe(A);
    expect(writerOf('.tramado/class.json', { createdBy: { deviceId: B } })).toBe(B);
    expect(writerOf('Aulas/x/lecture.json', { recordedBy: { deviceId: A } })).toBe(A);
    expect(writerOf('Aulas/x/transcript.json', { writer: { deviceId: B } })).toBe(B);
    expect(isMachinePath('Documentos/a.pdf')).toBe(false);
    expect(isMachinePath(`.tramado/members/${A}.json`)).toBe(true);
  });
});

describe('judge (sync spec §12.1)', () => {
  const path = `.tramado/chat/${A}/2026-11.jsonl`;
  const v1 = enc.encode('{"a":1}\n');
  const v2 = enc.encode('{"a":1}\n{"a":2}\n');
  const info = (bytes: Uint8Array, by: string | null) => ({ localModifiedBy: by, localBlocksHash: blocksHash(bytes), localDeleted: false });

  it('trusts the writer version bound to the bytes, and is pending when the database lags', () => {
    expect(judge({ path, bytes: v2, info: info(v2, 'AAAAAAA'), writer: A, cache: undefined, extras: {} })).toMatchObject({ kind: 'trusted', how: 'writer' });
    // the event/db describes version 1 while the bytes are version 2
    expect(judge({ path, bytes: v2, info: info(v1, 'AAAAAAA'), writer: A, cache: undefined, extras: {} })).toEqual({ kind: 'pending' });
  });

  it('a foreign write keeping the trusted prefix trusts only the prefix', () => {
    const forged = enc.encode('{"a":1}\n{"evil":1}\n');
    expect(judge({ path, bytes: forged, info: info(forged, 'BBBBBBB'), writer: A, cache: cacheEntry(v1), extras: {} })).toEqual({ kind: 'prefix', length: v1.length });
    const rewritten = enc.encode('{"a":9}\n');
    expect(judge({ path, bytes: rewritten, info: info(rewritten, 'BBBBBBB'), writer: A, cache: cacheEntry(v1), extras: {} })).toEqual({ kind: 'untrusted', reason: 'foreign-write' });
  });

  it('same content stays trusted whoever wrote it; signature/rollback failures are untrusted', () => {
    expect(judge({ path, bytes: v1, info: info(v1, 'BBBBBBB'), writer: A, cache: cacheEntry(v1), extras: {} }).kind).toBe('trusted');
    const m = `.tramado/members/${A}.json`;
    expect(judge({ path: m, bytes: v1, info: info(v1, 'AAAAAAA'), writer: A, cache: undefined, extras: { sigOk: false } })).toEqual({ kind: 'untrusted', reason: 'signature' });
    expect(judge({ path: m, bytes: v1, info: info(v1, 'AAAAAAA'), writer: A, cache: undefined, extras: { sigOk: true, noRollback: false } })).toEqual({ kind: 'untrusted', reason: 'rollback' });
    expect(judge({ path: m, bytes: v1, info: null, writer: A, cache: undefined, extras: { sigOk: true } }).kind).toBe('trusted');
  });

  it('deletions count only from the writer; class, meta, bans, mod and consent deletions never', () => {
    expect(deletionHonoured(`.tramado/members/${A}.json`, A, { localDeleted: true, localModifiedBy: 'AAAAAAA', localBlocksHash: null })).toBe(true);
    expect(deletionHonoured(`.tramado/members/${A}.json`, A, { localDeleted: true, localModifiedBy: 'BBBBBBB', localBlocksHash: null })).toBe(false);
    expect(deletionHonoured(`.tramado/bans/${A}.json`, A, { localDeleted: true, localModifiedBy: 'AAAAAAA', localBlocksHash: null })).toBe(false);
    expect(deletionHonoured('.tramado/class.json', A, null)).toBe(false);
  });
});
