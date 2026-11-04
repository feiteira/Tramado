import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError } from '../../core/errors';

// The Tauri APIs are replaced by fakes (Trama pattern): these tests check what the bindings send to the
// shell and how they map the answers, one assertion per binding group; the shell itself is `cargo test`.

type Call = { cmd: string; args: unknown; options: unknown };
const calls: Call[] = [];
let respond: (cmd: string, args: unknown) => unknown = () => undefined;

class FakeChannel<T> {
  onmessage: (e: T) => void = () => undefined;
}
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown, options?: unknown) => {
    calls.push({ cmd, args, options });
    return respond(cmd, args);
  }),
  Channel: FakeChannel,
}));
const win = { title: '', handler: null as null | ((e: { preventDefault(): void }) => Promise<void>), hidden: 0 };
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTitle: async (t: string) => void (win.title = t),
    onCloseRequested: async (f: (e: { preventDefault(): void }) => Promise<void>) => {
      win.handler = f;
      return () => undefined;
    },
    hide: async () => void win.hidden++,
    show: async () => undefined,
  }),
}));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ setZoom: async () => undefined }) }));
const listeners = new Map<string, (e: { payload: unknown }) => void>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  },
}));

const { createTauriPlatform, isTauri } = await import('./index');
const { createMediaBindings } = await import('./media');
const { readFileSync } = await import('node:fs');
type Platform = import('../types').Platform;
const CLASS = 'tramado-mde5jfv46prdf2fjxvmbjr4242';

beforeEach(() => {
  calls.length = 0;
  respond = () => undefined;
});

describe('tauri bindings', () => {
  it('maps shell errors to PlatformError with their data', async () => {
    respond = () => {
      throw { code: 'AI_FREE_LIMIT', message: 'limit', data: { resetAt: 1 } };
    };
    const err = (await createTauriPlatform().info().catch((e: unknown) => e)) as PlatformError;
    expect(err).toBeInstanceOf(PlatformError);
    expect([err.code, err.data]).toEqual(['AI_FREE_LIMIT', { resetAt: 1 }]);
  });

  it('app: app files and private appends use camelCase args and raw bodies with encoded headers', async () => {
    const p = createTauriPlatform();
    await p.appFiles.write('prefs.json', '{}');
    await p.privateFiles.append(CLASS, 'ask/ä.jsonl', new TextEncoder().encode('{}\n'));
    expect(calls[0]).toMatchObject({ cmd: 'app_file_write', args: { name: 'prefs.json', text: '{}' } });
    expect(calls[1]!.cmd).toBe('private_append');
    expect(calls[1]!.args).toBeInstanceOf(Uint8Array);
    expect(calls[1]!.options).toEqual({ headers: { 'x-class': CLASS, 'x-path': 'ask%2F%C3%A4.jsonl' } });
  });

  it('classes and fs: binary reads become bytes, writes send x-own', async () => {
    const p = createTauriPlatform();
    respond = (cmd) => (cmd === 'class_read' ? new Uint8Array([1, 2]).buffer : { path: 'a', size: 1, mtimeMs: 1, sha256: null });
    expect(await p.fs.read(CLASS, 'a')).toEqual(new Uint8Array([1, 2]));
    const view = new Uint8Array([9, 9, 9, 9]).subarray(1, 3);
    await p.fs.write(CLASS, 'Notas/a.md', view, { own: true });
    const w = calls.find((c) => c.cmd === 'class_write')!;
    expect((w.args as Uint8Array).byteLength).toBe(2);
    expect(w.options).toEqual({ headers: { 'x-class': CLASS, 'x-path': 'Notas%2Fa.md', 'x-own': '1' } });
    await p.classes.update(CLASS, { archived: true });
    expect(calls.at(-1)).toMatchObject({ cmd: 'class_update', args: { classId: CLASS, patch: { archived: true } } });
  });

  it('dialogs, secrets and system pass their request objects', async () => {
    const p = createTauriPlatform();
    await p.dialogs.pickFiles({ title: 't', filters: [], multiple: true });
    await p.secrets.set('openrouter', 'sk-x');
    await p.system.openExternal('https://openrouter.ai/keys', { title: 't', message: 'm', confirm: 'c', cancel: 'x' });
    expect(calls.map((c) => c.cmd)).toEqual(['dialog_pick_files', 'secret_set', 'open_external']);
    expect(calls[0]!.args).toEqual({ req: { title: 't', filters: [], multiple: true } });
  });

  it('ai: send wires a Channel named onEvent', async () => {
    const seen: unknown[] = [];
    await createTauriPlatform().ai.send({ requestId: 'r', base: { type: 'openrouter' }, method: 'GET', path: 'models', stream: false }, (e) => seen.push(e));
    const args = calls[0]!.args as { onEvent: FakeChannel<unknown> };
    args.onEvent.onmessage({ type: 'end' });
    expect(seen).toEqual([{ type: 'end' }]);
  });

  it('sync: sign sends the canonical bytes as a raw body', async () => {
    await createTauriPlatform().sync.sign(CLASS, '.tramado/bans/X.json', new Uint8Array([1]));
    expect(calls[0]).toMatchObject({ cmd: 'sync_sign', options: { headers: { 'x-class': CLASS, 'x-path': '.tramado%2Fbans%2FX.json' } } });
  });

  it('speech: marks and peaks wrap their arguments as the Rust structs expect', async () => {
    const s = createTauriPlatform().speech!;
    await s.recorder.mark('exam', 'rever');
    await s.peaks({ kind: 'private', recordingId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K' }, 1200);
    expect(calls[0]!.args).toEqual({ m: { kind: 'exam', note: 'rever' } });
    expect(calls[1]!.args).toEqual({ req: { source: { kind: 'private', recordingId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K' }, buckets: 1200 } });
  });

  it('events: global events reach subscribers until they unsubscribe', async () => {
    const seen: unknown[] = [];
    const off = createTauriPlatform().events.onTray((a) => seen.push(a));
    await Promise.resolve();
    listeners.get('app:tray')!({ payload: { action: 'quit' } });
    off();
    expect(seen).toEqual(['quit']);
  });

  it('window: close goes through the handler and hides or quits', async () => {
    const p = createTauriPlatform();
    p.window.onCloseRequested(async () => 'hide');
    let prevented = false;
    await win.handler!({ preventDefault: () => void (prevented = true) });
    expect([prevented, win.hidden]).toEqual([true, 1]);
  });

  it('media: URLs are percent-encoded per segment', () => {
    const m = createMediaBindings('tramado-media://localhost');
    expect(m.url({ kind: 'class', classId: CLASS, path: 'Aulas/2026-10-14 1015 Aula 6/audio.webm' })).toBe(
      `tramado-media://localhost/c/${CLASS}/Aulas/2026-10-14%201015%20Aula%206/audio.webm`,
    );
    expect(m.url({ kind: 'selftest' })).toBe('tramado-media://localhost/res/selftest.webm');
    expect(isTauri()).toBe(false);
  });
});


// One case per command of architecture §6.1–§6.5 (R-SHELL): the exact command name, the camelCase
// top-level arguments and, for raw-body commands, the bytes and the percent-encoded headers.
const TEXT = { title: 'Permitir?', message: 'Enviar para {host}?', confirm: 'Permitir', cancel: 'Cancelar' };
const PICK = '0123456789abcdef0123456789abcdef';
const H = 'a'.repeat(64);
const bytes = (s: string) => new TextEncoder().encode(s);
type Case = { cmd: string; run: (p: Platform) => Promise<unknown> | void; args?: unknown; headers?: Record<string, string>; body?: string; reply?: unknown };
const CASES: Case[] = [
  // §6.1 app, files, private data, cache
  { cmd: 'app_info', run: (p) => p.info() },
  { cmd: 'app_file_read', run: (p) => p.appFiles.read('identity.json'), args: { name: 'identity.json' }, reply: null },
  { cmd: 'app_file_write', run: (p) => p.appFiles.write('hlc.json', '{}'), args: { name: 'hlc.json', text: '{}' } },
  { cmd: 'app_log', run: (p) => p.log('warn', 'webview ready', { code: 'IO_ERROR' }), args: { level: 'warn', message: 'webview ready', data: { code: 'IO_ERROR' } } },
  { cmd: 'app_take_pending_links', run: (p) => p.system.takePendingLinks(), reply: [] },
  { cmd: 'app_set_background_mode', run: (p) => p.window.setBackgroundMode({ trayOnClose: true, sharedClasses: 2 }), args: { mode: { trayOnClose: true, sharedClasses: 2 } } },
  { cmd: 'app_autostart_get', run: (p) => p.window.autostart.get(), reply: false },
  { cmd: 'app_autostart_set', run: (p) => p.window.autostart.set(true), args: { enabled: true } },
  { cmd: 'app_quit', run: (p) => p.window.quit() },
  { cmd: 'diag_collect', run: (p) => p.system.diagnostics() },
  { cmd: 'person_init', run: (p) => p.person.init() },
  { cmd: 'person_prove', run: (p) => p.person.prove(CLASS), args: { classId: CLASS } },
  { cmd: 'storage_usage', run: (p) => p.storage.usage() },
  { cmd: 'cache_clear', run: (p) => p.cache.clear() },
  { cmd: 'app_reveal', run: (p) => p.storage.reveal('private', CLASS), args: { which: 'private', classId: CLASS } },
  { cmd: 'private_read', run: (p) => p.privateFiles.read(CLASS, 'notes/Aula 1.md'), args: { classId: CLASS, path: 'notes/Aula 1.md' }, reply: null },
  { cmd: 'private_write', run: (p) => p.privateFiles.write(CLASS, 'notes/Ação.md', bytes('# Notas')), headers: { 'x-class': CLASS, 'x-path': 'notes%2FA%C3%A7%C3%A3o.md' }, body: '# Notas' },
  { cmd: 'private_append', run: (p) => p.privateFiles.append(CLASS, 'ask/01JBX4Q7Z5W8M2E3C9R6T0YH2K.jsonl', bytes('{}\n')), headers: { 'x-class': CLASS, 'x-path': 'ask%2F01JBX4Q7Z5W8M2E3C9R6T0YH2K.jsonl' }, body: '{}\n', reply: 3 },
  { cmd: 'private_list', run: (p) => p.privateFiles.list(CLASS, 'notes'), args: { classId: CLASS, dir: 'notes' }, reply: [] },
  { cmd: 'private_remove', run: (p) => p.privateFiles.remove(CLASS, 'notes', true), args: { classId: CLASS, path: 'notes', recursive: true } },
  { cmd: 'private_purge', run: (p) => p.privateFiles.purge(CLASS), args: { classId: CLASS } },
  { cmd: 'cache_read', run: (p) => p.cache.read(`text/${H}.json`), args: { key: `text/${H}.json` }, reply: null },
  { cmd: 'cache_write', run: (p) => p.cache.write(`peaks/${H}-1200.json`, bytes('{}')), headers: { 'x-name': `peaks%2F${H}-1200.json` }, body: '{}' },
  { cmd: 'cache_remove', run: (p) => p.cache.remove('models-catalog.json'), args: { key: 'models-catalog.json' } },
  // §6.2 class registry and class files
  { cmd: 'classes_list', run: (p) => p.classes.list(), reply: [] },
  { cmd: 'classes_root', run: (p) => p.classes.root() },
  { cmd: 'classes_set_root', run: (p) => p.classes.setRoot(PICK), args: { pick: PICK } },
  { cmd: 'class_create', run: (p) => p.classes.create({ classId: CLASS, dirName: 'Direito Civil', parent: PICK }), args: { req: { classId: CLASS, dirName: 'Direito Civil', parent: PICK } } },
  { cmd: 'class_adopt', run: (p) => p.classes.adopt(PICK), args: { pick: PICK } },
  { cmd: 'class_fork', run: (p) => p.classes.fork(CLASS, 'tramado-wp4vuizadsrm5cjkgpv2ewpwuv'), args: { classId: CLASS, newClassId: 'tramado-wp4vuizadsrm5cjkgpv2ewpwuv' } },
  { cmd: 'class_update', run: (p) => p.classes.update(CLASS, { skipAudio: true, localIgnores: ['Docs/grande.pdf'] }), args: { classId: CLASS, patch: { skipAudio: true, localIgnores: ['Docs/grande.pdf'] } } },
  { cmd: 'class_forget', run: (p) => p.classes.forget(CLASS), args: { classId: CLASS } },
  { cmd: 'class_trash', run: (p) => p.classes.trash(CLASS), args: { classId: CLASS } },
  { cmd: 'class_trash_empty', run: (p) => p.classes.emptyTrash(CLASS), args: { classId: CLASS } },
  { cmd: 'class_list', run: (p) => p.fs.list(CLASS, '', { recursive: true, maxDepth: 3, includeTramado: true }), args: { classId: CLASS, dir: '', opts: { recursive: true, maxDepth: 3, includeTramado: true } }, reply: [] },
  { cmd: 'class_stat', run: (p) => p.fs.stat(CLASS, 'Docs/a.pdf'), args: { classId: CLASS, path: 'Docs/a.pdf' }, reply: null },
  { cmd: 'class_read', run: (p) => p.fs.read(CLASS, 'Docs/a.pdf'), args: { classId: CLASS, path: 'Docs/a.pdf' }, reply: new Uint8Array([1]).buffer },
  { cmd: 'class_read_range', run: (p) => p.fs.readRange(CLASS, 'Aulas/A1/audio.webm', 1024, 4096), args: { classId: CLASS, path: 'Aulas/A1/audio.webm', offset: 1024, length: 4096 }, reply: new Uint8Array([1]).buffer },
  { cmd: 'class_write', run: (p) => p.fs.write(CLASS, 'Notas/Introdução.md', bytes('olá'), { own: false }), headers: { 'x-class': CLASS, 'x-path': 'Notas%2FIntrodu%C3%A7%C3%A3o.md', 'x-own': '0' }, body: 'olá' },
  { cmd: 'class_append', run: (p) => p.fs.append(CLASS, '.tramado/chat/X/2026-11.jsonl', bytes('{}\n'), { own: true }), headers: { 'x-class': CLASS, 'x-path': '.tramado%2Fchat%2FX%2F2026-11.jsonl', 'x-own': '1' }, body: '{}\n' },
  { cmd: 'class_mkdir', run: (p) => p.fs.mkdir(CLASS, 'Docs/Testes'), args: { classId: CLASS, path: 'Docs/Testes' } },
  { cmd: 'class_move', run: (p) => p.fs.move(CLASS, 'a.md', 'Notas/a.md'), args: { classId: CLASS, from: 'a.md', to: 'Notas/a.md' } },
  { cmd: 'class_remove', run: (p) => p.fs.remove(CLASS, 'Notas'), args: { classId: CLASS, path: 'Notas', recursive: false } },
  { cmd: 'class_hash', run: (p) => p.fs.hash(CLASS, 'Docs/a.pdf'), args: { classId: CLASS, path: 'Docs/a.pdf' }, reply: H },
  { cmd: 'class_import', run: (p) => p.fs.importFile(CLASS, PICK, 'Docs/Código Civil.pdf'), args: { classId: CLASS, pick: PICK, dest: 'Docs/Código Civil.pdf' } },
  { cmd: 'class_export', run: (p) => p.fs.exportFile(CLASS, 'Docs/a.pdf', PICK), args: { classId: CLASS, path: 'Docs/a.pdf', pick: PICK } },
  { cmd: 'class_reveal', run: (p) => p.classes.reveal(CLASS, 'Docs/a.pdf'), args: { classId: CLASS, path: 'Docs/a.pdf' } },
  { cmd: 'class_open', run: (p) => p.classes.open(CLASS, 'Docs/a.pdf'), args: { classId: CLASS, path: 'Docs/a.pdf' } },
  // §6.3 dialogs
  { cmd: 'dialog_pick_files', run: (p) => p.dialogs.pickFiles({ title: 'Importar', filters: [{ name: 'PDF', extensions: ['pdf'] }], multiple: true }), args: { req: { title: 'Importar', filters: [{ name: 'PDF', extensions: ['pdf'] }], multiple: true } }, reply: [] },
  { cmd: 'dialog_pick_folder', run: (p) => p.dialogs.pickFolder({ title: 'Pasta' }), args: { req: { title: 'Pasta' } }, reply: null },
  { cmd: 'dialog_save', run: (p) => p.dialogs.save({ title: 'Guardar', defaultName: 'notas.md', filters: [] }), args: { req: { title: 'Guardar', defaultName: 'notas.md', filters: [] } }, reply: null },
  // §6.4 secrets and AI
  { cmd: 'secret_set', run: (p) => p.secrets.set('host:localhost_11434', 'k-1'), args: { name: 'host:localhost_11434', value: 'k-1' } },
  { cmd: 'secret_status', run: (p) => p.secrets.status('openrouter'), args: { name: 'openrouter' } },
  { cmd: 'secret_clear', run: (p) => p.secrets.clear('openrouter'), args: { name: 'openrouter' } },
  { cmd: 'ai_cancel', run: (p) => p.ai.cancel('req-1'), args: { requestId: 'req-1' } },
  { cmd: 'ai_hosts', run: (p) => p.ai.hosts(), reply: [] },
  { cmd: 'ai_host_allow', run: (p) => p.ai.allowHost('http://localhost:11434/v1', TEXT), args: { base: 'http://localhost:11434/v1', text: TEXT }, reply: null },
  { cmd: 'ai_host_forget', run: (p) => p.ai.forgetHost('localhost_11434'), args: { hostId: 'localhost_11434' } },
  { cmd: 'ai_privacy_get', run: (p) => p.ai.privacy(), reply: 'no-training' },
  { cmd: 'ai_privacy_set', run: (p) => p.ai.setPrivacy('standard', TEXT), args: { level: 'standard', text: TEXT }, reply: false },
  { cmd: 'ai_activity', run: (p) => p.ai.activity(50), args: { limit: 50 }, reply: [] },
  { cmd: 'ai_activity_clear', run: (p) => p.ai.clearActivity() },
  { cmd: 'ai_busy_policy_get', run: (p) => p.ai.busyPolicy(), reply: false },
  { cmd: 'ai_busy_policy_set', run: (p) => p.ai.setBusyPolicy(true, TEXT), args: { relax: true, text: TEXT }, reply: true },
  // §6.5 system
  { cmd: 'open_external', run: (p) => p.system.openExternal('https://pt.wikipedia.org/wiki/X', TEXT), args: { url: 'https://pt.wikipedia.org/wiki/X', text: TEXT }, reply: true },
  { cmd: 'notify_show', run: (p) => p.notifications.show({ title: 'Nova transcrição', body: 'Aula 6', tag: 't' }), args: { n: { title: 'Nova transcrição', body: 'Aula 6', tag: 't' } } },
  { cmd: 'shortcut_set_markers', run: (p) => p.system.setMarkerShortcuts({ important: 'CommandOrControl+Alt+1', todo: 'CommandOrControl+Alt+4' }), args: { accelerators: { important: 'CommandOrControl+Alt+1', todo: 'CommandOrControl+Alt+4' } } },
  { cmd: 'system_power', run: (p) => p.system.power(), reply: { source: 'ac', percent: null } },
];

describe('tauri bindings: one case per R-SHELL command (architecture §6.1–§6.5)', () => {
  it.each(CASES.map((c) => [c.cmd, c] as const))('%s', async (cmd, c) => {
    respond = (name) => (name === cmd ? c.reply : undefined);
    await c.run(createTauriPlatform());
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.cmd).toBe(cmd);
    if (c.headers) {
      expect(call.args).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(call.args as Uint8Array)).toBe(c.body);
      expect(call.options).toEqual({ headers: c.headers });
    } else {
      expect(call.args).toEqual(c.args);
      expect(call.options).toBeUndefined();
    }
  });

  it('ai_send passes the request and a Channel named onEvent', async () => {
    const req = {
      requestId: 'r', base: { type: 'host', hostId: 'localhost_11434' }, method: 'POST', path: 'chat/completions',
      body: { model: 'm' }, stream: true, privacyOverride: 'standard', overrideText: TEXT, busyFallback: true,
      activity: { classId: CLASS, action: 'examAnswer', passages: 3 },
    } as const;
    await createTauriPlatform().ai.send(req, () => undefined);
    expect(calls[0]!.cmd).toBe('ai_send');
    const args = calls[0]!.args as { request: unknown; onEvent: unknown };
    expect(args.request).toEqual(req);
    expect(args.onEvent).toBeInstanceOf(FakeChannel);
  });

  it('covers every command of the §6.1–§6.5 tables', () => {
    const arch = readFileSync(new URL('../../../../docs/dev/architecture.md', import.meta.url), 'utf8');
    const s = arch.indexOf('### 6.1 App');
    const e = arch.indexOf('### 6.6 Media');
    const names = new Set<string>();
    for (const line of arch.slice(s, e).split('\n')) {
      const m = /^\| `([a-z0-9_]+)` \|/.exec(line);
      if (m) names.add(m[1]!);
    }
    const covered = new Set([...CASES.map((c) => c.cmd), 'ai_send']);
    expect([...names].filter((n) => !covered.has(n))).toEqual([]);
    expect([...covered].filter((n) => !names.has(n))).toEqual([]);
  });

  it('binary answers become Uint8Array; null stays null', async () => {
    const p = createTauriPlatform();
    respond = (cmd) => (cmd === 'class_read_range' ? [7, 8] : cmd === 'cache_read' ? new Uint8Array([5]) : null);
    expect(await p.fs.readRange(CLASS, 'a', 0, 2)).toEqual(new Uint8Array([7, 8]));
    expect(await p.cache.read(`text/${H}.json`)).toEqual(new Uint8Array([5]));
    expect(await p.privateFiles.read(CLASS, 'x.json')).toBeNull();
  });

  it('optional arguments are left out, not sent as undefined', async () => {
    const p = createTauriPlatform();
    p.log('info', 'webview ready');
    await p.storage.reveal('cache');
    await p.classes.reveal(CLASS);
    expect(calls.map((c) => c.args)).toEqual([{ level: 'info', message: 'webview ready' }, { which: 'cache' }, { classId: CLASS }]);
  });

  it('a close request that answers stay neither hides nor quits', async () => {
    const p = createTauriPlatform();
    const before = win.hidden;
    p.window.onCloseRequested(async () => 'stay');
    await win.handler!({ preventDefault: () => undefined });
    expect(win.hidden).toBe(before);
    expect(calls.some((c) => c.cmd === 'app_quit')).toBe(false);
    p.window.onCloseRequested(async () => 'quit');
    await win.handler!({ preventDefault: () => undefined });
    expect(calls.at(-1)!.cmd).toBe('app_quit');
  });

  it('events: every global event of §7.1 reaches its subscriber', async () => {
    const p = createTauriPlatform();
    const seen: unknown[] = [];
    p.events.onClassChanged((e) => seen.push(e));
    p.events.onDeepLink((e) => seen.push(e));
    p.events.onShortcut((e) => seen.push(e));
    p.events.onDrop((e) => seen.push(e));
    p.events.onSync((e) => seen.push(e));
    await Promise.resolve();
    const changed = { classId: CLASS, paths: ['Docs/a.pdf'], selfWrite: false, rescan: false };
    listeners.get('class:changed')!({ payload: changed });
    listeners.get('app:deep-link')!({ payload: { url: 'file:', text: 'tramado://join/x' } });
    listeners.get('app:shortcut')!({ payload: { id: 'marker', kind: 'exam' } });
    listeners.get('app:drop')!({ payload: { picked: [], x: 1, y: 2 } });
    listeners.get('sync:event')!({ payload: { type: 'gap' } });
    expect(seen).toEqual([changed, { url: 'file:', text: 'tramado://join/x' }, { id: 'marker', kind: 'exam' }, { picked: [], x: 1, y: 2 }, { type: 'gap' }]);
  });

  it('media: private recordings, files and the Windows base', () => {
    const m = createMediaBindings('http://tramado-media.localhost');
    expect(m.url({ kind: 'private', recordingId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K' })).toBe('http://tramado-media.localhost/r/01JBX4Q7Z5W8M2E3C9R6T0YH2K.webm');
    expect(m.url({ kind: 'file', classId: CLASS, path: 'Docs/Código #1?.pdf' })).toBe(`http://tramado-media.localhost/c/${CLASS}/Docs/C%C3%B3digo%20%231%3F.pdf`);
  });
});
