// Consent records (folder spec §8.5): signed, append-only lines in every device's consent log. A `revoke` line counts
// when written by the person who wrote the revoked line or by an organiser at the revoke line's HLC; revokes address
// lines by `{deviceId, id}` (any device's log). Active consents are the record/share lines not revoked.
import { isDeviceId, isHlc, isUlid, type DeviceId, type Hlc, type MemberId, type Ulid } from '../model/ids';
import type { ConsentLine } from '../model/files';
import type { PersonAt } from './meta';

export interface ConsentSource { deviceId: DeviceId; line: ConsentLine }
export interface ActiveConsent extends ConsentLine { deviceId: DeviceId; by: MemberId | null }

export function consentLineOk(l: unknown): l is ConsentLine {
  if (typeof l !== 'object' || l === null) return false;
  const o = l as Record<string, unknown>;
  if (!isUlid(o.id) || !isHlc(o.hlc) || typeof o.memberId !== 'string' || typeof o.text !== 'string') return false;
  if (o.kind !== 'record' && o.kind !== 'share' && o.kind !== 'revoke') return false;
  if (o.scope !== 'class' && o.scope !== 'lecture') return false;
  if (o.kind === 'revoke') {
    const r = o.revokes as Record<string, unknown> | undefined;
    return !!r && isDeviceId(r.deviceId) && isUlid(r.id);
  }
  return true;
}

/** The active record/share consents after the counting revocations. Lines must already be trusted and signed. */
export function activeConsents(
  lines: readonly ConsentSource[],
  personAt: PersonAt,
  isOrganiserAt: (memberId: MemberId | null, hlc: Hlc) => boolean,
): ActiveConsent[] {
  const byRef = new Map<string, ConsentSource>();
  for (const l of lines) if (l.line.kind !== 'revoke') byRef.set(`${l.deviceId}:${l.line.id}`, l);
  const revoked = new Set<string>();
  for (const l of lines) {
    if (l.line.kind !== 'revoke' || !l.line.revokes) continue;
    const key = `${l.line.revokes.deviceId}:${l.line.revokes.id}`;
    const target = byRef.get(key);
    if (!target) continue;
    const revoker = personAt(l.deviceId, l.line.hlc);
    const owner = personAt(target.deviceId, target.line.hlc);
    if ((revoker !== null && revoker === owner) || isOrganiserAt(revoker, l.line.hlc)) revoked.add(key);
  }
  return [...byRef.entries()]
    .filter(([k]) => !revoked.has(k))
    .map(([, l]) => ({ ...l.line, deviceId: l.deviceId, by: personAt(l.deviceId, l.line.hlc) }))
    .sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
}

/** Whether a class-scope (or this lecture's) record consent is active for `lectureId` (draft id). */
export function hasConsent(active: readonly ActiveConsent[], kind: 'record' | 'share', lectureId: Ulid | null): boolean {
  return active.some((c) => c.kind === kind && (c.scope === 'class' || (lectureId !== null && c.lectureId === lectureId)));
}
