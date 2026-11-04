import { describe, expect, it } from 'vitest';
import { formatHlc } from '../hlc';
import type { BansFile } from '../model/files';
import { effectiveBans, withEntry, type BansInput } from './bans';
import { replayOrganisers, type MetaInput } from './meta';

const D = (c: string) => `${c.repeat(7)}-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA`;
const A = D('A'), B = D('B'), X = D('X'), Y = D('Y');
const MAL = 'mmmmmmmmmmmmmmmmmmmmmmmmmm';
const h = (ms: number, n = 'aaaaaaa') => formatHlc({ ms, counter: 0, device: n });
const persons: Record<string, string> = { [A]: 'ana', [B]: 'bruno' };
const personAt = (d: string) => persons[d] ?? null;
const bans = (deviceId: string, entries: BansFile['entries']): BansInput => ({
  deviceId, file: { format: 'tramado.bans', version: 1, deviceId, memberId: persons[deviceId]!, hlc: h(1), updatedAt: '', entries, sig: { cert: '', value: '' } },
});
const meta = (deviceId: string, ops: MetaInput['file']['organiserOps']): MetaInput => ({
  deviceId, file: { format: 'tramado.meta', version: 1, deviceId, memberId: persons[deviceId]!, fields: {}, organiserOps: ops, hlc: h(1), sig: { cert: '', value: '' } },
});

describe('effective bans (folder spec §8.19)', () => {
  it('counts organisers at the entry HLC and expands memberIds to every claiming device', () => {
    const org = replayOrganisers('ana', [meta(A, [{ op: 'add', memberId: 'bruno', hlc: h(50) }])], personAt, new Set());
    const claims = new Map([[X, MAL], [Y, MAL]]);
    const e = effectiveBans([
      bans(A, [{ target: { memberId: MAL }, state: 'banned', hlc: h(10) }]),
      bans(B, [{ target: { deviceId: D('Q') }, state: 'banned', hlc: h(20, 'bbbbbbb') }]),   // bruno not yet an organiser
    ], personAt, org.isOrganiserAt, claims);
    expect([...e.bannedDevices].sort()).toEqual([X, Y]);
    expect(e.devices.size).toBe(0);
  });

  it('the greatest counting entry per target decides; unban lifts', () => {
    const org = replayOrganisers('ana', [], personAt, new Set());
    const e = effectiveBans([bans(A, [
      { target: { deviceId: X }, state: 'banned', hlc: h(10) },
      { target: { deviceId: X }, state: 'unbanned', hlc: h(20) },
    ])], personAt, org.isOrganiserAt, new Map());
    expect(e.bannedDevices.has(X)).toBe(false);
    expect(e.current({ deviceId: X })).toBe(h(20));
  });

  it('withEntry replaces the entry of a target', () => {
    const next = withEntry([{ target: { memberId: MAL }, state: 'banned', hlc: h(1) }], { memberId: MAL }, 'unbanned', h(2));
    expect(next).toEqual([{ target: { memberId: MAL }, state: 'unbanned', hlc: h(2) }]);
  });
});
