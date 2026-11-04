// Mesh: the roster drives the policy (sync spec §10, D-1): a member file is pushed with its device; a ban by an
// organiser becomes bannedDevices everywhere and removes the device from every folder; a device that left is dropped;
// a member file untrusted for three reconcile cycles does not drop its device.
import { describe, expect, it } from 'vitest';
import { info, meshApp, newMesh, settle, sharedClass } from './harness.testutil';

describe('mesh: roster → policy', () => {
  it('member files, bans and departures', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    const roster = (n: string) => mesh.policy(n, classId)?.roster.map((r) => r.deviceId).sort();
    const all = [ana.deviceId, bruno.deviceId, carla.deviceId].sort();
    expect(roster('ana')).toEqual(all);
    expect(roster('bruno')).toEqual(all);
    expect(mesh.policy('carla', classId)?.knownDevices.sort()).toEqual(all);
    expect(mesh.policy('carla', classId)?.label).toBe('Direito Constitucional I');

    // A non-organiser cannot ban.
    await expect(bruno.services.sync.ban(classId, { memberId: carla.memberId })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // The organiser bans Carla: every member pushes bannedDevices; askBeforeAdmit turns on.
    await ana.services.sync.ban(classId, { memberId: carla.memberId }, 'spam');
    await settle(mesh, [ana, bruno, carla], 8);
    expect(mesh.policy('bruno', classId)?.bannedDevices).toEqual([carla.deviceId]);
    expect(mesh.policy('bruno', classId)?.askBeforeAdmit).toBe(true);
    expect(roster('bruno')).toEqual([ana.deviceId, bruno.deviceId].sort());
    expect(mesh.folderDevices('bruno', classId)).not.toContain(carla.deviceId);
    expect(mesh.folderDevices('ana', classId)).not.toContain(carla.deviceId);
    expect(info(bruno, classId).detail.get().people.find((p) => p.memberId === carla.memberId)?.banned).toBe(true);

    // Unban: the effects are lifted (the person can come back with the invite).
    await ana.services.sync.unban(classId, { memberId: carla.memberId });
    await settle(mesh, [ana, bruno, carla], 8);
    expect(mesh.policy('bruno', classId)?.bannedDevices).toEqual([]);
  });

  it('a device that left is dropped from the folders and keeps its binding for older records', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    await bruno.services.forClass(classId).chat.send({ text: 'Até à próxima' });
    await settle(mesh, [ana, bruno, carla]);
    await bruno.services.sync.leave(classId, { afterwards: 'trash', deleteMyNotes: true });
    await settle(mesh, [ana, bruno, carla], 8);
    expect(mesh.folderDevices('ana', classId)).toEqual([ana.deviceId, carla.deviceId].sort());
    expect(mesh.policy('carla', classId)?.roster.map((r) => r.deviceId)).not.toContain(bruno.deviceId);
    expect(bruno.services.library.classes.get().map((c) => c.id)).not.toContain(classId);
    // Bruno's old message is still his.
    const msg = carla.services.forClass(classId).chat.view.get().items.find((m) => m.text === 'Até à próxima');
    expect(msg).toMatchObject({ unverified: false, author: { memberName: 'Bruno Costa' } });
  });

  it('a member file untrusted for three cycles does not drop its device', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    // Carla overwrites Bruno's member file (a foreign write): readers keep the last trusted one.
    mesh.forge('carla', 'bruno', classId, `.tramado/members/${bruno.deviceId}.json`, new TextEncoder().encode('{"format":"tramado.member","version":1}'));
    mesh.crash('bruno');   // so Bruno's app cannot heal it
    for (let i = 0; i < 3; i++) await settle(mesh, [ana, carla], 2);
    expect(mesh.folderDevices('ana', classId)).toContain(bruno.deviceId);
    expect(mesh.policy('ana', classId)?.roster.map((r) => r.deviceId)).toContain(bruno.deviceId);
    expect(info(ana, classId).detail.get().people.map((p) => p.name)).toContain('Bruno Costa');
    expect(ana.services.sync.state.get().foreignWrites).toBeGreaterThan(0);
  });
});
