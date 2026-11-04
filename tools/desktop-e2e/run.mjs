#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (tools/desktop-e2e/run.mjs), MPL-2.0, same author.
//
// End-to-end tests of the real Tramado desktop app (Linux, WebKitGTK) through W3C WebDriver (plan §8.1, arch §17).
// See README.md. Every instance runs in a throwaway TRAMADO_DATA_DIR on a private Xvfb display; nothing touches the
// person's own Tramado, Syncthing, keychain or autostart.
//
//   node tools/desktop-e2e/run.mjs --suite=smoke|sync-two|sync-three|media|model|hidden [--bin=<path>] [--keep]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, ROOT, say, since, warn } from './lib.mjs';

const opts = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (!m) {
    console.error(`desktop-e2e: unexpected argument ${a}`);
    process.exit(2);
  }
  opts[m[1]] = m[2] ?? 'true';
}
const SUITES = {
  smoke: () => import('./smoke.mjs'),
  'sync-two': () => import('./sync.mjs'),
  'sync-three': () => import('./sync.mjs'),
  media: () => import('./media.mjs'),
  model: () => import('./model.mjs'),
  hidden: () => import('./hidden.mjs'),
};
const suite = opts.suite ?? 'smoke';
if (!SUITES[suite]) {
  console.error(`desktop-e2e: unknown suite ${suite} (${Object.keys(SUITES).join(', ')})`);
  process.exit(2);
}
if (process.platform !== 'linux') {
  console.error('desktop-e2e: Linux only (WebKitGTK, Xvfb, /proc).');
  process.exit(2);
}
const bin = opts.bin ?? process.env.TRAMADO_BIN ?? join(ROOT, 'target/release/tramado-desktop');
if (!existsSync(bin)) {
  console.error(`desktop-e2e: no app at ${bin} (npm run build:desktop, or --bin=/ TRAMADO_BIN=)`);
  process.exit(2);
}
for (const tool of ['Xvfb', 'tauri-driver', 'WebKitWebDriver', 'python3']) {
  const { status } = await import('node:child_process').then((cp) => cp.spawnSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' }));
  if (status !== 0) {
    console.error(`desktop-e2e: ${tool} is missing (README.md lists the requirements)`);
    process.exit(2);
  }
}

const h = new Harness({ suite, bin, keep: opts.keep === 'true' || process.env.TRAMADO_E2E_KEEP === '1', artifacts: process.env.TRAMADO_E2E_ARTIFACTS });
const deadline = Number(process.env.TRAMADO_E2E_TIMEOUT_MS ?? (suite === 'hidden' ? 40 : 25) * 60_000);
const watchdog = setTimeout(() => {
  warn(`✗ the run took longer than ${deadline / 60000} min`);
  h.cleanup().finally(() => process.exit(1));
}, deadline);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => h.cleanup().finally(() => process.exit(130)));

let ok = false;
try {
  say(`Tramado desktop e2e — suite ${suite}\n  app: ${bin}\n  work: ${h.work}\n  D-Bus: ${h.privateBus ? 'private session per instance' : 'inherited'}`);
  await h.startDisplay();
  say(`  display: ${h.display}`);
  const mod = await SUITES[suite]();
  await mod.default(h, { ...opts, suite });
  ok = true;
} catch (e) {
  if (!e?.reported) warn(`✗ ${e?.stack ?? e}`);
} finally {
  clearTimeout(watchdog);
  await h.cleanup();
  say('');
  for (const [name, ms] of h.timings) say(`  ${(ms / 1000).toFixed(1).padStart(6)}s  ${name}`);
  say(ok ? `✓ desktop e2e (${suite}) passed in ${since(h.t0)}` : `✗ desktop e2e (${suite}) FAILED after ${since(h.t0)} (artifacts: ${h.artifacts})`);
  process.exit(ok ? 0 : 1);
}
