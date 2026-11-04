// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Suite `hidden` (architecture §4.3 and Q6, plan §8.1 task 4): does a hidden window keep Tramado's webview timers
// honest enough on Linux? A organises a shared class, volunteers to transcribe (a local model, plugged in) and closes
// its window, which hides it (a shared class, "keep sharing in the background"). While A stays hidden for
// --minutes (15 by default), B joins with the code (admission: Rust, plus A's services for the roster) and imports a
// recording that asks a classmate to transcribe it, so A's volunteer delay (sync spec §14.3, a webview timer) starts
// and expires in the hidden window. Nothing touches A's webview meanwhile: A is observed through its files only.
// Reported: B's admission time, the volunteer claim's lateness against its deadline (delay + jitter), A's presence
// heartbeats. A miss fails the suite (the documented fallback then is to move volunteer timers to Rust).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, assert, say, sleep } from './lib.mjs';
import { createClass, onboard, waitFor } from './steps.mjs';
import { claimsOnDisk, classDir, inviteCode, joinWithCode, lecturesOnDisk, openTab, speechDir } from './sync.mjs';

const JITTER_MAX_S = 15;
/** The documented coarse timing of a hidden page: timers may fire up to a minute late (architecture §4.3). */
const GRACE_S = 60;

export default async function hidden(h, opts) {
  const minutes = Number(opts.minutes ?? 15);
  const models = speechDir(h);
  assert(models, 'the volunteer needs a local model: set TRAMADO_SPEECH_FROM to a folder with the turbo model');
  const a = h.app('ana', { speechDir: models });
  const b = h.app('bruno');
  const report = {};
  let cls;
  let code;
  let dirA;

  await h.step('A shares a class and volunteers (local model, plugged in); B is onboarded', async () => {
    await Promise.all([a.start(), b.start()]);
    await onboard(a, { name: 'Ana Ribeiro', then: 'create' });
    await onboard(b, { name: 'Bruno Costa', then: 'join' });
    cls = await createClass(a, { name: 'Teoria Geral do Direito', share: true, fromDialog: true });
    code = await inviteCode(a);
    dirA = await classDir(a, cls);
    const st = await a.run(`const s = window.__tramadoE2E; return { power: (await s.ctx.platform.system.power()).source, models: (await s.ctx.platform.speech.models()).filter((m) => m.state === 'ready').map((m) => m.id + ':' + (m.speedRT ?? 'unmeasured')) }`);
    report.deviceA = (await a.call('sync_identity')).deviceId;
    assert(st.models.length, `A has no ready model: ${JSON.stringify(st)}`);
    report.a = st;
    return JSON.stringify(st);
  });

  let hiddenAt;
  await h.step('A closes its window: hidden, still running (tray), its webview untouched from now on', async () => {
    a.closeWindow();
    await waitFor('the window unmapped', () => !a.isMapped(), 20_000, 250);
    assert(a.pid(), 'A exited instead of hiding');
    hiddenAt = Date.now();
    return `pid ${a.pid()}; ${a.tree().syncthing.length ? 'Syncthing running' : 'no Syncthing?'}`;
  });

  const presence = [];
  const watchPresence = () => {
    const dir = join(dirA, '.tramado/presence');
    try {
      for (const f of readdirSync(dir)) {
        const m = statSync(join(dir, f)).mtimeMs;
        if (!presence.some((p) => p.f === f && p.m === m)) presence.push({ f, m });
      }
    } catch {}
  };
  const settle = Math.min(2, minutes / 4);
  await h.step(`A stays hidden ${settle} min before anything happens (a page hidden for a while is throttled hardest)`, async () => {
    const end = hiddenAt + settle * 60_000;
    while (Date.now() < end) {
      watchPresence();
      await sleep(2000);
    }
  });

  await h.step('B joins with the code while A is hidden (the pending joiner)', async () => {
    const t0 = Date.now();
    const joined = await joinWithCode(b, code);
    assert(joined === cls, 'B joined another class');
    report.joinS = (Date.now() - t0) / 1000;
    const seen = await waitFor("B's member file on A's disk", () => readdirSync(join(dirA, '.tramado/members')).length >= 2, 120_000, 500);
    report.memberOnA = (Date.now() - t0) / 1000;
    return `B was in after ${report.joinS.toFixed(1)} s; B's member file on A's disk after ${report.memberOnA.toFixed(1)} s (${seen})`;
  });

  let arrived;
  await h.step('B imports a recording for a classmate to transcribe; it reaches the hidden A', async () => {
    const audio = join(h.work, 'Aula 3.webm');
    const { copyFileSync } = await import('node:fs');
    copyFileSync(join(ROOT, 'app/test-fixtures/tramado/audio/speech-en.webm'), audio);
    await openTab(b, cls, 'lectures');
    b.queueDialogs({ paths: [audio] });
    await b.click('class-add');
    await b.click('class-add-recording');
    await b.present('import-dialog', 15_000);
    await b.click('import-choose');
    await b.until('the file', `const f = document.querySelector('[data-testid="import-file"]'); return f && f.textContent.trim()`, [], 15_000);
    await b.click('import-permission');
    await b.js(`document.querySelector('[data-testid="import-transcribe"] input[value="classmate"]').click()`);
    await b.click('import-confirm');
    await b.gone('import-dialog', 30_000);
    const l = await waitFor('the lecture and its audio on A', () => {
      const x = lecturesOnDisk(dirA);
      return x.length === 1 && x[0].files.includes('audio.webm') && x[0].files.includes('lecture.json') ? x[0] : null;
    }, 180_000, 500);
    // The audio is complete when its size matches lecture.json.
    const lecture = JSON.parse(readFileSync(join(l.dir, 'lecture.json'), 'utf8'));
    await waitFor('the whole audio', () => statSync(join(l.dir, 'audio.webm')).size === (lecture.audio?.size ?? -1), 120_000, 250);
    arrived = Date.now();
    report.lectureId = lecture.id;
    return `lecture ${lecture.id} complete on A ${((arrived - hiddenAt) / 60000).toFixed(1)} min after hiding`;
  });

  await h.step('the volunteer delay expires in the hidden window: A claims and transcribes', async () => {
    const speed = report.a.models.find((m) => m.startsWith('turbo'))?.split(':')[1];
    const delayS = speed && speed !== 'unmeasured' && Number(speed) >= 1.5 ? 60 : 180;
    const deadline = arrived + (delayS + JITTER_MAX_S) * 1000;
    const claim = await waitFor("A's claim", () => {
      const mine = claimsOnDisk(dirA).filter((c) => c.file.includes(report.lectureId) && c.file.includes(report.deviceA));
      return mine.length ? mine : null;
    }, (delayS + JITTER_MAX_S + GRACE_S + 240) * 1000, 1000);
    const claimedAt = Date.now();
    report.claimLateS = (claimedAt - deadline) / 1000;
    report.claimAfterS = (claimedAt - arrived) / 1000;
    report.delayS = delayS;
    const t = await waitFor('the transcript', () => lecturesOnDisk(dirA)[0]?.transcripts.length, 10 * 60_000, 1000);
    assert(report.claimLateS <= GRACE_S, `the volunteer claim came ${report.claimLateS.toFixed(0)} s after its deadline (delay ${delayS} s + jitter ≤ ${JITTER_MAX_S} s)`);
    return `claimed ${report.claimAfterS.toFixed(0)} s after the audio arrived (delay ${delayS} s + jitter ≤ ${JITTER_MAX_S} s: ${report.claimLateS <= 0 ? 'on time' : `${report.claimLateS.toFixed(0)} s late`}); claim files: ${claim.map((c) => c.file).join(', ')}; transcript ${t ? 'written' : '?'}`;
  });

  await h.step(`A stays hidden until ${minutes} min; its presence heartbeats meanwhile`, async () => {
    const end = hiddenAt + minutes * 60_000;
    while (Date.now() < end) {
      watchPresence();
      await sleep(5000);
    }
    watchPresence();
    // Sync spec §13: a device writes its presence when its activity changes (and every 60 s while it records,
    // transcribes or has a class note open); an idle device writes nothing.
    const mine = presence.filter((p) => p.f.startsWith(report.deviceA) && p.m >= hiddenAt).map((p) => p.m).sort((x, y) => x - y);
    const times = mine.map((m) => `+${((m - hiddenAt) / 1000).toFixed(0)} s`);
    report.presence = { writesByA: mine.length, at: times };
    assert(a.pid(), 'A exited while hidden');
    assert(!a.isMapped(), 'A showed itself');
    return `A wrote its presence ${mine.length} time(s) while hidden (${times.join(', ') || 'never'}): activity changes (transcription started and ended)`;
  });

  await h.step('show A again: its screens are live; B quits; A quits', async () => {
    await a.call('plugin:window|show', { label: 'main' });
    await waitFor('mapped', () => a.isMapped(), 20_000, 250);
    await a.present('rail', 30_000);
    await b.quit();
    await a.quit();
  });
  say(`  Q6 report: ${JSON.stringify(report)}`);
}
