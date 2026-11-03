import { describe, expect, it } from 'vitest';
import { classIdOf, itemIdOf } from '../core/model/derive';
import { parserFor } from '../core/model/parse';
import { sha256Hex } from '../core/util/sha256';
import { createClassStore } from './classStore';
import { createTestContext } from './testing/context';
import type { ChangeKind } from './types/common';

const enc = (s: string) => new TextEncoder().encode(s);
const NONCE = 'q4m2zx7k3v5hbnw6r2yjc7aefg';

async function setup() {
  const t = await createTestContext();
  const { platform } = t;
  const classId = classIdOf(platform.mem.deviceId, NONCE);
  await platform.classes.create({ classId, dirName: 'Direito Constitucional I' });
  const add = (p: string, s: string) => platform.mem.addFile(classId, p, enc(s));
  add('.tramado/class.json', JSON.stringify({ format: 'tramado.class', version: 1, classId }));
  const entry = (await platform.classes.list())[0]!;
  return { ...t, classId, add, entry };
}

const lectureJson = (id: string) => JSON.stringify({ format: 'tramado.lecture', version: 1, id, title: 'Aula' });

describe('ClassStore', () => {
  it('discovers lectures and exams by manifest, in renamed folders, and skips §4.5 names', async () => {
    const { ctx, add, entry, platform } = await setup();
    const l6 = itemIdOf(1_792_483_200_000, platform.mem.deviceId, NONCE);
    const exam = itemIdOf(1_792_483_300_000, platform.mem.deviceId, 'aaaaaaaaaaaaaaaaaaaaaaaaaa');
    add('Renamed by Ana/whatever/lecture.json', lectureJson(l6));
    add('Renamed by Ana/whatever/audio.webm', 'x');
    add('Renamed by Ana/whatever/slides.pdf', 'pdf');
    add('Renamed by Ana/whatever/deeper/ignored.pdf', 'x');
    add('Old exams/Frequência/exam.json', JSON.stringify({ format: 'tramado.exam', version: 1, id: exam }));
    add('Old exams/Frequência/enunciado.pdf', 'pdf');
    add('Aulas/arriving/transcript.json', '{}');
    add('Aulas/arriving/audio.webm', 'x');
    add('Documentos/Lei.pdf', 'pdf');
    add('Documentos/draft.tmp', 'x');
    add('Documentos/big.part', 'x');
    add('Notas/Resumo.md', '# r');
    add('Notas/Resumo.sync-conflict-20261103-155644-TKBNV23.md', '# r2');
    add('.stversions/old.pdf', 'x');
    const store = createClassStore(ctx, entry);
    await store.start();
    const s = store.state.get();
    expect(s.status).toBe('ready');
    expect([...s.index.lectures.values()]).toEqual([expect.objectContaining({ id: l6, dir: 'Renamed by Ana/whatever', manifest: 'Renamed by Ana/whatever/lecture.json' })]);
    expect([...s.index.exams.keys()]).toEqual([exam]);
    expect(s.index.documents.map((d) => [d.path, d.lectureId ?? d.examId ?? null])).toEqual([
      ['Documentos/Lei.pdf', null],
      ['Old exams/Frequência/enunciado.pdf', exam],
      ['Renamed by Ana/whatever/slides.pdf', l6],
    ]);
    expect(s.index.notes.map((n) => n.path)).toEqual(['Notas/Resumo.md']);
    expect(s.index.conflicts).toEqual([{ path: 'Notas/Resumo.sync-conflict-20261103-155644-TKBNV23.md', of: 'Notas/Resumo.md' }]);
    expect([...s.index.machine.keys()]).toEqual(['.tramado/class.json']);
    store.stop();
  });

  it('detects duplicate manifest ids and keeps the shorter path', async () => {
    const { ctx, add, entry, platform } = await setup();
    const id = itemIdOf(1, platform.mem.deviceId, NONCE);
    add('Aulas/a/lecture.json', lectureJson(id));
    add('Aulas/copy of a/lecture.json', lectureJson(id));
    const store = createClassStore(ctx, entry);
    await store.start();
    const s = store.state.get();
    expect(s.index.lectures.get(id)?.manifest).toBe('Aulas/a/lecture.json');
    expect(s.index.duplicates).toEqual([{ id, paths: ['Aulas/a/lecture.json', 'Aulas/copy of a/lecture.json'] }]);
    store.stop();
  });

  it('reports changes per kind, drops own-write echoes and rescans', async () => {
    const { ctx, classId, entry, clock, platform } = await setup();
    const store = createClassStore(ctx, entry);
    await store.start();
    const seen: Array<[ChangeKind[], string[]]> = [];
    store.onChange(['document', 'chat', 'note'], (paths) => seen.push([['document', 'chat', 'note'], paths]));
    platform.events.onClassChanged((e) => store.ingest(e.paths, e));
    await store.writeText('Notas/Mine.md', '# mine', { own: false });
    await store.idle();
    expect(store.state.get().kinds.note).toBe(1);
    const before = store.state.get().revision;
    // The echo of our own write (selfWrite, same size and mtime) changes nothing.
    store.ingest(['Notas/Mine.md'], { selfWrite: true, rescan: false });
    await new Promise((r) => setTimeout(r, 0));
    clock.advance(600);
    await store.idle();
    expect(store.state.get().revision).toBe(before);
    // A classmate's file arrives (as Syncthing would write it).
    platform.mem.applyRemote(classId, 'Documentos/Novo.pdf', enc('pdf'), { modifiedBy: 'TKBNV23', mtimeMs: 7 });
    clock.advance(600);
    await store.idle();
    expect(store.state.get().kinds.document).toBe(1);
    expect(seen.map(([, p]) => p)).toEqual([['Notas/Mine.md'], ['Documentos/Novo.pdf']]);
    // A rescan finds what changed behind its back.
    platform.mem.list(classId).get('Documentos/Novo.pdf')!.bytes = enc('changed');
    store.ingest([], { selfWrite: false, rescan: true });
    clock.advance(600);
    await store.idle();
    expect(store.state.get().kinds.document).toBeGreaterThanOrEqual(1);
    store.stop();
  });

  it('reads JSONL incrementally and re-reads from 0 when the prefix changed', async () => {
    const { ctx, classId, entry, platform } = await setup();
    const store = createClassStore(ctx, entry);
    await store.start();
    const path = `.tramado/chat/${platform.mem.deviceId}/2026-11.jsonl`;
    const parse = parserFor('tramado.chat');
    const line = (id: string) => ({ format: 'tramado.chat', version: 1, type: 'message', id, hlc: 'h', ms: 1, memberId: 'm', text: id });
    await store.appendLine(path, line('a'));
    await store.appendLine(path, line('b'));
    const first = await store.readJsonl(path, parse);
    expect(first.lines.map((l) => (l.value as { id: string }).id)).toEqual(['a', 'b']);
    const bytes = await platform.fs.read(classId, path);
    const from = { offset: first.consumed, prefixSha256: sha256Hex(bytes.subarray(0, first.consumed)) };
    await store.appendLine(path, line('c'));
    await platform.fs.append(classId, path, enc('{"format":"tramado.chat","version":9,"type":"message"}\n'), { own: true });
    await platform.fs.append(classId, path, enc('garbage\n'), { own: true });
    const next = await store.readJsonl(path, parse, from);
    expect(next.lines.map((l) => (l.value as { id: string }).id)).toEqual(['c']);
    expect([next.newer, next.skipped]).toEqual([1, 1]);
    // A redaction rewrote the file: the prefix no longer matches, so everything is read again.
    await platform.fs.write(classId, path, enc(JSON.stringify(line('z')) + '\n'), { own: true });
    const again = await store.readJsonl(path, parse, from);
    expect(again.lines.map((l) => (l.value as { id: string }).id)).toEqual(['z']);
    store.stop();
  });

  it('keeps the last trusted version when the gate does not trust new bytes', async () => {
    const { ctx, entry, platform, classId } = await setup();
    const store = createClassStore(ctx, entry);
    await store.start();
    const path = `.tramado/members/${platform.mem.deviceId}.json`;
    const parse = parserFor('tramado.member');
    await store.writeJson(path, { format: 'tramado.member', version: 1, name: 'Ana' }, { own: true });
    expect((await store.readJson(path, parse))?.value).toMatchObject({ name: 'Ana' });
    let trusted = true;
    store.setTrustGate({ verify: async () => (trusted ? { kind: 'trusted' } : { kind: 'untrusted', reason: 'foreign-write' }), noteOwnWrite: () => undefined });
    trusted = false;
    platform.mem.applyRemote(classId, path, enc(JSON.stringify({ format: 'tramado.member', version: 1, name: 'Mallory' })), { modifiedBy: 'TKBNV23', mtimeMs: 9 });
    const loaded = await store.readJson(path, parse);
    expect(loaded?.value).toMatchObject({ name: 'Ana' });
    expect(loaded?.verdict.kind).toBe('trusted');
    store.stop();
  });

  it('is missing when class.json is gone', async () => {
    const t = await createTestContext();
    const classId = classIdOf(t.platform.mem.deviceId, NONCE);
    await t.platform.classes.create({ classId, dirName: 'X' });
    const store = createClassStore(t.ctx, (await t.platform.classes.list())[0]!);
    await store.start();
    expect(store.state.get().status).toBe('missing');
    store.stop();
  });
});
