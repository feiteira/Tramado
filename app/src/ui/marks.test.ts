import { describe, expect, it } from 'vitest';
import { parseMarks, stripMarks } from './marks';

describe('marks', () => {
  it('splits bold and highlighter marks', () => {
    expect(parseMarks('Your classes, [m]all in one place[/m]')).toEqual([
      { text: 'Your classes, ', mark: null },
      { text: 'all in one place', mark: 'm' },
    ]);
    expect(parseMarks('[b]Ana[/b] joined')).toEqual([
      { text: 'Ana', mark: 'b' },
      { text: ' joined', mark: null },
    ]);
  });
  it('leaves malformed marks as text', () => {
    expect(stripMarks('a [b]b[/m] c')).toBe('a [b]b[/m] c');
    expect(stripMarks('[x]y[/x]')).toBe('[x]y[/x]');
  });
});
