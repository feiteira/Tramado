// The per-class policy TS pushes to Rust (architecture D-1, sync spec §9–§10, §18.1): the folder label (effective
// meta name), the effective `askBeforeAdmit`, the roster (devices with a trusted, signed member file bound to a
// person by a valid proof, minus banned devices), the known devices (trusted member file whose person proof
// verifies) and the banned devices (effective bans expanded, folder spec §8.19).
import type { ClassId, DeviceId, Instant, MemberId } from '../model/ids';
import type { MemberFile } from '../model/files';

/** Structurally the ClassPolicy of platform/types/sync.ts (core cannot import platform types). */
export interface PolicyShape {
  classId: ClassId; label: string; askBeforeAdmit: boolean;
  roster: Array<{ deviceId: DeviceId; memberId: MemberId; name: string; deviceName: string; addresses: string[] }>;
  knownDevices: DeviceId[]; bannedDevices: DeviceId[]; updatedAt: Instant;
}

export interface PolicyState {
  classId: ClassId;
  label: string;
  askBeforeAdmit: boolean;
  /** Trusted member files with their binding state. */
  members: ReadonlyArray<{ deviceId: DeviceId; file: MemberFile; bound: boolean }>;
  bannedDevices: ReadonlySet<DeviceId>;
  me: DeviceId;
  now: Instant;
}

export function computePolicy(s: PolicyState): PolicyShape {
  const sorted = [...s.members].sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
  const known = sorted.filter((m) => m.bound).map((m) => m.deviceId);
  const roster = sorted
    .filter((m) => m.bound && (m.deviceId === s.me || !s.bannedDevices.has(m.deviceId)))
    .map((m) => ({
      deviceId: m.deviceId, memberId: m.file.memberId, name: m.file.name.slice(0, 64), deviceName: (m.file.deviceName ?? '').slice(0, 64),
      addresses: Array.isArray(m.file.addresses) ? m.file.addresses.filter((a) => typeof a === 'string').slice(0, 8) : [],
    }));
  return {
    classId: s.classId, label: s.label, askBeforeAdmit: s.askBeforeAdmit, roster, knownDevices: known,
    bannedDevices: [...s.bannedDevices].filter((d) => d !== s.me).sort(), updatedAt: s.now,
  };
}

/** Whether two policies differ in anything but `updatedAt` (avoids pushing the same policy again). */
export function samePolicy(a: PolicyShape | null, b: PolicyShape): boolean {
  if (!a) return false;
  const strip = (p: PolicyShape) => JSON.stringify({ ...p, updatedAt: '' });
  return strip(a) === strip(b);
}
