// Device signatures and person proofs (folder spec §6.6, §8.3.1), verified with WebCrypto Ed25519
// (Node ≥ 22 and current webviews). Signing happens in Rust (sync_sign); TS only verifies, plus
// `signedMessage` so callers can build the exact bytes Rust signs.
import { fromBase64, toBase64 } from '../bytes';
import { base32Upper } from '../ids';
import { sha256 } from '../util/sha256';
import { jcsWithoutSig } from './jcs';
import type { ClassId, ClassPath, DeviceId } from './ids';
import type { MemberFile, Sig } from './files';
import { memberIdOf } from './derive';

const LUHN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Syncthing's Luhn mod-32 check character of a base32 group (lib/protocol/luhn.go). */
function luhn32(s: string): string {
  let factor = 1;
  let sum = 0;
  for (const ch of s) {
    const cp = LUHN.indexOf(ch);
    if (cp < 0) throw new Error(`not base32: ${ch}`);
    let addend = factor * cp;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return LUHN[(32 - (sum % 32)) % 32]!;
}

/** The canonical device ID of a 32-byte SHA-256 (base32, Luhn check characters, dashes). */
export function deviceIdOfHash(hash: Uint8Array): DeviceId {
  const b32 = base32Upper(hash).slice(0, 52);
  let withCheck = '';
  for (let i = 0; i < 4; i++) {
    const group = b32.slice(i * 13, i * 13 + 13);
    withCheck += group + luhn32(group);
  }
  return withCheck.match(/.{7}/g)!.join('-');
}

/** `deviceId(cert)`: the canonical device ID of SHA-256(DER). */
export const deviceIdOfCert = (der: Uint8Array): DeviceId => deviceIdOfHash(sha256(der));

/** Whether the Luhn check characters of a canonical device ID are right. */
export function deviceIdChecks(id: DeviceId): boolean {
  const flat = id.replace(/-/g, '');
  if (!/^[A-Z2-7]{56}$/.test(flat)) return false;
  for (let i = 0; i < 4; i++) {
    const group = flat.slice(i * 14, i * 14 + 13);
    if (luhn32(group) !== flat[i * 14 + 13]) return false;
  }
  return true;
}

const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

/** The 32-byte Ed25519 public key of a certificate DER, or null unless it holds exactly one such SPKI (§6.6 step 2). */
export function spkiKey(der: Uint8Array): Uint8Array | null {
  let found = -1;
  outer: for (let i = 0; i + SPKI_PREFIX.length + 32 <= der.length; i++) {
    for (let j = 0; j < SPKI_PREFIX.length; j++) if (der[i + j] !== SPKI_PREFIX[j]) continue outer;
    if (found >= 0) return null;
    found = i;
  }
  return found < 0 ? null : der.slice(found + SPKI_PREFIX.length, found + SPKI_PREFIX.length + 32);
}

const enc = new TextEncoder();

/** `UTF-8("tramado-sig-v1") || 0x00 || UTF-8(classId) || 0x00 || UTF-8(path) || 0x00 || canonical`. */
export function signedMessageFromCanonical(classId: ClassId, path: ClassPath, canonical: Uint8Array): Uint8Array {
  const parts = [enc.encode('tramado-sig-v1'), enc.encode(classId), enc.encode(path), canonical];
  const len = parts.reduce((n, p) => n + p.length, 0) + 3;
  const out = new Uint8Array(len);
  let o = 0;
  parts.forEach((p, i) => {
    out.set(p, o);
    o += p.length;
    if (i < 3) out[o++] = 0;
  });
  return out;
}

/** The bytes `sync_sign` receives: RFC 8785 JSON of the record without `sig` (architecture §6.7). */
export const canonicalBytes = (record: Record<string, unknown>): Uint8Array => enc.encode(jcsWithoutSig(record));

/** The full signed message of a record (folder spec §6.6). */
export function signedMessage(classId: ClassId, path: ClassPath, record: Record<string, unknown>): Uint8Array {
  return signedMessageFromCanonical(classId, path, canonicalBytes(record));
}

/** base64url without padding (person proofs). */
export function toBase64Url(b: Uint8Array): string {
  return toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(std + '='.repeat((4 - (std.length % 4)) % 4));
}

async function ed25519Verify(pub: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', pub as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

/**
 * Verifies a signed record (§6.6): `deviceId(cert)` equals `writer`, the cert holds exactly one Ed25519
 * key, and the signature verifies over the message for `classId` and `path`. `classIds` lets a JSONL
 * line signed under an earlier ID of a rotation chain verify too (v1.1).
 */
export async function verifySig(
  record: Record<string, unknown>,
  classId: ClassId | ClassId[],
  path: ClassPath,
  writer: DeviceId,
): Promise<boolean> {
  const sig = record.sig as Sig | undefined;
  if (!sig || typeof sig.cert !== 'string' || typeof sig.value !== 'string') return false;
  let der: Uint8Array;
  let value: Uint8Array;
  try {
    der = fromBase64(sig.cert);
    value = fromBase64(sig.value);
  } catch {
    return false;
  }
  if (value.length !== 64 || deviceIdOfCert(der) !== writer) return false;
  const pub = spkiKey(der);
  if (!pub) return false;
  for (const id of Array.isArray(classId) ? classId : [classId]) {
    if (await ed25519Verify(pub, value, signedMessage(id, path, record))) return true;
  }
  return false;
}

/** The person-proof message of §8.3.1. */
export const personProofMessage = (classId: ClassId, deviceId: DeviceId, memberId: string): Uint8Array =>
  enc.encode(`tramado-member-v1|${classId}|${deviceId}|${memberId}`);

/** Verifies a member file's person proof for `classId` (§8.3.1): memberId(pub) == memberId and the sig verifies. */
export async function verifyPersonProof(member: Pick<MemberFile, 'deviceId' | 'memberId' | 'person'>, classId: ClassId): Promise<boolean> {
  const proof = member.person;
  if (!proof || typeof proof.pub !== 'string' || typeof proof.sig !== 'string') return false;
  let pub: Uint8Array;
  let sig: Uint8Array;
  try {
    pub = fromBase64Url(proof.pub);
    sig = fromBase64Url(proof.sig);
  } catch {
    return false;
  }
  if (pub.length !== 32 || sig.length !== 64 || memberIdOf(pub) !== member.memberId) return false;
  return ed25519Verify(pub, sig, personProofMessage(classId, member.deviceId, member.memberId));
}
