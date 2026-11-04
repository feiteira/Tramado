// Mesh: the class service (folder spec §8.2–§8.5) and the rest of SyncService: meta LWW across devices, organisers
// and "Become an organiser" after every organiser left, consent record/revoke, presence with staleness, folder
// offers, "Recently deleted" and restore, the receiving mass-delete guard, settings, diagnostics.
import { describe, expect, it } from 'vitest';
import type { NotificationServiceImpl } from '../notifications';
import type { PresenceServiceImpl } from '../presence';
import { dec, enc, info, meshApp, newMesh, settle, sharedClass } from './harness.testutil';

describe('mesh: class service', () => {
  it('meta is last-writer-wins across devices; invalid values are refused; askBeforeAdmit only from organisers', async () => {
    const mesh = newMesh({ clockSkewMs: { bruno: -120_000 } });
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    await info(bruno, classId).setMeta({ term: '2026/27 · 1.º semestre' });
    await settle(mesh, [ana, bruno]);
    await info(ana, classId).setMeta({ term: '2026/27 · S1' });
    await settle(mesh, [ana, bruno]);
    // Bruno's clock is 2 minutes slow, but the override stamp makes his later change win.
    await info(bruno, classId).setMeta({ term: 'Semestre 1' });
    await settle(mesh, [ana, bruno]);
    expect(info(ana, classId).detail.get().meta.term).toBe('Semestre 1');
    await expect(info(ana, classId).setMeta({ name: '' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(info(ana, classId).setMeta({ colour: 'red' })).rejects.toMatchObject({ code: 'INVALID' });
    // A non-organiser's askBeforeAdmit does not count.
    await info(bruno, classId).setMeta({ askBeforeAdmit: true });
    await settle(mesh, [ana, bruno]);
    expect(info(ana, classId).detail.get().meta.askBeforeAdmit).toBe(false);
    await expect(info(bruno, classId).setOrganiser(bruno.memberId, true)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await info(ana, classId).setOrganiser(bruno.memberId, true);
    await settle(mesh, [ana, bruno]);
    expect(info(bruno, classId).detail.get().me.isOrganiser).toBe(true);
    expect(ana.services.library.classes.get()[0]!.organisers.sort()).toEqual([ana.memberId, bruno.memberId].sort());
  });

  it('becoming an organiser once every organiser left (vacancy, with the departure stamp)', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    // Bruno's self-add while Ana (the only organiser) is still here.
    await info(bruno, classId).becomeOrganiser();
    await settle(mesh, [ana, bruno, carla]);
    expect(info(carla, classId).detail.get().organisers).toEqual([ana.memberId]);
    const metaBefore = JSON.parse(dec(mesh.files('carla', classId).get(`.tramado/meta/${ana.deviceId}.json`))).hlc as string;
    await ana.services.sync.leave(classId, { afterwards: 'trash', deleteMyNotes: true });
    await settle(mesh, [ana, bruno, carla], 8);
    // The leave rewrote Ana's meta with a fresh hlc (the departure stamp, folder spec §8.2) before her member file went.
    const stamp = JSON.parse(dec(mesh.files('carla', classId).get(`.tramado/meta/${ana.deviceId}.json`))).hlc as string;
    expect(stamp > metaBefore).toBe(true);
    expect(mesh.files('carla', classId).has(`.tramado/members/${ana.deviceId}.json`)).toBe(false);
    // Bruno's earlier self-add was stamped before Ana left: it stays invalid on every reader.
    for (const a of [bruno, carla]) expect(info(a, classId).detail.get().organisers).toEqual([ana.memberId]);
    // Carla's "Become an organiser", stamped after the departure, is valid everywhere; Ana drops out.
    await info(carla, classId).becomeOrganiser();
    await settle(mesh, [bruno, carla]);
    for (const a of [bruno, carla]) expect(info(a, classId).detail.get().organisers).toEqual([carla.memberId]);
    // Bruno's own self-add now is invalid (Carla is an organiser and has not left).
    await info(bruno, classId).becomeOrganiser();
    await settle(mesh, [bruno, carla]);
    for (const a of [bruno, carla]) expect(info(a, classId).detail.get().organisers).toEqual([carla.memberId]);
  });

  it('consent lines are signed, shared, and revocable by their author', async () => {
    const mesh = newMesh();
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    const ref = await info(ana, classId).consent.record({
      kind: 'record', scope: 'class', textId: 'record.dialog.consent.v1', textLang: 'pt-PT', text: 'Tenho autorização para gravar esta aula.', lecturer: 'Prof.ª Marta Reis',
    });
    await settle(mesh, [ana, bruno]);
    expect(info(bruno, classId).consent.active().map((c) => c.id)).toEqual([ref.id]);
    await expect(Promise.resolve(info(bruno, classId).consent.revoke(ref))).resolves.toBeUndefined();
    await settle(mesh, [ana, bruno]);
    expect(info(ana, classId).consent.active()).toHaveLength(1);    // Bruno is neither the author nor an organiser
    await info(ana, classId).consent.revoke(ref);
    await settle(mesh, [ana, bruno]);
    expect(info(bruno, classId).consent.active()).toHaveLength(0);
  });

  it('presence: written on change, heartbeat while active, stale after 3 minutes of silence', async () => {
    const mesh = newMesh();
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    const p = (a: typeof ana) => a.services.forClass(classId).presence as PresenceServiceImpl;
    await p(bruno).setActivity({ editing: { path: 'Notas/Resumo.md', since: new Date(mesh.clock('bruno').now()).toISOString() } });
    await settle(mesh, [ana, bruno], 2);
    expect(p(ana).others.get()[bruno.deviceId]).toMatchObject({ stale: false, activity: { editing: { path: 'Notas/Resumo.md' } } });
    for (let i = 0; i < 6; i++) {
      await mesh.advance(60_000);
      await settle(mesh, [ana, bruno], 1);
    }
    expect(p(ana).others.get()[bruno.deviceId]?.stale).toBe(false);   // heartbeats every 60 s
    mesh.crash('bruno');
    bruno.services.dispose();
    await mesh.advance(200_000);
    await settle(mesh, [ana], 1);
    expect(p(ana).others.get()[bruno.deviceId]?.stale).toBe(true);
  });

  it('folder offers, recently deleted and restore, remote mass deletion, settings and diagnostics', async () => {
    const mesh = newMesh();
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const classId = await sharedClass(mesh, ana, [bruno]);
    const store = (a: typeof ana) => a.services.forClass(classId).store;
    await store(ana).writeBytes('Documentos/Resumo.txt', enc('resumo'), { own: false });
    await settle(mesh, [ana, bruno]);
    await store(ana).remove('Documentos/Resumo.txt');
    await settle(mesh, [ana, bruno]);
    const versions = await bruno.services.sync.versions(classId);
    expect(versions.map((v) => v.path)).toEqual(['Documentos/Resumo.txt']);
    await bruno.services.sync.restore(classId, [{ path: versions[0]!.path, versionTime: versions[0]!.versionTime }]);
    await settle(mesh, [ana, bruno]);
    expect(mesh.files('ana', classId).has('Documentos/Resumo.txt')).toBe(true);

    // Ana deletes 25 files at once: Bruno's app is warned and can restore them.
    for (let i = 0; i < 25; i++) await store(ana).writeBytes(`Documentos/f${i}.txt`, enc(`f${i}`), { own: false });
    await settle(mesh, [ana, bruno]);
    for (let i = 0; i < 25; i++) await store(ana).remove(`Documentos/f${i}.txt`);
    await settle(mesh, [ana, bruno]);
    const warn = bruno.services.sync.state.get().massDeleteRemote;
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ classId, count: 25, byName: 'Ana Ribeiro' });
    expect((bruno.services.notifications as NotificationServiceImpl).recent().map((n) => n.key)).toContain('notify.massDelete');
    await bruno.services.sync.resolveRemoteMassDelete(classId, warn[0]!.by, 'restore');
    await settle(mesh, [ana, bruno]);
    expect([...mesh.files('ana', classId).keys()].filter((p) => /^Documentos\/f\d+\.txt$/.test(p))).toHaveLength(25);

    await bruno.services.sync.applySettings({ maxSendKbps: 500 });
    expect(bruno.ctx.prefs.get('sync.maxSendKbps')).toBe('500');
    const text = await bruno.services.sync.diagnosticsText();
    expect(text).toContain('Sharing: running');
    expect(text).not.toMatch(/[A-Z2-7]{7}-[A-Z2-7]{7}-/);
  });
});
