import { describe, expect, it } from 'vitest';
import { base32Lower, base32Upper, fromBase32, newQuestionId, newSegmentId, newUlid, ulidFrom, ulidTime, uuid } from './ids';
import { RE_QUESTION_ID, RE_SEGMENT_ID, RE_ULID } from './model/ids';
import { mulberry32 } from './util/prng';

describe('ids', () => {
  it('base32 matches RFC 4648 test vectors (no padding)', () => {
    const enc = (s: string) => base32Upper(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('MY');
    expect(enc('fo')).toBe('MZXQ');
    expect(enc('foo')).toBe('MZXW6');
    expect(enc('foob')).toBe('MZXW6YQ');
    expect(enc('fooba')).toBe('MZXW6YTB');
    expect(enc('foobar')).toBe('MZXW6YTBOI');
    expect(base32Lower(new TextEncoder().encode('foobar'))).toBe('mzxw6ytboi');
    expect(new TextDecoder().decode(fromBase32('MZXW6YTBOI'))).toBe('foobar');
  });

  it('ULIDs encode time and entropy', () => {
    const id = ulidFrom(1793721438157, new Uint8Array(10));
    expect(id).toMatch(RE_ULID);
    expect(id.slice(10)).toBe('0000000000000000');
    expect(ulidTime(id)).toBe(1793721438157);
    expect(ulidFrom(0, new Uint8Array(10).fill(255)).slice(10)).toBe('ZZZZZZZZZZZZZZZZ');
    const r = mulberry32(1);
    expect(newUlid(1, r)).toMatch(RE_ULID);
  });

  it('segment, question and request ids', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      expect(newSegmentId(r)).toMatch(RE_SEGMENT_ID);
      expect(newQuestionId(r)).toMatch(RE_QUESTION_ID);
    }
    expect(uuid(r)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
