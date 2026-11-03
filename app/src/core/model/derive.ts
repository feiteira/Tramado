// Derived identifiers (folder spec §2.1): class, lecture and exam IDs are bound to the device that
// created them, and member IDs to the person key. Readers recompute them before trusting a manifest
// (§6.2 rule 3). Pure and synchronous; vectors in test-vectors/ids.json (shared with Rust).
import { base32Lower, randomBytesFrom, ulidFrom } from '../ids';
import { sha256 } from '../util/sha256';
import type { ClassId, DeviceId, MemberId, Nonce, Ulid } from './ids';

/** `"tramado-" + b32(SHA-256("tramado-class-v1|" + creatorDeviceId + "|" + idNonce))[0..26]`. */
export function classIdOf(creatorDeviceId: DeviceId, idNonce: Nonce): ClassId {
  return 'tramado-' + base32Lower(sha256(`tramado-class-v1|${creatorDeviceId}|${idNonce}`)).slice(0, 26);
}

/** The ULID whose time is `ms` and whose 80 bits are SHA-256("tramado-item-v1|" + writer + "|" + nonce)[0..10]. */
export function itemIdOf(ms: number, writerDeviceId: DeviceId, idNonce: Nonce): Ulid {
  return ulidFrom(ms, sha256(`tramado-item-v1|${writerDeviceId}|${idNonce}`).slice(0, 10));
}

/** Whether `id` is an item ID of `writer` and `nonce`: compares the 80-bit part only (folder spec §2.1). */
export function itemIdMatches(id: Ulid, writerDeviceId: DeviceId, idNonce: Nonce): boolean {
  return id.length === 26 && id.slice(10) === itemIdOf(0, writerDeviceId, idNonce).slice(10);
}

/** `b32(SHA-256(personPub))[0..26]`, personPub = the 32 raw public-key bytes. */
export function memberIdOf(personPub: Uint8Array): MemberId {
  return base32Lower(sha256(personPub)).slice(0, 26);
}

/** 16 random bytes, base32 lower case, first 26 characters (folder spec §2 `Nonce`). */
export function newNonce(rand: () => number): Nonce {
  return base32Lower(randomBytesFrom(rand, 16)).slice(0, 26);
}
