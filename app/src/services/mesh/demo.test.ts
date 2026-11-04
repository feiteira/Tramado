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

async function seeded(opts: { missing?: string | null } = {}) {
  const { seedDemo } = await import('../../demo/seed');
  const NOW = Date.UTC(2026, 10, 3, 15, 30);
  const { ctx, platform, clock } = await createTestContext({ syncMode: 'fake', startMs: NOW, kind: 'demo' } as never);
  const keys = await seedDemo(platform, { lang: 'en', theme: 'light', name: 'Ana Ribeiro', nowMs: NOW, empty: false });
  createDemoSyncControls(platform, keys, { mode: 'fake', now: () => clock.now(), missing: opts.missing ?? null });
  const { createIdentityService } = await import('../identity');
  (ctx as { identity: unknown }).identity = (await createIdentityService(platform)).identity;
  const services = createServices(ctx);
  await services.library.load();
  await services.sync.boot();
  for (let i = 0; i < 6; i++) {
    clock.advance(1200);
    for (const c of services.library.classes.get()) {
      await (services.forClass(c.id).store as ClassStoreImpl).idle();
      await (services.forClass(c.id).info as ClassServiceImpl).reload();
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  return { services, keys };
}

describe('the seeded demo (UX §7.3)', () => {
  it('sync=fake: Bruno (law) and Jamie (bio) are both online — two distinct classmates for the sync pill', async () => {
    const { services } = await seeded();
    expect(services.sync.state.get().onlineMembers).toBe(2);
  });

  it('missing=law: the folder-missing state; "Recently deleted" lists the fictional deletions', async () => {
    const { services, keys } = await seeded({ missing: 'law' });
    expect(services.sync.state.get().markerMissing).toEqual([keys.classes.law]);
    expect(services.library.classes.get().find((c) => c.id === keys.classes.law)?.sync.kind).toBe('missingFolder');
    const v = await services.sync.versions(keys.classes.law!);
    expect(v).toHaveLength(4);
    await services.sync.restore(keys.classes.law!, [{ path: v[0]!.path, versionTime: v[0]!.versionTime }]);
    expect(await services.sync.versions(keys.classes.law!)).toHaveLength(3);
  });
});

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
