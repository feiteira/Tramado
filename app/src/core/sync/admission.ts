// Admission decision (sync spec §9.2, architecture §5.3), mirrored by Rust `tramado_sync::admission::decide` and
// tested against test-vectors/admission.json on both sides. The memory mesh admits joiners with it too.
import { RE_CLASS_ID, type ClassId, type DeviceId, type EpochMs } from '../model/ids';

/** The fields of a ClassPolicy (platform/types/sync.ts) that admission reads (core cannot import platform types). */
export interface AdmissionPolicy { askBeforeAdmit: boolean; knownDevices: readonly DeviceId[]; bannedDevices: readonly DeviceId[] }
/** GlobalPolicy of platform/types/sync.ts (Rust state; v1.1 pairing). */
export interface AdmissionGlobal { ownDevices: readonly DeviceId[]; pairingOpenUntil: EpochMs | null }

export interface FolderOffer { folderId: string; deviceId: DeviceId; inFolder: boolean }
export type Decision = 'share' | 'queue' | 'ban' | 'skip' | 'unknown';

/**
 * share: the device proved the folder ID; queue: ask before letting it in; ban: refuse (this class only);
 * skip: already in the folder; unknown: not one of my classes (Rust emits `folderOffer`).
 */
export function decide(
  policies: Readonly<Record<ClassId, AdmissionPolicy>> | ReadonlyMap<ClassId, AdmissionPolicy>,
  global: AdmissionGlobal,
  offer: FolderOffer,
  nowMs: EpochMs,
): Decision {
  if (!RE_CLASS_ID.test(offer.folderId)) return 'unknown';
  const p = policies instanceof Map ? policies.get(offer.folderId) : (policies as Readonly<Record<ClassId, AdmissionPolicy>>)[offer.folderId];
  if (!p) return 'unknown';
  if (offer.inFolder) return 'skip';
  if (p.bannedDevices.includes(offer.deviceId)) return 'ban';
  const pairing = global.ownDevices.includes(offer.deviceId) || (global.pairingOpenUntil !== null && global.pairingOpenUntil > nowMs);
  if (p.askBeforeAdmit && !p.knownDevices.includes(offer.deviceId) && !pairing) return 'queue';
  return 'share';
}
