// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Pieces of the flows shared by the suites: onboarding, a new class, imports, and the probes of the real webview
// (CSP style-src, fonts, no network).
import { lookup } from 'node:dns/promises';
import { assert, sleep } from './lib.mjs';

/** Onboarding (UX §3.1): welcome → name → AI (key or "Not now") → ready → create | join | finish. */
export async function onboard(a, { name, key = null, then = 'finish' }) {
  await a.present('onboarding-welcome', 90_000);
  await a.click('onboarding-start');
  await a.type('onboarding-name-input', name);
  await a.click('onboarding-name-continue');
  // Continue creates the sharing identity (Syncthing generates its certificate) and starts the services.
  await a.present('onboarding-ai', 120_000);
  if (key) {
    await a.type('onboarding-ai-key', key);
    await a.click('onboarding-ai-test');
    const state = await a.until('the key test', `const r = document.querySelector('[data-testid="onboarding-ai-result"]'); return r && r.dataset.state !== 'checking' ? (r.dataset.state || r.textContent) : null`, [], 60_000);
    assert(state === 'ok', `the key test failed: ${state}`);
    await a.click('onboarding-ai-continue');
  } else {
    await a.click('onboarding-ai-skip');
  }
  await a.present('onboarding-ready', 30_000);
  await a.click(then === 'create' ? 'onboarding-create' : then === 'join' ? 'onboarding-join' : 'onboarding-finish');
  return a.untilRun('the services', `const s = window.__tramadoE2E; return s ? { member: s.ctx.identity.get()?.memberId ?? null } : null;`, [], 30_000);
}

/** The New class dialog (already open when fromDialog, else from the rail). Returns the class id. */
export async function createClass(a, { name, share, fromDialog = false }) {
  if (!fromDialog) await a.click('rail-new-class');
  await a.present('class-dialog', 30_000);
  await a.type('class-name', name, { clear: true });
  const on = (await a.attr('class-share', 'aria-checked')) === 'true' || (await a.js(`const n = document.querySelector('[data-testid="class-share"]'); const i = n && (n.matches('input') ? n : n.querySelector('input')); return !!(i && i.checked)`));
  if (on !== share) await a.click('class-share');
  await a.click('class-dialog-save');
  if (share) {
    // The first shared class asks about the tray and autostart (UX §3.10.1).
    const first = await a.until('the class or the first-share question', `return document.querySelector('[data-testid="first-share-dialog"]') ? 'first' : document.querySelector('[data-testid="screen-class"]') ? 'class' : null`, [], 60_000);
    if (first === 'first') {
      await a.click('first-share-done');
      await a.gone('first-share-dialog', 15_000);
    }
  }
  const id = await a.untilRun('the class in the library', `const s = window.__tramadoE2E; return s.library.classes.get().find((c) => c.name === arguments[0])?.id ?? null;`, [name], 60_000);
  await a.until('its screen', `const s = document.querySelector('[data-testid="screen-class"]'); return s && s.dataset.classId === arguments[0]`, [id], 60_000);
  return id;
}

/** Add › Documents… with the files answered through the dialog queue; waits for their rows. */
export async function importDocuments(a, paths) {
  a.queueDialogs({ paths });
  await a.click('class-add');
  await a.click('class-add-documents');
  await a.present('class-documents', 30_000);
  const rows = await a.until(`${paths.length} document row(s)`, `const r = document.querySelectorAll('[data-testid="doc-item"]'); return r.length >= arguments[0] ? r.length : null`, [paths.length], 60_000);
  assert(a.pendingDialogs() === 0, 'the dialog answer was not used');
  return `${rows} row(s)`;
}

/** Each kind of style applies in the real webview (Tauri would otherwise add a nonce to style-src). */
export async function cspProbe(a, rootId) {
  const r = await a.js(`const root = document.querySelector('[data-testid="' + arguments[0] + '"]');
    const probe = document.createElement('div');
    probe.style.width = '123px';
    probe.setAttribute('data-e2e', '');
    document.body.appendChild(probe);
    const attr = document.createElement('div');
    attr.setAttribute('style', 'width: 77px');
    document.body.appendChild(attr);
    const tag = document.createElement('style');
    tag.textContent = '[data-e2e] { height: 31px; }';
    document.head.appendChild(tag);
    const out = { rootDisplay: root ? getComputedStyle(root).display : null, cssom: probe.getBoundingClientRect().width,
      attribute: attr.getBoundingClientRect().width, styleTag: probe.getBoundingClientRect().height,
      bg: getComputedStyle(document.body).backgroundColor, sheets: document.styleSheets.length,
      inline: [...document.querySelectorAll('[style]')].length };
    probe.remove(); attr.remove(); tag.remove();
    return out;`, rootId);
  assert(r.rootDisplay && r.rootDisplay !== 'block' && r.rootDisplay !== 'inline', `the screen has no layout (display ${r.rootDisplay}): stylesheets not applied`);
  assert(r.cssom === 123, `inline style (CSSOM) dropped: ${r.cssom}`);
  assert(r.attribute === 77, `style attribute dropped: ${r.attribute}`);
  assert(r.styleTag === 31, `<style> element ignored: ${r.styleTag}`);
  return `${rootId} display ${r.rootDisplay}; ${r.sheets} stylesheets; body ${r.bg}; ${r.inline} elements with inline styles`;
}

export async function fontsProbe(a) {
  const r = await a.run(`await document.fonts.ready;
    await Promise.all(['16px "Figtree Variable"', '16px "Bricolage Grotesque Variable"', '16px "Source Serif 4 Variable"'].map((f) => document.fonts.load(f)));
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''));
    const h1 = document.querySelector('h1');
    return { loaded: [...new Set(loaded)], ui: getComputedStyle(document.body).fontFamily, heading: h1 ? getComputedStyle(h1).fontFamily : null };`);
  assert(!r.error, r.error);
  for (const f of ['Figtree Variable', 'Bricolage Grotesque Variable', 'Source Serif 4 Variable']) assert(r.loaded.includes(f), `${f} did not load (loaded: ${r.loaded.join(', ') || 'none'})`);
  assert(/^"?Figtree Variable/.test(r.ui), `the interface font is ${r.ui}`);
  return `loaded: ${r.loaded.join(', ')}; heading ${r.heading?.split(',')[0]}`;
}

/** The webview has no network: plugin commands refused, CSP blocks, and no external socket anywhere. */
export async function networkProbe(a) {
  const refused = {};
  for (const [cmd, args] of [
    ['plugin:http|fetch', { clientConfig: { method: 'GET', url: 'https://example.com/', headers: [], data: null } }],
    ['plugin:opener|open_url', { url: 'https://example.com/' }],
    ['plugin:shell|open', { path: 'https://example.com/' }],
    ['plugin:dialog|open', { options: {} }],
    ['plugin:notification|notify', { options: { title: 'x' } }],
  ]) {
    const r = await a.invoke(cmd, args);
    assert(r.denied, `${cmd} was not refused: ${JSON.stringify(r)}`);
    refused[cmd] = r.denied.slice(0, 60);
  }
  // The AI pipe refuses a host nobody allowed and plain http.
  const allow = await a.invoke('ai_host_allow', { base: 'http://example.org/v1', text: { title: 'T', message: 'Open {host}?', confirm: 'Yes', cancel: 'No' } });
  assert(/AI_BAD_ADDRESS/.test(allow.denied ?? ''), `ai_host_allow over plain http was not refused: ${JSON.stringify(allow)}`);
  const r = await a.run(`const violations = [];
    const onV = (e) => violations.push(e.violatedDirective + ' ' + e.blockedURI);
    document.addEventListener('securitypolicyviolation', onV);
    const outcome = {};
    try { await fetch('https://example.com/?tramado-e2e'); outcome.fetch = 'allowed'; } catch (e) { outcome.fetch = 'blocked: ' + e.message; }
    try { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/xhr'); await new Promise((res) => { x.onloadend = res; x.send(); }); outcome.xhr = x.status ? 'allowed' : 'blocked'; } catch (e) { outcome.xhr = 'blocked: ' + e.message; }
    try { const ws = new WebSocket('wss://example.com/'); outcome.ws = await new Promise((res) => { ws.onopen = () => res('allowed'); ws.onerror = () => res('blocked'); setTimeout(() => res('blocked (timeout)'), 4000); }); } catch (e) { outcome.ws = 'blocked: ' + e.message; }
    const img = new Image(); img.src = 'https://example.com/pixel.png?tramado-e2e';
    outcome.img = await new Promise((res) => { img.onload = () => res('allowed'); img.onerror = () => res('blocked'); setTimeout(() => res('blocked (timeout)'), 4000); });
    await new Promise((res) => setTimeout(res, 300));
    document.removeEventListener('securitypolicyviolation', onV);
    return { outcome, violations };`);
  assert(!r.error, r.error);
  for (const [k, v] of Object.entries(r.outcome)) assert(v.startsWith('blocked'), `${k} to example.com was ${v}`);
  const connect = r.violations.filter((v) => /^connect-src .*example\.com/.test(v));
  assert(connect.length >= 2, `fetch/XHR were not blocked by the CSP (violations: ${r.violations.join('; ') || 'none'})`);
  assert(r.violations.some((v) => /^img-src .*example\.com/.test(v)), `the image was not blocked by the CSP (violations: ${r.violations.join('; ')})`);
  const s = a.sockets();
  const ext = [...s.app, ...s.webkit, ...s.syncthing].filter((x) => x.external);
  assert(!ext.length, `external sockets: ${ext.map((x) => `${x.pid} ${x.proto} ${x.local} → ${x.remote}`).join(', ')}`);
  return `refused: ${Object.keys(refused).join(', ')}; CSP violations: ${r.violations.length}; ${s.processes} processes (${s.exes.join(', ')}), ${s.app.length + s.webkit.length + s.syncthing.length} sockets, none external`;
}

// Critique C38: the app process may reach OpenRouter, Hugging Face (and its CDN) and Syncthing's lookup server.
const ALLOWED_HOSTS = new Set(['openrouter.ai', 'huggingface.co', 'cdn-lfs.hf.co', 'cdn-lfs-us-1.hf.co', 'cas-bridge.xethub.hf.co', 'discovery-lookup.syncthing.net']);
const allowedIps = new Map();
export function allowHost(host) {
  ALLOWED_HOSTS.add(host);
}
/** Whether an IP belongs to an allow-listed host (resolved now; addresses rotate). */
export async function allowListed(ip) {
  for (const host of ALLOWED_HOSTS) {
    if (!allowedIps.has(host) || Date.now() - allowedIps.get(host).at > 60_000) {
      const ips = await lookup(host, { all: true }).then((l) => l.map((x) => x.address), () => []);
      allowedIps.set(host, { at: Date.now(), ips: new Set(ips) });
    }
    if (allowedIps.get(host).ips.has(ip)) return host;
  }
  return null;
}

/** Waits until fn() is truthy (Node side). */
export async function waitFor(what, fn, timeout = 60_000, every = 500) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeout / 1000} s waiting for ${what}`);
    await sleep(every);
  }
}

/**
 * Visits screens and checks each: no crash screen, nothing wider than the window. Returns the labels visited; throws
 * with every problem found. `classId`: every tab of that class; `settings`: every section; `palette`: the palette.
 */
export async function tour(a, { today = true, classId = null, settings = false, palette = false } = {}) {
  const problems = [];
  const visited = [];
  const fits = async (label) => {
    await sleep(500);
    const crash = await a.crashText();
    if (crash) problems.push(`${label}: crash screen: ${crash.slice(0, 200)}`);
    const fit = await a.js(`const de = document.documentElement; return { inner: innerWidth, doc: de.scrollWidth, body: document.body.scrollWidth };`);
    if (fit.doc > fit.inner + 1 || fit.body > fit.inner + 1) problems.push(`${label}: page ${Math.max(fit.doc, fit.body)} px in a ${fit.inner} px window`);
    visited.push(label);
  };
  if (today) {
    await a.click('nav-today');
    await a.present('screen-today', 15_000);
    await fits('today');
  }
  if (classId) {
    await a.click('rail-class', { selector: `[data-testid="rail-class"][data-class-id="${classId}"]` });
    await a.present('class-tabs', 15_000);
    const tabs = await a.js(`return [...document.querySelectorAll('[data-testid^="class-tabs-"]')].map((e) => e.dataset.testid.slice('class-tabs-'.length)).filter((x) => !x.includes('-'))`);
    for (const tab of tabs) {
      await a.click(`class-tabs-${tab}`);
      await a.until(`the ${tab} tab`, `const s = document.querySelector('[data-testid="screen-class"]'); return s && s.dataset.tab === arguments[0]`, [tab], 15_000);
      await fits(`class › ${tab}`);
    }
  }
  if (settings) {
    await a.click('nav-settings');
    const sections = await a.until('the settings sections', `const n = [...document.querySelectorAll('[data-testid^="settings-nav-"]')].map((e) => e.dataset.testid.slice('settings-nav-'.length)); return n.length ? n : null`, [], 15_000);
    for (const sec of sections) {
      await a.click(`settings-nav-${sec}`);
      await fits(`settings › ${sec}`);
    }
  }
  if (palette) {
    await a.click('rail-search');
    await a.present('palette', 10_000);
    await fits('palette');
    await a.keys('\uE00C');
  }
  if (problems.length) throw new Error(problems.join('\n      '));
  return visited;
}

/** The page errors an instance collected since its session started (or since the last reset). */
export async function pageErrors(a, reset = false) {
  const errors = (await a.js('return window.__e2eErrors || []')) ?? [];
  if (reset) await a.js('window.__e2eErrors = []');
  return errors;
}
