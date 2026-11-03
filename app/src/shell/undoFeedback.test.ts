import { describe, expect, it } from 'vitest';
import { makeI18n } from '../ui/i18n';
import { describeStep, stepDoneMessage, stepRefusedMessage } from './undoFeedback';
import { UndoManager } from './undoManager';

describe('undo feedback', () => {
  const step = { label: 'Deleted “Aula 6.pdf”', detail: '' };
  it('names the step in the reader’s language', () => {
    expect(describeStep(step)).toBe('Deleted “Aula 6.pdf”');
    expect(stepDoneMessage('undo', step, makeI18n('pt'))).toBe('Anular: Deleted “Aula 6.pdf”');
    expect(stepRefusedMessage('redo', null, makeI18n('en'))).toBe('Someone else changed this at the same time. Both versions are kept.');
  });

  it('runs steps in order and clears redo on a new record', async () => {
    const m = new UndoManager();
    const log: string[] = [];
    const mk = (n: string) => ({ label: n, detail: '', undo: async () => void log.push(`-${n}`), redo: async () => void log.push(`+${n}`) });
    m.record(mk('a'));
    m.record(mk('b'));
    await m.undo();
    await m.redo();
    await m.undo();
    m.record(mk('c'));
    expect(m.labels).toMatchObject({ canUndo: true, canRedo: false, undo: { label: 'c' } });
    expect(log).toEqual(['-b', '+b', '-b']);
    expect(await new UndoManager().undo()).toBeNull();
  });
});
