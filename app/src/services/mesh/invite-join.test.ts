// Mesh: invite → join → admission by folder-ID proof, full mesh through the roster, "Ask before letting people in",
// declines by organisers (ban) and check words (sync spec §7–§10).
import { describe, expect, it } from 'vitest';
import { checkWords } from '../../core/sync/checkWords';
import { info, meshApp, newMesh, settle, sharedClass } from './harness.testutil';

describe('mesh: invite and join', () => {
  it('a joiner proves the folder ID, is admitted and everyone sees everyone', async () => {
    const mesh = newMesh();
    const ana = await meshApp(mesh, 'ana');
    const bruno = await meshApp(mesh, 'bruno');
    const carla = await meshApp(mesh, 'carla');
    const classId = await ana.services.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'pt-PT', share: true });
    await settle(mesh, [ana], 2);
    const inv = await ana.services.sync.invite(classId);
    expect(inv.code.startsWith('tri1_')).toBe(true);
    expect(inv.link).toBe(`tramado://join/${inv.code}`);
    expect(inv.qrText.startsWith('tramado://join/tri1_')).toBe(true);
    expect(inv.fileText.split('\n')[1]).toContain('Direito Constitucional I');
    const preview = await bruno.services.sync.parseCode(`Junta-te: ${inv.link}`);
    expect(preview.classId).toBe(classId);
    expect(preview.checkWords).toBe(checkWords(bruno.deviceId));
    expect(preview.warnings).toEqual([]);
    expect((await ana.services.sync.parseCode(inv.code)).warnings).toEqual(expect.arrayContaining(['ownInvite', 'alreadyMember']));
    await bruno.services.sync.join(preview, { includeAudio: true });
    await settle(mesh, [ana, bruno]);
    expect(mesh.folderDevices('ana', classId)).toEqual([ana.deviceId, bruno.deviceId].sort());
    expect(info(bruno, classId).detail.get().meta.name).toBe('Direito Constitucional I');
    expect(info(bruno, classId).detail.get().organisers).toEqual([ana.memberId]);
    expect(info(ana, classId).detail.get().people.map((p) => p.name).sort()).toEqual(['Ana Ribeiro', 'Bruno Costa']);
    expect(bruno.services.library.classes.get().find((c) => c.id === classId)?.name).toBe('Direito Constitucional I');

    // Carla joins with an invite that names only Bruno's device; Ana learns her from the roster.
    const fromBruno = await bruno.services.sync.invite(classId);
    await carla.services.sync.join(await carla.services.sync.parseCode(fromBruno.code), { includeAudio: false });
    await settle(mesh, [ana, bruno, carla], 8);
    const all = [ana.deviceId, bruno.deviceId, carla.deviceId].sort();
    expect(mesh.folderDevices('ana', classId)).toEqual(all);
    expect(mesh.folderDevices('carla', classId)).toEqual(all);
    expect(info(ana, classId).detail.get().people).toHaveLength(3);
    expect(mesh.policy('ana', classId)?.roster.map((r) => r.deviceId).sort()).toEqual(all);
  });

  it('ask before letting people in: queued, let in by any member; an organiser decline bans', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla, diogo] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla'), await meshApp(mesh, 'diogo')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    await info(ana, classId).setMeta({ askBeforeAdmit: true });
    await settle(mesh, [ana, bruno]);
    expect(mesh.policy('ana', classId)?.askBeforeAdmit).toBe(true);
    expect(mesh.policy('bruno', classId)?.askBeforeAdmit).toBe(true);
    const { code } = await ana.services.sync.invite(classId);
    await carla.services.sync.join(await carla.services.sync.parseCode(code), { includeAudio: true });
    await settle(mesh, [ana, bruno, carla]);
    expect(ana.services.sync.state.get().joinRequests.map((r) => r.deviceId)).toEqual([carla.deviceId]);
    expect(mesh.folderDevices('ana', classId)).not.toContain(carla.deviceId);
    await ana.services.sync.admit(classId, carla.deviceId);
    await settle(mesh, [ana, bruno, carla], 8);
    expect(mesh.folderDevices('ana', classId)).toContain(carla.deviceId);
    expect(info(carla, classId).detail.get().meta.name).toBe('Direito Constitucional I');
    expect(info(bruno, classId).detail.get().people).toHaveLength(3);

    await diogo.services.sync.join(await diogo.services.sync.parseCode(code), { includeAudio: true });
    await settle(mesh, [ana, bruno, carla, diogo]);
    expect(ana.services.sync.state.get().joinRequests.map((r) => r.deviceId)).toEqual([diogo.deviceId]);
    await ana.services.sync.decline(classId, diogo.deviceId);
    await settle(mesh, [ana, bruno, carla, diogo], 8);
    expect(mesh.policy('bruno', classId)?.bannedDevices).toEqual([diogo.deviceId]);
    expect(mesh.folderDevices('bruno', classId)).not.toContain(diogo.deviceId);
  });

  it('joinStalled counts 90 s from the first connection to a member, not from join() (sync spec §8)', async () => {
    const mesh = newMesh();
    const [ana, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, []);
    await info(ana, classId).setMeta({ askBeforeAdmit: true });   // nobody lets Carla in
    await settle(mesh, [ana]);
    const { code } = await ana.services.sync.invite(classId);
    mesh.crash('ana');                                             // the only member is offline
    await carla.services.sync.join(await carla.services.sync.parseCode(code), { includeAudio: true });
    expect(carla.services.sync.joining(classId)).toMatchObject({ connectedAt: null });
    await mesh.advance(120_000);
    await settle(mesh, [carla], 2);
    expect(carla.services.sync.state.get().joinStalled).toEqual([]);   // nobody to connect to: not stalled
    mesh.restart('ana');
    const ana2 = await meshApp(mesh, 'ana', ana.platform);
    await settle(mesh, [ana2, carla], 2);
    expect(carla.services.sync.joining(classId)?.connectedAt).not.toBeNull();
    await mesh.advance(60_000);
    expect(carla.services.sync.state.get().joinStalled).toEqual([]);
    await mesh.advance(31_000);
    expect(carla.services.sync.state.get().joinStalled).toEqual([classId]);
    // Let in at last: the stall clears.
    await ana2.services.sync.admit(classId, carla.deviceId);
    await settle(mesh, [ana2, carla], 6);
    expect(carla.services.sync.state.get().joinStalled).toEqual([]);
    expect(carla.services.sync.joining(classId)).toBeNull();
  });

  it('try again re-runs the knock with the same invite', async () => {
    const mesh = newMesh();
    const [ana, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, []);
    await info(ana, classId).setMeta({ askBeforeAdmit: true });
    await settle(mesh, [ana]);
    const { code } = await ana.services.sync.invite(classId);
    await carla.services.sync.join(await carla.services.sync.parseCode(code), { includeAudio: false });
    await settle(mesh, [ana, carla], 2);
    await mesh.advance(91_000);
    expect(carla.services.sync.state.get().joinStalled).toEqual([classId]);
    await expect(carla.services.sync.retryJoin(classId)).resolves.toBe(classId);
    expect(carla.services.sync.state.get().joinStalled).toEqual([]);
    expect((await carla.platform.classes.list()).find((e) => e.classId === classId)).toMatchObject({ joining: true, skipAudio: true });
    await ana.services.sync.admit(classId, carla.deviceId);
    await settle(mesh, [ana, carla], 6);
    expect(info(carla, classId).detail.get().meta.name).toBe('Direito Constitucional I');
  });

  it('refuses damaged and pairing codes', async () => {
    const mesh = newMesh();
    const ana = await meshApp(mesh, 'ana');
    await expect(ana.services.sync.parseCode('nothing here')).rejects.toMatchObject({ code: 'SYNC_INVITE_INVALID' });
    await expect(ana.services.sync.parseCode(`trp1_${'A'.repeat(60)}`)).rejects.toMatchObject({ code: 'NEWER_FORMAT', data: { pair: true } });
  });
});
