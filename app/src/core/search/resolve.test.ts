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
