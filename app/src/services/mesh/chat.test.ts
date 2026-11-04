// Mesh: chat across three devices with a partition and a heal; delivery ticks from availability; edits, deletes with
// redaction; mentions notify; unread and markRead (folder spec §8.16, sync spec §15).
import { describe, expect, it } from 'vitest';
import type { NotificationServiceImpl } from '../notifications';
import { meshApp, newMesh, settle, sharedClass } from './harness.testutil';

describe('mesh: chat', () => {
  it('three devices, partition, heal, delivery ticks', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    const chat = (a: typeof ana) => a.services.forClass(classId).chat;

    await chat(ana).send({ text: 'Bom dia a todos' });
    expect(chat(ana).view.get().items.at(-1)).toMatchObject({ text: 'Bom dia a todos', delivery: 'local' });
    await settle(mesh, [ana, bruno, carla]);
    expect(chat(ana).view.get().items.at(-1)?.delivery).toBe('sent');
    expect(chat(bruno).view.get().items.map((m) => m.text)).toEqual(['Bom dia a todos']);
    expect(chat(bruno).view.get().unread).toBe(1);

    // Carla is cut off; Ana and Bruno keep talking; Carla writes alone.
    mesh.partition(['ana', 'bruno'], ['carla']);
    await chat(bruno).send({ text: `Alguém tem os slides? <@${ana.memberId}>` });
    await chat(carla).send({ text: 'Estou sem rede' });
    await settle(mesh, [ana, bruno, carla]);
    expect(chat(carla).view.get().items.map((m) => m.text)).toEqual(['Bom dia a todos', 'Estou sem rede']);
    expect(chat(carla).view.get().items.at(-1)?.delivery).toBe('local');
    expect(chat(ana).view.get().mentions).toBe(1);
    expect((ana.services.notifications as NotificationServiceImpl).recent().map((n) => n.key)).toContain('notify.mention');

    mesh.heal();
    await settle(mesh, [ana, bruno, carla]);
    const order = (a: typeof ana) => chat(a).view.get().items.map((m) => m.text);
    expect(order(ana)).toEqual(order(bruno));
    expect(order(ana)).toEqual(order(carla));
    expect(order(ana)).toHaveLength(3);
    expect(chat(carla).view.get().items.find((m) => m.text === 'Estou sem rede')?.delivery).toBe('sent');

    chat(ana).markRead();
    expect(chat(ana).view.get().unread).toBe(0);
  });

  it('edit and delete for everyone (with redaction); replies stay below their parent', async () => {
    const mesh = newMesh();
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    const chat = (a: typeof ana) => a.services.forClass(classId).chat;
    const q = await chat(ana).send({ text: 'Frequência a dia 10?' });
    await settle(mesh, [ana, bruno]);
    await chat(bruno).send({ text: 'Não, a 12', replyTo: q });
    await chat(ana).edit(q, 'Frequência a dia 10 ou 12?');
    await settle(mesh, [ana, bruno]);
    const items = chat(bruno).view.get().items;
    expect(items.map((m) => m.text)).toEqual(['Frequência a dia 10 ou 12?', 'Não, a 12']);
    expect(items[0]!.edited).toBe(true);
    expect(items[1]!.replyTo).toMatchObject({ id: `${q.deviceId}:${q.id}`, author: 'Ana Ribeiro' });
    await expect(chat(bruno).edit(q, 'hack')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await chat(ana).remove(q);
    await settle(mesh, [ana, bruno]);
    expect(chat(bruno).view.get().items[0]).toMatchObject({ deleted: true, text: '' });
    const raw = new TextDecoder().decode([...mesh.files('bruno', classId)].find(([p]) => p.startsWith(`.tramado/chat/${ana.deviceId}/`))![1]);
    expect(raw).not.toContain('Frequência a dia 10?');
    expect(raw).toContain('"redacted":true');
  });
});
