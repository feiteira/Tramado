// DocumentService over the memory platform (architecture §11.2; folder spec §5.4, §9.1, §11.2;
// UX §3.7.1): imports with sanitised unique names and duplicate detection by SHA-256, the text
// states of the list, remove for everyone / this computer only, rename and move.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DocumentServiceImpl } from './documents';
import type { ExtractionServiceImpl } from './extraction';
import { createServices } from './index';
import type { SearchServiceImpl } from './search';
import { createTestContext } from './testing/context';

const fixture = (dir: 'tramado/docs' | 'import', name: string) => new Uint8Array(readFileSync(new URL(`../../test-fixtures/${dir}/${name}`, import.meta.url)));
const enc = (s: string) => new TextEncoder().encode(s);

async function setup() {
  const t = await createTestContext({ name: 'Ana Ribeiro' });
  const s = createServices(t.ctx);
  const classId = await s.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'en', share: false });
  const cls = s.forClass(classId);
  const idle = () => (cls.store as unknown as { idle(): Promise<void> }).idle();
  await idle();
  const docs = cls.documents as DocumentServiceImpl;
  const pick = async (...files: Array<{ name: string; bytes: Uint8Array }>) => {
    t.platform.mem.queueDialog({ picks: files });
    return t.platform.dialogs.pickFiles({ title: 'Add', filters: [], multiple: true });
  };
  const settle = async () => {
    await idle();
    await (s.search as SearchServiceImpl).settled(classId);
    await (s.extraction as ExtractionServiceImpl).idle();
    await docs.idle();
  };
  return { ...t, s, classId, cls, idle, docs, pick, settle };
}

describe('DocumentService', () => {
  it('imports with sanitised, unique names into the documents folder (or a sub-folder)', async () => {
    const env = await setup();
    const { docs } = env;
    const r = await docs.import(await env.pick(
      { name: 'Lei: versão final?.pdf', bytes: fixture('tramado/docs', 'law.pdf') },
      { name: 'slides.pptx', bytes: fixture('tramado/docs', 'slides.pptx') },
      { name: 'CON.txt', bytes: enc('reserved name on Windows') },
    ));
    expect(r).toEqual([
      { name: 'Lei: versão final?.pdf', path: 'Documents/Lei- versão final-.pdf' },
      { name: 'slides.pptx', path: 'Documents/slides.pptx' },
      { name: 'CON.txt', path: 'Documents/CON_.txt' },
    ]);
    const again = await docs.import(await env.pick({ name: 'slides.pptx', bytes: enc('different bytes, same name') }), 'Documents/Slides');
    expect(again).toEqual([{ name: 'slides.pptx', path: 'Documents/Slides/slides.pptx' }]);
    const clash = await docs.import(await env.pick({ name: 'SLIDES.pptx', bytes: enc('another different file') }));
    expect(clash).toEqual([{ name: 'SLIDES.pptx', path: 'Documents/SLIDES (2).pptx' }]);
    // Nothing is left in the staging area.
    expect([...env.platform.mem.list(env.classId).keys()].filter((p) => p.startsWith('.tramado/tmp/'))).toEqual([]);
    env.s.dispose();
  });

  it('detects duplicates by SHA-256 before anything reaches the class; "Add anyway" adds a copy', async () => {
    const env = await setup();
    const { docs } = env;
    await docs.import(await env.pick({ name: 'law.pdf', bytes: fixture('tramado/docs', 'law.pdf') }));
    const before = [...env.platform.mem.list(env.classId).keys()].sort();
    const dup = await docs.import(await env.pick({ name: 'Lei renomeada.pdf', bytes: fixture('tramado/docs', 'law.pdf') }));
    // Within one import too: the second copy of the same file is a duplicate of the first.
    const twice = await docs.import(await env.pick({ name: 'x.txt', bytes: enc('mesmo') }, { name: 'y.txt', bytes: enc('mesmo') }));
    expect(twice).toEqual([{ name: 'x.txt', path: 'Documents/x.txt' }, { name: 'y.txt', duplicateOf: 'Documents/x.txt' }]);
    await env.platform.fs.remove(env.classId, 'Documents/x.txt');
    expect(dup).toEqual([{ name: 'Lei renomeada.pdf', duplicateOf: 'Documents/law.pdf' }]);
    expect([...env.platform.mem.list(env.classId).keys()].sort()).toEqual(before);
    env.clock.advance(60_000);   // the copy is newer than the original
    const anyway = await docs.import(await env.pick({ name: 'Lei renomeada.pdf', bytes: fixture('tramado/docs', 'law.pdf') }), undefined, { allowDuplicate: true });
    expect(anyway).toEqual([{ name: 'Lei renomeada.pdf', path: 'Documents/Lei renomeada.pdf', duplicateOf: 'Documents/law.pdf' }]);
    await env.settle();
    const copy = docs.list.get().find((d) => d.path === 'Documents/Lei renomeada.pdf');
    expect(copy?.duplicateOf).toBe('Documents/law.pdf');
    env.s.dispose();
  });

  it('lists documents with kind, text state, pages, attachments and conflict copies', async () => {
    const env = await setup();
    const { docs, platform, classId } = env;
    await docs.import(await env.pick(
      { name: 'law.pdf', bytes: fixture('tramado/docs', 'law.pdf') },
      { name: 'slides.pptx', bytes: fixture('tramado/docs', 'slides.pptx') },
      { name: 'scan.pdf', bytes: fixture('import', 'scanned.pdf') },
      { name: 'foto.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
      { name: 'broken.pdf', bytes: enc('this is not a pdf') },
    ));
    platform.mem.addFile(classId, 'Documents/From chat/anexo.txt', enc('Um anexo do chat.'));
    platform.mem.applyRemote(classId, 'Documents/law.sync-conflict-20261103-155644-TKBNV23.pdf', enc('x'), { modifiedBy: 'TKBNV23', mtimeMs: 1 });
    platform.mem.applyRemote(classId, 'Notes/n.sync-conflict-20261103-155644-TKBNV23.md', enc('x'), { modifiedBy: 'TKBNV23', mtimeMs: 1 });
    await env.settle();
    const byName = Object.fromEntries(docs.list.get().map((d) => [d.name, d]));
    expect(byName['law.pdf']).toMatchObject({ kind: 'pdf', extraction: 'ready', pages: 6, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), dir: 'Documents', fromChat: false, conflictOf: null });
    expect(byName['slides.pptx']).toMatchObject({ kind: 'pptx', extraction: 'ready', pages: 3 });
    expect(byName['scan.pdf']).toMatchObject({ kind: 'pdf', extraction: 'scan' });
    expect(byName['foto.png']).toMatchObject({ kind: 'image', extraction: 'unsupported', pages: null });
    expect(byName['broken.pdf']).toMatchObject({ kind: 'pdf', extraction: 'failed' });
    expect(byName['anexo.txt']).toMatchObject({ fromChat: true, extraction: 'ready' });
    expect(byName['law.sync-conflict-20261103-155644-TKBNV23.pdf']).toMatchObject({ conflictOf: 'Documents/law.pdf' });
    expect(Object.keys(byName).some((n) => n.startsWith('n.sync-conflict'))).toBe(false);
    const text = await docs.text('Documents/law.pdf');
    expect(text).toMatchObject({ kind: 'pdf', pageLabels: ['i', 'ii', '1', '2', '3', '4'], imagePages: [5] });
    // The text cache is written once per content (architecture §13.1).
    expect(await platform.cache.read(`text/${text.sha256}.json`)).not.toBeNull();
    env.s.dispose();
  });

  it('removes for everyone, or from this computer only (ignore line first), renames and moves', async () => {
    const env = await setup();
    const { docs, platform, classId } = env;
    await docs.import(await env.pick(
      { name: 'a.pdf', bytes: fixture('tramado/docs', 'law.pdf') },
      { name: 'b.txt', bytes: enc('bê') },
      { name: 'c.txt', bytes: enc('cê') },
    ));
    await docs.remove('Documents/b.txt', 'thisComputer');
    const entry = (await platform.classes.list()).find((e) => e.classId === classId)!;
    expect(entry.localIgnores).toEqual(['Documents/b.txt']);
    expect(await platform.fs.stat(classId, 'Documents/b.txt')).toBeNull();
    await docs.remove('Documents/c.txt', 'everyone');
    expect(await platform.fs.stat(classId, 'Documents/c.txt')).toBeNull();
    expect((await platform.classes.list())[0]!.localIgnores).toEqual(['Documents/b.txt']);
    expect(await docs.rename('Documents/a.pdf', 'Lei de exemplo')).toBe('Documents/Lei de exemplo.pdf');
    expect(await docs.rename('Documents/Lei de exemplo.pdf', 'Lei de exemplo.pdf')).toBe('Documents/Lei de exemplo.pdf');
    expect(await docs.move('Documents/Lei de exemplo.pdf', 'Documents/Legislação')).toBe('Documents/Legislação/Lei de exemplo.pdf');
    expect(await platform.fs.stat(classId, 'Documents/Legislação/Lei de exemplo.pdf')).not.toBeNull();
    await expect(docs.move('Documents/Legislação', 'Documents/Legislação/sub')).rejects.toMatchObject({ code: 'INVALID' });
    expect(typeof docs.url('Documents/Legislação/Lei de exemplo.pdf')).toBe('string');
    // A whole folder, from this computer only.
    await docs.remove('Documents/Legislação', 'thisComputer');
    expect(await platform.fs.stat(classId, 'Documents/Legislação/Lei de exemplo.pdf')).toBeNull();
    expect((await platform.classes.list())[0]!.localIgnores).toEqual(['Documents/b.txt', 'Documents/Legislação']);
    await expect(docs.remove('Documents/none.pdf', 'everyone')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    env.s.dispose();
  });
});
