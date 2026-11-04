// Binding devices to people (folder spec §8.3.1): a device is bound to person M when its trusted, signed member
// file names M, `memberId(person.pub) == M` and the person proof verifies; a valid revocation by another bound
// device of M unbinds it. A device that left keeps the binding of its last trusted member file for records
// stamped before it left. `people()` groups bound devices by person (name and colour from the bound file with the
// greatest `hlc`); devices whose file claims a person without a valid proof are "unverified".
import { fromBase64Url, verifyPersonProof, verifySig } from '../model/sig';
import { isDeviceId, isHlc, isMemberId, type ClassId, type ClassPath, type DeviceId, type Hlc, type MemberId } from '../model/ids';
import type { MemberFile } from '../model/files';

const enc = new TextEncoder();

/** The revocation message of §8.3.1 (v1.1 writers; readers honour valid ones). */
export const revokeMessage = (classId: ClassId, deviceId: DeviceId, memberId: MemberId): Uint8Array =>
  enc.encode(`tramado-revoke-v1|${classId}|${deviceId}|${memberId}`);

export interface MemberCheck {
  /** The device signature verifies for the device in the path (§6.6). */
  sigOk: boolean;
  /** memberId(person.pub) == memberId and the proof verifies (§8.3.1). */
  proofOk: boolean;
  /** Devices this file's person validly revokes (only meaningful when proofOk). */
  revokes: DeviceId[];
}

/** Basic shape checks of a member file (frozen fields and the ones roster decisions use). */
export function memberShapeOk(f: unknown, deviceId: DeviceId): f is MemberFile {
  if (typeof f !== 'object' || f === null) return false;
  const m = f as Record<string, unknown>;
  return m.deviceId === deviceId && isMemberId(m.memberId) && typeof m.name === 'string' && isHlc(m.hlc)
    && typeof m.person === 'object' && m.person !== null;
}

/** Verifies the signature, the person proof and any revocations of a member file (async: WebCrypto). */
export async function checkMemberFile(file: MemberFile, classId: ClassId | ClassId[], path: ClassPath): Promise<MemberCheck> {
  const ids = Array.isArray(classId) ? classId : [classId];
  const sigOk = await verifySig(file as unknown as Record<string, unknown>, ids, path, file.deviceId);
  let proofOk = false;
  for (const id of ids) if (!proofOk) proofOk = await verifyPersonProof(file, id);
  const revokes: DeviceId[] = [];
  if (proofOk && Array.isArray(file.person.revoked)) {
    for (const r of file.person.revoked) {
      if (!r || !isDeviceId(r.deviceId) || typeof r.sig !== 'string' || r.deviceId === file.deviceId) continue;
      try {
        const key = await crypto.subtle.importKey('raw', fromBase64Url(file.person.pub) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
        const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64Url(r.sig) as BufferSource, revokeMessage(ids[0]!, r.deviceId, file.memberId) as BufferSource);
        if (ok) revokes.push(r.deviceId);
      } catch {
        // an unparseable revocation is ignored
      }
    }
  }
  return { sigOk, proofOk, revokes };
}

/** One trusted member file with its checks. */
export interface MemberInput { deviceId: DeviceId; file: MemberFile; check: MemberCheck }
/** A device that left (sync spec §10 `left()`): its last binding, valid for records stamped before `leftHlc`. */
export interface FormerBinding { memberId: MemberId; leftHlc: Hlc; file: MemberFile | null }

export interface PersonEntry {
  memberId: MemberId;
  name: string;
  colour: string | null;
  devices: DeviceId[];          // currently bound devices
  /** The bound file with the greatest hlc (display name, colour). */
  file: MemberFile;
}

export interface Bindings {
  /** Currently bound devices → person. */
  bound: ReadonlyMap<DeviceId, MemberId>;
  /** Every device's claimed memberId (bound or not): bans of a memberId cover all of them (§8.19). */
  claims: ReadonlyMap<DeviceId, MemberId>;
  /** Devices whose file claims a person without a valid proof (or signature). */
  unverified: ReadonlySet<DeviceId>;
  /** The person a device's records count for at `hlc` (current binding, else the former one before it left). */
  personAt(deviceId: DeviceId, hlc?: Hlc): MemberId | null;
  people: PersonEntry[];
  /** Member files by device (trusted ones). */
  files: ReadonlyMap<DeviceId, MemberFile>;
}

export function computeBindings(members: readonly MemberInput[], former: ReadonlyMap<DeviceId, FormerBinding> = new Map()): Bindings {
  const claims = new Map<DeviceId, MemberId>();
  const files = new Map<DeviceId, MemberFile>();
  const candidates = new Map<DeviceId, MemberId>();
  const unverified = new Set<DeviceId>();
  for (const m of members) {
    files.set(m.deviceId, m.file);
    claims.set(m.deviceId, m.file.memberId);
    if (m.check.sigOk && m.check.proofOk && m.file.deviceId === m.deviceId) candidates.set(m.deviceId, m.file.memberId);
    else unverified.add(m.deviceId);
  }
  // Revocations: a bound device of M revoking another device of M unbinds it.
  const revoked = new Set<DeviceId>();
  for (const m of members) {
    const who = candidates.get(m.deviceId);
    if (!who) continue;
    for (const d of m.check.revokes) if (candidates.get(d) === who) revoked.add(d);
  }
  const bound = new Map<DeviceId, MemberId>();
  for (const [d, who] of candidates) {
    if (revoked.has(d)) unverified.add(d);
    else bound.set(d, who);
  }
  const byPerson = new Map<MemberId, PersonEntry>();
  for (const [d, who] of [...bound].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const f = files.get(d)!;
    const cur = byPerson.get(who);
    if (!cur) byPerson.set(who, { memberId: who, name: f.name, colour: f.colour ?? null, devices: [d], file: f });
    else {
      cur.devices.push(d);
      if (f.hlc > cur.file.hlc) Object.assign(cur, { name: f.name, colour: f.colour ?? null, file: f });
    }
  }
  return {
    bound, claims, unverified, files,
    people: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.memberId < b.memberId ? -1 : 1)),
    personAt(deviceId, hlc) {
      const now = bound.get(deviceId);
      if (now) return now;
      const f = former.get(deviceId);
      if (f && (hlc === undefined || hlc < f.leftHlc)) return f.memberId;
      return null;
    },
  };
}
