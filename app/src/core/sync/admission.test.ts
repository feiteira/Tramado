import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decide } from './admission';
import { computePolicy, samePolicy } from './policy';
import type { MemberFile } from '../model/files';

interface Case { name: string; offer?: Record<string, unknown>; policy?: Record<string, unknown>; global?: Record<string, unknown>; now?: number; expect: string }
const V = JSON.parse(readFileSync(new URL('../../../../test-vectors/admission.json', import.meta.url), 'utf8')) as { devices: Record<string, string>; cases: Case[] };
const CLS = 'tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa';
const dev = (s: unknown) => (typeof s === 'string' && V.devices[s] ? V.devices[s] : s) as string;

describe('decide() (test-vectors/admission.json)', () => {
  it.each(V.cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const policy = {
      askBeforeAdmit: false, knownDevices: [] as string[], bannedDevices: [] as string[],
      ...(c.policy ?? {}),
    } as { askBeforeAdmit: boolean; knownDevices: string[]; bannedDevices: string[] };
    policy.knownDevices = policy.knownDevices.map(dev);
    policy.bannedDevices = policy.bannedDevices.map(dev);
    const global = { ownDevices: [] as string[], pairingOpenUntil: null as number | null, ...(c.global ?? {}) };
    global.ownDevices = global.ownDevices.map(dev);
    const offer = { folderId: CLS, deviceId: 'D1', inFolder: false, ...(c.offer ?? {}) } as { folderId: string; deviceId: string; inFolder: boolean };
    offer.deviceId = dev(offer.deviceId);
    expect(decide({ [CLS]: policy }, global, offer, c.now ?? 0)).toBe(c.expect);
    expect(decide(new Map([[CLS, policy]]), global, offer, c.now ?? 0)).toBe(c.expect);
  });
});

describe('computePolicy (architecture D-1)', () => {
  const file = (deviceId: string, memberId: string): MemberFile => ({
    format: 'tramado.member', version: 1, deviceId, memberId, name: 'N'.repeat(70), deviceName: 'laptop', joinedAt: '', hlc: '', addresses: ['tcp://10.0.0.1:22000'],
    caps: { cpuOk: true, localModel: null, cloud: false, volunteer: 'off' }, person: { pub: '', sig: '' }, vouches: [], formats: {}, app: { name: 'Tramado', version: '0.1.0', platform: 'linux' }, sig: { cert: '', value: '' },
  });
  it('roster = bound and not banned; known = bound; banned without me', () => {
    const [d1, d2] = [V.devices.D1!, V.devices.D2!];
    const p = computePolicy({
      classId: CLS, label: 'DC I', askBeforeAdmit: true, me: d1, now: '2026-11-03T10:00:00.000Z',
      members: [{ deviceId: d2, file: file(d2, 'b'.repeat(26)), bound: true }, { deviceId: d1, file: file(d1, 'a'.repeat(26)), bound: true }, { deviceId: 'X', file: file('X', 'c'.repeat(26)), bound: false }],
      bannedDevices: new Set([d2, d1]),
    });
    expect(p.roster.map((r) => r.deviceId)).toEqual([d1]);
    expect(p.roster[0]!.name).toHaveLength(64);
    expect(p.knownDevices).toEqual([d1, d2]);
    expect(p.bannedDevices).toEqual([d2]);
    expect(samePolicy(p, { ...p, updatedAt: 'later' })).toBe(true);
    expect(samePolicy(p, { ...p, askBeforeAdmit: false })).toBe(false);
  });
});
