import { describe, expect, it } from 'vitest';
import { conflictOriginal, groupConflicts, keepBothPath, noteTitle } from './conflicts';

describe('note conflict copies (sync spec §16)', () => {
  it('groups copies per note, oldest first', () => {
    const g = groupConflicts([
      'Notas/Resumo.sync-conflict-20261103-155644-TKBNV23.md',
      'Notas/Resumo.sync-conflict-20261102-101010-AB4Z76W.md',
      'Notas/Outra.sync-conflict-20261103-101010-AB4Z76W.md',
      'Notas/Normal.md',
    ]);
    expect([...g.keys()].sort()).toEqual(['Notas/Outra.md', 'Notas/Resumo.md']);
    expect(g.get('Notas/Resumo.md')!.map((c) => c.date)).toEqual(['20261102', '20261103']);
    expect(conflictOriginal('Notas/Resumo.sync-conflict-20261103-155644-TKBNV23.md')).toBe('Notas/Resumo.md');
    expect(conflictOriginal('Notas/Resumo.md')).toBeNull();
  });

  it('keeps both as `<base> (2).md`, unique among the siblings', () => {
    expect(keepBothPath('Notas/Resumo.md', ['Resumo.md'])).toBe('Notas/Resumo (2).md');
    expect(keepBothPath('Notas/Resumo.md', ['Resumo.md', 'Resumo (2).md', 'resumo (3).md'])).toBe('Notas/Resumo (4).md');
  });

  it('titles a note by its first heading, else its file name', () => {
    expect(noteTitle('Notas/a.md', 'texto\n# Semana 8\n## Sub')).toBe('Semana 8');
    expect(noteTitle('Notas/Resumo — Semana 8.md', 'sem título')).toBe('Resumo — Semana 8');
    expect(noteTitle('notes/x.md', null)).toBe('x');
  });
});
