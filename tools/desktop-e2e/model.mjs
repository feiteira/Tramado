// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Suite `model` (plan §8.1 wave-3 brief; closes the R-SPEECH gap "small never ran", §15 item 18): the real on-demand
// download of the "small" whisper model (~190 MB) from Hugging Face through Settings › Transcription, into the run's
// data folder. The app is closed in the middle of it (the window close a person makes) and the download resumes from
// its .part after a restart; the file's SHA-256 is checked here too; a Portuguese recording is transcribed with it on
// this computer; then the model is removed through the same screen. The app process reaches only Hugging Face (and its
// CDN) meanwhile; WebKit nothing.
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, assert, say, sleep } from './lib.mjs';
import { allowHost, allowListed, createClass, onboard, waitFor } from './steps.mjs';
import { classDir, lecturesOnDisk, openTab } from './sync.mjs';

const SMALL = { file: 'ggml-small-q5_1.bin', size: 190085487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb' };
const URL_ = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin';
const VAD = 'ggml-silero-v5.1.2.bin';

const sha256 = (file) =>
  new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });

async function openModels(a) {
  await a.click('nav-settings');
  await a.click('settings-nav-transcription');
  await a.present('speech-model-small', 30_000);
}
const rowState = (a) => a.attr('speech-model-small', 'data-state');

export default async function model(h) {
  const a = h.app('ana');
  const models = join(a.dir, 'data/models');
  mkdirSync(models, { recursive: true });
  // The voice-activity model ships inside the bundle (a resource); a bare cargo build has none beside it.
  const vad = [join(ROOT, 'desktop/src-tauri/resources/speech', VAD)].find(existsSync);
  assert(vad, `no ${VAD} in desktop/src-tauri/resources/speech (node tools/fetch-speech-assets.mjs)`);
  copyFileSync(vad, join(models, VAD));
  const part = join(models, `${SMALL.file}.part`);
  const dest = join(models, SMALL.file);
  // The CDN host Hugging Face redirects to (allowed for the app process, critique C38).
  try {
    const r = await fetch(URL_, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const loc = r.headers.get('location');
    if (loc) allowHost(new URL(loc, URL_).host);
  } catch {}
  let classId;
  const external = new Map();
  const audit = async () => {
    const s = a.sockets();
    assert(!s.webkit.some((x) => x.external), `WebKit holds external sockets: ${JSON.stringify(s.webkit.filter((x) => x.external))}`);
    for (const x of s.app.filter((x) => x.external && x.remoteIp)) if (!external.has(x.remoteIp)) external.set(x.remoteIp, await allowListed(x.remoteIp));
  };

  await h.step('start, onboarding, a class; Settings › Transcription lists "small" as not downloaded', async () => {
    await a.start();
    await onboard(a, { name: 'Ana Ribeiro', then: 'create' });
    classId = await createClass(a, { name: 'Direito Constitucional', share: false, fromDialog: true });
    await openModels(a);
    const st = await rowState(a);
    assert(st === 'absent', `small is ${st}`);
    return `models folder: ${models}`;
  });

  let partBytes = 0;
  await h.step('download "small" from Hugging Face; close the app in the middle of it', async () => {
    await a.click('speech-model-download', { selector: '[data-testid="speech-model-small"] [data-testid="speech-model-download"]' });
    const t0 = Date.now();
    await waitFor('40 MB downloaded', async () => {
      await audit();
      const d = await a.run(`return window.__tramadoE2E.models.downloads.get().small ?? null`);
      return d && d.done > 40e6 ? d : null;
    }, 10 * 60_000, 1000);
    const speed = ((existsSync(part) ? statSync(part).size : 0) / 1e6 / ((Date.now() - t0) / 1000)).toFixed(1);
    await a.quitByClose(60_000);
    assert(/Tramado exiting/.test(a.logText()), 'no exit handlers');
    assert(existsSync(part) && !existsSync(dest), 'the .part is missing after the close');
    partBytes = statSync(part).size;
    return `${(partBytes / 1e6).toFixed(1)} MB in the .part when the app closed (~${speed} MB/s)`;
  });

  let resumedFrom = null;
  await h.step('restart: "small" shows the partial download; Resume continues from the .part; a webview reload re-attaches', async () => {
    await a.start();
    await a.present('rail', 60_000);
    await openModels(a);
    const st = await rowState(a);
    assert(st === 'partial', `small is ${st} after the restart`);
    // The first progress the service sees is the "started" event's resumedFrom.
    await a.js(`window.__e2eFirst = null; const s = window.__tramadoE2E.models.downloads; window.__e2eUnsub = s.subscribe(() => { const v = s.get(); if (window.__e2eFirst === null && v.small) window.__e2eFirst = v.small.done; });`);
    await a.click('speech-model-resume');
    resumedFrom = await a.until('the first progress', 'return window.__e2eFirst', [], 60_000);
    assert(resumedFrom >= partBytes - 1 && resumedFrom > 0, `the download restarted at ${resumedFrom}, the .part held ${partBytes}`);
    // The webview reloads while Rust keeps downloading: the row re-attaches (speech_model_attach, D-7) and moves on.
    await sleep(3000);
    const before = a.logged('webview ready').length;
    await a.js('setTimeout(() => location.reload(), 50); return true');
    await waitFor('"webview ready" again', () => a.logged('webview ready').length > before, 30_000, 250);
    await a.present('rail', 30_000);
    await openModels(a);
    const p1 = await a.until('the download shown again', `const d = window.__tramadoE2E.models.downloads.get().small; return d && d.done > 0 ? d.done : null`, [], 30_000).catch(() => null);
    await sleep(3000);
    const p2 = await a.run(`return window.__tramadoE2E.models.downloads.get().small?.done ?? null`);
    const reattached = p1 !== null && p2 !== null && p2 > p1 ? `re-attached after the reload (${(p1 / 1e6).toFixed(1)} → ${(p2 / 1e6).toFixed(1)} MB)` : `after the reload: ${p1} → ${p2} (${await rowState(a)})`;
    assert(p1 !== null || (await rowState(a)) === 'ready', `the download was not shown again after the reload (row ${await rowState(a)})`);
    const t0 = Date.now();
    await waitFor('the model ready', async () => {
      await audit();
      return (await rowState(a)) === 'ready';
    }, 15 * 60_000, 1000);
    return `resumed at ${(resumedFrom / 1e6).toFixed(1)} MB (the .part held ${(partBytes / 1e6).toFixed(1)} MB); ${reattached}; ready ${((Date.now() - t0) / 1000).toFixed(0)} s later`;
  });

  await h.step('the file on disk: size and SHA-256 of the pinned model; no .part left', async () => {
    assert(!existsSync(part), 'a .part is left');
    assert(statSync(dest).size === SMALL.size, `size ${statSync(dest).size}`);
    const got = await sha256(dest);
    assert(got === SMALL.sha256, `SHA-256 ${got}`);
    const bad = [...external].filter(([, host]) => !host);
    assert(!bad.length, `the app reached hosts beyond the allow-list: ${bad.map(([ip]) => ip).join(', ')}`);
    return `${SMALL.size} bytes, SHA-256 ${got.slice(0, 16)}…; app connections: ${[...external].map(([ip, host]) => `${ip} (${host})`).join(', ') || 'none seen'}; WebKit: none`;
  });

  await h.step('transcribe a Portuguese recording with "small" on this computer', async () => {
    await a.js(`document.querySelector('[data-testid="speech-model-small"] input[type="radio"]').click()`);
    await a.until('small active', `return document.querySelector('[data-testid="speech-model-small"]').classList.contains('model-row--active')`, [], 15_000);
    const audio = join(a.dir, 'inbox', 'Aula 5.webm');
    mkdirSync(join(a.dir, 'inbox'), { recursive: true });
    copyFileSync(join(ROOT, 'app/test-fixtures/tramado/audio/speech-pt.webm'), audio);
    await openTab(a, classId, 'lectures');
    a.queueDialogs({ paths: [audio] });
    await a.click('class-add');
    await a.click('class-add-recording');
    await a.present('import-dialog', 15_000);
    await a.click('import-choose');
    await a.until('the file', `const f = document.querySelector('[data-testid="import-file"]'); return f && f.textContent.trim()`, [], 15_000);
    // The lecture's language: European Portuguese (the class was made in English).
    const picked = await a.js(`const el = document.querySelector('[data-testid="import-language"]');
      if (![...el.options].some((o) => o.value === 'pt-PT')) return [...el.options].map((o) => o.value);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, 'pt-PT'); el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;`);
    assert(picked === 'pt-PT', `cannot choose pt-PT: ${JSON.stringify(picked)}`);
    await a.click('import-confirm');
    await a.gone('import-dialog', 30_000);
    const dir = await classDir(a, classId);
    const t0 = Date.now();
    const lecture = await waitFor('the transcript', () => {
      const l = lecturesOnDisk(dir);
      return l.length === 1 && l[0].transcripts.length ? l[0] : null;
    }, 10 * 60_000, 1000);
    const t = JSON.parse(readFileSync(join(lecture.dir, 'transcript.json'), 'utf8'));
    const words = (t.segments ?? []).map((s) => s.text).join(' ').trim();
    assert(t.engine?.model === 'ggml-small-q5_1', `transcribed with ${t.engine?.model}`);
    assert(/^pt/.test(t.language ?? ''), `transcript language ${t.language}`);
    assert(/artigo|direitos|proporcionalidade|constitucional/i.test(words), `unexpected words: ${words.slice(0, 200)}`);
    return `${((Date.now() - t0) / 1000).toFixed(0)} s with ${t.engine.model} (language ${t.language ?? t.lang ?? '?'}): "${words.slice(0, 160)}"`;
  });

  await h.step('remove "small" through Settings › Transcription; the file is gone', async () => {
    await openModels(a);
    // The active model cannot be the one removed: back to the default first.
    await a.js(`const r = document.querySelector('[data-testid="speech-model-turbo"] input[type="radio"]'); if (r && !r.disabled) r.click();`);
    await a.click('speech-model-remove', { selector: '[data-testid="speech-model-small"] [data-testid="speech-model-remove"]' });
    await a.present('confirm-dialog', 10_000);
    await a.click('confirm-ok');
    await waitFor('the file removed', () => !existsSync(dest), 30_000);
    await a.until('the row back to "Download"', `return document.querySelector('[data-testid="speech-model-small"]')?.dataset.state === 'absent'`, [], 15_000);
    await a.quitByClose();
  });
  say(`  ${external.size} external address(es) seen from the app process`);
}
