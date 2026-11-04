// Soft bans (folder spec §8.19, sync spec §18.1): an entry counts when the device whose file holds it was bound to a
// person who was an organiser at the entry's HLC; per target the counting entry with the greatest HLC decides; a
// banned memberId bans every device whose member file *claims* that memberId, bound or not.
import { isDeviceId, isHlc, isMemberId, type DeviceId, type Hlc, type MemberId } from '../model/ids';
import type { BansFile } from '../model/files';
import type { PersonAt } from './meta';

export interface BansInput { deviceId: DeviceId; file: BansFile }
export type BanTarget = { deviceId: DeviceId } | { memberId: MemberId };
export interface BanDecision { target: BanTarget; state: 'banned' | 'unbanned'; hlc: Hlc; by: DeviceId; reason?: string }

export const targetKey = (t: BanTarget): string => ('deviceId' in t ? `d:${t.deviceId}` : `m:${t.memberId}`);

function validTarget(t: unknown): t is BanTarget {
  if (typeof t !== 'object' || t === null) return false;
  const o = t as Record<string, unknown>;
  return ('deviceId' in o && isDeviceId(o.deviceId)) || ('memberId' in o && isMemberId(o.memberId));
}

export interface EffectiveBans {
  /** Per target, the counting entry with the greatest HLC. */
  decisions: ReadonlyMap<string, BanDecision>;
  members: ReadonlySet<MemberId>;
  devices: ReadonlySet<DeviceId>;
  /** devices ∪ every device whose member file claims a banned memberId (ClassPolicy.bannedDevices). */
  bannedDevices: ReadonlySet<DeviceId>;
  /** The greatest stamp of a counting entry per target (the `w` of the override rule). */
  current(target: BanTarget): Hlc | null;
}

export function effectiveBans(
  bans: readonly BansInput[],
  personAt: PersonAt,
  isOrganiserAt: (memberId: MemberId | null, hlc: Hlc) => boolean,
  claims: ReadonlyMap<DeviceId, MemberId>,
): EffectiveBans {
  const decisions = new Map<string, BanDecision>();
  for (const b of bans) {
    const entries = Array.isArray(b.file.entries) ? b.file.entries : [];
    for (const e of entries) {
      if (!e || !validTarget(e.target) || (e.state !== 'banned' && e.state !== 'unbanned') || !isHlc(e.hlc)) continue;
      if (!isOrganiserAt(personAt(b.deviceId, e.hlc), e.hlc)) continue;
      const key = targetKey(e.target);
      const cur = decisions.get(key);
      if (!cur || e.hlc > cur.hlc || (e.hlc === cur.hlc && b.deviceId > cur.by)) {
        decisions.set(key, { target: e.target, state: e.state, hlc: e.hlc, by: b.deviceId, ...(e.reason ? { reason: e.reason } : {}) });
      }
    }
  }
  const members = new Set<MemberId>();
  const devices = new Set<DeviceId>();
  for (const d of decisions.values()) {
    if (d.state !== 'banned') continue;
    if ('memberId' in d.target) members.add(d.target.memberId);
    else devices.add(d.target.deviceId);
  }
  const bannedDevices = new Set(devices);
  for (const [dev, m] of claims) if (members.has(m)) bannedDevices.add(dev);
  return { decisions, members, devices, bannedDevices, current: (t) => decisions.get(targetKey(t))?.hlc ?? null };
}

/**
 * The next own bans file: the entry for `target` replaced by a new one stamped `hlc` (the caller stamps it with the
 * override rule over every counting entry of that target, folder spec §3.4).
 */
export function withEntry(prev: BansFile['entries'], target: BanTarget, state: 'banned' | 'unbanned', hlc: Hlc, reason?: string): BansFile['entries'] {
  const key = targetKey(target);
  const rest = prev.filter((e) => !(validTarget(e.target) && targetKey(e.target) === key));
  return [...rest, { target, state, hlc, ...(reason ? { reason: reason.slice(0, 200) } : {}) }];
}
