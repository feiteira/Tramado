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
//   --skip-build        do not build the frontend nor the app (use what is there)
//   --skip-frontend     do not run `npm run build` (the app is still built)
//   --timeout=<s>       how long to wait for "webview ready" (default 30)
//
// Prints a JSON report ({ ok, png, webviewReady, mediaSelftest?, logTail }) and exits 0 when everything passed.
// The app runs with TRAMADO_DATA_DIR=.tramado-dev/smoke (wiped first), TRAMADO_E2E=1 and the fetched Syncthing
// sidecar; nothing touches the developer's own Tramado data, keychain or autostart.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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

/** The data object of the last `media selftest` line, if any. */
function selftestResult(text) {
  const lines = text.split('\n').filter((l) => / INFO media selftest /.test(l));
  if (lines.length === 0) return null;
  const json = lines.at(-1).replace(/^.* INFO media selftest /, '');
  try {
    return JSON.parse(json);
  } catch {
    return { ok: false, error: `unreadable: ${json}` };
  }
}

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
  }
  if (exited === null) {
    app.kill('SIGTERM');
    for (let i = 0; i < 40 && exited === null; i++) await sleep(250);
    if (exited === null) app.kill('SIGKILL');
  }
  report.ok = report.webviewReady && report.png !== null && (!MEDIA || report.mediaSelftest?.ok === true);
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
