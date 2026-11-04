// The moderation log (folder spec §8.18): read-only in 0.1 (pins, hides, audio removal by organisers and rotation are
// v1.1), but readers honour the lines by the table: pin by any member; unpin by the pinner or an organiser (state
// per target = greatest HLC among honoured pin/unpin lines); hide/unhide by an organiser (from a non-organiser: a
// suggestion shown to organisers only); audio-removed by an organiser or the recorder's person; rotate by an organiser.
import { isHlc, isUlid, type DeviceId, type Hlc, type MemberId, type Ulid } from '../model/ids';
import type { ModLine, MsgRef } from '../model/files';
import type { PersonAt } from './meta';

export interface ModSource { deviceId: DeviceId; line: ModLine }

export interface ModState {
  pins: Array<{ target: MsgRef; by: MemberId; hlc: Hlc }>;
  hidden: Array<{ target: MsgRef; by: MemberId; hlc: Hlc }>;
  hideSuggestions: Array<{ target: MsgRef; by: MemberId; hlc: Hlc }>;
  audioRemoved: ReadonlySet<Ulid>;
  rotations: Array<{ by: MemberId; newClassIdSha256: string; newLabel: string; hlc: Hlc }>;
}

export function modLineOk(l: unknown): l is ModLine {
  if (typeof l !== 'object' || l === null) return false;
  const o = l as Record<string, unknown>;
  return ['pin', 'unpin', 'hide', 'unhide', 'audio-removed', 'rotate'].includes(o.type as string) && isUlid(o.id) && isHlc(o.hlc);
}

const refKey = (r: MsgRef) => `${r.deviceId}:${r.id}`;

export function foldMod(
  lines: readonly ModSource[],
  personAt: PersonAt,
  isOrganiserAt: (memberId: MemberId | null, hlc: Hlc) => boolean,
  recorderOf: (lectureId: Ulid) => MemberId | null,
): ModState {
  const sorted = [...lines].sort((a, b) => (a.line.hlc < b.line.hlc ? -1 : a.line.hlc > b.line.hlc ? 1 : a.deviceId < b.deviceId ? -1 : 1));
  const pinState = new Map<string, { target: MsgRef; by: MemberId; hlc: Hlc; on: boolean }>();
  const hideState = new Map<string, { target: MsgRef; by: MemberId; hlc: Hlc; on: boolean }>();
  const suggestions = new Map<string, { target: MsgRef; by: MemberId; hlc: Hlc }>();
  const audioRemoved = new Set<Ulid>();
  const rotations: ModState['rotations'] = [];
  for (const { deviceId, line } of sorted) {
    const who = personAt(deviceId, line.hlc);
    if (!who) continue;
    const org = isOrganiserAt(who, line.hlc);
    const t = line.target;
    switch (line.type) {
      case 'pin':
        if (t) pinState.set(refKey(t), { target: t, by: who, hlc: line.hlc, on: true });
        break;
      case 'unpin': {
        if (!t) break;
        const cur = pinState.get(refKey(t));
        if (cur && (cur.by === who || org)) pinState.set(refKey(t), { ...cur, hlc: line.hlc, on: false });
        break;
      }
      case 'hide':
      case 'unhide':
        if (!t) break;
        if (org) hideState.set(refKey(t), { target: t, by: who, hlc: line.hlc, on: line.type === 'hide' });
        else if (line.type === 'hide') suggestions.set(refKey(t), { target: t, by: who, hlc: line.hlc });
        break;
      case 'audio-removed':
        if (line.lectureId && (org || recorderOf(line.lectureId) === who)) audioRemoved.add(line.lectureId);
        break;
      case 'rotate':
        if (org && typeof line.newClassIdSha256 === 'string') rotations.push({ by: who, newClassIdSha256: line.newClassIdSha256, newLabel: line.newLabel ?? '', hlc: line.hlc });
        break;
    }
  }
  const strip = <T extends { on: boolean }>(m: Map<string, T>) => [...m.values()].filter((v) => v.on).map(({ on: _on, ...rest }) => rest);
  return {
    pins: strip(pinState).sort((a, b) => (a.hlc > b.hlc ? -1 : 1)),
    hidden: strip(hideState),
    hideSuggestions: [...suggestions.values()].filter((s) => !hideState.get(refKey(s.target))?.on),
    audioRemoved,
    rotations,
  };
}
