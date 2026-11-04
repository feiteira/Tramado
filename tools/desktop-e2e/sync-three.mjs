// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Suite `sync-three` (plan §8.1 task 3; sync spec §24 "Three-instance e2e for the unverified flows"): A organises a
// shared class that B and C join, and a study group that only C joins. C forges B's member file and deletes A's: the
// owners heal them (§12.3) and every copy ends equal to the owner's mirror. A removes C from the class (soft ban,
// §18.1): on A, which still shares the study group with C, C's device leaves the class's folder and gets an
// `ignoredFolders` entry for it; on B, where every folder C was in bans C, C becomes a device-wide "tramado-ban"
// ignore. What C writes in the class afterwards reaches nobody, while the study group still syncs between A and C
// (§9.2: a ban in one class never ignores the device in another). B leaves while the others are offline (§17): the
// class leaves B's screens at once, and B finishes leaving only when A is back and holds the deletion.
// Rotation and pairing are v1.1 (§18.2, §19).
import { readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, say, sleep } from './lib.mjs';
import { createClass, onboard, pageErrors, waitFor } from './steps.mjs';
import { classDir, dismissFirstShare, inviteCode, joinWithCode, openTab, seesChat, sendChat } from './sync.mjs';

/** Folders (with their devices) and devices (with their ignored folders) of an instance's Syncthing config.xml. */
export function syncthingConfig(app) {
  let xml = '';
  try {
    xml = readFileSync(join(app.dir, 'data/syncthing/config.xml'), 'utf8');
  } catch {
    return { folders: {}, devices: {}, remoteIgnored: [] };
  }
  const folders = {};
  for (const m of xml.matchAll(/<folder id="([^"]+)"[^>]*>([\s\S]*?)<\/folder>/g)) {
    folders[m[1]] = [...m[2].matchAll(/<device id="([^"]+)"/g)].map((d) => d[1]);
  }
  const devices = {};
  for (const m of xml.matchAll(/<device id="([^"]+)"([^>]*)>([\s\S]*?)<\/device>/g)) {
    if (/<folder /.test(m[3])) continue;
    const name = /name="([^"]*)"/.exec(m[2])?.[1] ?? '';
    devices[m[1]] = { name, ignoredFolders: [...m[3].matchAll(/<ignoredFolder [^>]*id="([^"]+)"/g)].map((f) => f[1]) };
  }
  const remoteIgnored = [...xml.matchAll(/<remoteIgnoredDevice [^>]*id="([^"]+)"/g)].map((r) => r[1]);
  return { folders, devices, remoteIgnored };
}

export default async function syncThree(h) {
  const tag = Math.random().toString(36).slice(2, 7);
  const a = h.app('ana');
  const b = h.app('bruno');
  const c = h.app('carla');
  const className = `Finanças Públicas ${tag}`;
  let cls;
  let group;
  const id = {};
  const dirs = {};
  const member = {};

  await h.step('A, B and C start; A creates a shared class; B and C join with the code', async () => {
    await Promise.all([a.start(), b.start(), c.start()]);
    await onboard(a, { name: 'Ana Ribeiro', then: 'create' });
    await onboard(b, { name: 'Bruno Costa', then: 'join' });
    await onboard(c, { name: 'Carla Mendes', then: 'join' });
    cls = await createClass(a, { name: className, share: true, fromDialog: true });
    const code = await inviteCode(a);
    assert((await joinWithCode(b, code)) === cls, 'B joined another class');
    assert((await joinWithCode(c, code)) === cls, 'C joined another class');
    // The study group: A and C only.
    group = await createClass(a, { name: `Grupo de estudo ${tag}`, share: true });
    const groupCode = await inviteCode(a);
    assert((await joinWithCode(c, groupCode, { fromRail: true })) === group, 'C joined another group');
    for (const x of [a, b, c]) {
      const ident = await x.call('sync_identity');
      id[x.name] = ident;
      dirs[x.name] = await classDir(x, cls);
      member[x.name] = await x.run('return window.__tramadoE2E.ctx.identity.get().memberId');
    }
    await a.untilRun('A sees 3 members', `return window.__tramadoE2E.library.classes.get().find((c) => c.id === arguments[0])?.memberCount >= 3;`, [cls], 180_000);
    await sendChat(a, cls, `Bem-vindos ${tag}`);
    await seesChat(b, cls, `Bem-vindos ${tag}`);
    await seesChat(c, cls, `Bem-vindos ${tag}`);
    return `class ${cls}, study group ${group}; devices A ${id.ana.shortId}, B ${id.bruno.shortId}, C ${id.carla.shortId}`;
  });

  const memberFile = (x) => `.tramado/members/${id[x].deviceId}.json`;
  const mirror = (x, path) => join(x.dir, 'data/private', cls, 'mirror', path);
  const bytesAt = (x, owner) => {
    try {
      return readFileSync(join(dirs[x.name], memberFile(owner)), 'utf8');
    } catch {
      return null;
    }
  };

  await h.step("forged write: C rewrites B's member file; B heals it and every copy returns to B's version", async () => {
    const path = memberFile('bruno');
    const original = readFileSync(mirror(b, path), 'utf8');
    assert(bytesAt(a, 'bruno') === original, "A's copy of B's member file differs from B's mirror before the test");
    const forged = original.replace('Bruno Costa', `Bruno Forjado ${tag}`);
    assert(forged !== original, "B's member file does not carry B's name");
    const heals = () => b.logText().split('\n').filter((l) => /changed one of this device's files/.test(l)).length;
    const before = heals();
    // C writes it the way another program would (not through the app), then asks its Syncthing to scan.
    writeFileSync(join(dirs.carla, path), forged);
    await c.call('sync_scan', { classId: cls, path });
    const t0 = Date.now();
    await waitFor("B's heal (its log)", () => heals() > before, 120_000, 250);
    const healedAt = Date.now() - t0;
    await waitFor("B's version back on A, B and C", () => [a, b, c].every((x) => bytesAt(x, 'bruno') === original), 120_000, 250);
    const line = b.logText().split('\n').filter((l) => /changed one of this device's files/.test(l)).at(-1) ?? '';
    const healed = line.replace(/^\S+ \S+ /, '');
    // A never showed the forged name.
    const shown = await a.run(`const m = window.__tramadoE2E.forClass(arguments[0]).info.model?.get?.(); return m ? JSON.stringify(m).includes(arguments[1]) : null;`, cls, `Bruno Forjado ${tag}`).catch(() => null);
    assert(shown !== true, "A's class model carries the forged name");
    return `B healed it ${(healedAt / 1000).toFixed(1)} s after C's scan, equal everywhere at ${((Date.now() - t0) / 1000).toFixed(1)} s; B logged: ${healed}`;
  });

  await h.step("forged deletion: C deletes A's member file; A restores it on every computer", async () => {
    const path = memberFile('ana');
    const original = readFileSync(mirror(a, path), 'utf8');
    unlinkSync(join(dirs.carla, path));
    await c.call('sync_scan', { classId: cls, path });
    const t0 = Date.now();
    await waitFor("A's member file back on A, B and C", () => [a, b, c].every((x) => bytesAt(x, 'ana') === original), 120_000, 500);
    const members = await b.untilRun('B still counts 3 members', `return window.__tramadoE2E.library.classes.get().find((c) => c.id === arguments[0])?.memberCount;`, [cls], 30_000);
    assert(members >= 3, `B counts ${members} members after the forged deletion`);
    return `restored everywhere in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  });

  await h.step('soft ban: A removes C; on A and B, C leaves the folder and gets an ignoredFolders entry', async () => {
    await openTab(a, cls, 'members');
    const sel = `[data-testid="member-item"][data-member-id="${member.carla}"] [data-testid="member-menu"]`;
    await a.click('member-menu', { selector: sel });
    await a.click('member-remove');
    await a.present('member-remove-dialog', 10_000);
    await a.click('member-remove-confirm');
    await a.gone('member-remove-dialog', 30_000);
    const C = id.carla.deviceId;
    const t0 = Date.now();
    const state = await waitFor('the ban applied on A and B', () => {
      const ca = syncthingConfig(a);
      const cb = syncthingConfig(b);
      // A shares the study group with C: C stays configured, out of the class's folder, with an ignoredFolders entry.
      const okA = ca.folders[cls] && !ca.folders[cls].includes(C) && ca.devices[C]?.ignoredFolders.includes(cls) && ca.folders[group]?.includes(C);
      // B shares nothing else with C: a device-wide ignore.
      const okB = cb.folders[cls] && !cb.folders[cls].includes(C) && !cb.devices[C] && cb.remoteIgnored.includes(C);
      return okA && okB ? { ca, cb } : null;
    }, 120_000, 500);
    return `in ${((Date.now() - t0) / 1000).toFixed(1)} s. A: class folder devices ${state.ca.folders[cls].length}, C's ignoredFolders [${state.ca.devices[C].ignoredFolders}], C still in the study group's folder. B: C device-wide ignored ("tramado-ban"), class folder devices ${state.cb.folders[cls].length}`;
  });

  await h.step('after the ban, what C writes reaches neither A nor B; A and B still sync', async () => {
    const leak = `Depois da remoção ${tag}.md`;
    writeFileSync(join(dirs.carla, leak), `# depois ${tag}\n`);
    await c.call('sync_scan', { classId: cls }).catch(() => null);
    const ok = `Ainda aqui ${tag}`;
    await sendChat(a, cls, ok);
    await seesChat(b, cls, ok);
    const study = `Estudamos amanhã? ${tag}`;
    await sendChat(c, group, study);
    await seesChat(a, group, study);
    await sleep(8000);
    for (const x of [a, b]) {
      let found = false;
      try {
        readFileSync(join(dirs[x.name], leak));
        found = true;
      } catch {}
      assert(!found, `C's file reached ${x.name} after the ban`);
    }
    return "A ↔ B chat crossed in the class; C's new file stayed on C; C's line reached A in the study group";
  });

  await h.step('C quits; no page error on A, B or C since they started', async () => {
    const errors = [];
    for (const x of [a, b, c]) errors.push(...(await pageErrors(x)).map((e) => `${x.name}: ${e}`));
    await c.quit();
    assert(!errors.length, `page errors:\n      ${errors.join('\n      ')}`);
  });

  await h.step('leaving while the others are offline: A quits, B leaves (the class leaves B at once, B keeps "leaving")', async () => {
    await a.quit();
    await openTab(b, cls, 'lectures');
    await b.click('class-more');
    await b.click('class-open-settings');
    await b.present('class-settings', 15_000);
    await b.click('class-leave');
    await b.present('confirm-dialog', 15_000);
    await b.click('confirm-ok');
    await b.gone('confirm-dialog', 30_000);
    await b.until('the class gone from the rail', `return !document.querySelector('[data-testid="rail-class"][data-class-id="' + arguments[0] + '"]')`, [cls], 30_000);
    await sleep(5000);
    const reg = await b.call('classes_list');
    const entry = reg.find((e) => e.classId === cls);
    assert(entry && entry.leaving, `B's registry entry while nobody is online: ${JSON.stringify(entry)}`);
    const cfg = syncthingConfig(b);
    assert(cfg.folders[cls], 'B removed the folder before anybody received the departure');
    assert(bytesAt(b, 'bruno') === null, "B's member file is still in B's folder");
    return `B: leaving since ${entry.leaving.since}; folder still configured; member file deleted locally`;
  });

  await h.step('A comes back: it receives the departure, B finishes leaving (folder removed, a local fork), A drops B', async () => {
    await a.start();
    await a.present('rail', 90_000);
    const t0 = Date.now();
    const done = await waitFor('B to finish leaving', async () => {
      const cfg = syncthingConfig(b);
      const reg = await b.call('classes_list');
      return !cfg.folders[cls] && !reg.some((e) => e.classId === cls && e.leaving) ? { reg, cfg } : null;
    }, 180_000, 1000);
    // keepLocal: the app forks the copy into a new, local class (folder spec §8.1) once Rust says it left.
    const fork = await waitFor("B's local fork", async () => (await b.call('classes_list')).find((e) => (e.aliases ?? []).includes(cls)), 60_000, 1000).catch(async (e) => {
      throw new Error(`${e.message}; B's registry: ${JSON.stringify(await b.call('classes_list'))}`);
    });
    assert(!fork.shared, `the fork is shared: ${JSON.stringify(fork)}`);
    await b.present('rail', 10_000);
    await b.until("the fork in B's rail", `return !!document.querySelector('[data-testid="rail-class"][data-class-id="' + arguments[0] + '"]')`, [fork.classId], 30_000);
    assert(bytesAt(a, 'bruno') === null, "B's member file is still on A");
    await a.untilRun('A counts B gone', `return window.__tramadoE2E.library.classes.get().find((c) => c.id === arguments[0])?.memberCount <= 2;`, [cls], 120_000);
    const devs = await waitFor("B's device off A's folder", () => {
      const f = syncthingConfig(a).folders[cls];
      return f && !f.includes(id.bruno.deviceId) ? f : null;
    }, 120_000, 1000);
    return `B finished in ${((Date.now() - t0) / 1000).toFixed(1)} s; B kept a local fork ${fork.classId} (in its rail); A's folder devices: ${devs.length}`;
  });

  await h.step('A and B quit', async () => {
    await a.quit();
    await b.quit();
  });
  say(`  (tag ${tag})`);
}
