// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Suite `media` (plan §8.1 task 3, critique R3): the media self-test of Settings › About passes in WebKitGTK (the
// 5-minute file seeks to 4:12 within 0.25 s on the path the player uses), and a recording made through a PulseAudio
// null sink (a speech clip played into it, its monitor remapped as a microphone) is saved as a lecture, plays in the
// lecture's player with its duration and is transcribed on this computer. The null sink and the remapped source are
// unloaded at the end; a PulseAudio started here is stopped.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, assert, say, sleep } from './lib.mjs';
import { createClass, onboard, waitFor } from './steps.mjs';
import { classDir, lecturesOnDisk, openTab, speechDir } from './sync.mjs';

const SINK = 'tramado_e2e';
const MIC = 'tramado_e2e_mic';

function pactl(...args) {
  const r = spawnSync('pactl', args, { encoding: 'utf8', timeout: 15_000 });
  if (r.status !== 0) throw new Error(`pactl ${args.join(' ')}: ${r.stderr || r.error?.message}`);
  return r.stdout.trim();
}

/** A null sink and its monitor remapped as an ordinary source (the recorder's picker leaves monitors out). */
async function soundSetup(h) {
  let started = false;
  if (spawnSync('pactl', ['info'], { stdio: 'ignore', timeout: 10_000 }).status !== 0) {
    const r = spawnSync('pulseaudio', ['--start', '--exit-idle-time=-1'], { encoding: 'utf8', timeout: 20_000 });
    assert(r.status === 0, `pulseaudio --start failed: ${r.stderr}`);
    started = true;
  }
  const sink = pactl('load-module', 'module-null-sink', `sink_name=${SINK}`, `sink_properties=device.description=Tramado-e2e`);
  const mic = pactl('load-module', 'module-remap-source', `master=${SINK}.monitor`, `source_name=${MIC}`, `source_properties=device.description=Tramado-e2e-microphone`);
  h.onCleanup(() => {
    for (const m of [mic, sink]) spawnSync('pactl', ['unload-module', m], { stdio: 'ignore', timeout: 10_000 });
    if (started) spawnSync('pulseaudio', ['--kill'], { stdio: 'ignore', timeout: 10_000 });
  });
  return { started, modules: [sink, mic] };
}

export default async function media(h) {
  const models = speechDir(h);
  const sound = await soundSetup(h);
  say(`  PulseAudio: ${sound.started ? 'started here' : 'already running'}; modules ${sound.modules.join(', ')} (${SINK}, ${MIC})`);
  const a = h.app('ana', { speechDir: models });
  const wav = join(h.work, 'speech-en.wav');
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(ROOT, 'app/test-fixtures/tramado/audio/speech-en.webm'), '-ar', '48000', '-ac', '1', wav], { encoding: 'utf8' });
  assert(ff.status === 0, `ffmpeg could not decode the fixture: ${ff.stderr}`);
  let classId;

  await h.step('start, onboarding, a class', async () => {
    await a.start();
    await onboard(a, { name: 'Ana Ribeiro', then: 'create' });
    classId = await createClass(a, { name: 'Direito Constitucional', share: false, fromDialog: true });
    const info = await a.call('app_info');
    return `media via ${info.mediaAudio} (${info.webview})`;
  });

  await h.step('Settings › About: the media self-test passes in WebKitGTK (seek to 4:12 within 0.25 s)', async () => {
    await a.click('nav-settings');
    await a.click('settings-nav-about');
    await a.click('about-media-test');
    const state = await a.until('the result', `const r = document.querySelector('[data-testid="about-media-result"]'); return r ? r.dataset.state + ': ' + r.textContent : null`, [], 60_000);
    assert(state.startsWith('ok'), `the self-test failed: ${state}`);
    // The same check as the shell runs it (TRAMADO_E2E_MEDIA_SELFTEST), with the numbers.
    const r = await a.run(`const info = await window.__TAURI_INTERNALS__.invoke('app_info');
      const res = await fetch(info.mediaBase + '/res/selftest.webm');
      const url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'audio/webm' }));
      const el = new Audio(); el.muted = true; el.preload = 'auto';
      const once = (n) => new Promise((ok, ko) => { el.addEventListener(n, ok, { once: true }); el.addEventListener('error', () => ko(new Error('media error ' + (el.error && el.error.code))), { once: true }); setTimeout(() => ko(new Error('timeout ' + n)), 20000); });
      el.src = url; await once('loadedmetadata'); const duration = el.duration;
      el.currentTime = 252; await once('seeked');
      const out = { duration, currentTime: el.currentTime };
      URL.revokeObjectURL(url);
      return out;`);
    assert(!r.error, r.error);
    assert(Math.abs(r.duration - 300) <= 1 && Math.abs(r.currentTime - 252) <= 0.25, `duration ${r.duration}, landed at ${r.currentTime}`);
    return `${state.split(':')[0]}; duration ${r.duration.toFixed(3)} s, seek to 252 landed at ${r.currentTime.toFixed(3)} s`;
  });

  let recorded = null;
  await h.step('record through the null sink: a speech clip played into it, picked up by the remapped microphone', async () => {
    const devices = await a.call('speech_devices');
    const mic = devices.inputs.find((d) => d.id.includes(MIC) || d.name.includes('Tramado-e2e'));
    assert(mic, `the remapped source is not offered: ${devices.inputs.map((d) => d.name).join(', ')}`);
    await openTab(a, classId, 'lectures');
    await a.click('record-class');
    await a.present('record-dialog', 15_000);
    const options = await a.until('the device list', `const el = document.querySelector('[data-testid="record-device"]'); return el && el.options.length > 0 && !el.disabled ? [...el.options].map((o) => [o.value, o.textContent]) : null`, [], 20_000);
    const pick = options.find(([v, label]) => v.includes(MIC) || label.includes('Tramado-e2e'));
    assert(pick, `the remapped microphone is not in the dialog's list: ${JSON.stringify(options)} (speech_devices: ${JSON.stringify(devices.inputs)})`);
    await a.js(`const el = document.querySelector('[data-testid="record-device"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, arguments[0]); el.dispatchEvent(new Event('change', { bubbles: true }));`, pick[0]);
    assert((await a.js(`return document.querySelector('[data-testid="record-device"]').value`)) === pick[0], 'the device choice did not stick');
    if (await a.exists('record-consent')) await a.click('record-consent');
    await a.click('record-start');
    await a.until('recording', `const d = document.querySelector('[data-testid="record-dock"]'); return d && d.dataset.state === 'recording'`, [], 30_000);
    await sleep(1000);
    const play = spawn('paplay', [`--device=${SINK}`, wav], { stdio: 'ignore' });
    const peaks = [];
    const until = Date.now() + 12_000;
    while (Date.now() < until) {
      peaks.push(await a.js(`const m = document.querySelector('[data-testid="record-meter"]'); return m ? Number(m.getAttribute('aria-valuenow') ?? m.dataset.level ?? -1) : -1`).catch(() => -1));
      await sleep(500);
    }
    await new Promise((r) => (play.exitCode !== null ? r() : play.once('exit', r)));
    await sleep(800);
    await a.click('record-stop');
    await a.present('record-save', 30_000);
    // Transcribe it here (the default when this computer can).
    await a.click('record-save-confirm');
    await a.gone('record-save', 30_000);
    const dir = await classDir(a, classId);
    recorded = await waitFor('the lecture with its audio', () => {
      const l = lecturesOnDisk(dir);
      return l.length === 1 && l[0].files.includes('audio.webm') ? l[0] : null;
    }, 60_000);
    const lecture = JSON.parse(readFileSync(join(recorded.dir, 'lecture.json'), 'utf8'));
    return `level meter while playing: max ${Math.max(...peaks)} (aria-valuenow); lecture ${lecture.id ?? ''}: ${lecture.audio?.durationMs ?? lecture.durationMs ?? '?'} ms, ${lecture.audio?.size ?? '?'} bytes`;
  });

  await h.step("the lecture plays in WebKitGTK: the player's <audio> has its duration and seeks", async () => {
    await a.click('lecture-open', { selector: '[data-testid="lecture-item"] [data-testid="lecture-open"], [data-testid="lecture-item"]' }).catch(() => a.click('lecture-item'));
    await a.present('screen-lecture', 30_000);
    const r = await a.untilRun('the audio element ready', `const el = document.querySelector('[data-testid="screen-lecture"] audio') || document.querySelector('audio');
      if (!el || !el.src) return null;
      if (el.readyState < 1) { await new Promise((ok) => { el.addEventListener('loadedmetadata', ok, { once: true }); setTimeout(ok, 3000); }); }
      if (!(el.duration > 0)) return null;
      const target = Math.min(5, el.duration / 2);
      el.currentTime = target;
      await new Promise((ok) => { el.addEventListener('seeked', ok, { once: true }); setTimeout(ok, 5000); });
      return { src: el.src.slice(0, 5), duration: el.duration, at: el.currentTime, target };`, [], 60_000);
    assert(Math.abs(r.at - r.target) <= 0.25, `seek to ${r.target} landed at ${r.at}`);
    assert(r.duration > 8 && r.duration < 30, `duration ${r.duration}`);
    return `src ${r.src}…, duration ${r.duration.toFixed(2)} s, seek to ${r.target.toFixed(2)} landed at ${r.at.toFixed(2)}`;
  });

  await h.step('the recording is transcribed on this computer: the words of the clip', async () => {
    assert(models, 'no turbo model to transcribe with (TRAMADO_SPEECH_FROM)');
    const t = await waitFor('transcript.json', () => {
      try {
        return JSON.parse(readFileSync(join(recorded.dir, 'transcript.json'), 'utf8'));
      } catch {
        return null;
      }
    }, 5 * 60_000, 1000);
    const words = (t.segments ?? []).map((s) => s.text).join(' ').trim();
    assert(/separation of powers|legislative|executive|judicial/i.test(words), `the transcript misses the clip: ${words.slice(0, 200)}`);
    await a.until('the transcript on screen', `const t = document.querySelector('[data-testid="lecture-transcript"]'); return t && /powers|legislative|judicial/i.test(t.textContent)`, [], 60_000);
    return `"${words.slice(0, 120)}"`;
  });

  await h.step('quit (close the window): exit handlers ran', async () => {
    await a.quitByClose();
    assert(/Tramado exiting/.test(a.logText()), 'no "Tramado exiting"');
  });
}
