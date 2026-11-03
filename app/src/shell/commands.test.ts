import { describe, expect, it, vi } from 'vitest';
import { type Command, CommandRegistry, scoreCommand } from './commands';

const cmd = (id: string, label: string, keywords?: string[]): Command => ({ id, label, keywords, run: () => undefined });

describe('scoreCommand', () => {
  it('matches everything for an empty or blank query', () => {
    expect(scoreCommand(cmd('a', 'Codes'), '')).toBeGreaterThan(0);
    expect(scoreCommand(cmd('a', 'Codes'), '   ')).toBeGreaterThan(0);
  });

  it('ignores case and accents in both directions', () => {
    expect(scoreCommand(cmd('a', 'Ir para Memorandos'), 'memo')).toBeGreaterThan(0);
    expect(scoreCommand(cmd('a', 'Pseudonimização'), 'PSEUDONIMIZACAO')).toBeGreaterThan(0);
    expect(scoreCommand(cmd('a', 'Pseudonimizacao'), 'pseudonimização')).toBeGreaterThan(0);
  });

  it('requires every word', () => {
    expect(scoreCommand(cmd('a', 'Go to Codes'), 'go codes')).toBeGreaterThan(0);
    expect(scoreCommand(cmd('a', 'Go to Codes'), 'go memos')).toBe(0);
  });

  it('ranks a label start above a word start above a substring above a keyword', () => {
    const start = scoreCommand(cmd('a', 'Codes'), 'cod');
    const word = scoreCommand(cmd('b', 'Go to codes'), 'cod');
    const inner = scoreCommand(cmd('c', 'Autocode'), 'cod');
    const key = scoreCommand(cmd('d', 'Codebook', ['xcod']), 'xco');
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(key);
    expect(key).toBeGreaterThan(0);
  });
});

describe('CommandRegistry', () => {
  it('registers, replaces by id and unregisters only its own entry', () => {
    const r = new CommandRegistry();
    const off1 = r.register(cmd('x', 'First'));
    const off2 = r.register(cmd('x', 'Second'));
    expect(r.list().map((c) => c.label)).toEqual(['Second']);
    off1(); // the replaced one: must not remove the replacement
    expect(r.list().map((c) => c.label)).toEqual(['Second']);
    off2();
    expect(r.list()).toHaveLength(0);
  });

  it('searches best first, keeping registration order among equals, and skips disabled', () => {
    const r = new CommandRegistry();
    r.register([cmd('1', 'Go to Memos'), cmd('2', 'Memos'), cmd('3', 'Go to Media'), { ...cmd('4', 'Memo export'), disabled: true }]);
    expect(r.search('memo').map((c) => c.id)).toEqual(['2', '1']);
    expect(r.search('').map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(r.search('zzz')).toEqual([]);
  });

  it('puts a higher priority first among equal matches, never above a better match', () => {
    const r = new CommandRegistry();
    r.register([cmd('nav', 'Go to Documents'), { ...cmd('screen', 'Go to document…'), priority: 1 }, cmd('exact', 'Documents')]);
    expect(r.search('go to doc').map((c) => c.id)).toEqual(['screen', 'nav']);
    expect(r.search('documents').map((c) => c.id)).toEqual(['exact', 'nav']);
    expect(r.search('').map((c) => c.id)).toEqual(['screen', 'nav', 'exact']);
  });

  it('limits results', () => {
    const r = new CommandRegistry();
    r.register(Array.from({ length: 500 }, (_, i) => cmd(String(i), `Command ${i}`)));
    expect(r.search('command', 20)).toHaveLength(20);
  });

  it('notifies subscribers and bumps its version', () => {
    const r = new CommandRegistry();
    const fn = vi.fn();
    const unsub = r.subscribe(fn);
    const v0 = r.getVersion();
    const off = r.register(cmd('a', 'A'));
    off();
    off(); // a second call changes nothing
    expect(fn).toHaveBeenCalledTimes(2);
    expect(r.getVersion()).toBe(v0 + 2);
    unsub();
    r.register(cmd('b', 'B'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
