// WebCrypto Ed25519 over the test-only key pool (keys.ts): the memory platform's device "certificate"
// (fake DER holding exactly one Ed25519 SPKI, so core/model/sig.ts verifies it like Syncthing's) and
// its person key.
import { fromHex } from '../../core/bytes';
import { deviceIdOfCert } from '../../core/model/sig';
import type { DeviceId } from '../../core/model/ids';
import { KEY_POOL } from './keys';

const PKCS8_PREFIX = fromHex('302e020100300506032b657004220420');
const SPKI_PREFIX = fromHex('302a300506032b6570032100');

export interface PoolKey { index: number; pub: Uint8Array; sign(message: Uint8Array): Promise<Uint8Array> }

export function poolKey(index: number): PoolKey {
  const entry = KEY_POOL[index];
  if (!entry) throw new Error(`memory platform: no test key ${index} (the pool has ${KEY_POOL.length})`);
  const seed = fromHex(entry[0]);
  const pub = fromHex(entry[1]);
  let key: Promise<CryptoKey> | null = null;
  return {
    index,
    pub,
    async sign(message) {
      key ??= crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8_PREFIX, ...seed]) as BufferSource, { name: 'Ed25519' }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, await key, message as BufferSource));
    },
  };
}

/** A device identity: fake certificate (header + SPKI + index), its canonical device ID and its signer. */
export function deviceIdentity(index: number): { deviceId: DeviceId; cert: Uint8Array; key: PoolKey } {
  const key = poolKey(index);
  const header = new TextEncoder().encode(`TRAMADO-MEMORY-CERT-${index}\u0000`);
  const cert = new Uint8Array([...header, ...SPKI_PREFIX, ...key.pub]);
  return { deviceId: deviceIdOfCert(cert), cert, key };
}

export const DEVICE_KEYS = 32;
export const personKeyIndex = (deviceIndex: number) => 32 + (deviceIndex % 32);
