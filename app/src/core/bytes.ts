// Byte helpers written out by hand so the core runs the same in a webview, Node and React Native.

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += HEX[b >> 4]! + HEX[b & 15]!;
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : B64[c & 63]!;
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => {
      const ch = clean[i + k];
      if (ch === undefined) return 0;
      const v = B64_INDEX.get(ch);
      if (v === undefined) throw new Error('invalid base64');
      return v;
    });
    const triple = (n[0]! << 18) | (n[1]! << 12) | (n[2]! << 6) | n[3]!;
    if (o < out.length) out[o++] = (triple >> 16) & 255;
    if (o < out.length) out[o++] = (triple >> 8) & 255;
    if (o < out.length) out[o++] = triple & 255;
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = (s: string): Uint8Array => encoder.encode(s);
export const fromUtf8 = (b: Uint8Array): string => decoder.decode(b);

// Windows-1252 bytes 0x80–0x9F. The rest of the code page is Latin-1 (byte = code point).
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** Windows-1252, the code page of most CSV and text files saved by Excel or Notepad in Portugal and Spain. */
export function fromWindows1252(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 8192) {
    const codes = Array.from(b.subarray(i, i + 8192), (x) => (x >= 0x80 && x < 0xa0 ? CP1252_HIGH[x - 0x80]! : x));
    out += String.fromCharCode(...codes);
  }
  return out;
}

function fromUtf16(b: Uint8Array, littleEndian: boolean): string {
  let out = '';
  for (let i = 0; i + 1 < b.length; i += 16384) {
    const codes: number[] = [];
    for (let j = i; j + 1 < Math.min(b.length, i + 16384); j += 2) codes.push(littleEndian ? b[j]! | (b[j + 1]! << 8) : (b[j]! << 8) | b[j + 1]!);
    out += String.fromCharCode(...codes);
  }
  return out;
}

/**
 * Text from a file of unknown encoding: UTF-16 when it starts with that byte-order mark,
 * UTF-8 when the bytes are valid UTF-8 (with or without a BOM), and Windows-1252 otherwise.
 * Never throws; a leading byte-order mark is left out.
 */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return fromUtf16(b.subarray(2), true);
  if (b[0] === 0xfe && b[1] === 0xff) return fromUtf16(b.subarray(2), false);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return fromWindows1252(b);
  }
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

export function readU32be(b: Uint8Array, offset: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset, false);
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // getRandomValues refuses more than 65536 bytes per call.
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

/** Overwrites key material we no longer need. Best effort: JS cannot guarantee no copies exist. */
export function wipe(b: Uint8Array | null | undefined): void {
  b?.fill(0);
}
