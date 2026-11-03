#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (tools/fetch-speech-models.mjs), MPL-2.0, same author.
//
// Speech files for builds and tests (architecture §18.2):
//   node tools/fetch-speech-assets.mjs
//       the Silero VAD bundled with the app → desktop/src-tauri/resources/speech/
//   node tools/fetch-speech-assets.mjs --model=small|turbo|large-v3 [--dest=.tramado-dev/models]
//       a whisper model for tests (the app downloads its models itself, on demand)
//
// Every file is checked against its size and SHA-256; a file already in place is kept. An
// interrupted download resumes from its `.part`. TRAMADO_SPEECH_FROM=<dir> copies the files
// from a local folder instead of downloading. The table below must stay equal to
// crates/tramado-speech/src/registry.rs (a Rust unit test compares them).

import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const MODEL_REV = '5359861c739e955e79d9a303bcbc70fb988958b1';

/** The bundled voice-activity model (Silero v5.1.2, MIT). */
export const VAD = {
  file: 'ggml-silero-v5.1.2.bin',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v5.1.2.bin',
  size: 885098,
  sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
};

/** whisper.cpp models (MIT), as in tramado-speech::registry. */
export const MODELS = {
  'turbo': { file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2' },
  'small': { file: 'ggml-small-q5_1.bin', size: 190085487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb' },
  'large-v3': { file: 'ggml-large-v3-q5_0.bin', size: 1081140203, sha256: 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1' },
};

const modelUrl = (file) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REV}/${file}`;

function parseArgs(argv) {
  const opts = { model: null, dest: null };
  for (const a of argv) {
    if (a.startsWith('--model=')) opts.model = a.slice('--model='.length);
    else if (a.startsWith('--dest=')) opts.dest = a.slice('--dest='.length);
    else if (a === '--help' || a === '-h') {
      console.log('usage: node tools/fetch-speech-assets.mjs [--model=small|turbo|large-v3 [--dest=.tramado-dev/models]]');
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (opts.model && !MODELS[opts.model]) throw new Error(`unknown model ${opts.model} (small, turbo, large-v3)`);
  if (opts.dest && !opts.model) throw new Error('--dest goes with --model');
  return opts;
}

async function sha256(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function good(path, f) {
  return existsSync(path) && statSync(path).size === f.size && (await sha256(path)) === f.sha256;
}

/** Downloads into `part`, resuming from what it already holds when the server allows it. */
async function download(url, part, f) {
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have >= f.size) {
    rmSync(part, { force: true });
    have = 0;
  }
  const headers = have > 0 ? { Range: `bytes=${have}-` } : {};
  const res = await fetch(url, { redirect: 'follow', headers });
  if (!res.body || !(res.status === 200 || (res.status === 206 && have > 0))) throw new Error(`${f.file}: HTTP ${res.status}`);
  if (res.status === 200) have = 0; // the server ignored the range: start over
  let received = have;
  let shown = Math.floor((have / f.size) * 20) * 5;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    const pct = Math.floor((received / f.size) * 100);
    if (pct >= shown + 5) {
      shown = pct - (pct % 5);
      console.log(`  ${f.file}: ${shown}%`);
    }
  });
  await pipeline(body, createWriteStream(part, { flags: have > 0 ? 'a' : 'w' }));
}

async function fetchFile(f, url, destDir) {
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, f.file);
  if (await good(dest, f)) {
    console.log(`speech: ${f.file} ok (${dest})`);
    return;
  }
  const part = `${dest}.part`;
  const from = process.env.TRAMADO_SPEECH_FROM;
  if (from) {
    console.log(`speech: copying ${f.file} from ${from}`);
    rmSync(part, { force: true });
    copyFileSync(join(from, f.file), part);
  } else {
    console.log(`speech: downloading ${f.file} (${Math.round(f.size / 1e6)} MB)`);
    await download(url, part, f);
  }
  if (!(await good(part, f))) {
    rmSync(part, { force: true });
    throw new Error(`${f.file}: wrong size or SHA-256`);
  }
  renameSync(part, dest);
  console.log(`speech: ${f.file} ok (${dest})`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.model) {
    await fetchFile(VAD, VAD.url, join(root, 'desktop', 'src-tauri', 'resources', 'speech'));
    return;
  }
  const m = MODELS[opts.model];
  const destDir = opts.dest ? (isAbsolute(opts.dest) ? opts.dest : resolve(process.cwd(), opts.dest)) : join(root, '.tramado-dev', 'models');
  await fetchFile(m, modelUrl(m.file), destDir);
}

main().catch((e) => {
  console.error(`fetch-speech-assets: ${e.message}`);
  process.exit(1);
});
