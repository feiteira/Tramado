import { describe, expect, it } from 'vitest';
import { anchorQuote, resolveQuote } from './resolve';

describe('resolveQuote', () => {
  const text = 'A lei restritiva nunca pode atingir o conteúdo essencial. O conteúdo essencial é o limite.';
  it('finds a unique quote and refuses missing or ambiguous ones', () => {
    expect(resolveQuote(text, 'nunca pode atingir')).toEqual({ start: 17, end: 35 });
    expect(() => resolveQuote(text, 'conteúdo essencial')).toThrow(/ambiguous/);
    expect(resolveQuote(text, 'conteúdo essencial', 2).start).toBe(text.lastIndexOf('conteúdo essencial'));
    expect(() => resolveQuote(text, 'inexistente')).toThrow(/not found/);
    expect(() => resolveQuote(text, 'conteúdo essencial', 3)).toThrow(/occurs 2/);
    expect(resolveQuote('aaa', 'aa', 2)).toEqual({ start: 1, end: 3 });
  });
  it('re-anchors by prefix and suffix', () => {
    const q = { exact: 'conteúdo essencial', prefix: 'O ', suffix: ' é o' };
    expect(anchorQuote(text, q)).toEqual({ start: text.lastIndexOf('conteúdo essencial'), end: text.lastIndexOf('conteúdo essencial') + 18 });
    expect(anchorQuote(text, { exact: 'nada', prefix: '', suffix: '' })).toBeNull();
  });
});

import { resolveCitation, type CitationLookup } from './resolve';
import type { Citation } from '../model/files';

describe('resolveCitation (folder spec §8.15 steps 1–4)', () => {
  const law = 'Artigo 18.º As leis restritivas nunca podem atingir o conteúdo essencial do direito restringido.';
  const files = (m: Record<string, { sha: string; text: string }>): CitationLookup => ({
    shaOf: async (p) => m[p]?.sha ?? null,
    pathsWithSha: async (sha) => Object.keys(m).filter((p) => m[p]!.sha === sha),
    textOf: async (p) => m[p]?.text ?? null,
    candidates: async () => Object.keys(m),
    lectureExists: async (id) => id === 'L1',
    examExists: async (id) => id === 'E1',
  });
  const cite = (path: string, sha: string): Citation => ({
    ref: 'S1', source: { kind: 'document', path, sha256: sha }, locator: { type: 'article', article: '18.º', pages: [9, 9] },
    quote: { exact: 'nunca podem atingir o conteúdo essencial', prefix: 'As leis restritivas ', suffix: ' do direito' }, label: 'Lei.pdf · art. 18.º (p. 9)',
  });

  it('exact: the stored path still has the stored SHA-256', async () => {
    expect(await resolveCitation(cite('Documentos/Lei.pdf', 'a'.repeat(64)), files({ 'Documentos/Lei.pdf': { sha: 'a'.repeat(64), text: law } })))
      .toEqual({ status: 'exact', path: 'Documentos/Lei.pdf' });
  });

  it('moved: the same SHA-256 at another path (renamed or moved file)', async () => {
    const r = await resolveCitation(cite('Documentos/Lei.pdf', 'a'.repeat(64)), files({ 'Documentos/Legislação/Lei fundamental.pdf': { sha: 'a'.repeat(64), text: law } }));
    expect(r).toEqual({ status: 'moved', path: 'Documentos/Legislação/Lei fundamental.pdf' });
  });

  it('changed: the file changed, the quote is found again (same path first, then the class)', async () => {
    const changed = `Nova redação. ${law}`;
    const r = await resolveCitation(cite('Documentos/Lei.pdf', 'a'.repeat(64)), files({ 'Documentos/Lei.pdf': { sha: 'b'.repeat(64), text: changed } }));
    expect(r).toMatchObject({ status: 'changed', path: 'Documentos/Lei.pdf', at: { start: changed.indexOf('nunca'), how: 'exact' } });
    const elsewhere = await resolveCitation(cite('Documentos/Lei.pdf', 'a'.repeat(64)), files({ 'Documentos/Outra.pdf': { sha: 'c'.repeat(64), text: changed } }));
    expect(elsewhere).toMatchObject({ status: 'changed', path: 'Documentos/Outra.pdf' });
    // A small edit inside the quote is still found on the same path (fuzzy).
    const edited = law.replace('nunca podem', 'nunca poderão');
    const fuzzy = await resolveCitation(cite('Documentos/Lei.pdf', 'a'.repeat(64)), files({ 'Documentos/Lei.pdf': { sha: 'd'.repeat(64), text: edited } }));
    expect(fuzzy).toMatchObject({ status: 'changed', at: { how: 'fuzzy' } });
  });

  it('missing: nothing matches; lectures and exams resolve by id', async () => {
    expect(await resolveCitation(cite('Documentos/Lei.pdf', 'a'.repeat(64)), files({ 'Documentos/Outra.pdf': { sha: 'c'.repeat(64), text: 'Outro texto.' } }))).toEqual({ status: 'missing' });
    const lecture: Citation = { ref: 'S2', source: { kind: 'lecture', lectureId: 'L1', audioSha256: null, transcriptRevision: 1 }, locator: { type: 'segment', segmentId: 's_abcde', startMs: 1000, endMs: 2000 }, quote: null, label: 'Aula 6 · 0:01' };
    expect(await resolveCitation(lecture, files({}))).toEqual({ status: 'exact' });
    expect(await resolveCitation({ ...lecture, source: { ...lecture.source, lectureId: 'L9' } as Citation['source'] }, files({}))).toEqual({ status: 'missing' });
    expect(await resolveCitation({ ...lecture, source: { kind: 'exam', examId: 'E1' } }, files({}))).toEqual({ status: 'exact' });
  });
});
