// Signing helper (folder spec §6.6, sync spec §12.4): builds the RFC 8785 canonical bytes of a record without `sig`
// and asks the signer (platform.sync.sign: Rust holds the device key; it prepends "tramado-sig-v1" 0 classId 0 path 0)
// for the signature. Core cannot import the platform, so the signer is passed in.
import { canonicalBytes } from '../model/sig';
import type { ClassId, ClassPath } from '../model/ids';
import type { Sig } from '../model/files';

export type Signer = (classId: ClassId, path: ClassPath, canonical: Uint8Array) => Promise<Sig>;

/** The record with a fresh `sig` (any previous `sig` is dropped before canonicalisation). */
export async function signRecord<T extends object>(sign: Signer, classId: ClassId, path: ClassPath, record: T): Promise<T & { sig: Sig }> {
  const { sig: _old, ...rest } = record as T & { sig?: Sig };
  const sig = await sign(classId, path, canonicalBytes(rest as Record<string, unknown>));
  return { ...(rest as T), sig };
}
