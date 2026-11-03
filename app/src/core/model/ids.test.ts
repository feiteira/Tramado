import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fromBase64, fromHex } from '../bytes';
import { classIdOf, itemIdMatches, itemIdOf, memberIdOf, newNonce } from './derive';
import { dashed, dashless, hlcNodeOf, isClassId, isDeviceId, isMemberId, isUlid, langMatches, shortIdOf } from './ids';
import { deviceIdChecks, deviceIdOfCert, deviceIdOfHash, spkiKey, verifyPersonProof, verifySig } from './sig';
import { mulberry32 } from '../util/prng';

const V = JSON.parse(readFileSync(new URL('../../../../test-vectors/ids.json', import.meta.url), 'utf8'));

describe('identifiers (test-vectors/ids.json)', () => {
  it('derives class IDs', () => {
    for (const c of V.classId) {
      expect(classIdOf(c.deviceId, c.idNonce)).toBe(c.classId);
      expect(isClassId(c.classId)).toBe(true);
    }
  });

  it('derives item IDs and matches their 80-bit part', () => {
    for (const c of V.itemId) {
      expect(itemIdOf(c.ms, c.deviceId, c.idNonce)).toBe(c.itemId);
      expect(isUlid(c.itemId)).toBe(true);
      expect(itemIdMatches(c.itemId, c.deviceId, c.idNonce)).toBe(true);
      expect(itemIdMatches(itemIdOf(c.ms > 0 ? c.ms - 1 : 1, c.deviceId, c.idNonce), c.deviceId, c.idNonce)).toBe(true);
      expect(itemIdMatches(c.itemId, c.deviceId, 'aaaaaaaaaaaaaaaaaaaaaaaaab')).toBe(false);
    }
  });

  it('derives member IDs from person public keys', () => {
    for (const c of V.memberId) {
      expect(memberIdOf(fromHex(c.pubHex))).toBe(c.memberId);
      expect(isMemberId(c.memberId)).toBe(true);
    }
  });

  it('computes Syncthing device IDs of real certificates', () => {
    for (const c of V.deviceIdOfCert) {
      const der = fromBase64(c.certDerB64);
      expect(deviceIdOfCert(der)).toBe(c.deviceId);
      expect(isDeviceId(c.deviceId)).toBe(true);
      expect(deviceIdChecks(c.deviceId)).toBe(true);
      expect(spkiKey(der)?.length).toBe(32);
    }
    for (const c of V.deviceIdOfHash) expect(deviceIdOfHash(fromHex(c.hashHex))).toBe(c.deviceId);
    for (const bad of V.invalidDeviceIds) expect(isDeviceId(bad) && deviceIdChecks(bad)).toBe(false);
  });

  it('short IDs, HLC nodes and dashless forms', () => {
    for (const c of V.shortId) {
      expect(shortIdOf(c.deviceId)).toBe(c.shortId);
      expect(hlcNodeOf(c.deviceId)).toBe(c.hlcNode);
      expect(dashless(c.deviceId)).toBe(c.dashless);
      expect(dashed(c.dashless)).toBe(c.deviceId);
    }
  });

  it('verifies a device signature made by Syncthing\'s key (and refuses tampering)', async () => {
    const s = V.signature;
    expect(await verifySig(s.record, s.classId, s.path, s.writer)).toBe(true);
    expect(await verifySig({ ...s.record, note: 'changed' }, s.classId, s.path, s.writer)).toBe(false);
    expect(await verifySig(s.record, s.classId, s.path + 'x', s.writer)).toBe(false);
    expect(await verifySig(s.record, 'tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa', s.path, s.writer)).toBe(false);
    expect(await verifySig(s.record, ['tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa', s.classId], s.path, s.writer)).toBe(true);
    expect(await verifySig(s.record, s.classId, s.path, V.deviceIdOfCert[1].deviceId)).toBe(false);
    const { sig: _sig, ...unsigned } = s.record;
    expect(await verifySig(unsigned, s.classId, s.path, s.writer)).toBe(false);
  });

  it('verifies a person proof', async () => {
    const p = V.personProof;
    expect(await verifyPersonProof(p, p.classId)).toBe(true);
    expect(await verifyPersonProof(p, 'tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(await verifyPersonProof({ ...p, memberId: V.memberId[1].memberId }, p.classId)).toBe(false);
  });

  it('makes nonces and matches language tags', () => {
    const n = newNonce(mulberry32(3));
    expect(n).toMatch(/^[a-z2-7]{26}$/);
    expect(langMatches('es', 'es-ES')).toBe(true);
    expect(langMatches('pt-PT', 'pt-BR')).toBe(false);
    expect(langMatches('PT-pt', 'pt')).toBe(true);
    expect(langMatches('en', 'es')).toBe(false);
  });
});
