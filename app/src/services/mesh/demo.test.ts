// The single-device memory sync and its demo modes (UX §7.2): `fake` (peers online, DemoControls.sync writing as a
// member's device), `offline` (my message stays pending), `error` (SYNC_UNAVAILABLE), `join=ask` (a waiting joiner).
import { describe, expect, it } from 'vitest';
import { createDemoSyncControls } from '../../platform/memory/sync';
import { deviceIdentity, personKeyIndex, poolKey } from '../../platform/memory/signer';
import { memberIdOf } from '../../core/model/derive';
import { createServices } from '../index';
import { createTestContext } from '../testing/context';
import type { ClassServiceImpl } from '../class';
import type { ClassStoreImpl } from '../classStore';
import type { SyncServiceImpl } from '../sync';

async function demo(mode: 'fake' | 'offline' | 'error' | 'local', join: 'ask' | null = null) {
  const { ctx, platform, clock } = await createTestContext({ name: 'Ana Ribeiro', syncMode: mode });
  const services = createServices(ctx);
  await services.library.load();
  const share = mode !== 'error' && mode !== 'local';
  const classId = await services.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'pt-PT', share });
  const bruno = deviceIdentity(5).deviceId;
  const keys = {
    classes: { law: classId },
    members: { ana: { memberId: ctx.identity.get()!.memberId, deviceIds: [platform.mem.deviceId] }, bruno: { memberId: memberIdOf(poolKey(personKeyIndex(5)).pub), deviceIds: [bruno] }, diogo: { memberId: memberIdOf(poolKey(personKeyIndex(6)).pub), deviceIds: [deviceIdentity(6).deviceId] } },
  };
  const controls = createDemoSyncControls(platform, keys, { mode, now: () => clock.now(), join });
  await services.sync.boot();
  const idle = async () => {
    for (let i = 0; i < 8; i++) {
      clock.advance(1200);
      await (services.forClass(classId).store as ClassStoreImpl).idle();
      await (services.forClass(classId).info as ClassServiceImpl).reload();
      await new Promise((r) => setTimeout(r, 2));
    }
  };
  await idle();
  return { ctx, platform, services, classId, controls, idle, bruno };
}

describe('memory sync demo modes', () => {
  it('fake: peers are online; peerSays and peerJoins write as the member device', async () => {
    const d = await demo('fake');
    const chat = d.services.forClass(d.classId).chat;
    await d.controls.peerSays('law', 'bruno', 'Alguém tem os slides da aula 6?');
    await d.idle();
    expect(chat.view.get().items.map((m) => m.text)).toEqual(['Alguém tem os slides da aula 6?']);
    expect(chat.view.get().unread).toBe(1);
    expect(d.services.sync.state.get().status?.state).toBe('running');
    await d.controls.peerJoins('law', 'Eva Lopes', 'Eva’s laptop');
    await d.idle();
    const people = (d.services.forClass(d.classId).info as ClassServiceImpl).detail.get().people.map((p) => p.name);
    expect(people).toEqual(['Ana Ribeiro', 'Eva Lopes']);
    await chat.send({ text: 'Estão nos documentos' });
    await d.idle();
    expect(chat.view.get().items.at(-1)?.delivery).toBe('sent');
    d.controls.setOnline('bruno', false);
    expect((d.services.sync as SyncServiceImpl).connectionOf(d.bruno)?.connected).toBe(false);
  });

  it('offline: my last message stays pending', async () => {
    const d = await demo('offline');
    const chat = d.services.forClass(d.classId).chat;
    await chat.send({ text: 'Alguém aí?' });
    await d.idle();
    expect(chat.view.get().items.at(-1)?.delivery).toBe('local');
  });

  it('error: sharing is unavailable', async () => {
    const d = await demo('error');
    expect(d.services.sync.state.get().status?.error).toBe('SYNC_UNAVAILABLE');
    await expect(d.services.sync.share(d.classId)).rejects.toMatchObject({ code: 'SYNC_UNAVAILABLE' });
  });

  it('join=ask: Diogo waits; letting him in admits him', async () => {
    const d = await demo('fake', 'ask');
    const diogo = deviceIdentity(6).deviceId;
    expect(d.services.sync.state.get().joinRequests.map((r) => r.deviceId)).toEqual([diogo]);
    await d.services.sync.admit(d.classId, diogo);
    expect(d.services.sync.state.get().joinRequests).toEqual([]);
  });
});
