#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// startup: the release job's start-up smoke for a built Tramado on Windows and macOS (it runs on Linux too). No
// WebDriver, no display server of its own: the runner's desktop session shows the window.
//
//   node tools/desktop-e2e/startup.mjs --app=<executable or Tramado.app> [--sidecar=<path>] [--wait=40]
//
// 1. Starts the app with a fresh TRAMADO_DATA_DIR in the temporary folder (nothing touches a real profile, keychain,
//    autostart or the single-instance lock) and waits until its log says "webview ready": the frontend loaded in
//    the system webview (WebView2, WKWebView). The app then keeps running until --wait seconds have passed.
// 2. Meanwhile runs the bundled Syncthing sidecar (default: tramado-syncthing next to the app) as the app starts it
//    (`serve`, GUI on a loopback port, API key in the environment, its home in the same temporary folder) and waits
//    for /rest/noauth/health to answer OK. With no shared class the app itself does not start Syncthing, so this is
//    what proves the bundled binary runs on this system.
// 3. Checks that both are still alive, stops Syncthing through its API and the app (its whole process tree on
//    Windows), prints the app log and deletes the temporary folder.
//
// Fails (exit 1) when the app exits early, never logs "webview ready", or Syncthing never reports healthy. ERROR
// lines of the app log are printed as warnings: they are worth reading, but some come from the system (audio
// servers, a missing tray) and must not make a release flaky.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const opts = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (!m || !['app', 'sidecar', 'wait'].includes(m[1])) {
    console.error(`startup: unexpected argument ${a} (use --app=<path> [--sidecar=<path>] [--wait=<s>])`);
    process.exit(2);
  }
  opts[m[1]] = m[2] ?? '';
}
if (!opts.app) {
  console.error('startup: --app=<the app executable, or Tramado.app on macOS> is required');
  process.exit(2);
}

const WIN = process.platform === 'win32';
const EXE = WIN ? '.exe' : '';
const WAIT_S = Number(opts.wait) || 40;
const READY_S = 30;
const HEALTH_S = 60;
const GH = Boolean(process.env.GITHUB_ACTIONS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warn = (m) => console.log(GH ? `::warning::${m}` : `warning: ${m}`);
const fail = (m) => console.log(GH ? `::error::${m}` : `error: ${m}`);

/** The executable: the path given, or the app binary inside a macOS .app bundle (not the Syncthing sidecar). */
function appExecutable(p) {
  const abs = resolve(p);
  if (!abs.endsWith('.app')) return abs;
  const dir = join(abs, 'Contents', 'MacOS');
  const bins = readdirSync(dir).filter((n) => !n.includes('syncthing'));
  if (bins.length !== 1) throw new Error(`${dir} holds ${bins.length} app binaries (${bins.join(', ')})`);
  return join(dir, bins[0]);
}

const app = appExecutable(opts.app);
const sidecar = resolve(opts.sidecar || join(dirname(app), `tramado-syncthing${EXE}`));
for (const f of [app, sidecar]) {
  if (!existsSync(f)) {
    fail(`${f} does not exist`);
    process.exit(1);
  }
}

function freePort() {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.once('error', ko);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** Stops a process and, on Windows, every process it started (WebView2's helpers). */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (WIN) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
  const t = Date.now();
  while (child.exitCode === null && child.signalCode === null && Date.now() - t < 5000) await sleep(100);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

const work = mkdtempSync(join(tmpdir(), 'tramado-startup-'));
const logFile = join(work, 'data', 'logs', 'app.log');
const readLog = () => {
  try {
    return readFileSync(logFile, 'utf8');
  } catch {
    return '';
  }
};

const report = { app, sidecar, appAlive: false, webviewReadyAfterS: null, syncthingHealthyAfterS: null, syncthingAlive: false };
let appProc = null;
let stProc = null;
let ok = false;
try {
  console.log(`startup: ${app} (${(statSync(app).size / 1e6).toFixed(1)} MB) with TRAMADO_DATA_DIR=${work}`);
  const started = Date.now();
  const env = { ...process.env, TRAMADO_DATA_DIR: work };
  delete env.TRAMADO_E2E;
  appProc = spawn(app, [], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  appProc.on('error', (e) => fail(`the app did not start: ${e.message}`));

  // Syncthing beside it, as the app starts it (sync spec §2.4), on its own home and a loopback port.
  const port = await freePort();
  const key = randomBytes(24).toString('hex');
  stProc = spawn(
    sidecar,
    ['serve', `--home=${join(work, 'syncthing')}`, '--no-browser', '--no-restart', '--no-upgrade', `--gui-address=http://127.0.0.1:${port}`],
    {
      env: { ...process.env, STGUIAPIKEY: key, STNOUPGRADE: '1', STNODEFAULTFOLDER: '1', STMONITORED: 'yes' },
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    },
  );
  stProc.on('error', (e) => fail(`Syncthing did not start: ${e.message}`));

  const gone = (c) => c.exitCode !== null || c.signalCode !== null;
  while (Date.now() - started < WAIT_S * 1000) {
    const s = (Date.now() - started) / 1000;
    if (gone(appProc)) break;
    if (report.webviewReadyAfterS === null && readLog().includes('webview ready')) report.webviewReadyAfterS = Math.round(s);
    if (report.syncthingHealthyAfterS === null && !gone(stProc)) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/rest/noauth/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok && (await r.json()).status === 'OK') report.syncthingHealthyAfterS = Math.round(s);
      } catch {
        // Not listening yet.
      }
    }
    if (report.webviewReadyAfterS === null && s > READY_S) break;
    await sleep(500);
  }
  // Syncthing may need longer on a cold Windows runner (key generation, a virus scan of a new binary).
  while (report.syncthingHealthyAfterS === null && !gone(stProc) && Date.now() - started < HEALTH_S * 1000) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/rest/noauth/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok && (await r.json()).status === 'OK') report.syncthingHealthyAfterS = Math.round((Date.now() - started) / 1000);
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  report.appAlive = !gone(appProc);
  report.syncthingAlive = !gone(stProc);
  if (report.syncthingAlive) {
    try {
      await fetch(`http://127.0.0.1:${port}/rest/system/shutdown`, { method: 'POST', headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(5000) });
    } catch {
      // Stopped below anyway.
    }
  }

  if (!report.appAlive) fail(`the app exited (code ${appProc.exitCode ?? appProc.signalCode})`);
  if (report.webviewReadyAfterS === null) fail(`the app never logged "webview ready" in ${READY_S} s`);
  if (report.syncthingHealthyAfterS === null) fail(`the Syncthing sidecar never reported healthy in ${HEALTH_S} s`);
  else if (!report.syncthingAlive) fail('the Syncthing sidecar exited after reporting healthy');
  ok = report.appAlive && report.webviewReadyAfterS !== null && report.syncthingHealthyAfterS !== null && report.syncthingAlive;
} catch (e) {
  fail(`startup: ${e.message}`);
} finally {
  if (stProc) {
    const t = Date.now();
    while (stProc.exitCode === null && stProc.signalCode === null && Date.now() - t < 10_000) await sleep(100);
    await stop(stProc);
  }
  if (appProc) await stop(appProc);
  const log = readLog();
  console.log(`--- ${basename(logFile)} ---\n${log.trimEnd()}\n---`);
  for (const line of log.split('\n').filter((l) => / ERROR /.test(l))) warn(`app log: ${line.slice(0, 300)}`);
  console.log(JSON.stringify(report, null, 2));
  // WebView2 and Syncthing may hold files for a moment after they exit.
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(work, { recursive: true, force: true });
      break;
    } catch {
      await sleep(500);
    }
  }
}
process.exit(ok ? 0 : 1);
