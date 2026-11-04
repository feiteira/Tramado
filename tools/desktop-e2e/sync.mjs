// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Suites `sync-two` and `sync-three` (plan §8.1 task 3): separate TRAMADO_DATA_DIRs, each app with its own Syncthing
// on loopback (TRAMADO_DATA_DIR keeps Syncthing on 127.0.0.1 with discovery and relays off), never the person's own.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, assert, say, sleep } from './lib.mjs';
import { createClass, importDocuments, onboard, waitFor } from './steps.mjs';

const TURBO = 'ggml-large-v3-turbo-q5_0.bin';
const VAD = 'ggml-silero-v5.1.2.bin';

/** A models folder for the run: links to an existing turbo model (never downloaded by these suites). */
export function speechDir(h) {
  const from = [process.env.TRAMADO_E2E_SPEECH_DIR, process.env.TRAMADO_SPEECH_FROM, join(ROOT, '.tramado-dev/models')].find((d) => d && existsSync(join(d, TURBO)));
  if (!from) return null;
  const dir = join(h.work, 'models');
  mkdirSync(dir, { recursive: true });
  for (const f of [TURBO, VAD]) {
    const src = existsSync(join(from, f)) ? join(from, f) : join(ROOT, 'desktop/src-tauri/resources/speech', f);
    if (existsSync(src) && !existsSync(join(dir, f))) symlinkSync(src, join(dir, f));
  }
  return dir;
}

export async function openTab(a, classId, tab) {
  const on = await a.js(`const s = document.querySelector('[data-testid="screen-class"]'); return s ? s.dataset.classId : null`);
  if (on !== classId) await a.click('rail-class', { selector: `[data-testid="rail-class"][data-class-id="${classId}"]` });
  await a.until(`the class ${classId}`, `const s = document.querySelector('[data-testid="screen-class"]'); return s && s.dataset.classId === arguments[0]`, [classId], 30_000);
  await a.click(`class-tabs-${tab}`);
  await a.until(`the ${tab} tab`, `const s = document.querySelector('[data-testid="screen-class"]'); return s && s.dataset.tab === arguments[0]`, [tab], 15_000);
}

/** The organiser's invite code, from the Invite dialog. */
export async function inviteCode(a) {
  await a.click('class-invite');
  await a.present('invite-dialog', 15_000);
  const code = await a.until('the invite code (Syncthing ready)', `const n = document.querySelector('[data-testid="invite-code"]'); const i = n && (n.matches('input, textarea') ? n : n.querySelector('input, textarea')); return i && i.value ? i.value : null`, [], 120_000);
  await a.click('invite-done');
  await a.gone('invite-dialog', 10_000);
  return code;
}

/** Join with a code through the Join dialog (already open, or from the rail with fromRail). Returns the class id. */
export async function joinWithCode(b, code, { fromRail = false } = {}) {
  const before = await b.run('return window.__tramadoE2E.library.classes.get().map((c) => c.id)');
  if (fromRail) await b.click('rail-join');
  await b.present('join-dialog', 30_000);
  await b.fill('join-code', code);
  await b.click('join-continue');
  await b.present('join-step-preview', 30_000);
  await b.click('join-rules');
  await b.click('join-submit');
  await b.present('join-step-done', 180_000);
  const classId = await b.untilRun('the joined class', `const c = window.__tramadoE2E.library.classes.get().find((x) => !arguments[0].includes(x.id)); return c ? c.id : null;`, [before], 30_000);
  await b.click('join-open');
  await b.present('screen-class', 30_000);
  await dismissFirstShare(b);
  return classId;
}

/** The first shared class asks about the tray and autostart (UX §3.10.1): keep the defaults. */
export async function dismissFirstShare(a, wait = 3000) {
  const end = Date.now() + wait;
  while (Date.now() < end) {
    if (await a.exists('first-share-dialog')) {
      await a.click('first-share-done');
      await a.gone('first-share-dialog', 15_000);
      return true;
    }
    await sleep(250);
  }
  return false;
}

/** Sends a chat line in the class's Chat tab. */
export async function sendChat(a, classId, text) {
  await openTab(a, classId, 'chat');
  await a.present('chat-input', 20_000);
  await a.type('chat-input', text);
  await a.keys(''); // Enter
  await a.until('the line in the list', `return [...document.querySelectorAll('[data-testid="chat-message"]')].some((m) => m.textContent.includes(arguments[0]))`, [text], 20_000);
}

export async function seesChat(b, classId, text, timeout = 120_000) {
  await openTab(b, classId, 'chat');
  return b.until(`"${text}" in ${b.name}'s chat`, `const m = [...document.querySelectorAll('[data-testid="chat-message"]')].find((m) => m.textContent.includes(arguments[0])); return m ? m.textContent.slice(0, 120) : null`, [text], timeout);
}

/** The class folder of an instance (absolute). */
export async function classDir(a, classId) {
  const e = (await a.call('classes_list')).find((c) => c.classId === classId);
  assert(e, `${a.name}: no class ${classId}`);
  return e.path;
}

/** Lecture folders (a directory with lecture.json) with their transcript files and conflict copies, read from disk. */
export function lecturesOnDisk(dir) {
  const out = [];
  const walk = (d, depth) => {
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (existsSync(join(p, 'lecture.json'))) {
        const files = readdirSync(p);
        out.push({ dir: p, files, transcripts: files.filter((f) => f === 'transcript.json'), conflicts: files.filter((f) => /sync-conflict/.test(f)) });
      } else if (depth < 4) walk(p, depth + 1);
    }
  };
  walk(dir, 0);
  return out;
}

export function claimsOnDisk(dir) {
  const c = join(dir, '.tramado/claims');
  if (!existsSync(c)) return [];
  const out = [];
  for (const f of readdirSync(c, { recursive: true })) {
    if (!String(f).endsWith('.json')) continue;
    try {
      out.push({ file: String(f), ...JSON.parse(readFileSync(join(c, String(f)), 'utf8')) });
    } catch {}
  }
  return out;
}

export default async function sync(h, opts) {
  if (opts.suite === 'sync-three') return (await import('./sync-three.mjs')).default(h, opts);
  const models = speechDir(h);
  const tag = Math.random().toString(36).slice(2, 7);
  const a = h.app('ana', { speechDir: models });
  const b = h.app('bruno', { speechDir: models });
  const inbox = join(h.work, 'inbox');
  mkdirSync(inbox, { recursive: true });
  const pdf = join(inbox, `Sumários ${tag}.pdf`);
  copyFileSync(join(ROOT, 'app/test-fixtures/tramado/docs/law.pdf'), pdf);
  const audio = join(inbox, `Aula de ${tag}.webm`);
  copyFileSync(join(ROOT, 'app/test-fixtures/tramado/audio/speech-en.webm'), audio);
  const className = `Direito Constitucional ${tag}`;
  let classA;
  let classB;
  let code;

  await h.step('A and B start (separate data folders), onboarding', async () => {
    await Promise.all([a.start(), b.start()]);
    await onboard(a, { name: 'Ana Ribeiro', then: 'create' });
    await onboard(b, { name: 'Bruno Costa', then: 'join' });
  });
  await h.step('A creates a shared class; Syncthing starts on loopback; the invite code', async () => {
    classA = await createClass(a, { name: className, share: true, fromDialog: true });
    code = await inviteCode(a);
    const s = a.sockets();
    assert(s.syncthing.length > 0, 'no Syncthing process under A');
    const ext = s.syncthing.filter((x) => x.external);
    assert(!ext.length, `A's Syncthing reaches beyond loopback: ${ext.map((x) => `${x.proto} ${x.local} → ${x.remote}`).join(', ')}`);
    return `${classA}; code ${code.length} characters; Syncthing ${s.syncthing.length} sockets, all loopback`;
  });
  await h.step('B joins with the code; A admits (no "ask before join"); B is in', async () => {
    classB = await joinWithCode(b, code);
    assert(classB === classA, `B joined ${classB}, A shares ${classA}`);
    await a.untilRun('A sees 2 members', `const s = window.__tramadoE2E; return s.library.classes.get().find((c) => c.id === arguments[0])?.memberCount >= 2;`, [classA], 120_000);
  });
  await h.step('a document crosses (A adds a PDF; it arrives at B and is indexed there)', async () => {
    await openTab(a, classA, 'documents');
    await importDocuments(a, [pdf]);
    await openTab(b, classB, 'documents');
    await b.until('the PDF at B', `return [...document.querySelectorAll('[data-testid="doc-item"]')].some((r) => r.textContent.includes(arguments[0]))`, [`Sumários ${tag}`], 180_000);
    const st = await b.untilRun('B indexes it', `const v = await window.__tramadoE2E.search.settled(arguments[0]); return v.docs >= 1 && v.pending === 0 ? v : null;`, [classB], 120_000);
    return `${st.docs} document(s) indexed at B`;
  });
  await h.step('a chat line crosses; A sees ✓ Sent', async () => {
    const line = `Olá turma ${tag}`;
    await sendChat(a, classA, line);
    await seesChat(b, classB, line);
    await a.until('✓ Sent on A', `const m = [...document.querySelectorAll('[data-testid="chat-message"]')].filter((m) => m.textContent.includes(arguments[0])).at(-1); return m && m.querySelector('[data-testid="chat-delivery-sent"]')`, [line], 120_000);
    const back = `Obrigado ${tag}`;
    await sendChat(b, classB, back);
    await seesChat(a, classA, back);
  });
  await h.step('A imports a recording (transcribed here); exactly one transcript reaches both', async () => {
    assert(models, `no ${TURBO} to transcribe with: set TRAMADO_SPEECH_FROM (or TRAMADO_E2E_SPEECH_DIR) to a folder holding it, or fetch it into .tramado-dev/models (node tools/fetch-speech-assets.mjs --model=turbo)`);
    await openTab(a, classA, 'lectures');
    a.queueDialogs({ paths: [audio] });
    await a.click('class-add');
    await a.click('class-add-recording');
    await a.present('import-dialog', 15_000);
    await a.click('import-choose');
    await a.until('the file', `const f = document.querySelector('[data-testid="import-file"]'); return f && f.textContent.trim()`, [], 15_000);
    await a.click('import-permission');
    await a.click('import-confirm');
    await a.gone('import-dialog', 30_000);
    const dirA = await classDir(a, classA);
    const dirB = await classDir(b, classB);
    const t0 = Date.now();
    const done = await waitFor('the transcript on both computers', () => {
      const la = lecturesOnDisk(dirA);
      const lb = lecturesOnDisk(dirB);
      return la.length === 1 && lb.length === 1 && la[0].transcripts.length && lb[0].transcripts.length ? { la, lb } : null;
    }, 6 * 60_000, 1000);
    await sleep(8000); // a second transcript (a duplicate claim) would show up within a few seconds
    const la = lecturesOnDisk(dirA);
    const lb = lecturesOnDisk(dirB);
    assert(la.length === 1 && lb.length === 1, `lectures: A ${la.length}, B ${lb.length}`);
    for (const l of [...la, ...lb]) {
      assert(l.transcripts.length === 1, `transcripts in ${l.dir}: ${l.files.join(', ')}`);
      assert(!l.conflicts.length, `conflict copies in ${l.dir}: ${l.conflicts.join(', ')}`);
    }
    const ta = JSON.parse(readFileSync(join(la[0].dir, 'transcript.json'), 'utf8'));
    const tb = JSON.parse(readFileSync(join(lb[0].dir, 'transcript.json'), 'utf8'));
    assert(JSON.stringify(ta) === JSON.stringify(tb), 'A and B hold different transcripts');
    const words = (ta.segments ?? []).map((s) => s.text).join(' ');
    assert(/separation of powers/i.test(words), `unexpected transcript: ${words.slice(0, 200)}`);
    const claims = claimsOnDisk(dirA).filter((c) => c.kind === 'transcribe' || c.lectureId);
    const ids = { [(await a.call('sync_identity')).deviceId]: 'A', [(await b.call('sync_identity')).deviceId]: 'B' };
    await openTab(b, classB, 'lectures');
    await b.until('the transcript chip at B', `return document.querySelector('[data-testid="lecture-transcript-chip"]')`, [], 60_000).catch(() => null);
    return `in ${((Date.now() - t0) / 1000).toFixed(0)} s by ${ids[ta.writer?.deviceId] ?? ta.writer?.deviceId ?? '?'} (${ta.engine?.model ?? '?'}): "${words.trim().slice(0, 90)}"; ${claims.length} claim file(s): ${claims.map((c) => `${c.file}=${c.state ?? c.status ?? '?'}`).join(', ')}`;
  });
  await h.step('instances stopped one after the other: A quits (its Syncthing too), B sees A leave, then B quits', async () => {
    const syncA = a.tree().syncthing;
    await a.quit();
    assert(!syncA.some((p) => existsSync(`/proc/${p}`)), `A's Syncthing still runs (${syncA.join(', ')})`);
    assert(/Tramado exiting/.test(a.logText()), "A's exit handlers did not run");
    const offline = await b.untilRun('B sees A offline', `const s = window.__tramadoE2E; const c = s.sync.connections.get(); return Object.values(c).length > 0 && Object.values(c).every((x) => !x.connected) ? JSON.stringify(c) : null;`, [], 120_000);
    const syncB = b.tree().syncthing;
    await b.quit();
    assert(!syncB.some((p) => existsSync(`/proc/${p}`)), `B's Syncthing still runs (${syncB.join(', ')})`);
    return `B's view of A after A quit: ${offline.slice(0, 160)}`;
  });
  say(`  (tag ${tag})`);
}
