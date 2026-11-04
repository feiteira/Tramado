// Formatting helpers of the group screens, and Windows file-name problems (UX §3.15.9).
import { describe, expect, it } from 'vitest';
import { makeI18n } from '../../ui/i18n';
import { encodeMentions, decodeMentions, filterMentions, mentionQuery } from '../../ui/tramado/Composer';
import { formatSize, shortDevice, splitDeviceName } from './format';
import { windowsNameProblems, windowsProblem } from './windowsNames';
import { syncErrorOf } from './cards';

describe('format', () => {
  it('sizes, device names and short ids', () => {
    const en = makeI18n('en');
    expect(formatSize(512, en)).toBe('512 B');
    expect(formatSize(84_000, en)).toBe('84 KB');
    expect(formatSize(2_310_000, en)).toBe('2.3 MB');
    expect(formatSize(2_310_000, makeI18n('pt'))).toBe('2,3 MB');
    expect(splitDeviceName('Diogo Santos (Diogo’s laptop)')).toEqual({ person: 'Diogo Santos', device: 'Diogo’s laptop' });
    expect(splitDeviceName('Tramado')).toEqual({ person: 'Tramado', device: '' });
    expect(shortDevice('AB4Z76W-AAAAAAA-BBBBBBB')).toBe('AB4Z76W');
  });

  it('Windows names', () => {
    expect(windowsProblem('aula: resumo?.md')).toBe('chars');
    expect(windowsProblem('CON.txt')).toBe('reserved');
    expect(windowsProblem('notas.')).toBe('trailing');
    expect(windowsProblem('Aula 6.pdf')).toBeNull();
    expect(windowsNameProblems(['Docs/Aula.pdf', 'Docs/aula.pdf', 'x/aux', 'ok.md'])).toEqual(['Docs/aula.pdf', 'x/aux']);
  });

  it('sync error codes', () => {
    expect(syncErrorOf({ state: 'running', error: null })).toBeNull();
    expect(syncErrorOf({ state: 'error', error: null })).toBe('SYNC_UNAVAILABLE');
    expect(syncErrorOf({ state: 'running', error: 'SYNC_LOCKED' })).toBe('SYNC_LOCKED');
    expect(syncErrorOf(null, 'SYNC_PORT')).toBe('SYNC_PORT');
    expect(syncErrorOf(null, 'NOT_FOUND')).toBeNull();
  });
});

describe('composer mentions', () => {
  const opts = [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'Bruno Costa' }, { id: 'cccccccccccccccccccccccccc', name: 'Carla Mendes' }, { id: 'ai', name: 'AI' }, { id: 'everyone', name: 'everyone' }];
  it('finds the query before the caret and filters options', () => {
    expect(mentionQuery('olá @Br', 7)).toEqual({ start: 4, query: 'Br' });
    expect(mentionQuery('email@x', 7)).toBeNull();
    expect(filterMentions(opts, 'men').map((o) => o.id)).toEqual(['cccccccccccccccccccccccccc']);
    expect(filterMentions(opts, 'ia').map((o) => o.id)).toEqual(['ai']);
    expect(filterMentions(opts, 'tod').map((o) => o.id)).toEqual(['everyone']);
  });
  it('encodes names, @AI/@IA and @everyone as tokens, and decodes them back', () => {
    const text = '@Bruno Costa e @IA: o que disse? @everyone @Carla';
    const enc = encodeMentions(text, opts);
    expect(enc).toBe('<@bbbbbbbbbbbbbbbbbbbbbbbbbb> e <@ai>: o que disse? <@everyone> @Carla');
    expect(encodeMentions('mail@ai.org @ai', opts)).toBe('mail@ai.org <@ai>');
    expect(encodeMentions('@ai', opts.slice(0, 2))).toBe('@ai');   // AI off: not a mention
    expect(decodeMentions(enc, opts)).toBe('@Bruno Costa e @AI: o que disse? @everyone @Carla');
  });
});
