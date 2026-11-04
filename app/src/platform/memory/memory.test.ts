import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMemoryPlatform } from './index';
import { deviceIdChecks, verifyPersonProof, verifySig } from '../../core/model/sig';
import { isDeviceId, isMemberId, shortIdOf } from '../../core/model/ids';
import { classIdOf, memberIdOf } from '../../core/model/derive';
import { canonicalBytes, fromBase64Url } from '../../core/model/sig';
import { PlatformError } from '../../core/errors';
import type { ClassChangedEvent } from '../types';

const V = JSON.parse(readFileSync(new URL('../../../../test-vectors/class-paths.json', import.meta.url), 'utf8')) as {
  valid: string[];
  invalid: Array<{ path: string }>;
};
const enc = (s: string) => new TextEncoder().encode(s);
const NONCE = 'q4m2zx7k3v5hbnw6r2yjc7aefg';

async function withClass(deviceIndex = 0) {
  const p = createMemoryPlatform({ deviceIndex, clock: { now: () => 1_793_721_438_157 } });
  const classId = classIdOf(p.mem.deviceId, NONCE);
  await p.classes.create({ classId, dirName: 'Direito Constitucional I' });
  return { p, classId };
}

describe('memory platform', () => {
  it('has a valid device identity whose signatures verify', async () => {
    const { p, classId } = await withClass(3);
    expect(isDeviceId(p.mem.deviceId) && deviceIdChecks(p.mem.deviceId)).toBe(true);
    const record = { format: 'tramado.bans', version: 1, deviceId: p.mem.deviceId, entries: [] as unknown[] };
    const path = `.tramado/bans/${p.mem.deviceId}.json`;
    const sig = await p.sync.sign(classId, path, canonicalBytes(record));
    expect(await verifySig({ ...record, sig }, classId, path, p.mem.deviceId)).toBe(true);
    const other = createMemoryPlatform({ deviceIndex: 4 });
    expect(other.mem.deviceId).not.toBe(p.mem.deviceId);
  });

  it('creates and proves the person key', async () => {
    const { p, classId } = await withClass();
    const info = await p.person.init();
    expect(isMemberId(info.memberId)).toBe(true);
    expect(memberIdOf(fromBase64Url(info.pub))).toBe(info.memberId);
    const person = await p.person.prove(classId);
    expect(await verifyPersonProof({ deviceId: p.mem.deviceId, memberId: info.memberId, person }, classId)).toBe(true);
  });

  it('applies the shared class-path rules', async () => {
    const { p, classId } = await withClass();
    for (const path of V.valid) await expect(p.fs.write(classId, path, enc('x'), { own: false }), path).resolves.toBeTruthy();
    for (const c of V.invalid) await expect(p.fs.write(classId, c.path, enc('x'), { own: false })).rejects.toBeInstanceOf(PlatformError);
  });

  it('writes atomically, appends lines and reports every write as selfWrite', async () => {
    const { p, classId } = await withClass();
    const seen: ClassChangedEvent[] = [];
    const writes: string[] = [];
    p.events.onClassChanged((e) => seen.push(e));
    p.mem.onWrite((_c, path, _b, kind) => writes.push(`${kind}:${path}`));
    const s = await p.fs.write(classId, 'Notas/a.md', enc('olá'), { own: false });
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    const a1 = await p.fs.append(classId, '.tramado/chat/X/2026-11.jsonl', enc('{"a":1}\n'), { own: true });
    const a2 = await p.fs.append(classId, '.tramado/chat/X/2026-11.jsonl', enc('{"b":2}\n'), { own: true });
    expect([a1.size, a2.size, a2.sha256]).toEqual([8, 16, null]);
    await expect(p.fs.append(classId, '.tramado/chat/X/2026-11.jsonl', enc('{"c":3}'), { own: true })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(p.fs.append(classId, '.tramado/chat/X/2026-11.jsonl', enc('a\nb\n'), { own: true })).rejects.toMatchObject({ code: 'INVALID' });
    await p.fs.move(classId, 'Notas/a.md', 'Notas/b.md');
    await expect(p.fs.move(classId, 'Notas/b.md', '.tramado/chat/X/2026-11.jsonl')).rejects.toMatchObject({ code: 'CONFLICT' });
    await p.fs.remove(classId, 'Notas/b.md');
    expect(seen.every((e) => e.selfWrite && e.classId === classId)).toBe(true);
    expect(writes).toEqual(['write:Notas/a.md', 'append:.tramado/chat/X/2026-11.jsonl', 'append:.tramado/chat/X/2026-11.jsonl', 'move:Notas/b.md', 'remove:Notas/b.md']);
  });

  it('lists like Rust: skips §4.5 names, hides .tramado unless asked, reports conflicts', async () => {
    const { p, classId } = await withClass();
    for (const path of ['Docs/a.pdf', 'Docs/deep/b.pdf', 'Notas/n.sync-conflict-20261103-155644-TKBNV23.md', '.tramado/class.json', '.tramado/tmp/x.part', 'Docs/.hidden'])
      p.mem.addFile(classId, path, enc('x'));
    const top = await p.fs.list(classId, '', { recursive: false });
    expect(top.map((e) => e.path)).toEqual(['Docs', 'Notas']);
    const all = await p.fs.list(classId, '', { recursive: true, includeTramado: true });
    expect(all.map((e) => e.path)).toEqual(['.tramado', '.tramado/class.json', 'Docs', 'Docs/a.pdf', 'Docs/deep', 'Docs/deep/b.pdf', 'Notas', 'Notas/n.sync-conflict-20261103-155644-TKBNV23.md']);
    expect(all.find((e) => e.path.startsWith('Notas/n'))?.conflictOf).toBe('Notas/n.md');
    expect((await p.fs.list(classId, 'Docs', { recursive: true, maxDepth: 1 })).map((e) => e.path)).toEqual(['Docs/a.pdf', 'Docs/deep']);
  });

  it('applies remote writes without an onWrite echo', async () => {
    const { p, classId } = await withClass();
    const seen: ClassChangedEvent[] = [];
    let echoed = 0;
    p.events.onClassChanged((e) => seen.push(e));
    p.mem.onWrite(() => echoed++);
    p.mem.applyRemote(classId, 'Docs/r.pdf', enc('r'), { modifiedBy: 'TKBNV23', mtimeMs: 5 });
    expect(echoed).toBe(0);
    expect(seen).toEqual([{ classId, paths: ['Docs/r.pdf'], selfWrite: false, rescan: false }]);
    expect(p.mem.list(classId).get('Docs/r.pdf')?.modifiedBy).toBe('TKBNV23');
    p.mem.applyRemote(classId, 'Docs/r.pdf', null, { modifiedBy: 'TKBNV23', mtimeMs: 6 });
    expect(await p.fs.stat(classId, 'Docs/r.pdf')).toBeNull();
  });

  it('answers dialogs from the queue and imports picked files', async () => {
    const { p, classId } = await withClass();
    p.mem.queueDialog({ picks: [{ name: 'Lei.pdf', bytes: enc('%PDF-1.4') }] });
    const picked = await p.dialogs.pickFiles({ title: 'x', filters: [], multiple: true });
    expect(picked).toHaveLength(1);
    const s = await p.fs.importFile(classId, picked[0]!.token, 'Documentos/Lei.pdf');
    expect(s.size).toBe(8);
    expect(await p.dialogs.pickFiles({ title: 'x', filters: [], multiple: false })).toEqual([]);
    await expect(p.fs.importFile(classId, 'nope', 'Documentos/x.pdf')).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('keeps the registry, app files, private files and cache', async () => {
    const { p, classId } = await withClass();
    expect((await p.classes.list())[0]).toMatchObject({ classId, dirName: 'Direito Constitucional I', shared: false, available: false });
    await expect(p.classes.create({ classId, dirName: 'Other' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await p.fs.write(classId, '.tramado/class.json', enc('{}'), { own: true });
    expect((await p.classes.list())[0]!.available).toBe(true);
    await p.classes.update(classId, { archived: true });
    expect((await p.classes.list())[0]!.archived).toBe(true);
    await p.appFiles.write('prefs.json', '{}');
    expect(await p.appFiles.read('prefs.json')).toBe('{}');
    await p.privateFiles.write(classId, 'notes/a.md', enc('x'));
    expect(await p.privateFiles.list(classId, '')).toEqual(['notes/a.md']);
    await expect(p.privateFiles.write(classId, 'mirror/x', enc('x'))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(p.cache.write('nope', enc('x'))).rejects.toMatchObject({ code: 'INVALID' });
    await p.cache.write('models-catalog.json', enc('{}'));
    await p.cache.clear();
    expect(await p.cache.read('models-catalog.json')).not.toBeNull();
    expect(shortIdOf((await p.sync.identity()).deviceId)).toBe(shortIdOf(p.mem.deviceId));
    const shared = await p.sync.shareClass(classId, 'DC I');
    expect(shared.shared).toBe(true);
  });

  it('stubs fail with the documented codes', async () => {
    const p = createMemoryPlatform();
    const events: unknown[] = [];
    await p.ai.send({ requestId: 'r1', base: { type: 'openrouter' }, method: 'POST', path: 'chat/completions', stream: true }, (e) => events.push(e));
    await Promise.resolve();
    expect(events).toEqual([{ type: 'fail', code: 'AI_NO_KEY', message: expect.any(String) }]);
    await expect(p.sync.joinClass({ code: 'tri1_x', dirName: 'x', includeAudio: true })).rejects.toMatchObject({ code: 'SYNC_UNAVAILABLE' });
    expect(p.speech).toBeUndefined();
  });
});
