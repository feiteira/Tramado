// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (tools/desktop-e2e/run.mjs), MPL-2.0, same author.
//
// The plumbing of the desktop end-to-end suites (plan §8.1, research/trama-ui.md §4.5): a private X display, one
// tauri-driver (+ WebKitWebDriver, under its own D-Bus session) per app instance, W3C WebDriver over `fetch`, steps
// with failure reports, the socket audit of critique C38 and the window close a person makes (X11 WM_DELETE_WINDOW,
// so the app's exit handlers run). No npm dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const since = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
const TRIPLE = process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
export const SIDECAR = join(ROOT, `desktop/src-tauri/binaries/tramado-syncthing-${TRIPLE}`);
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

// Strings that must never reach the output (the OpenRouter key in a live run). Every line the harness prints goes
// through redact().
const secrets = new Set();
export function addSecret(s) {
  if (s && s.length >= 8) secrets.add(s);
}
export function redact(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('«redacted»');
  return out;
}
export const say = (...a) => console.log(redact(a.join(' ')));
export const warn = (...a) => console.error(redact(a.join(' ')));

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** A free local TCP port. */
export const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

/** Every file under a folder, recursively (symbolic links are not followed). */
export function filesUnder(dir) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// ── Processes (/proc) ────────────────────────────────────────────────────────────────────────────────────────────

function procExe(pid) {
  try {
    return readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return '';
  }
}
function procEnv(pid) {
  try {
    return readFileSync(`/proc/${pid}/environ`, 'latin1').split('\0');
  } catch {
    return [];
  }
}
function procPpid(pid) {
  try {
    return Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[1]);
  } catch {
    return -1;
  }
}
export function allPids() {
  return readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number);
}
/** pid → children, for the whole system. */
function childrenMap() {
  const m = new Map();
  for (const pid of allPids()) {
    const pp = procPpid(pid);
    if (!m.has(pp)) m.set(pp, []);
    m.get(pp).push(pid);
  }
  return m;
}
function subtree(root, kids = childrenMap()) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    out.push(p);
    for (const c of kids.get(p) ?? []) stack.push(c);
  }
  return out;
}

const isLoopback = (hex) =>
  hex.length === 8
    ? hex.endsWith('7F') || hex === '00000000'
    : /^0{24}01000000$|^0{20}FFFF0000[0-9A-F]{6}7F$|^0{32}$/.test(hex);
function hexToIp(hex) {
  if (hex.length === 8) return [3, 2, 1, 0].map((i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).join('.');
  if (/^0{20}FFFF0000/.test(hex)) return hexToIp(hex.slice(24));
  const words = [];
  for (let i = 0; i < 4; i++) {
    const w = hex.slice(i * 8, i * 8 + 8);
    const b = [3, 2, 1, 0].map((k) => w.slice(k * 2, k * 2 + 2)).join('');
    words.push(b.slice(0, 4), b.slice(4));
  }
  return words.map((w) => parseInt(w, 16).toString(16)).join(':');
}

/**
 * Sockets of a set of processes, read from each process's own network namespace (WebKit may run its helpers in a
 * sandbox). Each entry: { proto, local, remote, remoteIp, external } where external = either end beyond loopback.
 */
export function socketsOf(pids) {
  const out = [];
  for (const pid of pids) {
    const inodes = new Set();
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try {
          const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`));
          if (m) inodes.add(m[1]);
        } catch {}
      }
    } catch {}
    if (!inodes.size) continue;
    for (const proto of ['tcp', 'tcp6', 'udp', 'udp6']) {
      let lines = [];
      try {
        lines = readFileSync(`/proc/${pid}/net/${proto}`, 'utf8').trim().split('\n').slice(1);
      } catch {}
      for (const line of lines) {
        const f = line.trim().split(/\s+/);
        if (!inodes.has(f[9])) continue;
        const [lh, lp] = f[1].split(':');
        const [rh, rp] = f[2].split(':');
        const listening = /^0+$/.test(rh) && parseInt(rp, 16) === 0;
        out.push({
          pid,
          proto,
          local: `${hexToIp(lh)}:${parseInt(lp, 16)}`,
          remote: `${hexToIp(rh)}:${parseInt(rp, 16)}`,
          remoteIp: listening ? null : hexToIp(rh),
          external: !isLoopback(lh) || !isLoopback(rh),
        });
      }
    }
  }
  return out;
}

// ── X display ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A private Xvfb display (its number chosen by Xvfb itself). */
export async function startXvfb(size = '1440x900x24') {
  const x = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', size, '-nolisten', 'tcp', '-noreset'], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let err = '';
  x.stderr.on('data', (d) => (err += d));
  const n = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error(`Xvfb did not start: ${err.slice(-300)}`)), 15_000);
    x.stdio[3].on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) {
        clearTimeout(t);
        res(buf.trim());
      }
    });
    x.on('exit', (c) => {
      clearTimeout(t);
      rej(new Error(`Xvfb exited (${c}): ${err.slice(-300)}`));
    });
  });
  return { display: `:${n}`, proc: x };
}

// The window close a person makes: an X11 WM_DELETE_WINDOW to the program's mapped windows (Xvfb has no window
// manager to send it). WebDriver's "close window" ends the process at once, which would skip the exit handlers.
export const CLOSE_WINDOWS_PY = String.raw`
import ctypes as C, sys
pid = int(sys.argv[1])
x = C.cdll.LoadLibrary('libX11.so.6')
x.XOpenDisplay.restype = C.c_void_p; x.XOpenDisplay.argtypes = [C.c_char_p]
x.XDefaultRootWindow.restype = C.c_ulong; x.XDefaultRootWindow.argtypes = [C.c_void_p]
x.XInternAtom.restype = C.c_ulong; x.XInternAtom.argtypes = [C.c_void_p, C.c_char_p, C.c_int]
x.XQueryTree.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ulong)), C.POINTER(C.c_uint)]
x.XGetWindowProperty.argtypes = [C.c_void_p, C.c_ulong, C.c_ulong, C.c_long, C.c_long, C.c_int, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.c_void_p)]
x.XSendEvent.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_long, C.c_void_p]
x.XFlush.argtypes = [C.c_void_p]
x.XFree.argtypes = [C.c_void_p]
class Attrs(C.Structure):
    _fields_ = [('x', C.c_int), ('y', C.c_int), ('w', C.c_int), ('h', C.c_int), ('bw', C.c_int), ('depth', C.c_int), ('visual', C.c_void_p), ('root', C.c_ulong), ('cls', C.c_int), ('bit_gravity', C.c_int), ('win_gravity', C.c_int), ('backing_store', C.c_int), ('planes', C.c_ulong), ('pixel', C.c_ulong), ('save_under', C.c_int), ('colormap', C.c_ulong), ('map_installed', C.c_int), ('map_state', C.c_int), ('all_masks', C.c_long), ('your_mask', C.c_long), ('dnp', C.c_long), ('override', C.c_int), ('screen', C.c_void_p)]
x.XGetWindowAttributes.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(Attrs)]
class Msg(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', C.c_void_p), ('window', C.c_ulong), ('message_type', C.c_ulong), ('format', C.c_int), ('l', C.c_long * 5)]
class Event(C.Union):
    _fields_ = [('xclient', Msg), ('pad', C.c_long * 24)]
d = x.XOpenDisplay(None)
if not d: sys.exit('cannot open the X display')
NET_WM_PID = x.XInternAtom(d, b'_NET_WM_PID', 0)
PROTOCOLS = x.XInternAtom(d, b'WM_PROTOCOLS', 0)
DELETE = x.XInternAtom(d, b'WM_DELETE_WINDOW', 0)
def prop_pid(w):
    t, f, n, a, p = C.c_ulong(), C.c_int(), C.c_ulong(), C.c_ulong(), C.c_void_p()
    if x.XGetWindowProperty(d, w, NET_WM_PID, 0, 1, 0, 6, C.byref(t), C.byref(f), C.byref(n), C.byref(a), C.byref(p)) != 0 or not p.value: return None
    v = C.cast(p, C.POINTER(C.c_ulong))[0] if n.value else None
    x.XFree(p)
    return v
def walk(w):
    r, par, ch, n = C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)(), C.c_uint()
    if not x.XQueryTree(d, w, C.byref(r), C.byref(par), C.byref(ch), C.byref(n)): return
    kids = [ch[i] for i in range(n.value)]
    if ch: x.XFree(ch)
    for k in kids:
        yield k
        yield from walk(k)
mode = sys.argv[2] if len(sys.argv) > 2 else 'close'
sent = 0
for w in walk(x.XDefaultRootWindow(d)):
    a = Attrs()
    if prop_pid(w) != pid or not x.XGetWindowAttributes(d, w, C.byref(a)): continue
    if mode == 'mapped':
        if a.map_state == 2: sent += 1
        continue
    if a.map_state != 2: continue
    e = Event(); e.xclient.type = 33; e.xclient.window = w; e.xclient.message_type = PROTOCOLS; e.xclient.format = 32
    e.xclient.l[0] = DELETE
    x.XSendEvent(d, w, 0, 0, C.byref(e)); sent += 1
x.XFlush(d)
print(sent)
`;

// ── The harness ──────────────────────────────────────────────────────────────────────────────────────────────────

export class Harness {
  constructor({ suite, bin, keep, artifacts }) {
    this.suite = suite;
    this.bin = bin;
    /** The app process's executable name (an AppImage's AppRun execs usr/bin/tramado-desktop). */
    this.exe = basename(bin) === 'AppRun' ? 'tramado-desktop' : basename(bin);
    /** A bundle carries its Syncthing sidecar beside the binary. */
    this.bundled = basename(bin) === 'AppRun' ? existsSync(join(dirname(bin), 'usr/bin/tramado-syncthing')) : existsSync(join(dirname(bin), 'tramado-syncthing'));
    this.keep = keep;
    this.work = mkdtempSync(join(tmpdir(), `tramado-e2e-${suite}-`));
    this.artifacts = artifacts ?? join(this.work, 'artifacts');
    mkdirSync(this.artifacts, { recursive: true });
    this.apps = [];
    this.timings = [];
    this.cleanups = [];
    this.display = null;
    this.t0 = Date.now();
    this.privateBus = spawnSync('dbus-run-session', ['--version']).status === 0;
  }

  async startDisplay() {
    const x = await startXvfb();
    this.display = x.display;
    this.onCleanup(() => {
      try {
        process.kill(-x.proc.pid, 'SIGKILL');
      } catch {}
    });
  }

  onCleanup(fn) {
    this.cleanups.push(fn);
  }

  /** A new app instance with its own TRAMADO_DATA_DIR (not started). */
  app(name, opts = {}) {
    const a = new App(this, name, opts);
    this.apps.push(a);
    return a;
  }

  async step(name, fn) {
    const t = Date.now();
    say(`• ${name}`);
    try {
      const note = await fn();
      if (note) say(`    ${typeof note === 'string' ? note : JSON.stringify(note)}`);
      this.timings.push([name, Date.now() - t]);
      say(`    ok (${since(t)})`);
      return note;
    } catch (e) {
      warn(`    ✗ ${e.message}`);
      for (const a of this.apps) await a.report(name);
      e.reported = true;
      throw e;
    }
  }

  async cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    for (const a of this.apps) await a.kill().catch(() => {});
    for (const fn of this.cleanups.reverse()) {
      try {
        await fn();
      } catch {}
    }
    if (this.keep) say(`  kept: ${this.work}`);
    else {
      // Keep the artifacts (screenshots, reports) when they sit inside the work folder and something is in them.
      const pngs = filesUnder(this.artifacts);
      for (const e of readdirSync(this.work)) if (join(this.work, e) !== this.artifacts) rmSync(join(this.work, e), { recursive: true, force: true });
      if (!pngs.length) rmSync(this.work, { recursive: true, force: true });
    }
  }
}

export class App {
  constructor(h, name, { env = {}, speechDir = null } = {}) {
    this.h = h;
    this.name = name;
    this.dir = join(h.work, name);
    mkdirSync(this.dir, { recursive: true });
    this.dialogs = join(this.dir, 'dialogs.json');
    writeFileSync(this.dialogs, '[]');
    this.extraEnv = env;
    this.speechDir = speechDir;
    this.driver = null;
    this.port = 0;
    this.session = null;
    this.domClicks = false;
  }

  get log() {
    return join(this.dir, 'data/logs/app.log');
  }

  env() {
    const bundled = this.h.bundled;
    return {
      ...process.env,
      DISPLAY: this.h.display,
      TRAMADO_DATA_DIR: this.dir,
      TRAMADO_E2E: '1',
      TRAMADO_E2E_DIALOGS: this.dialogs,
      ...(bundled ? {} : { TRAMADO_SYNCTHING_BIN: SIDECAR }),
      ...(this.speechDir ? { TRAMADO_SPEECH_DIR: this.speechDir } : {}),
      // Software rendering: Xvfb has no GPU.
      WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      LIBGL_ALWAYS_SOFTWARE: '1',
      NO_AT_BRIDGE: '1',
      GTK_A11Y: 'none',
      ...this.extraEnv,
    };
  }

  async startDriver() {
    await this.stopDriver();
    this.port = await freePort();
    const nativePort = await freePort();
    const log = [];
    const cmd = ['tauri-driver', '--port', String(this.port), '--native-port', String(nativePort)];
    // A private D-Bus session per instance: no desktop portals to wait for (~30 s per start under Xvfb otherwise).
    if (this.h.privateBus) cmd.unshift('dbus-run-session', '--');
    const d = spawn(cmd[0], cmd.slice(1), { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    d.log = log;
    const keep = (x) => {
      log.push(String(x));
      if (log.length > 200) log.shift();
    };
    d.stdout.on('data', keep);
    d.stderr.on('data', keep);
    this.driver = d;
    const end = Date.now() + 20_000;
    for (;;) {
      if (d.exitCode !== null) throw new Error(`tauri-driver exited (${d.exitCode}): ${log.join('').slice(-800)}`);
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/status`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
      } catch {}
      if (Date.now() > end) throw new Error('tauri-driver did not start listening within 20 s');
      await sleep(200);
    }
  }

  async stopDriver() {
    if (!this.driver) return;
    const d = this.driver;
    this.driver = null;
    const group = (sig) => {
      try {
        process.kill(-d.pid, sig);
      } catch {}
    };
    if (d.exitCode === null) {
      group('SIGTERM');
      await Promise.race([new Promise((r) => d.once('exit', r)), sleep(5000)]);
    }
    group('SIGKILL');
  }

  async wd(method, path, body, timeout = 90_000) {
    const url = `http://127.0.0.1:${this.port}/session${this.session ? `/${this.session}` : ''}${path}`;
    let res;
    try {
      res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      throw new Error(`${this.name}: ${method} ${path}: ${e.name === 'TimeoutError' ? `no answer in ${timeout / 1000} s` : e.message}`);
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${this.name}: ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    if (json.value?.error) throw new Error(`${this.name}: ${method} ${path}: ${json.value.error} ${json.value.message ?? ''}`.trim());
    return json.value;
  }

  /** Starts the driver and the app (a new WebDriver session). */
  async start(args = []) {
    if (!this.driver) await this.startDriver();
    this.session = null;
    const t = Date.now();
    const s = await this.wd('POST', '', { capabilities: { alwaysMatch: { 'tauri:options': { application: this.h.bin, args } } } }, 120_000);
    this.session = s.sessionId;
    say(`    (${this.name}: session in ${since(t)})`);
    await this.js(`if (!window.__e2eErrors) {
      window.__e2eErrors = [];
      const keep = (m) => { window.__e2eErrors.push(String(m).slice(0, 500)); if (window.__e2eErrors.length > 30) window.__e2eErrors.shift(); };
      window.addEventListener('error', (e) => keep('error: ' + (e.message || e)));
      window.addEventListener('unhandledrejection', (e) => keep('unhandled: ' + (e.reason && e.reason.stack || e.reason)));
      const ce = console.error.bind(console);
      console.error = (...a) => { keep('console.error: ' + a.map((x) => x && x.stack || x).join(' ')); ce(...a); };
    }`);
  }

  js(script, ...args) {
    return this.wd('POST', '/execute/sync', { script, args });
  }
  /** Runs an async function body in the page; its resolved value comes back (errors as {error}). */
  run(body, ...args) {
    return this.wd(
      'POST',
      '/execute/async',
      {
        script: `const done = arguments[arguments.length - 1];
      (async (...args) => { ${body} })(...Array.prototype.slice.call(arguments, 0, -1))
        .then((v) => done(v === undefined ? null : v), (e) => done({ error: String(e && e.stack || e) }));`,
        args,
      },
      180_000,
    );
  }
  /** A command through Tauri's IPC, as the bindings call it: {ok} or {denied: "<code>: <message>"}. */
  invoke(cmd, args = {}) {
    return this.run(
      `try { return { ok: await window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]) }; }
       catch (e) { return { denied: typeof e === 'string' ? e : (e && e.code ? e.code + ': ' + (e.message || '') : JSON.stringify(e)) }; }`,
      cmd,
      args,
    );
  }
  async call(cmd, args = {}) {
    const r = await this.invoke(cmd, args);
    if (!('ok' in r)) throw new Error(`${this.name}: ${cmd} failed: ${r.denied ?? r.error}`);
    return r.ok;
  }

  async crashText() {
    return this.js(`const d = document.querySelector('[data-testid="crash-details"], [data-testid="error-boundary"]'); return d ? (d.value || d.textContent || 'crashed').slice(0, 2000) : null;`).catch(() => null);
  }

  /** Waits until a page script returns something truthy; returns it. */
  async until(what, script, args = [], timeout = 30_000) {
    const end = Date.now() + timeout;
    let last;
    for (let i = 0; ; i++) {
      try {
        const v = await this.js(script, ...args);
        if (v) return v;
      } catch (e) {
        last = e;
      }
      if (i % 8 === 7) {
        const crash = await this.crashText();
        if (crash) throw new Error(`${this.name}: the app crashed while waiting for ${what}:\n${crash}`);
      }
      if (Date.now() > end) throw new Error(`${this.name}: timed out after ${timeout / 1000} s waiting for ${what}${last ? ` (${last.message})` : ''}`);
      await sleep(250);
    }
  }
  /** Waits for an async page body to return something truthy. */
  async untilRun(what, body, args = [], timeout = 30_000) {
    const end = Date.now() + timeout;
    let last;
    for (;;) {
      try {
        const v = await this.run(body, ...args);
        if (v && !v.error) return v;
        if (v?.error) last = new Error(v.error.split('\n')[0]);
      } catch (e) {
        last = e;
      }
      if (Date.now() > end) throw new Error(`${this.name}: timed out after ${timeout / 1000} s waiting for ${what}${last ? ` (${last.message})` : ''}`);
      await sleep(500);
    }
  }

  static sel(id) {
    return `[data-testid="${id}"]`;
  }
  present(id, timeout = 30_000) {
    return this.until(id, 'return !!document.querySelector(arguments[0])', [App.sel(id)], timeout);
  }
  gone(id, timeout = 30_000) {
    return this.until(`${id} to go`, 'return !document.querySelector(arguments[0])', [App.sel(id)], timeout);
  }
  exists(id) {
    return this.js('return !!document.querySelector(arguments[0])', App.sel(id));
  }
  text(id) {
    return this.js('const e = document.querySelector(arguments[0]); return e ? e.textContent : null', App.sel(id));
  }
  attr(id, name) {
    return this.js('const e = document.querySelector(arguments[0]); return e ? e.getAttribute(arguments[1]) : null', App.sel(id), name);
  }
  async find(id, timeout = 30_000, selector = App.sel(id)) {
    await this.until(id, 'return !!document.querySelector(arguments[0])', [selector], timeout);
    return (await this.wd('POST', '/element', { using: 'css selector', value: selector }))[ELEMENT];
  }
  /** Clicks an element by test id (or selector) once it is enabled; WebDriver's pointer unless domClicks. */
  async click(id, { selector = App.sel(id), timeout = 30_000, dom = this.domClicks } = {}) {
    const el = await this.find(id, timeout, selector);
    await this.until(`${id} to be enabled`, 'const e = document.querySelector(arguments[0]); return e && !e.disabled && e.getAttribute("aria-disabled") !== "true" && e.getAttribute("aria-busy") !== "true"', [selector], timeout);
    if (dom) await this.js('document.querySelector(arguments[0]).scrollIntoView({block: "center"}); document.querySelector(arguments[0]).click()', selector);
    else {
      try {
        await this.wd('POST', `/element/${el}/click`, {});
      } catch (e) {
        // An element under an overlay or out of view: the DOM click (still the element's own handler).
        if (!/intercepted|not interactable|out of bounds|stale/i.test(e.message)) throw e;
        await this.js('document.querySelector(arguments[0]).click()', selector);
      }
    }
  }
  /** Types into an input (the test id may be on the input or on its field wrapper). */
  async type(id, text, { clear = false } = {}) {
    const selector = await this.js(
      `const n = document.querySelector(arguments[0]); if (!n) return null;
       if (n.matches('input, textarea, [contenteditable="true"]')) return arguments[0];
       return n.querySelector('input, textarea') ? arguments[0] + ' input, ' + arguments[0] + ' textarea' : arguments[0];`,
      App.sel(id),
    ).then(async (s) => s ?? (await this.present(id), App.sel(id)));
    const el = await this.find(id, 30_000, selector);
    if (clear) await this.wd('POST', `/element/${el}/clear`, {});
    await this.wd('POST', `/element/${el}/value`, { text });
  }
  /** Sets an input's value through React's setter (fast, no key events). */
  async fill(id, text) {
    const ok = await this.js(
      `const n = document.querySelector(arguments[0]); const input = n && (n.matches('input, textarea') ? n : n.querySelector('input, textarea'));
       if (!input) return false;
       const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
       Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, arguments[1]);
       input.dispatchEvent(new Event('input', { bubbles: true }));
       return true;`,
      App.sel(id),
      text,
    );
    assert(ok, `${this.name}: no input ${id}`);
  }
  async keys(...seq) {
    const actions = [...seq.map((value) => ({ type: 'keyDown', value })), ...seq.reverse().map((value) => ({ type: 'keyUp', value }))];
    await this.wd('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions }] });
    await this.wd('DELETE', '/actions').catch(() => {});
  }
  bodyText() {
    return this.js('return document.body.innerText');
  }
  async screenshot(name) {
    if (!this.session) return null;
    try {
      const png = await this.wd('GET', '/screenshot', undefined, 30_000);
      const file = join(this.h.artifacts, `${this.name}-${name.replace(/[^\w.-]+/g, '-')}.png`);
      writeFileSync(file, Buffer.from(png, 'base64'));
      return file;
    } catch {
      return null;
    }
  }

  /** What a failed step prints for this instance. */
  async report(stepName) {
    if (!this.session) return;
    const shot = await this.screenshot(`FAILED ${stepName}`);
    if (shot) warn(`    [${this.name}] screenshot: ${shot}`);
    const crash = await this.crashText();
    if (crash) warn(`    [${this.name}] crash screen:\n${crash}`);
    const errors = await this.js('return window.__e2eErrors || []').catch(() => []);
    if (errors?.length) warn(`    [${this.name}] page errors:\n      ${errors.join('\n      ')}`);
    const text = await this.bodyText().catch(() => '');
    if (text) warn(`    [${this.name}] page text: ${text.replace(/\s+/g, ' ').slice(0, 700)}`);
    const tail = this.logText().split('\n').filter(Boolean).slice(-12);
    if (tail.length) warn(`    [${this.name}] app log (tail):\n      ${tail.join('\n      ')}`);
  }

  // ── Dialog answers (architecture §6.3: TRAMADO_E2E_DIALOGS) ──
  queueDialogs(...answers) {
    let q = [];
    try {
      q = JSON.parse(readFileSync(this.dialogs, 'utf8'));
    } catch {}
    q.push(...answers);
    const tmp = `${this.dialogs}.tmp`;
    writeFileSync(tmp, JSON.stringify(q));
    renameSync(tmp, this.dialogs);
  }
  pendingDialogs() {
    try {
      return JSON.parse(readFileSync(this.dialogs, 'utf8')).length;
    } catch {
      return 0;
    }
  }

  // ── Log ──
  logText() {
    try {
      return readFileSync(this.log, 'utf8');
    } catch {
      return '';
    }
  }
  /** The data objects of the log lines with this message (oldest first). */
  logged(message) {
    const marker = ` ${message} `;
    return this.logText()
      .split('\n')
      .filter((l) => l.includes(marker) || l.endsWith(` ${message}`))
      .map((l) => {
        const at = l.indexOf(marker);
        if (at < 0) return {};
        try {
          return JSON.parse(l.slice(at + marker.length));
        } catch {
          return { raw: l.slice(at + marker.length) };
        }
      });
  }

  // ── Processes ──
  /** The app's own process(es): the binary, started with this instance's TRAMADO_DATA_DIR. */
  pids() {
    const want = `TRAMADO_DATA_DIR=${this.dir}`;
    const exe = this.h.exe;
    return allPids().filter((p) => basename(procExe(p)) === exe && procEnv(p).includes(want));
  }
  pid() {
    const p = this.pids();
    return p.length === 1 ? p[0] : null;
  }
  /** The app, its WebKit helpers and the Syncthing subtree. */
  tree() {
    const app = this.pid();
    if (!app) return { app: null, webkit: [], syncthing: [], all: [] };
    const kids = childrenMap();
    const all = subtree(app, kids);
    const syncRoots = all.filter((p) => /tramado-syncthing/.test(basename(procExe(p))));
    const syncthing = syncRoots.flatMap((p) => subtree(p, kids));
    const webkit = all.filter((p) => p !== app && !syncthing.includes(p));
    return { app, webkit, syncthing, all, exes: Object.fromEntries(all.map((p) => [p, basename(procExe(p))])) };
  }
  /** Critique C38: sockets of the app process, of its WebKit processes and of the Syncthing subtree. */
  sockets() {
    const t = this.tree();
    return {
      processes: t.all.length,
      exes: [...new Set(Object.values(t.exes ?? {}))],
      app: socketsOf(t.app ? [t.app] : []),
      webkit: socketsOf(t.webkit),
      syncthing: socketsOf(t.syncthing),
    };
  }
  isMapped() {
    const pid = this.pid();
    if (!pid) return false;
    const r = spawnSync('python3', ['-c', CLOSE_WINDOWS_PY, String(pid), 'mapped'], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, DISPLAY: this.h.display } });
    return Number(r.stdout) > 0;
  }

  /** Asks the window to close, as a window manager's close button does. */
  closeWindow() {
    const pid = this.pid();
    assert(pid, `${this.name}: expected one running app, found ${this.pids().length}`);
    const r = spawnSync('python3', ['-c', CLOSE_WINDOWS_PY, String(pid)], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, DISPLAY: this.h.display } });
    assert(r.status === 0 && Number(r.stdout) > 0, `${this.name}: could not ask the window to close (python3 and libX11 are needed): ${r.error?.message ?? ''}${r.stderr}${r.stdout}`);
  }

  async waitForExit(timeout = 20_000, message = 'the app did not exit') {
    const end = Date.now() + timeout;
    while (this.pids().length) {
      if (Date.now() > end) {
        for (const p of this.pids()) {
          try {
            process.kill(p, 'SIGKILL');
          } catch {}
        }
        throw new Error(`${this.name}: ${message}`);
      }
      await sleep(200);
    }
  }

  /** Closes the window; the app saves, runs its exit handlers and exits (no shared class). */
  async quitByClose(timeout = 30_000) {
    this.closeWindow();
    await this.waitForExit(timeout, 'the app did not exit after its window was asked to close');
    await this.endSession();
  }

  /** The tray's Quit (app_quit): with shared classes the window close only hides. */
  async quit(timeout = 30_000) {
    if (!this.pid()) return this.endSession();
    // The command does not answer: the app exits under it.
    this.run(`window.__TAURI_INTERNALS__.invoke('app_quit'); return true;`).catch(() => {});
    await this.waitForExit(timeout, 'the app did not exit after app_quit');
    await this.endSession();
  }

  async endSession() {
    if (this.session) await this.wd('DELETE', '', undefined, 15_000).catch(() => {});
    this.session = null;
    await this.stopDriver();
  }

  async kill() {
    for (const p of this.tree().all.reverse()) {
      try {
        process.kill(p, 'SIGKILL');
      } catch {}
    }
    this.session = null;
    await this.stopDriver();
  }

  /** Files of this instance's data folder (relative paths). */
  files(sub = '') {
    const base = join(this.dir, sub);
    return filesUnder(base).map((f) => relative(this.dir, f));
  }
  read(rel) {
    return readFileSync(join(this.dir, rel));
  }
  has(rel) {
    return existsSync(join(this.dir, rel));
  }
  size(rel) {
    return statSync(join(this.dir, rel)).size;
  }
}
