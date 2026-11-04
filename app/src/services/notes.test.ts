// NotesService over the memory platform (architecture §11.2, §13.2; folder spec §8.21; sync spec §16;
// UX §3.8): class and private notes, titles, and conflict copies → keep / merge / keep both.
import { describe, expect, it } from 'vitest';
import { createServices } from './index';
import type { NotesServiceImpl } from './notes';
import { createTestContext } from './testing/context';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
const COPY = 'Notes/Resumo.sync-conflict-20261103-155644-TKBNV23.md';
const COPY2 = 'Notes/Resumo.sync-conflict-20261103-160010-WSGDTBE.md';

async function setup() {
  const t = await createTestContext({ name: 'Ana Ribeiro' });
  const s = createServices(t.ctx);
  const classId = await s.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'en', share: false });
  const cls = s.forClass(classId);
  const idle = async () => {
    await (cls.store as unknown as { idle(): Promise<void> }).idle();
    await (cls.notes as NotesServiceImpl).idle();
  };
  await idle();
  const notes = cls.notes as NotesServiceImpl;
  const read = (p: string) => t.platform.fs.read(classId, p).then(dec, () => null);
  /** A conflict copy arriving from Syncthing (folder spec §8.21). */
  const conflict = async (path: string, text: string) => {
    t.platform.mem.applyRemote(classId, path, enc(text), { modifiedBy: 'TKBNV23', mtimeMs: t.clock.now() });
    await idle();
  };
  return { ...t, s, classId, cls, idle, notes, read, conflict };
}

describe('NotesService', () => {
  it('creates, lists, saves, renames and removes class notes and private notes', async () => {
    const env = await setup();
    const { notes, classId, platform } = env;
    expect(notes.list.get()).toEqual([]);
    const shared = await notes.create('class', 'Resumo: semana 8');
    expect(shared).toBe('Notes/Resumo- semana 8.md');
    expect(await env.read(shared)).toBe('# Resumo: semana 8\n\n');
    env.clock.advance(1000);
    const mine = await notes.create('private', 'Aula 6 — apontamentos');
    expect(mine).toBe('notes/Aula 6 — apontamentos.md');
    expect(dec(await platform.privateFiles.read(classId, mine))).toBe('# Aula 6 — apontamentos\n\n');
    // The private note never reaches the class folder.
    expect([...platform.mem.list(classId).keys()].some((p) => p.includes('apontamentos'))).toBe(false);
    await env.idle();
    expect(notes.list.get().map((n) => [n.scope, n.path, n.title, n.conflict])).toEqual([
      ['private', mine, 'Aula 6 — apontamentos', false],
      ['class', shared, 'Resumo: semana 8', false],
    ]);
    expect(notes.list.get()[0]!.mtimeMs).toBe(env.clock.now());

    await notes.save('class', shared, '# Resumo: semana 8\n\nRestrições e conteúdo essencial.\n');
    expect(await notes.read('class', shared)).toContain('conteúdo essencial');
    await notes.save('private', mine, '# Aula 6\n\nO meu esquema.\n');
    await env.idle();
    expect(notes.list.get().find((n) => n.scope === 'private')?.title).toBe('Aula 6');

    const renamed = await notes.rename('class', shared, 'Resumo partilhado');
    expect(renamed).toBe('Notes/Resumo partilhado.md');
    expect(await env.read(renamed)).toBe('# Resumo partilhado\n\nRestrições e conteúdo essencial.\n');
    expect(await env.read(shared)).toBeNull();
    const renamedMine = await notes.rename('private', mine, 'Esquema');
    expect(renamedMine).toBe('notes/Esquema.md');
    expect(await platform.privateFiles.read(classId, mine)).toBeNull();

    await notes.remove('class', renamed);
    await notes.remove('private', renamedMine);
    await env.idle();
    expect(notes.list.get()).toEqual([]);
    await expect(notes.read('private', 'notes/../x.md')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(notes.read('private', 'Documents/x.md')).rejects.toMatchObject({ code: 'INVALID' });
    env.s.dispose();
  });

  it('shows a conflict copy and resolves it: keep the other version (written to the note, copies deleted)', async () => {
    const env = await setup();
    const { notes } = env;
    const path = 'Notes/Resumo.md';
    await notes.save('class', path, '# Resumo\nRestrições\nTrês testes\n');
    await env.conflict(COPY, '# Resumo\nRestrições aos direitos\nTrês testes\nNota do Bruno\n');
    expect(notes.list.get()).toEqual([expect.objectContaining({ path, conflict: true })]);
    const c = await notes.conflicts(path);
    expect(c).toEqual({ base: '# Resumo\nRestrições\nTrês testes\n', copies: [{ path: COPY, text: '# Resumo\nRestrições aos direitos\nTrês testes\nNota do Bruno\n' }] });
    await notes.resolve(path, { keep: COPY });
    await env.idle();
    expect(await env.read(path)).toBe('# Resumo\nRestrições aos direitos\nTrês testes\nNota do Bruno\n');
    expect(await env.read(COPY)).toBeNull();
    expect(notes.list.get()).toEqual([expect.objectContaining({ path, conflict: false })]);
    env.s.dispose();
  });

  it('resolves by keeping this version, by a merge by hand, or by keeping both as `<base> (2).md`', async () => {
    const env = await setup();
    const { notes } = env;
    const path = 'Notes/Resumo.md';
    await notes.save('class', path, 'mine\n');
    await env.conflict(COPY, 'theirs\n');
    await env.conflict(COPY2, 'third\n');
    await notes.resolve(path, { keep: 'base' });
    expect([await env.read(path), await env.read(COPY), await env.read(COPY2)]).toEqual(['mine\n', null, null]);

    await env.conflict(COPY, 'theirs\n');
    await notes.resolve(path, { merged: 'mine\ntheirs\n' });
    expect([await env.read(path), await env.read(COPY)]).toEqual(['mine\ntheirs\n', null]);

    await env.conflict(COPY, 'theirs again\n');
    await notes.resolve(path, { keepBoth: true });
    await env.idle();
    expect([await env.read(path), await env.read(COPY), await env.read('Notes/Resumo (2).md')]).toEqual(['mine\ntheirs\n', null, 'theirs again\n']);
    expect(notes.list.get().map((n) => [n.path, n.conflict]).sort()).toEqual([['Notes/Resumo (2).md', false], ['Notes/Resumo.md', false]]);
    await expect(notes.resolve(path, { keep: 'Notes/other.md' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    env.s.dispose();
  });

  it('does not invent an author for the losing text and reports presence without a presence service', async () => {
    const env = await setup();
    const { notes } = env;
    await notes.save('class', 'Notes/Resumo.md', 'mine\n');
    await env.conflict(COPY, 'theirs\n');
    const listed = notes.list.get()[0]!;
    expect(listed.editingBy).toEqual([]);
    expect(JSON.stringify(await notes.conflicts('Notes/Resumo.md'))).not.toContain('TKBNV23"');
    expect(() => notes.editing('Notes/Resumo.md')).not.toThrow();
    env.s.dispose();
  });
});
