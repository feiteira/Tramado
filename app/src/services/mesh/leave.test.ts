// Mesh: leaving (sync spec §17): a persisted background state that finishes only once another member holds the
// deletion of my member file (so leaving while everyone is offline waits); "keep a copy" forks the class (new ID,
// `forkedFrom`), and sharing the fork changes nothing on the others.
import { describe, expect, it } from 'vitest';
import { verifySig } from '../../core/model/sig';
import { dec, info, meshApp, newMesh, settle, sharedClass } from './harness.testutil';

describe('mesh: leave', () => {
  it('waits while the others are offline, then finishes', async () => {
    const mesh = newMesh();
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    mesh.crash('ana');
    await bruno.services.sync.leave(classId, { afterwards: 'trash', deleteMyNotes: false });
    await settle(mesh, [bruno], 4);
    // The class left the UI at once but is still a folder (leaving).
    expect(bruno.services.library.classes.get().map((c) => c.id)).not.toContain(classId);
    expect((await bruno.platform.classes.list()).find((e) => e.classId === classId)?.leaving).toMatchObject({ afterwards: 'trash' });
    expect(mesh.folderDevices('bruno', classId).length).toBeGreaterThan(0);
    mesh.restart('ana');
    const ana2 = await meshApp(mesh, 'ana', ana.platform);
    await settle(mesh, [ana2, bruno], 8);
    expect(mesh.folderDevices('bruno', classId)).toEqual([]);
    expect((await bruno.platform.classes.list()).find((e) => e.classId === classId)).toBeUndefined();
    expect(mesh.folderDevices('ana', classId)).toEqual([ana.deviceId]);
    expect(info(ana2, classId).detail.get().people.map((p) => p.name)).toEqual(['Ana Ribeiro']);
  });

  it('keep a copy: the class is forked, and sharing the fork changes nothing for the others', async () => {
    const mesh = newMesh();
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    await ana.services.forClass(classId).chat.send({ text: 'Antes de sair' });
    await settle(mesh, [ana, bruno]);
    const before = new Map([...mesh.files('ana', classId)].map(([p, b]) => [p, dec(b)]));
    await bruno.services.sync.leave(classId, { afterwards: 'keepLocal', deleteMyNotes: false });
    await settle(mesh, [ana, bruno], 8);
    const list = bruno.services.library.classes.get();
    const fork = list.find((c) => c.name === 'Direito Constitucional I');
    expect(fork).toBeDefined();
    expect(fork!.id).not.toBe(classId);
    expect(fork!.shared).toBe(false);
    const cf = JSON.parse(dec(mesh.files('bruno', fork!.id).get('.tramado/class.json')));
    expect(cf).toMatchObject({ classId: fork!.id, forkedFrom: classId, createdBy: { deviceId: bruno.deviceId } });
    expect(await verifySig(cf, fork!.id, '.tramado/class.json', bruno.deviceId)).toBe(true);
    expect(info(bruno, fork!.id).detail.get().organisers).toEqual([bruno.memberId]);
    // Sharing the fork creates a new folder; Ana's class is untouched.
    await bruno.services.sync.share(fork!.id);
    await settle(mesh, [ana, bruno], 6);
    const after = new Map([...mesh.files('ana', classId)].map(([p, b]) => [p, dec(b)]));
    for (const [p, text] of before) if (!p.startsWith('.tramado/members/') && !p.startsWith('.tramado/presence/')) expect(after.get(p)).toBe(text);
    expect(mesh.folderDevices('ana', classId)).toEqual([ana.deviceId]);
    expect(mesh.folderDevices('bruno', fork!.id)).toEqual([bruno.deviceId]);
  });
});
