import { describe, expect, it } from 'vitest';
import { fitClassPath, lectureDirName, sanitize, unique } from './sanitize';

describe('sanitize (folder spec §5.4)', () => {
  it('applies each step', () => {
    expect(sanitize('Aula 6: "Restrições" <1/2>?', 'x')).toBe('Aula 6- -Restrições- -1-2--');
    expect(sanitize('  a \t\n b  ', 'x')).toBe('a -- b'); // step 2 turns controls into '-' before step 3
    expect(sanitize('name. . ', 'x')).toBe('name');
    expect(sanitize('.hidden', 'x')).toBe('_hidden');
    expect(sanitize('CON', 'x')).toBe('CON_');
    expect(sanitize('con.txt', 'x')).toBe('con_.txt');
    expect(sanitize('lpt¹.md', 'x')).toBe('lpt¹_.md');
    expect(sanitize('notes.tmp', 'x')).toBe('notes_.tmp');
    expect(sanitize('a.sync-conflict-x.md', 'x')).toBe('a.sync-conflict-x_.md');
    expect(sanitize('~$draft.docx', 'x')).toBe('~$draft_.docx');
    expect(sanitize('   ', 'Untitled')).toBe('Untitled');
    expect(sanitize('Código', 'x')).toBe('Código');
  });

  it('truncates to 120 UTF-8 bytes on a grapheme boundary, keeping the extension', () => {
    const long = 'é'.repeat(100) + '.pdf';
    const s = sanitize(long, 'x');
    expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(120);
    expect(s.endsWith('.pdf')).toBe(true);
    const emoji = '👩‍👩‍👧'.repeat(10);
    const e = sanitize(emoji, 'x');
    expect(new TextEncoder().encode(e).length).toBeLessThanOrEqual(120);
    expect(emoji.startsWith(e)).toBe(true);
  });

  it('makes names unique case-insensitively', () => {
    expect(unique(['Notas.md', 'notas (2).md'], 'NOTAS.md')).toBe('NOTAS (3).md');
    expect(unique([], 'a')).toBe('a');
  });

  it('names lecture directories in the recorder\'s zone and fits long paths', () => {
    expect(lectureDirName(Date.UTC(2026, 9, 14, 9, 15), 'Aula 6', 'Europe/Lisbon')).toBe('2026-10-14 1015 Aula 6');
    const p = fitClassPath('Aulas', 'x'.repeat(300) + '.pdf');
    expect(p!.length).toBe(200);
    expect(p!.endsWith('.pdf')).toBe(true);
    expect(fitClassPath('a'.repeat(199), 'b')).toBeNull();
  });
});
