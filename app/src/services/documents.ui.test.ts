// UI-DOCS additions to the documents domain (wave 2): folders and New folder, "Keep private" through the local
// ignores (UX §3.7.1 "Only on this computer"), delete with Undo, "Added by", persisted file hashes, AI OCR of a
// scan into the text cache (UX §3.7.2), "Describe with AI", notes moved between sections (UX §3.8), and search
// reading the effective (corrected) transcript from the LectureService.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAi, DEMO_OCR_TEXT } from '../platform/memory/ai';
import type { DocumentServiceImpl } from './documents';
import { HASHES_FILE, hashMemo, parseHashCache, type ExtractionServiceImpl } from './extraction';
import { createServices } from './index';
import type { SearchServiceImpl } from './search';
import { createTestContext } from './testing/context';

const fixture = (dir: 'tramado/docs' | 'import', name: string) => new Uint8Array(readFileSync(new URL(`../../test-fixtures/${dir}/${name}`, import.meta.url)));
const enc = (s: string) => new TextEncoder().encode(s);

async function setup(opts: { share?: boolean; ai?: boolean } = {}) {
  const ai = opts.ai ? createFakeAi({ mode: 'fake' }) : undefined;
  const t = await createTestContext({ name: 'Ana Ribeiro', ...(ai ? { ai } : {}) });
  if (opts.ai) await t.platform.secrets.set('openrouter', 'test-key-0001');
  const s = createServices(t.ctx);
  if (opts.ai) await s.ai.ready();
  const classId = await s.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'en', share: opts.share ?? false });
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
    await idle();
    await docs.idle();
  };
  return { ...t, s, classId, cls, idle, docs, pick, settle };
}

describe('DocumentService (UI-DOCS additions)', () => {
  it('lists folders (empty ones too) and creates unique, sanitised folders', async () => {
    const env = await setup();
    const { docs } = env;
    docs.list.get();
    expect(await docs.mkdir('Slides')).toBe('Documents/Slides');
    expect(await docs.mkdir('slides')).toBe('Documents/slides (2)');
    expect(await docs.mkdir('Lei: 2026?', 'Documents/Slides')).toBe('Documents/Slides/Lei- 2026-');
    await docs.import(await env.pick({ name: 'a.txt', bytes: enc('a') }), 'Documents/Readings');
    await env.settle();
    expect(docs.folders.get()).toEqual(['Documents/Readings', 'Documents/Slides', 'Documents/Slides/Lei- 2026-', 'Documents/slides (2)']);
    env.s.dispose();
  });

  it('keeps a file private: only on this computer, through the local ignores; sharing it again drops the line', async () => {
    const env = await setup();
    const { docs, platform, classId } = env;
    await docs.import(await env.pick({ name: 'esquemas.txt', bytes: enc('os meus esquemas') }, { name: 'b.txt', bytes: enc('bê') }));
    await env.settle();
    await docs.keepPrivate('Documents/esquemas.txt');
    await env.settle();
    expect((await platform.classes.list()).find((e) => e.classId === classId)!.localIgnores).toEqual(['Documents/esquemas.txt']);
    expect(new TextDecoder().decode(await platform.fs.read(classId, 'Documents/esquemas.txt'))).toBe('os meus esquemas');
    const row = docs.list.get().find((d) => d.name === 'esquemas.txt');
    expect(row).toMatchObject({ localOnly: true, addedBy: { self: true } });
    expect(docs.list.get().find((d) => d.name === 'b.txt')?.localOnly).toBeUndefined();
    // Removed from this computer only: ignored and gone, so not listed (and not "only on this computer").
    await docs.remove('Documents/b.txt', 'thisComputer');
    await env.settle();
    expect(docs.list.get().map((d) => d.name)).toEqual(['esquemas.txt']);
    await docs.share('Documents/esquemas.txt');
    await env.settle();
    expect((await platform.classes.list()).find((e) => e.classId === classId)!.localIgnores).toEqual(['Documents/b.txt']);
    expect(docs.list.get().find((d) => d.name === 'esquemas.txt')?.localOnly).toBeUndefined();
    env.s.dispose();
  });

  it('keeps a shared class file private: deleted for everyone, then written back behind the ignore line', async () => {
    const env = await setup({ share: true });
    const { docs, platform, classId } = env;
    await docs.import(await env.pick({ name: 'mine.txt', bytes: enc('privado') }));
    await env.settle();
    const deletions: string[] = [];
    const remove = platform.fs.remove.bind(platform.fs);
    platform.fs.remove = async (c, p, o) => {
      deletions.push(p);
      return remove(c, p, o);
    };
    await docs.keepPrivate('Documents/mine.txt');
    expect(deletions).toEqual(['Documents/mine.txt']);
    expect((await platform.classes.list()).find((e) => e.classId === classId)!.localIgnores).toEqual(['Documents/mine.txt']);
    expect(new TextDecoder().decode(await platform.fs.read(classId, 'Documents/mine.txt'))).toBe('privado');
    env.s.dispose();
  });

  it('deletes for everyone with an Undo that brings the same bytes back', async () => {
    const env = await setup();
    const { docs, platform, classId } = env;
    await docs.import(await env.pick({ name: 'law.pdf', bytes: fixture('tramado/docs', 'law.pdf') }));
    await env.settle();
    const removed = await docs.removeForUndo('Documents/law.pdf');
    expect(await platform.fs.stat(classId, 'Documents/law.pdf')).toBeNull();
    await docs.restore(removed);
    expect(await platform.fs.read(classId, 'Documents/law.pdf')).toEqual(fixture('tramado/docs', 'law.pdf'));
    // Restoring twice is harmless.
    await docs.restore(removed);
    env.s.dispose();
  });

  it('says who added each file: in a class only on this computer, always you', async () => {
    const env = await setup();
    const { docs } = env;
    await docs.import(await env.pick({ name: 'x.txt', bytes: enc('x') }));
    await env.settle();
    expect(docs.list.get()[0]!.addedBy).toEqual({ name: 'Ana Ribeiro', self: true });
    env.s.dispose();
  });
});

describe('file hashes (persisted per class)', () => {
  it('are written to the private hashes.json and read back by a new session, so files are not hashed again', async () => {
    const env = await setup();
    const { docs, platform, classId, ctx } = env;
    await docs.import(await env.pick({ name: 'a.txt', bytes: enc('alfa') }, { name: 'b.txt', bytes: enc('beta') }));
    await env.settle();
    await hashMemo(ctx).flush(classId);
    const saved = parseHashCache(await platform.privateFiles.read(classId, HASHES_FILE));
    expect([...saved.keys()].sort()).toEqual(['Documents/a.txt', 'Documents/b.txt']);
    expect(saved.get('Documents/a.txt')!.sha).toMatch(/^[0-9a-f]{64}$/);
    // A second app session over the same disk: no fs.hash call for unchanged files.
    const ctx2 = { ...ctx };
    let hashed = 0;
    const hash = platform.fs.hash.bind(platform.fs);
    platform.fs.hash = async (c, p) => {
      hashed++;
      return hash(c, p);
    };
    const memo2 = hashMemo(ctx2);
    await memo2.load(classId);
    const st = (await platform.fs.stat(classId, 'Documents/a.txt'))!;
    expect(memo2.known(classId, 'Documents/a.txt', st.size, st.mtimeMs)).toBe(saved.get('Documents/a.txt')!.sha);
    expect(await memo2.hash(classId, 'Documents/a.txt')).toBe(saved.get('Documents/a.txt')!.sha);
    expect(hashed).toBe(0);
    // A changed file (other size/mtime) is hashed again; deleted files are dropped from the file.
    expect(memo2.known(classId, 'Documents/a.txt', st.size + 1, st.mtimeMs)).toBeNull();
    memo2.retain(classId, ['Documents/a.txt']);
    await memo2.flush(classId);
    expect([...parseHashCache(await platform.privateFiles.read(classId, HASHES_FILE)).keys()]).toEqual(['Documents/a.txt']);
    env.s.dispose();
  });

  it('ignores a broken or foreign hashes.json', () => {
    expect(parseHashCache(enc('{nope')).size).toBe(0);
    expect(parseHashCache(enc(JSON.stringify({ format: 'other', version: 1, files: {} }))).size).toBe(0);
    expect(parseHashCache(enc(JSON.stringify({ format: 'tramado.hash-cache', version: 1, files: { a: { size: 1, mtimeMs: 2, sha256: 'xyz' } } }))).size).toBe(0);
  });
});

describe('AI reading of scans and images', () => {
  it('reads a scanned PDF page by page into the text cache (never the class), then search finds it', async () => {
    const env = await setup({ ai: true });
    const { docs, platform, classId, ctx, s } = env;
    let rendered = 0;
    ctx.pdfRender = { pages: async () => 1, renderJpeg: async (_b, page) => {
      rendered++;
      return enc(`jpeg of page ${page}`);
    } };
    await docs.import(await env.pick({ name: 'scan.pdf', bytes: fixture('import', 'scanned.pdf') }));
    await env.settle();
    expect(docs.list.get()[0]).toMatchObject({ extraction: 'scan' });
    const before = [...platform.mem.list(classId).keys()].sort();
    const progress: Array<[number, number]> = [];
    const t = await (s.extraction as ExtractionServiceImpl).ocr(classId, 'Documents/scan.pdf', { onProgress: (d, n) => progress.push([d, n]) });
    expect(t.text).toBe(DEMO_OCR_TEXT.trim());
    expect(t.warnings).toContain('ocr');
    expect(progress).toEqual([[0, 1], [1, 1]]);
    expect(rendered).toBe(1);
    expect([...platform.mem.list(classId).keys()].sort()).toEqual(before);
    await env.settle();
    expect(docs.list.get()[0]).toMatchObject({ extraction: 'ready' });
    const word = DEMO_OCR_TEXT.trim().split(/\s+/).find((w) => w.length > 6)!.replace(/[^\p{L}]/gu, '');
    const hits = await s.search.passages(classId, word);
    expect(hits.some((p) => p.source.kind === 'document' && p.source.path === 'Documents/scan.pdf')).toBe(true);
    // A second reading uses the page image cache (cache/ocr/): the AI is not asked again.
    let asked = 0;
    const run = s.ai.client.run.bind(s.ai.client);
    (s.ai.client as { run: typeof run }).run = async (o) => {
      asked++;
      return run(o);
    };
    await (s.extraction as ExtractionServiceImpl).ocr(classId, 'Documents/scan.pdf');
    expect(asked).toBe(0);
    env.s.dispose();
  });

  it('refuses scans longer than 20 pages and files that are not PDFs', async () => {
    const env = await setup({ ai: true });
    const { docs, classId, ctx, s } = env;
    await docs.import(await env.pick({ name: 'scan.pdf', bytes: fixture('import', 'scanned.pdf') }, { name: 'a.txt', bytes: enc('a') }));
    await env.settle();
    const ex = s.extraction as ExtractionServiceImpl;
    const cache = await ex.ensure(classId, 'Documents/scan.pdf');
    (ex as { ensure: typeof ex.ensure }).ensure = async () => ({ ...cache, pageStarts: Array.from({ length: 21 }, () => 0) });
    ctx.pdfRender = { pages: async () => 21, renderJpeg: async () => enc('j') };
    await expect(ex.ocr(classId, 'Documents/scan.pdf')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(ex.ocr(classId, 'Documents/a.txt')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    env.s.dispose();
  });

  it('describes an image with one vision request', async () => {
    const env = await setup({ ai: true });
    const { docs, classId, s } = env;
    await docs.import(await env.pick({ name: 'cell.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }));
    const r = await (s.extraction as ExtractionServiceImpl).describe(classId, 'Documents/cell.png');
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.model).toBeTruthy();
    env.s.dispose();
  });
});

describe('NotesService.moveTo', () => {
  it('moves a note between my notes and the class notes, keeping its text', async () => {
    const env = await setup();
    const { cls, platform, classId } = env;
    const notes = cls.notes;
    const mine = await notes.create('private', 'Esquema');
    await notes.save('private', mine, '# Esquema\n\nTexto.');
    const shared = await notes.moveTo('private', mine, 'class');
    expect(shared).toBe('Notes/Esquema.md');
    expect(await notes.read('class', shared)).toBe('# Esquema\n\nTexto.');
    expect(await platform.privateFiles.read(classId, mine)).toBeNull();
    const back = await notes.moveTo('class', shared, 'private');
    expect(back).toBe('notes/Esquema.md');
    expect(await notes.read('private', back)).toBe('# Esquema\n\nTexto.');
    expect(await platform.fs.stat(classId, shared)).toBeNull();
    env.s.dispose();
  });
});
