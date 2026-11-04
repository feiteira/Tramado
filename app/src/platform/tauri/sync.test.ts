import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlatformError } from '../../core/errors';
import type { Platform } from '../types';

// The sync bindings (architecture §6.7) against the Rust commands of desktop/src-tauri/src/commands/sync.rs:
// every Platform['sync'] method calls its command with the camelCase arguments whose snake_case
// names are exactly the Rust parameters (Tauri converts them), and maps errors to PlatformError.

type Call = { cmd: string; args: unknown; options: unknown };
const calls: Call[] = [];
let respond: (cmd: string, args: unknown) => unknown = () => undefined;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown, options?: unknown) => {
    calls.push({ cmd, args, options });
    return respond(cmd, args);
  }),
  Channel: class {},
}));

const { createSyncBindings } = await import('./sync');

const CLASS = 'tramado-mde5jfv46prdf2fjxvmbjr4242';
const DEV = '5QDNN46-YHG4AH2-3NWSGYW-RYXVGJP-JORVLZ4-3VGOMPY-S5KL2O6-AXZBAQE';

beforeEach(() => {
  calls.length = 0;
  respond = () => undefined;
});

/** `pub async fn <cmd>(…)` → its parameter names, without the injected State/Request ones. */
function rustParams(): Map<string, string[]> {
  const src = readFileSync(new URL('../../../../desktop/src-tauri/src/commands/sync.rs', import.meta.url), 'utf8');
  const out = new Map<string, string[]>();
  for (const m of src.matchAll(/pub async fn (sync_[a-z_]+)\s*\(([^)]*)\)/g)) {
    let sig = m[2]!;
    while (/<[^<>]*>/.test(sig)) sig = sig.replace(/<[^<>]*>/g, '');
    const params = sig
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => p.split(':')[0]!.trim())
      .filter((n) => n !== 'st' && n !== 'request');
    out.set(m[1]!, params);
  }
  return out;
}

const camel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** One call of every binding, with representative arguments. */
async function callAll(s: Platform['sync']): Promise<void> {
  await s.identity();
  await s.resolveCopiedIdentity('new');
  await s.start();
  await s.restart();
  await s.status();
  await s.snapshot();
  await s.applySettings({ localOnly: false, paused: false, maxSendKbps: 0, maxRecvKbps: 0, deviceName: 'Ana (portátil)' });
  await s.setPolicy({ classId: CLASS, label: 'TGDC', askBeforeAdmit: false, roster: [], knownDevices: [], bannedDevices: [], updatedAt: '2026-11-04T10:00:00.000Z' });
  await s.sign(CLASS, '.tramado/bans/X.json', new Uint8Array([123, 125]));
  await s.shareClass(CLASS, 'TGDC');
  await s.joinClass({ code: 'tri1_x', dirName: 'TGDC', includeAudio: false });
  await s.cancelJoin(CLASS);
  await s.acceptFolder({ folderId: CLASS, offeredBy: DEV, label: 'TGDC', dirName: 'TGDC', includeAudio: true });
  await s.leaveClass(CLASS, { afterwards: 'keepLocal' });
  await s.admit(CLASS, DEV);
  await s.decline(CLASS, DEV);
  await s.resolveMassDelete(CLASS, 'restore');
  await s.normalizeIds([DEV.toLowerCase()]);
  await s.ownAddresses();
  await s.fileInfo(CLASS, ['.tramado/chat/X/2026-11.jsonl']);
  await s.waitAvailable(CLASS, 'a.md', 1, 5000);
  await s.waitCaughtUp(CLASS, 60000);
  await s.deviceStats();
  await s.folderStatus(CLASS);
  await s.versions(CLASS);
  await s.restore(CLASS, [{ path: 'Docs/a.pdf', versionTime: '2026-11-03T16:03:20.000Z' }]);
  await s.folderErrors(CLASS);
  await s.pauseClass(CLASS, true);
  await s.scan(CLASS, 'Docs');
  await s.diagnostics();
  await s.existing();
}

describe('sync bindings', () => {
  it('every command exists in Rust with exactly the arguments the binding sends', async () => {
    await callAll(createSyncBindings());
    const rust = rustParams();
    for (const c of calls) {
      expect(rust.has(c.cmd), c.cmd).toBe(true);
      if (c.cmd === 'sync_sign') continue; // raw body + headers
      const sent = c.args === undefined ? [] : Object.keys(c.args as Record<string, unknown>).sort();
      const want = (rust.get(c.cmd) ?? []).map(camel);
      if (c.cmd === 'sync_scan') {
        expect(sent).toEqual(['classId', 'path']);
        continue;
      }
      expect(sent, c.cmd).toEqual([...want].sort());
    }
    // every Rust sync command is reachable from the bindings
    expect(new Set(calls.map((c) => c.cmd))).toEqual(new Set(rust.keys()));
  });

  it('sign sends the canonical bytes as a raw body with encoded class and path headers', async () => {
    await createSyncBindings().sign(CLASS, '.tramado/meta/Ä.json', new Uint8Array([9, 1, 2, 9]).subarray(1, 3));
    const c = calls[0]!;
    expect(c.cmd).toBe('sync_sign');
    expect(c.args).toBeInstanceOf(Uint8Array);
    expect([...(c.args as Uint8Array)]).toEqual([1, 2]);
    expect(c.options).toEqual({ headers: { 'x-class': CLASS, 'x-path': '.tramado%2Fmeta%2F%C3%84.json' } });
  });

  it('scan without a path sends no path; struct arguments are wrapped as Rust expects', async () => {
    const s = createSyncBindings();
    await s.scan(CLASS);
    await s.joinClass({ code: 'tri1_x', dirName: 'TGDC', parent: 'tok', includeAudio: true });
    await s.leaveClass(CLASS, { afterwards: 'trash' });
    expect(calls[0]).toMatchObject({ cmd: 'sync_scan', args: { classId: CLASS } });
    expect(calls[0]!.args).not.toHaveProperty('path');
    expect(calls[1]).toMatchObject({ cmd: 'sync_join_class', args: { req: { code: 'tri1_x', dirName: 'TGDC', parent: 'tok', includeAudio: true } } });
    expect(calls[2]).toMatchObject({ cmd: 'sync_leave_class', args: { classId: CLASS, opts: { afterwards: 'trash' } } });
  });

  it('shell errors become PlatformError with their code and data', async () => {
    respond = () => {
      throw { code: 'SYNC_INVITE_INVALID', message: 'own', data: { reason: 'own' } };
    };
    const e = (await createSyncBindings().joinClass({ code: 'x', dirName: 'd', includeAudio: true }).catch((x: unknown) => x)) as PlatformError;
    expect(e).toBeInstanceOf(PlatformError);
    expect([e.code, e.data]).toEqual(['SYNC_INVITE_INVALID', { reason: 'own' }]);
  });

  it('answers pass through untouched', async () => {
    respond = (cmd) => (cmd === 'sync_normalize_ids' ? [DEV, null] : cmd === 'sync_wait_available' ? true : undefined);
    const s = createSyncBindings();
    expect(await s.normalizeIds([DEV, 'bad'])).toEqual([DEV, null]);
    expect(await s.waitAvailable(CLASS, 'a', 1, 10)).toBe(true);
  });
});
