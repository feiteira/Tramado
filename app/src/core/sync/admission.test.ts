import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decide } from './admission';

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
