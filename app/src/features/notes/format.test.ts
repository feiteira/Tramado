// The note editor's Markdown commands (UX §3.8).
import { describe, expect, it } from 'vitest';
import { clock, docLink, insert, link, parseClock, parseTramadoLink, timeLink, toggleLines, wrap } from './format';

const apply = (text: string, sel: [number, number], f: (t: string, a: number, b: number) => { text: string; start: number; end: number }) => {
  const r = f(text, sel[0], sel[1]);
  return { text: r.text, selected: r.text.slice(r.start, r.end) };
};

describe('wrap', () => {
  it('wraps the selection, keeps spaces outside, and unwraps a wrapped one', () => {
    expect(apply('a lei restritiva', [2, 5], (t, a, b) => wrap(t, a, b, '**', 'texto'))).toEqual({ text: 'a **lei** restritiva', selected: 'lei' });
    expect(apply('a **lei** restritiva', [4, 7], (t, a, b) => wrap(t, a, b, '**', 'texto'))).toEqual({ text: 'a lei restritiva', selected: 'lei' });
    expect(apply('a lei ', [2, 6], (t, a, b) => wrap(t, a, b, '_', 'x'))).toEqual({ text: 'a _lei_ ', selected: 'lei' });
    expect(apply('', [0, 0], (t, a, b) => wrap(t, a, b, '**', 'negrito'))).toEqual({ text: '**negrito**', selected: 'negrito' });
  });
});

describe('toggleLines', () => {
  it('adds and removes a prefix on every selected line, replacing other list prefixes', () => {
    const t = 'um\ndois\ntrês';
    expect(toggleLines(t, 0, t.length, '- ').text).toBe('- um\n- dois\n- três');
    expect(toggleLines('- um\n- dois', 0, 11, '- ').text).toBe('um\ndois');
    expect(toggleLines('- um', 2, 2, '- [ ] ').text).toBe('- [ ] um');
    expect(toggleLines('título', 3, 3, '## ').text).toBe('## título');
    expect(toggleLines('## título', 3, 3, '## ').text).toBe('título');
  });
});

describe('links', () => {
  it('makes a link of the selection or a placeholder', () => {
    expect(apply('ver a lei', [6, 9], (t, a, b) => link(t, a, b, 'https://example.org', 'ligação'))).toEqual({ text: 'ver a [lei](https://example.org)', selected: 'lei' });
    expect(insert('nota', 4, 4, '[41:12](tramado:lecture/X?t=1)').text).toBe('nota [41:12](tramado:lecture/X?t=1)');
  });

  it('writes timestamp and document links in the UX §3.8 formats and reads them back', () => {
    expect(timeLink('01JA', 2_472_000)).toBe('[41:12](tramado:lecture/01JA?t=2472000)');
    expect(docLink('Documentos/Legislação/Lei.pdf', 'Lei Fundamental', 9, (n) => `p. ${n}`)).toBe('[Lei Fundamental, p. 9](tramado:doc/Documentos%2FLegisla%C3%A7%C3%A3o%2FLei.pdf?page=9)');
    expect(parseTramadoLink('tramado:lecture/01JA?t=2472000')).toEqual({ kind: 'lecture', id: '01JA', ms: 2_472_000 });
    expect(parseTramadoLink('tramado:doc/Documentos%2FLei.pdf?page=9')).toEqual({ kind: 'doc', path: 'Documentos/Lei.pdf', page: 9 });
    expect(parseTramadoLink('https://example.org')).toBeNull();
  });

  it('formats and parses clock times', () => {
    expect(clock(725_000)).toBe('12:05');
    expect(clock(3_900_000)).toBe('1:05:00');
    expect(parseClock('41:12')).toBe(2_472_000);
    expect(parseClock('1:05:00')).toBe(3_900_000);
    expect(parseClock('abc')).toBeNull();
  });
});
