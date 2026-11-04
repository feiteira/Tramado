#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Contract and two-instance tests of tramado-sync against the real, pinned Syncthing
// (architecture §17, sync spec §24): fetches the host's Syncthing sidecar, then runs
//   cargo test -p tramado-sync --test contract --test two_instances -- --ignored --test-threads=1
// with TRAMADO_SYNCTHING_BIN pointing at it. Extra arguments are passed to the test binaries
// (e.g. a test name). Until R-SYNC adds the test targets it prints "no contract tests yet".
// Afterwards it checks that no test Syncthing is left running (a `tramado-syncthing` whose
// --home is under the temporary directory): any such process is killed and the run fails.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'crates', 'tramado-sync', 'tests');
const targets = ['contract', 'two_instances'].filter((t) => existsSync(join(testsDir, `${t}.rs`)));

if (targets.length === 0) {
  console.log('no contract tests yet');
  process.exit(0);
}

const fetched = spawnSync(process.execPath, [join(root, 'tools', 'fetch-syncthing.mjs')], { cwd: root, stdio: 'inherit' });
if (fetched.status !== 0) process.exit(fetched.status ?? 1);

const out = execFileSync('rustc', ['-vV'], { cwd: root, encoding: 'utf8' });
const triple = (out.split('\n').find((l) => l.startsWith('host:')) ?? '').slice('host:'.length).trim();
const exe = triple.includes('windows') ? '.exe' : '';
const bin = join(root, 'desktop', 'src-tauri', 'binaries', `tramado-syncthing-${triple}${exe}`);
if (!existsSync(bin)) {
  console.error(`test-contract: ${bin} is missing`);
  process.exit(1);
}

const args = ['test', '-p', 'tramado-sync'];
for (const t of targets) args.push('--test', t);
args.push('--', '--ignored', '--test-threads=1', ...process.argv.slice(2));
console.log(`test-contract: cargo ${args.join(' ')}`);
const r = spawnSync('cargo', args, {
  cwd: root, // .cargo/config.toml and rust-toolchain.toml apply from here
  stdio: 'inherit',
  env: { ...process.env, TRAMADO_SYNCTHING_BIN: process.env.TRAMADO_SYNCTHING_BIN || bin },
});

/** Test instances still running: `[pid, command line]` of tramado-syncthing with a temp home. */
function leftovers() {
  if (process.platform === 'win32') return [];
  const ps = spawnSync('pgrep', ['-af', 'tramado-syncthing'], { encoding: 'utf8' });
  const tmp = [tmpdir(), process.env.TMPDIR, '/tmp'].filter(Boolean);
  return (ps.stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => / serve /.test(l) && tmp.some((t) => l.includes(`--home=${t}`)))
    .map((l) => [Number(l.split(' ')[0]), l]);
}

const left = leftovers();
if (left.length > 0) {
  for (const [pid, line] of left) {
    console.error(`test-contract: a test Syncthing was left running, killing it: ${line}`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  process.exit(1);
}
console.log('test-contract: no Syncthing test process left');
process.exit(r.status ?? 1);
