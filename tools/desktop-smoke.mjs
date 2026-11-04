#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// desktop-smoke: start the real desktop app (debug build with the frontend embedded) under Xvfb with an isolated
// data folder, wait for the webview to log "webview ready", take a screenshot of the screen, stop the app.
// Plan §3.1 task 8. Linux only (Xvfb, dbus-run-session, ImageMagick `import`).
//
//   npm run build && node tools/desktop-smoke.mjs --out=/tmp/smoke.png
//   pulseaudio --start --exit-idle-time=-1 && pactl load-module module-null-sink && \
//     node tools/desktop-smoke.mjs --media-selftest
//
// Options:
//   --out=<png>         screenshot path (default .tramado-dev/smoke/smoke.png)
//   --media-selftest    also run the media self-test in the webview (critique R3): `/res/selftest.webm` through
//                       tramado-media, seek to 252 s; passes when duration ≈ 300 and |currentTime − 252| ≤ 0.25 on
//                       the path the player uses: the scheme, or (when the element refuses the scheme, as WebKitGTK
//                       does) the Blob-URL fallback of architecture §8. `via` in the report says which.
//   --ipc-check         also call the commands of architecture §6.1–§6.5 from the real webview (through Tauri's IPC,
//                       as the bindings do) and check their answers: class files, private data, cache, media over the
//                       scheme, class:changed, dialogs and confirmations through the e2e answer queue, secrets, AI
//                       refusals, registry operations (create, update, fork, forget)
//   --skip-build        do not build the frontend nor the app (use what is there)
//   --skip-frontend     do not run `npm run build` (the app is still built)
//   --timeout=<s>       how long to wait for "webview ready" (default 30)
//
// Prints a JSON report ({ ok, png, webviewReady, mediaSelftest?, logTail }) and exits 0 when everything passed.
// The app runs with TRAMADO_DATA_DIR=.tramado-dev/smoke (wiped first), TRAMADO_E2E=1 and the fetched Syncthing
// sidecar; nothing touches the developer's own Tramado data, keychain or autostart.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const opts = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (!m) {
    console.error(`desktop-smoke: unexpected argument ${a}`);
    process.exit(2);
  }
  opts[m[1]] = m[2] ?? 'true';
}
const DATA = resolve(ROOT, '.tramado-dev/smoke');
const LOG = resolve(DATA, 'data/logs/app.log');
const OUT = resolve(opts.out ?? resolve(DATA, 'smoke.png'));
const TIMEOUT_S = Number(opts.timeout) || 30;
const MEDIA = opts['media-selftest'] === 'true';
const IPC = opts['ipc-check'] === 'true';
const BIN = resolve(ROOT, 'target/debug/tramado-desktop');
const TRIPLE = 'x86_64-unknown-linux-gnu';
const SIDECAR = resolve(ROOT, `desktop/src-tauri/binaries/tramado-syncthing-${process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : TRIPLE}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) {
    console.error(`desktop-smoke: ${cmd} ${args.join(' ')} failed (${r.status ?? r.signal})`);
    process.exit(1);
  }
}

function logText() {
  try {
    return readFileSync(LOG, 'utf8');
  } catch {
    return '';
  }
}

/** The data object of the last `<message>` line, if any. */
function logged(text, message) {
  const marker = ` INFO ${message} `;
  const lines = text.split('\n').filter((l) => l.includes(marker));
  if (lines.length === 0) return null;
  const json = lines.at(-1).slice(lines.at(-1).indexOf(marker) + marker.length);
  try {
    return JSON.parse(json);
  } catch {
    return { ok: false, error: `unreadable: ${json}` };
  }
}
const selftestResult = (text) => logged(text, 'media selftest');

// The IPC check, run in the webview by the app (TRAMADO_E2E_EVAL). Every step records {step, ok, detail}.
const IPC_SCRIPT = String.raw`(async () => {
  const T = window.__TAURI_INTERNALS__;
  const call = (cmd, args, headers) => T.invoke(cmd, args, headers ? { headers } : undefined);
  const enc = encodeURIComponent;
  const steps = [];
  const step = async (name, fn) => {
    try {
      const detail = await fn();
      steps.push({ step: name, ok: true, ...(detail === undefined ? {} : { detail }) });
    } catch (e) {
      steps.push({ step: name, ok: false, error: e && e.code ? e.code + ': ' + e.message : String(e) });
    }
  };
  const must = (cond, what) => { if (!cond) throw new Error('expected ' + what); };
  const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e && e.code ? e.code : String(e); } };
  const bytes = (s) => new TextEncoder().encode(s);
  const text = (b) => new TextDecoder().decode(new Uint8Array(b));
  const TEXT = { title: 'T', message: 'Open {host}?', confirm: 'Yes', cancel: 'No' };
  const C = 'tramado-mde5jfv46prdf2fjxvmbjr4242';
  const C2 = 'tramado-wp4vuizadsrm5cjkgpv2ewpwuv';
  const changes = [];
  let info;
  await step('app_info', async () => { info = await call('app_info'); must(info.devIsolated && info.e2e, 'dev isolated e2e'); must(info.mediaBase.startsWith('tramado-media://') || info.mediaBase.startsWith('http://tramado-media'), 'mediaBase'); return { webview: info.webview, mediaAudio: info.mediaAudio }; });
  await step('listen class:changed', async () => { await call('plugin:event|listen', { event: 'class:changed', target: { kind: 'Any' }, handler: T.transformCallback((e) => changes.push(e.payload)) }); });
  await step('app_take_pending_links', async () => must(Array.isArray(await call('app_take_pending_links')), 'array'));
  await step('person_init', async () => { const p = await call('person_init'); must(/^[a-z2-7]{26}$/.test(p.memberId) && p.pub.length === 43, 'person'); const again = await call('person_init'); must(again.memberId === p.memberId, 'same person'); });
  await step('person_prove without a device identity', async () => must((await code(call('person_prove', { classId: C }))) === 'SYNC_UNAVAILABLE', 'SYNC_UNAVAILABLE'));
  await step('secrets', async () => {
    const st = await call('secret_status', { name: 'openrouter' }); must(!st.set && st.store === 'file', 'unset, file store');
    const set = await call('secret_set', { name: 'openrouter', value: 'fake-smoke-key-1234' }); must(set.set && set.last4 === '1234', 'last4');
    await call('secret_clear', { name: 'openrouter' });
    must((await code(call('secret_set', { name: 'person', value: 'x' }))) === 'INVALID', 'person refused');
  });
  await step('ai refusals and settings', async () => {
    const channel = '__CHANNEL__:' + T.transformCallback(() => undefined);
    const req = { requestId: 'r1', base: { type: 'openrouter' }, method: 'POST', path: 'chat/completions', body: { model: 'm' }, stream: true };
    must((await code(call('ai_send', { request: req, onEvent: channel }))) === 'AI_NO_KEY', 'AI_NO_KEY');
    must((await code(call('ai_send', { request: { ...req, path: 'audio/transcriptions' }, onEvent: channel }))) === 'INVALID', 'audio path refused');
    must((await call('ai_hosts')).length === 0, 'no hosts');
    must((await call('ai_privacy_get')) === 'no-training', 'default privacy');
    must((await call('ai_privacy_set', { level: 'standard', text: TEXT })) === false, 'declined (e2e queue)');
    must((await call('ai_privacy_set', { level: 'zdr', text: TEXT })) === true, 'tightening needs no dialog');
    must((await call('ai_privacy_get')) === 'zdr', 'zdr stored');
    must((await call('ai_busy_policy_get')) === false, 'busy off');
    must(Array.isArray(await call('ai_activity', { limit: 10 })), 'activity');
    await call('ai_activity_clear');
    must((await code(call('ai_host_allow', { base: 'http://example.org/v1', text: TEXT }))) === 'AI_BAD_ADDRESS', 'bad address');
  });
  await step('classes_root', async () => { const r = await call('classes_root'); must(r.path.endsWith('classes'), r.path); });
  await step('class_create', async () => { const c = await call('class_create', { req: { classId: C, dirName: 'Direito Civil' } }); must(c.entry.classId === C && c.entry.dirName === 'Direito Civil' && !c.entry.shared, 'entry'); });
  await new Promise((r) => setTimeout(r, 300));
  await step('class_write + class_read', async () => {
    const st = await call('class_write', bytes('# Introdução'), { 'x-class': enc(C), 'x-path': enc('Notas/Introdução.md'), 'x-own': '0' });
    must(/^[0-9a-f]{64}$/.test(st.sha256), 'sha256');
    const back = await call('class_read', { classId: C, path: 'Notas/Introdução.md' });
    must(text(back) === '# Introdução', 'same bytes');
    must(text(await call('class_read_range', { classId: C, path: 'Notas/Introdução.md', offset: 2, length: 5 })) === 'Intro', 'range');
    must((await call('class_hash', { classId: C, path: 'Notas/Introdução.md' })) === st.sha256, 'hash');
  });
  await step('class_append', async () => { const st = await call('class_append', bytes('{"a":1}\n'), { 'x-class': enc(C), 'x-path': enc('.tramado/x.jsonl'), 'x-own': '0' }); must(st.size === 8 && st.sha256 === null, 'stamp'); });
  await step('own write refused for a foreign path', async () => must((await code(call('class_write', bytes('{}'), { 'x-class': enc(C), 'x-path': enc('.tramado/members/AAAAAAA.json'), 'x-own': '1' }))) === 'INVALID', 'INVALID'));
  await step('confinement', async () => {
    must((await code(call('class_read', { classId: C, path: '../config/secrets.json' }))) === 'INVALID', 'dot dot');
    must((await code(call('class_read', { classId: C, path: '.stversions/x' }))) === 'INVALID', '.st');
  });
  await step('class_list, class_stat, mkdir, move, remove', async () => {
    await call('class_mkdir', { classId: C, path: 'Docs' });
    await call('class_move', { classId: C, from: 'Notas/Introdução.md', to: 'Docs/Introdução.md' });
    const l = await call('class_list', { classId: C, dir: '', opts: { recursive: true, includeTramado: true } });
    const paths = l.map((e) => e.path);
    must(paths.includes('Docs/Introdução.md') && paths.includes('.tramado/x.jsonl'), JSON.stringify(paths));
    const st = await call('class_stat', { classId: C, path: 'Docs/Introdução.md' }); must(st && st.size > 0 && !st.isDir, 'stat');
    must((await call('class_stat', { classId: C, path: 'Docs/none.md' })) === null, 'null stat');
    await call('class_remove', { classId: C, path: '.tramado/x.jsonl', recursive: false });
    must((await code(call('class_remove', { classId: C, path: '.tramado/x.jsonl', recursive: false }))) === 'NOT_FOUND', 'NOT_FOUND');
  });
  await step('media over the scheme', async () => {
    const url = info.mediaBase + '/c/' + C + '/Docs/' + enc('Introdução.md');
    const r = await fetch(url, { headers: { Range: 'bytes=2-6' } });
    must(r.status === 206 && (await r.text()) === 'Intro', 'range 206');
    must((r.headers.get('content-type') || '').startsWith('text/plain'), 'mime');
    const missing = await fetch(info.mediaBase + '/c/' + C + '/Docs/none.md');
    must(missing.status === 404, '404');
  });
  await step('class:changed arrived', async () => {
    const seen = () => changes.some((c) => c.classId === C && c.paths.some((p) => p.startsWith('Docs/')));
    for (let i = 0; i < 40 && !seen(); i++) await new Promise((r) => setTimeout(r, 100));
    must(seen(), JSON.stringify(changes.slice(0, 5)));
    return { events: changes.length, selfWrite: changes.filter((c) => c.selfWrite).length };
  });
  await step('dialogs (e2e queue) + import/export', async () => {
    const picked = await call('dialog_pick_files', { req: { title: 'Import', filters: [{ name: 'PDF', extensions: ['pdf'] }], multiple: true } });
    must(picked.length === 1 && /^[0-9a-f]{32}$/.test(picked[0].token) && picked[0].name === 'Código Civil.pdf', JSON.stringify(picked));
    const st = await call('class_import', { classId: C, pick: picked[0].token, dest: 'Docs/Código Civil.pdf' });
    must(st.size === 9, 'imported size');
    must((await code(call('class_import', { classId: C, pick: picked[0].token, dest: 'Docs/Código Civil.pdf' }))) === 'CONFLICT', 'CONFLICT');
    must((await code(call('class_import', { classId: C, pick: '0'.repeat(32), dest: 'Docs/x.pdf' }))) === 'INVALID', 'unknown token');
    const save = await call('dialog_save', { req: { title: 'Save', defaultName: 'x.pdf', filters: [] } });
    must(save && save.token, 'save token');
    await call('class_export', { classId: C, path: 'Docs/Código Civil.pdf', pick: save.token });
    must((await code(call('class_export', { classId: C, path: 'Docs/Código Civil.pdf', pick: picked[0].token }))) === 'INVALID', 'open token cannot be a save target');
    must((await call('dialog_pick_folder', { req: { title: 'Folder' } })) === null, 'cancel');
  });
  await step('private data', async () => {
    await call('private_write', bytes('{"v":1}'), { 'x-class': enc(C), 'x-path': enc('notes/Aula 1.md') });
    must((await call('private_append', bytes('{}\n'), { 'x-class': enc(C), 'x-path': enc('ask/t.jsonl') })) === 3, 'append');
    must(text(await call('private_read', { classId: C, path: 'notes/Aula 1.md' })) === '{"v":1}', 'read');
    must((await call('private_read', { classId: C, path: 'none.json' })) === null, 'null');
    must(JSON.stringify(await call('private_list', { classId: C, dir: '' })) === JSON.stringify(['ask/t.jsonl', 'notes/Aula 1.md']), 'list');
    must((await code(call('private_read', { classId: C, path: 'mirror/x' }))) === 'INVALID', 'mirror refused');
    await call('private_remove', { classId: C, path: 'notes', recursive: true });
    await call('private_purge', { classId: C });
    must((await call('private_list', { classId: C, dir: '' })).length === 0, 'purged');
  });
  await step('cache', async () => {
    const key = 'text/' + 'a'.repeat(64) + '.json';
    await call('cache_write', bytes('{}'), { 'x-name': enc(key) });
    must(text(await call('cache_read', { key })) === '{}', 'read');
    await call('cache_write', bytes('[]'), { 'x-name': enc('models-catalog.json') });
    await call('cache_clear');
    must((await call('cache_read', { key })) === null, 'cleared');
    must((await call('cache_read', { key: 'models-catalog.json' })) !== null, 'catalog kept');
    await call('cache_remove', { key: 'models-catalog.json' });
    must((await code(call('cache_read', { key: '../x' }))) === 'INVALID', 'bad key');
  });
  await step('app files', async () => { await call('app_file_write', { name: 'prefs.json', text: '{"ui.locale":"pt"}' }); must((await call('app_file_read', { name: 'prefs.json' })) === '{"ui.locale":"pt"}', 'prefs'); must((await code(call('app_file_read', { name: 'classes.json' }))) === 'INVALID', 'allow-list'); });
  await step('class_update', async () => { const e = await call('class_update', { classId: C, patch: { archived: true, localIgnores: ['Docs/Código Civil.pdf'] } }); must(e.archived && e.localIgnores.length === 1, 'patched'); });
  await step('class_fork', async () => {
    await call('class_write', bytes(JSON.stringify({ format: 'tramado.class', version: 1, classId: C2 })), { 'x-class': enc(C), 'x-path': enc('.tramado/class.json'), 'x-own': '0' });
    const e = await call('class_fork', { classId: C, newClassId: C2 });
    must(e.classId === C2 && e.aliases.includes(C) && e.available, JSON.stringify(e));
  });
  await step('storage_usage', async () => { const u = await call('storage_usage'); must(u.classes.length === 1 && u.classes[0].total > 0, 'usage'); });
  await step('system_power', async () => { const p = await call('system_power'); must(['ac', 'battery', 'unknown'].includes(p.source), p.source); });
  await step('diag_collect', async () => { const d = await call('diag_collect'); must(d.app.version && Array.isArray(d.logTail), 'diag'); });
  await step('autostart (dev: in memory)', async () => { must((await call('app_autostart_get')) === false, 'off'); await call('app_autostart_set', { enabled: true }); must((await call('app_autostart_get')) === true, 'on'); await call('app_autostart_set', { enabled: false }); });
  await step('open_external', async () => {
    must((await code(call('open_external', { url: 'http://example.org', text: TEXT }))) === 'INVALID', 'http refused');
    must((await call('open_external', { url: 'https://example.org/x', text: TEXT })) === false, 'declined (e2e queue)');
    must((await call('open_external', { url: 'https://openrouter.ai/keys', text: TEXT })) === true, 'allow-listed');
  });
  await step('notify_show', async () => { await call('notify_show', { n: { title: 'Tramado', body: 'smoke' } }); });
  await step('shortcut_set_markers(null)', async () => { await call('shortcut_set_markers', { accelerators: null }); });
  await step('background mode', async () => { await call('app_set_background_mode', { mode: { trayOnClose: true, sharedClasses: 1 } }); await call('app_set_background_mode', { mode: { trayOnClose: true, sharedClasses: 0 } }); });
  await step('class_trash_empty, class_forget', async () => { await call('class_trash_empty', { classId: C2 }); await call('class_forget', { classId: C2 }); must((await call('classes_list')).length === 0, 'forgotten'); });
  const failed = steps.filter((s) => !s.ok);
  await call('app_log', { level: 'info', message: 'ipc check', data: { ok: failed.length === 0, steps: steps.length, failed } });
})();`;

// ── Inner part: runs inside xvfb-run + dbus-run-session ────────────────────────────────────────────────────────
async function inner() {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  mkdirSync(dirname(OUT), { recursive: true });
  const env = {
    ...process.env,
    TRAMADO_DATA_DIR: DATA,
    TRAMADO_E2E: '1',
    TRAMADO_SYNCTHING_BIN: SIDECAR,
    // Software rendering: Xvfb has no GPU.
    WEBKIT_DISABLE_DMABUF_RENDERER: '1',
    LIBGL_ALWAYS_SOFTWARE: '1',
    NO_AT_BRIDGE: '1',
    ...(MEDIA ? { TRAMADO_E2E_MEDIA_SELFTEST: '1' } : {}),
  };
  if (IPC) {
    // A fictional "PDF" to import and a place to export it to; answers for the dialogs and confirmations the
    // check meets, in order: pick files, save, pick folder (cancel), privacy relax (no), open link (no).
    const fixtures = resolve(DATA, 'fixtures');
    mkdirSync(fixtures, { recursive: true });
    const pdf = resolve(fixtures, 'Código Civil.pdf');
    writeFileSync(pdf, '%PDF-1.4\n');
    const answers = [{ confirm: false }, { paths: [pdf] }, { paths: [resolve(fixtures, 'export.pdf')] }, { cancel: true }, { confirm: false }];
    writeFileSync(resolve(DATA, 'dialogs.json'), JSON.stringify(answers));
    writeFileSync(resolve(DATA, 'ipc-check.js'), IPC_SCRIPT);
    env.TRAMADO_E2E_DIALOGS = resolve(DATA, 'dialogs.json');
    env.TRAMADO_E2E_EVAL = resolve(DATA, 'ipc-check.js');
  }
  const app = spawn(BIN, [], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  app.stdout.on('data', (d) => (output += d));
  app.stderr.on('data', (d) => (output += d));
  let exited = null;
  app.on('exit', (code, signal) => (exited = code ?? signal));

  const report = { ok: false, png: null, webviewReady: false };
  const deadline = Date.now() + TIMEOUT_S * 1000;
  while (Date.now() < deadline && exited === null) {
    if (logText().includes('webview ready')) {
      report.webviewReady = true;
      break;
    }
    await sleep(250);
  }
  if (report.webviewReady) {
    // Let fonts and styles settle before the picture.
    await sleep(2000);
    const shot = spawnSync('import', ['-window', 'root', OUT], { env: process.env, stdio: 'inherit' });
    if (shot.status === 0 && existsSync(OUT)) report.png = OUT;
    if (MEDIA) {
      const mediaDeadline = Date.now() + 45_000;
      let r = null;
      while (Date.now() < mediaDeadline && exited === null && !(r = selftestResult(logText()))) await sleep(250);
      report.mediaSelftest = r ?? { ok: false, error: 'no result within 45 s' };
    }
    if (IPC) {
      const ipcDeadline = Date.now() + 45_000;
      let r = null;
      while (Date.now() < ipcDeadline && exited === null && !(r = logged(logText(), 'ipc check'))) await sleep(250);
      report.ipcCheck = r ?? { ok: false, error: 'no result within 45 s' };
      if (r && existsSync(resolve(DATA, 'fixtures/export.pdf'))) report.ipcCheck.exported = true;
    }
  }
  if (exited === null) {
    app.kill('SIGTERM');
    for (let i = 0; i < 40 && exited === null; i++) await sleep(250);
    if (exited === null) app.kill('SIGKILL');
  }
  report.ok =
    report.webviewReady &&
    report.png !== null &&
    (!MEDIA || report.mediaSelftest?.ok === true) &&
    (!IPC || (report.ipcCheck?.ok === true && report.ipcCheck?.exported === true));
  report.logTail = logText().split('\n').filter(Boolean).slice(-15);
  if (!report.ok) report.appOutput = output.split('\n').filter(Boolean).slice(-30);
  if (exited !== null && !report.webviewReady) report.exited = exited;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

// ── Outer part: build, then re-run this script inside Xvfb ─────────────────────────────────────────────────────
async function outer() {
  if (process.platform !== 'linux') {
    console.error('desktop-smoke: Linux only (Xvfb).');
    process.exit(2);
  }
  for (const tool of ['xvfb-run', 'dbus-run-session', 'import']) {
    if (!has(tool)) {
      console.error(`desktop-smoke: ${tool} is missing (sudo apt install xvfb dbus imagemagick).`);
      process.exit(2);
    }
  }
  if (!existsSync(SIDECAR)) {
    console.error(`desktop-smoke: no Syncthing sidecar at ${SIDECAR}: run node tools/fetch-syncthing.mjs`);
    process.exit(2);
  }
  if (opts['skip-build'] !== 'true') {
    if (opts['skip-frontend'] !== 'true') run('npm', ['run', 'build']);
    // A plain debug build would load devUrl; custom-protocol embeds app/dist (tauri.conf.json frontendDist).
    run('cargo', ['build', '-p', 'tramado-desktop', '--no-default-features', '--features', 'tauri/custom-protocol']);
  }
  if (!existsSync(resolve(ROOT, 'app/dist/index.html'))) {
    console.error('desktop-smoke: app/dist is missing: run npm run build');
    process.exit(2);
  }
  if (!existsSync(BIN)) {
    console.error(`desktop-smoke: ${BIN} is missing`);
    process.exit(2);
  }
  const args = ['-a', '-s', '-screen 0 1440x900x24', 'dbus-run-session', '--', process.execPath, fileURLToPath(import.meta.url), '--inner', ...process.argv.slice(2)];
  const child = spawn('xvfb-run', args, { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 1));
}

if (opts.inner === 'true') await inner();
else await outer();
