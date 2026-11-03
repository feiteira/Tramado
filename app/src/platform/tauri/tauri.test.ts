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
