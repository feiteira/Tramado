#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Puts the pinned Syncthing release next to the desktop app as a Tauri sidecar
// (architecture §18.1):
//   desktop/src-tauri/binaries/tramado-syncthing-<triple>[.exe]   (mode 755)
//   desktop/src-tauri/resources/syncthing/{LICENSE.txt,AUTHORS}
//
//   node tools/fetch-syncthing.mjs [--target=<triple> | --all] [--gpg] [--force]
//
// Default target: the host triple (`rustc -vV`). Archives are cached in tools/.cache/ and
// checked against the SHA-256 below; TRAMADO_SYNCTHING_FROM=<dir> copies them from a local
// folder instead of downloading (offline builds, CI caches). A binary already in place whose
// `.sha256` stamp matches the pinned archive hash is kept. `--gpg` also checks the release's
// signed sha256sum.txt.asc against tools/keys/syncthing-release.asc. On any failure partial
// outputs are deleted, "nothing was kept" is printed and the exit code is 1.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync,
  readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const VERSION = 'v2.1.7';
const BASE = `https://github.com/syncthing/syncthing/releases/download/${VERSION}`;

/** Tauri triple → release asset and its SHA-256 (architecture §18.1). */
export const ASSETS = {
  'x86_64-unknown-linux-gnu': { asset: `syncthing-linux-amd64-${VERSION}.tar.gz`, sha256: '2edc416e7ed136b7c858ed5f3f02a3b8316589605e54c380228ceea7acbf0142' },
  'aarch64-unknown-linux-gnu': { asset: `syncthing-linux-arm64-${VERSION}.tar.gz`, sha256: '48e456690cd2b97e7d26b02b5ac35f62a3b36172267b144cfeaf02c993ab955c' },
  'x86_64-apple-darwin': { asset: `syncthing-macos-amd64-${VERSION}.zip`, sha256: 'b8be90176d0f24daebae7b5aaddac52ebfae395df6d99f5e0e54656db00868cb' },
  'aarch64-apple-darwin': { asset: `syncthing-macos-arm64-${VERSION}.zip`, sha256: '2df075b463231a307c91da657157beaed06383a941ba7ea04d33d536e3c4af38' },
  'universal-apple-darwin': { asset: `syncthing-macos-universal-${VERSION}.zip`, sha256: 'a98fb709c79412e5586c81a1586bfb256b6e5a97b067ddf7447155bcdf6aac3f' },
  'x86_64-pc-windows-msvc': { asset: `syncthing-windows-amd64-${VERSION}.zip`, sha256: '3ce7da770f546a8d02b65b2e7ee31f2a3b8b7c3f990ede045590cca4172ecfe1' },
  'aarch64-pc-windows-msvc': { asset: `syncthing-windows-arm64-${VERSION}.zip`, sha256: 'd535ffd611b3af223de64bc5dfc60c378881eb13d5c8ecb1431b7407094c15ff' },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'tools', '.cache');
const binDir = join(root, 'desktop', 'src-tauri', 'binaries');
const resDir = join(root, 'desktop', 'src-tauri', 'resources', 'syncthing');

function parseArgs(argv) {
  const opts = { targets: [], all: false, gpg: false, force: false };
  for (const a of argv) {
    if (a === '--all') opts.all = true;
    else if (a === '--gpg') opts.gpg = true;
    else if (a === '--force') opts.force = true;
    else if (a.startsWith('--target=')) opts.targets.push(a.slice('--target='.length));
    else if (a === '--help' || a === '-h') {
      console.log('usage: node tools/fetch-syncthing.mjs [--target=<triple> | --all] [--gpg] [--force]');
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function hostTriple() {
  // From the repository root, so rust-toolchain.toml picks the same toolchain as the build.
  const out = execFileSync('rustc', ['-vV'], { cwd: root, encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.startsWith('host:'));
  if (!line) throw new Error('rustc -vV printed no host triple');
  return line.slice('host:'.length).trim();
}

async function sha256(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function download(url, dest, label) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let shown = -5;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (!total) return;
    const pct = Math.floor((received / total) * 100);
    if (pct >= shown + 5) {
      shown = pct - (pct % 5);
      process.stdout.write(`  ${label}: ${shown}%\n`);
    }
  });
  await pipeline(body, createWriteStream(dest));
}

/** The archive in tools/.cache, verified (downloaded or copied when missing or wrong). */
async function archive(triple, { asset, sha256: want }) {
  mkdirSync(cacheDir, { recursive: true });
  const dest = join(cacheDir, asset);
  if (existsSync(dest) && (await sha256(dest)) === want) return dest;
  const part = `${dest}.part`;
  rmSync(part, { force: true });
  const from = process.env.TRAMADO_SYNCTHING_FROM;
  if (from) {
    console.log(`syncthing ${triple}: copying ${asset} from ${from}`);
    copyFileSync(join(from, asset), part);
  } else {
    console.log(`syncthing ${triple}: downloading ${asset}`);
    await download(`${BASE}/${asset}`, part, asset);
  }
  const got = await sha256(part);
  if (got !== want) {
    rmSync(part, { force: true });
    throw new Error(`${asset}: SHA-256 ${got} is not the pinned ${want}`);
  }
  renameSync(part, dest);
  return dest;
}

/** The primary key of tools/keys/syncthing-release.asc ("Syncthing Release Management"). */
const RELEASE_KEY = 'FBA2E162F2F44657B38F0309E5665F9BD5970C47';

/**
 * Checks the release's signed checksum list against the bundled release key. The list carries a
 * second signature by a key we do not ship, so gpg exits non-zero: we require a VALIDSIG by our key
 * and read the asset's line only from the signed text gpg extracts.
 */
async function verifyGpg(asset, want) {
  mkdirSync(cacheDir, { recursive: true });
  const work = mkdtempSync(join(cacheDir, 'gpg-'));
  try {
    const sums = join(work, 'sha256sum.txt.asc');
    const from = process.env.TRAMADO_SYNCTHING_FROM;
    if (from && existsSync(join(from, 'sha256sum.txt.asc'))) copyFileSync(join(from, 'sha256sum.txt.asc'), sums);
    else await download(`${BASE}/sha256sum.txt.asc`, sums, 'sha256sum.txt.asc');
    const home = join(work, 'gnupg');
    mkdirSync(home, { mode: 0o700 });
    const base = ['--homedir', home, '--batch', '--quiet'];
    execFileSync('gpg', [...base, '--import', join(root, 'tools', 'keys', 'syncthing-release.asc')], { stdio: 'ignore' });
    const signed = join(work, 'sha256sum.txt');
    const r = spawnSync('gpg', [...base, '--status-fd', '1', '--output', signed, '--decrypt', sums], { encoding: 'utf8' });
    const valid = (r.stdout || '').split('\n').some((l) => l.startsWith(`[GNUPG:] VALIDSIG ${RELEASE_KEY} `));
    if (!valid || !existsSync(signed)) throw new Error('sha256sum.txt.asc has no valid signature by the Syncthing release key');
    const line = readFileSync(signed, 'utf8').split('\n').find((l) => l.trim().endsWith(`  ${asset}`));
    if (!line || line.trim().split(/\s+/)[0] !== want) throw new Error(`${asset}: not in the signed checksum list with the pinned hash`);
    console.log(`syncthing: ${asset} matches the checksum list signed by ${RELEASE_KEY}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function extract(archivePath, asset, outDir) {
  if (asset.endsWith('.tar.gz')) {
    execFileSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'inherit' });
  } else if (process.platform === 'linux') {
    execFileSync('unzip', ['-o', '-q', archivePath, '-d', outDir], { stdio: 'inherit' });
  } else {
    execFileSync('tar', ['-xf', archivePath, '-C', outDir], { stdio: 'inherit' });
  }
}

async function fetchTarget(triple, opts) {
  const spec = ASSETS[triple];
  if (!spec) throw new Error(`no Syncthing build is pinned for ${triple}`);
  const exe = triple.includes('windows') ? '.exe' : '';
  const bin = join(binDir, `tramado-syncthing-${triple}${exe}`);
  const stamp = `${bin}.sha256`;
  const haveRes = existsSync(join(resDir, 'LICENSE.txt')) && existsSync(join(resDir, 'AUTHORS'));
  if (!opts.force && !opts.gpg && existsSync(bin) && existsSync(stamp) && haveRes
      && readFileSync(stamp, 'utf8').trim() === spec.sha256) {
    console.log(`syncthing ${triple}: ${VERSION} ok (${bin})`);
    return;
  }
  // Outputs are deleted on failure only once this run started writing them.
  const outputs = [];
  try {
    const arch = await archive(triple, spec);
    if (opts.gpg) await verifyGpg(spec.asset, spec.sha256);
    outputs.push(bin, stamp);
    rmSync(stamp, { force: true });
    mkdirSync(cacheDir, { recursive: true });
    const work = mkdtempSync(join(cacheDir, 'extract-'));
    try {
      extract(arch, spec.asset, work);
      const top = join(work, spec.asset.replace(/\.(tar\.gz|zip)$/, ''));
      const src = join(top, `syncthing${exe}`);
      if (!existsSync(src)) throw new Error(`${spec.asset}: no syncthing${exe} inside`);
      mkdirSync(binDir, { recursive: true });
      mkdirSync(resDir, { recursive: true });
      outputs.push(join(resDir, 'LICENSE.txt'), join(resDir, 'AUTHORS'));
      copyFileSync(src, bin);
      chmodSync(bin, 0o755);
      copyFileSync(join(top, 'LICENSE.txt'), join(resDir, 'LICENSE.txt'));
      copyFileSync(join(top, existsSync(join(top, 'AUTHORS.txt')) ? 'AUTHORS.txt' : 'AUTHORS'), join(resDir, 'AUTHORS'));
      writeFileSync(stamp, `${spec.sha256}\n`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    console.log(`syncthing ${triple}: ${VERSION} installed (${statSync(bin).size} bytes) at ${bin}`);
  } catch (e) {
    for (const p of outputs) rmSync(p, { force: true });
    throw e;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const targets = opts.all ? Object.keys(ASSETS) : opts.targets.length ? opts.targets : [hostTriple()];
  for (const t of targets) await fetchTarget(t, opts);
}

main().catch((e) => {
  console.error(`fetch-syncthing: ${e.message}`);
  console.error('fetch-syncthing: nothing was kept');
  process.exit(1);
});
