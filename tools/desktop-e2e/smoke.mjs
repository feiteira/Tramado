// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Suite `smoke` (plan §8.1 task 3): onboarding, create a class, import a PDF through the dialog queue, search finds an
// article, the CSP style probe, fonts, no external sockets from WebKit, the app process only to the allow-list,
// close → exit handlers ran. With TRAMADO_AI_LIVE=1: one real Ask over free models (the model that answered is
// logged), then the key may appear in no file of the data folder except the secrets store, and in no log.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROOT, addSecret, assert, sleep } from './lib.mjs';
import { onboard, createClass, importDocuments, cspProbe, fontsProbe, networkProbe, allowListed } from './steps.mjs';
import { openTab } from './sync.mjs';

export default async function smoke(h) {
  const live = process.env.TRAMADO_AI_LIVE === '1';
  let key = null;
  if (live) {
    // Read only here, at run time (never printed: every line goes through redact()).
    key = readFileSync(join(homedir(), '.openrouter.key'), 'utf8').replace(/\s+/g, '');
    assert(key.length > 20, 'TRAMADO_AI_LIVE=1 needs a key in ~/.openrouter.key');
    addSecret(key);
  }
  const a = h.app('ana');
  const inbox = join(a.dir, 'inbox');
  mkdirSync(inbox, { recursive: true });
  const pdf = join(inbox, 'Regulamento Pedagógico (fictício).pdf');
  copyFileSync(join(ROOT, 'app/test-fixtures/tramado/docs/law.pdf'), pdf);

  await h.step('start: the onboarding, window title "Tramado"', async () => {
    await a.start();
    await a.present('onboarding-welcome', 90_000);
    const title = await a.call('plugin:window|title', { label: 'main' });
    assert(title === 'Tramado', `window title: ${title}`);
    return `webview: ${(await a.call('app_info')).webview}`;
  });

  await h.step('real-app styles: stylesheets, <style> elements, style attributes and CSSOM apply (CSP style-src)', () => cspProbe(a, 'onboarding'));
  await h.step('fonts: Figtree, Bricolage Grotesque and Source Serif 4 load from the app', () => fontsProbe(a));
  await h.step('no network from the webview: plugins refused, fetch/XHR/WebSocket/image blocked by the CSP, no external sockets', () => networkProbe(a));

  await h.step(`onboarding: name, ${live ? 'the OpenRouter key (tested)' : 'AI "Not now"'}, "Create a class"`, () => onboard(a, { name: 'Ana Ribeiro', key, then: 'create' }));
  let classId;
  await h.step('a new class (sharing off)', async () => {
    classId = await createClass(a, { name: 'Direito Constitucional', share: false, fromDialog: true });
    return classId;
  });
  await h.step('Add › Documents…: a PDF through the dialog queue', () => importDocuments(a, [pdf]));
  await h.step('extraction and indexing in the webview workers', async () => {
    const st = await a.untilRun('the index to settle', `const s = window.__tramadoE2E; const v = await s.search.settled(arguments[0]); return v.docs >= 1 && v.pending === 0 ? v : null;`, [classId], 90_000);
    return `${st.docs} document(s), ${st.chars} characters`;
  });
  await h.step('search: the palette finds an article ("época de recurso" → Artigo 3.º)', async () => {
    await a.click('rail-search');
    await a.type('palette-input', 'época de recurso');
    const label = await a.until('a result', `const r = document.querySelector('[data-testid="palette-result"]'); return r && r.textContent`, [], 20_000);
    assert(/Artigo 3|art\. ?3/i.test(label), `the first result is not article 3: ${label.slice(0, 200)}`);
    await a.click('palette-result');
    await a.present('screen-document', 20_000);
    await a.until('the passage marked on the PDF page', `return document.querySelector('[data-testid="doc-pdf-page"] mark.cite, [data-testid="doc-pdf-page"] .cite-mark')`, [], 30_000);
    return label.replace(/\s+/g, ' ').slice(0, 120);
  });

  await h.step('Settings › About: the audio self-test passes (GStreamer in this build or bundle)', async () => {
    await a.click('nav-settings');
    await a.click('settings-nav-about');
    await a.click('about-media-test');
    const state = await a.until('the result', `const r = document.querySelector('[data-testid="about-media-result"]'); return r ? r.dataset.state + ': ' + r.textContent : null`, [], 60_000);
    assert(state.startsWith('ok'), `the self-test failed: ${state}`);
    return state;
  });

  if (live) {
    await h.step('live: one real Ask in the class (free models); the model that answered', () => liveAsk(a, classId));
  }

  await h.step('sockets after the work: WebKit none, Syncthing not running (no shared class), the app only to the allow-list', async () => {
    const s = a.sockets();
    assert(!s.webkit.some((x) => x.external), `WebKit processes hold external sockets: ${JSON.stringify(s.webkit.filter((x) => x.external))}`);
    assert(!s.syncthing.length, `Syncthing runs without a shared class (${s.syncthing.length} sockets)`);
    const bad = [];
    for (const x of s.app.filter((x) => x.external)) if (!(await allowListed(x.remoteIp))) bad.push(`${x.proto} ${x.local} → ${x.remote}`);
    assert(!bad.length, `the app process reaches beyond the allow-list: ${bad.join(', ')}`);
    return `${s.processes} processes (${s.exes.join(', ')}); app sockets ${s.app.length} (external ${s.app.filter((x) => x.external).length}, all allow-listed); WebKit ${s.webkit.length}, none external`;
  });

  await h.step('close the window: the exit handlers run and the app exits', async () => {
    const before = a.logText().length;
    await a.quitByClose();
    const after = a.logText().slice(before);
    assert(/Tramado exiting/.test(after), `no "Tramado exiting" in the log after the close: ${after.slice(-300)}`);
  });

  await h.step('restart: the class and its document are still there', async () => {
    await a.start();
    await a.present('rail', 60_000);
    const names = await a.untilRun('the library', `const s = window.__tramadoE2E; if (!s) return null; const c = s.library.classes.get(); return c.length ? c.map((x) => x.name) : null;`, [], 30_000);
    assert(names.includes('Direito Constitucional'), `classes after a restart: ${names}`);
    await a.quitByClose();
  });

  if (live) {
    await h.step('the key is in no file of the data folder except the secrets store, and in no log', async () => {
      const hits = [];
      const needles = [key, key.slice(-24)];
      for (const rel of a.files()) {
        if (rel === 'config/secrets.json') continue;
        const bytes = a.read(rel);
        for (const n of needles) if (bytes.includes(Buffer.from(n, 'utf8')) || bytes.includes(Buffer.from(n, 'utf16le'))) hits.push(rel);
      }
      assert(!hits.length, `the key is in: ${[...new Set(hits)].join(', ')}`);
      const secrets = a.read('config/secrets.json');
      assert(secrets.includes(Buffer.from(key)), 'the secrets store does not hold the key (the test would prove nothing)');
      return `${a.files().length} files checked`;
    });
  }
}

/** One Ask through the Ask tab; returns which model answered (from the AI activity log). */
async function liveAsk(a, classId) {
  await a.call('ai_activity_clear');
  await openTab(a, classId, 'ask');
  await a.present('ask-input', 30_000);
  await a.type('ask-input', 'Segundo o regulamento, quem pode inscrever-se na época de recurso? Responda numa frase.');
  await a.click('ask-send');
  const end = Date.now() + 5 * 60_000;
  let text = '';
  for (;;) {
    const st = await a.js(`const t = [...document.querySelectorAll('[data-testid="ai-answer-text"]')].at(-1);
      const err = document.querySelector('[data-testid^="ai-recover-"], [data-testid="ai-busy-retry"]');
      return { text: t ? t.textContent : '', busy: !!document.querySelector('[data-testid="ask-turn"] [aria-busy="true"]'), err: err ? err.dataset.testid : null };`);
    text = st.text;
    if (st.err) throw new Error(`the answer failed (${st.err}): ${(await a.bodyText()).slice(0, 300)}`);
    if (text.trim().length > 20 && !st.busy) break;
    if (Date.now() > end) throw new Error(`no answer in 5 min (text so far: ${text.slice(0, 100)})`);
    await sleep(1000);
  }
  await sleep(1500);
  const activity = await a.call('ai_activity', { limit: 20 });
  // The turn records the model that answered (the chain's first model may have been busy).
  const turn = await a.run(`const ask = window.__tramadoE2E.forClass(arguments[0]).ask;
    const t = ask.threads.get()[0]; if (!t) return null;
    const turns = ask.thread(t.threadId).get(); const last = turns.at(-1);
    return last ? { model: last.model, status: last.status, citations: last.citations.length } : null;`, classId);
  assert(turn && turn.status === 'ok' && turn.model, `the turn: ${JSON.stringify(turn)}`);
  const model = turn.model;
  const requests = activity.filter((x) => /chat\/completions/.test(x.path)).map((x) => `${x.status ?? x.code}`);
  const cites = await a.js(`return document.querySelectorAll('[data-testid="ask-turn"] [data-testid="cite-chip"], [data-testid="ask-turn"] .cite').length`);
  return `answered by ${model} (chat requests in the activity log: ${requests.join(', ') || 'none'}; ${turn.citations} citation(s), ${cites} on screen): "${text.replace(/\s+/g, ' ').slice(0, 140)}"`;
}
