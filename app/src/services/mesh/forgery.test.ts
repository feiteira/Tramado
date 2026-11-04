// Mesh: the forgery cases of sync spec §24 (folder spec §6.2): a forged memberId is shown under the writer's person;
// a duplicate id in another device's file is a second message; a member deleting an organiser's member and bans
// files changes no organisers, bans or folder devices; the event of version N arriving after the bytes of N+1 is
// pending, never trusted; unsigned and rolled-back member files are ignored even when `modifiedBy` claims the writer.
import { describe, expect, it } from 'vitest';
import { formatHlc } from '../../core/hlc';
import { chatMonthOf, chatPath } from '../../core/sync/chat';
import { dec, enc, info, meshApp, newMesh, settle, sharedClass } from './harness.testutil';

describe('mesh: forgeries', () => {
  it('forged memberId and duplicate ids in chat', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    const chat = (a: typeof ana) => a.services.forClass(classId).chat;
    const ref = await chat(ana).send({ text: 'Mensagem da Ana' });
    await settle(mesh, [ana, bruno, carla]);
    // Carla writes, in her own file, a line that claims to be Ana's and reuses the id of Ana's message.
    const now = mesh.clock('carla').now();
    const hlc = formatHlc({ ms: now, counter: 0, device: carla.deviceId.slice(0, 7).toLowerCase() });
    const line = { format: 'tramado.chat', version: 1, type: 'message', id: ref.id, hlc, ms: now, memberId: ana.memberId, text: 'Sou a Ana, juro' };
    const path = chatPath(carla.deviceId, chatMonthOf(hlc));
    const prev = dec(mesh.files('carla', classId).get(path));
    mesh.forge('carla', 'carla', classId, path, enc(prev + JSON.stringify(line) + '\n'));
    await settle(mesh, [ana, bruno, carla]);
    const items = chat(bruno).view.get().items;
    expect(items).toHaveLength(2);
    const forged = items.find((m) => m.text === 'Sou a Ana, juro')!;
    expect(forged).toMatchObject({ unverified: true, author: { deviceId: carla.deviceId, memberName: 'Carla Mendes' } });
    expect(items.find((m) => m.text === 'Mensagem da Ana')).toMatchObject({ unverified: false, author: { memberName: 'Ana Ribeiro' } });
  });

  it("deleting an organiser's member and bans files changes nothing for readers", async () => {
    const mesh = newMesh();
    const [ana, bruno, carla, diogo] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla'), await meshApp(mesh, 'diogo')];
    const classId = await sharedClass(mesh, ana, [bruno, carla, diogo]);
    await ana.services.sync.ban(classId, { memberId: diogo.memberId });
    await settle(mesh, [ana, bruno, carla, diogo], 8);
    expect(mesh.policy('bruno', classId)?.bannedDevices).toEqual([diogo.deviceId]);
    const before = { organisers: info(bruno, classId).detail.get().organisers, devices: mesh.folderDevices('bruno', classId) };
    mesh.crash('ana');   // Ana's app cannot heal; Carla deletes her files
    mesh.forge('carla', 'ana', classId, `.tramado/members/${ana.deviceId}.json`, new Uint8Array());
    mesh.forge('carla', 'ana', classId, `.tramado/bans/${ana.deviceId}.json`, new Uint8Array());
    mesh.forge('carla', 'ana', classId, `.tramado/meta/${ana.deviceId}.json`, new Uint8Array());
    await settle(mesh, [bruno, carla], 8);
    expect(mesh.files('bruno', classId).has(`.tramado/members/${ana.deviceId}.json`)).toBe(false);
    expect(info(bruno, classId).detail.get().organisers).toEqual(before.organisers);
    expect(info(bruno, classId).detail.get().people.map((p) => p.name)).toContain('Ana Ribeiro');
    expect(mesh.policy('bruno', classId)?.bannedDevices).toEqual([diogo.deviceId]);
    expect(mesh.policy('bruno', classId)?.askBeforeAdmit).toBe(true);
    expect(mesh.folderDevices('bruno', classId)).toEqual(before.devices);
    expect(info(bruno, classId).detail.get().meta.name).toBe('Direito Constitucional I');
  });

  it('the event of version N after the bytes of N+1 is pending, never trusted wrongly', async () => {
    const mesh = newMesh({ eventLag: 1 });
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    await settle(mesh, [ana, bruno], 4);
    await info(ana, classId).setMeta({ name: 'Direito Constitucional I (2026)' });
    await mesh.flush();            // the bytes arrive; the database entry and the event lag one round
    await mesh.advance(600);
    await (bruno.services.forClass(classId).store as unknown as { idle(): Promise<void> }).idle();
    expect(info(bruno, classId).detail.get().meta.name).toBe('Direito Constitucional I');
    expect(bruno.services.sync.state.get().foreignWrites).toBe(0);
    await settle(mesh, [ana, bruno]);
    expect(info(bruno, classId).detail.get().meta.name).toBe('Direito Constitucional I (2026)');
    expect(bruno.services.sync.state.get().foreignWrites).toBe(0);
  });

  it('unsigned or rolled-back member files are ignored even when modifiedBy names the writer', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    const memberPath = `.tramado/members/${ana.deviceId}.json`;
    const old = dec(mesh.files('carla', classId).get(memberPath));
    // Ana renames herself: a newer signed member file.
    const id = ana.ctx.identity as unknown as { get(): { name: string }; set(v: unknown): void };
    id.set({ ...id.get(), name: 'Ana R.' });
    await ana.services.forClass(classId).info.refreshOwnMemberFile();
    await settle(mesh, [ana, bruno, carla]);
    const names = () => info(bruno, classId).detail.get().people.map((p) => p.name);
    expect(names()).toContain('Ana R.');
    mesh.crash('ana');
    // Carla, with a modified Syncthing, sends an unsigned edit claiming modifiedBy = Ana …
    const current = JSON.parse(dec(mesh.files('carla', classId).get(memberPath)));
    mesh.forgeAs('carla', 'ana', classId, memberPath, enc(JSON.stringify({ ...current, name: 'Ana (sem assinatura)', sig: { cert: '', value: '' } })));
    await settle(mesh, [bruno, carla], 4);
    expect(names()).toContain('Ana R.');
    expect(names()).not.toContain('Ana (sem assinatura)');
    // … and replays the older signed version (lower hlc): a rollback.
    mesh.forgeAs('carla', 'ana', classId, memberPath, enc(old));
    await settle(mesh, [bruno, carla], 4);
    expect(names()).toContain('Ana R.');
    expect(names()).not.toContain('Ana Ribeiro');
  });
});
