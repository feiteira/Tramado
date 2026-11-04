import { describe, expect, it } from 'vitest';
import { checkMemberFile, computeBindings, memberShapeOk, type MemberInput } from './members';
import { hlcAt, signedMember, testDevice, testPerson } from './keys.testutil';

const CLS = 'tramado-geznkyujw4ofedwinfcmzl2rim';
const path = (d: string) => `.tramado/members/${d}.json`;

describe('person-key binding (folder spec §8.3.1)', () => {
  it('binds a device with a valid signature and proof; a claim without a valid proof is unverified', async () => {
    const [d1, d2] = [await testDevice('1'), await testDevice('2')];
    const [ana, bruno] = [await testPerson(), await testPerson()];
    const good = await signedMember(CLS, d1, ana);
    expect(memberShapeOk(good, d1.deviceId)).toBe(true);
    const c1 = await checkMemberFile(good, CLS, path(d1.deviceId));
    expect(c1).toMatchObject({ sigOk: true, proofOk: true });
    // d2 claims Ana's memberId but proves with Bruno's key
    const forged = await signedMember(CLS, d2, bruno, { memberId: ana.memberId });
    const c2 = await checkMemberFile(forged, CLS, path(d2.deviceId));
    expect(c2.sigOk).toBe(true);
    expect(c2.proofOk).toBe(false);
    const b = computeBindings([{ deviceId: d1.deviceId, file: good, check: c1 }, { deviceId: d2.deviceId, file: forged, check: c2 }]);
    expect(b.bound.get(d1.deviceId)).toBe(ana.memberId);
    expect(b.bound.has(d2.deviceId)).toBe(false);
    expect(b.unverified.has(d2.deviceId)).toBe(true);
    expect(b.claims.get(d2.deviceId)).toBe(ana.memberId);
    expect(b.people).toHaveLength(1);
  });

  it('a proof for another class or a tampered file does not verify', async () => {
    const d = await testDevice();
    const p = await testPerson();
    const f = await signedMember('tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa', d, p);
    expect((await checkMemberFile(f, CLS, path(d.deviceId)))).toMatchObject({ sigOk: false, proofOk: false });
    const g = await signedMember(CLS, d, p);
    expect((await checkMemberFile({ ...g, name: 'Mallory' }, CLS, path(d.deviceId))).sigOk).toBe(false);
  });

  it('two devices of one person; name from the greater hlc; revocation unbinds', async () => {
    const [d1, d2] = [await testDevice('a'), await testDevice('b')];
    const ana = await testPerson();
    const f1 = await signedMember(CLS, d1, ana, { name: 'Ana', hlc: hlcAt(10, d1.node) }, { revoke: [d2.deviceId] });
    const f2 = await signedMember(CLS, d2, ana, { name: 'Ana Ribeiro', hlc: hlcAt(20, d2.node) });
    const inputs: MemberInput[] = [
      { deviceId: d1.deviceId, file: f1, check: await checkMemberFile(f1, CLS, path(d1.deviceId)) },
      { deviceId: d2.deviceId, file: f2, check: await checkMemberFile(f2, CLS, path(d2.deviceId)) },
    ];
    const b = computeBindings(inputs);
    expect(b.bound.has(d2.deviceId)).toBe(false);
    const noRevoke = await signedMember(CLS, d1, ana, { name: 'Ana', hlc: hlcAt(10, d1.node) });
    const b2 = computeBindings([{ deviceId: d1.deviceId, file: noRevoke, check: await checkMemberFile(noRevoke, CLS, path(d1.deviceId)) }, inputs[1]!]);
    expect(b2.people[0]!.devices).toHaveLength(2);
    expect(b2.people[0]!.name).toBe('Ana Ribeiro');
  });

  it('a device that left keeps its binding for records stamped before it left', async () => {
    const d = await testDevice();
    const b = computeBindings([], new Map([[d.deviceId, { memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', leftHlc: hlcAt(100, d.node), file: null }]]));
    expect(b.personAt(d.deviceId, hlcAt(50, d.node))).toBe('k3q7mzx2v4hbtnw5r6yjc2aefg');
    expect(b.personAt(d.deviceId, hlcAt(150, d.node))).toBeNull();
  });
});
