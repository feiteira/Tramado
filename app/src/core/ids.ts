// Random identifiers of Tramado records (architecture §11.1). Class, lecture, exam and member IDs
// are *derived* (core/model/derive.ts); everything else uses the random ones below. Randomness is
// injected (`rand() → [0, 1)`) so tests and the demo are reproducible.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const B32_LOWER = 'abcdefghijklmnopqrstuvwxyz234567';
const B32_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function base32(bytes: Uint8Array, alphabet: string): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4648 base32, lower case, no padding (`b32` of folder spec §2.1). */
export const base32Lower = (bytes: Uint8Array): string => base32(bytes, B32_LOWER);
/** RFC 4648 base32, upper case, no padding (Syncthing device IDs). */
export const base32Upper = (bytes: Uint8Array): string => base32(bytes, B32_UPPER);

/** Decodes RFC 4648 base32 (either case, no padding); throws on a bad character. */
export function fromBase32(s: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s.toUpperCase()) {
    const v = B32_UPPER.indexOf(ch);
    if (v < 0) throw new Error(`invalid base32: ${ch}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

/** `n` random bytes from an injected `rand()`. */
export function randomBytesFrom(rand: () => number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rand() * 256) & 0xff;
  return out;
}

/** Encodes a 48-bit time and 10 bytes as a ULID (Crockford base32, upper case, 26 chars). */
export function ulidFrom(ms: number, entropy: Uint8Array): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 0xffffffffffff) throw new Error('ULID time out of range');
  if (entropy.length !== 10) throw new Error('ULID entropy must be 10 bytes');
  let time = '';
  let t = ms;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 80 bits → 16 characters: 5 bits each, most significant first.
  let rest = '';
  let bits = 0;
  let value = 0;
  for (const b of entropy) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      rest += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return time + rest;
}

/** The 48-bit time of a ULID. */
export function ulidTime(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(ch);
  return t;
}

/** A random ULID (chat lines, edits, consent, answers, annotations). */
export function newUlid(nowMs: number, rand: () => number): string {
  return ulidFrom(nowMs, randomBytesFrom(rand, 10));
}

/** `n` random base62 characters. */
export function base62(n: number, rand: () => number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += B62[Math.floor(rand() * 62) % 62];
  return s;
}

/** A random segment id `s_` + 6 base62 (folder spec §2: 5–8). */
export const newSegmentId = (rand: () => number): string => `s_${base62(6, rand)}`;
/** A random question id `q_` + 7 base62 (folder spec §2: 6–8). */
export const newQuestionId = (rand: () => number): string => `q_${base62(7, rand)}`;

/** RFC 4122 v4 UUID from an injected rand (request ids, job ids). */
export function uuid(rand: () => number): string {
  const b = randomBytesFrom(rand, 16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
