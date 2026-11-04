// Mesh: authorship (folder spec §6, sync spec §12): a member's forged chat and member files are ignored by readers
// (the last trusted content stays), counted as foreign writes, and the owner's device heals its file (§12.3).
import { describe, expect, it } from 'vitest';
import { chatPath } from '../../core/sync/chat';
import { dec, enc, info, meshApp, newMesh, settle, sharedClass } from './harness.testutil';

describe('mesh: trust', () => {
  it('forged chat and member files are ignored, counted, and healed by their owner', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    const chat = (a: typeof ana) => a.services.forClass(classId).chat;
    await chat(ana).send({ text: 'Original da Ana' });
    await settle(mesh, [ana, bruno, carla]);
    const path = [...mesh.files('ana', classId).keys()].find((p) => p.startsWith(`.tramado/chat/${ana.deviceId}/`))!;
    expect(path).toBe(chatPath(ana.deviceId, path.slice(-13, -6)));

    // Carla rewrites Ana's chat file and Ana's member file.
    const forgedLine = dec(mesh.files('ana', classId).get(path)).replace('Original da Ana', 'Texto falsificado');
    mesh.setSelfHeal('ana', false);
    mesh.forge('carla', 'ana', classId, path, enc(forgedLine));
    const memberPath = `.tramado/members/${ana.deviceId}.json`;
    const member = JSON.parse(dec(mesh.files('ana', classId).get(memberPath)));
    mesh.forge('carla', 'ana', classId, memberPath, enc(JSON.stringify({ ...member, name: 'Mallory' })));
    await settle(mesh, [ana, bruno, carla]);
    expect(chat(bruno).view.get().items.map((m) => m.text)).toEqual(['Original da Ana']);
    expect(info(bruno, classId).detail.get().people.map((p) => p.name)).toContain('Ana Ribeiro');
    expect(info(bruno, classId).detail.get().people.map((p) => p.name)).not.toContain('Mallory');
    expect(bruno.services.sync.state.get().foreignWrites).toBeGreaterThan(0);

    // Ana's device heals both files; everyone trusts them again.
    mesh.setSelfHeal('ana', true);
    mesh.forge('carla', 'ana', classId, path, enc(forgedLine + ''));
    await settle(mesh, [ana, bruno, carla]);
    expect(dec(mesh.files('bruno', classId).get(path))).toContain('Original da Ana');
    expect(dec(mesh.files('carla', classId).get(path))).not.toContain('falsificado');
    await chat(ana).send({ text: 'Depois da cura' });
    await settle(mesh, [ana, bruno, carla]);
    expect(chat(bruno).view.get().items.map((m) => m.text)).toEqual(['Original da Ana', 'Depois da cura']);
  });

  it('a foreign line appended after a trusted prefix: only the prefix counts', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    const chat = (a: typeof ana) => a.services.forClass(classId).chat;
    await chat(ana).send({ text: 'Primeira' });
    await settle(mesh, [ana, bruno, carla]);
    mesh.setSelfHeal('ana', false);
    const path = [...mesh.files('ana', classId).keys()].find((p) => p.startsWith(`.tramado/chat/${ana.deviceId}/`))!;
    const prev = dec(mesh.files('carla', classId).get(path));
    const line = JSON.parse(prev.trim());
    const extra = JSON.stringify({ ...line, id: '01JBXA7D1W3Q8K5N2M9R4T6Y0Z', text: 'Acrescentada pela Carla' });
    mesh.forge('carla', 'ana', classId, path, enc(prev + extra + '\n'));
    await settle(mesh, [ana, bruno, carla]);
    expect(chat(bruno).view.get().items.map((m) => m.text)).toEqual(['Primeira']);
  });
});
