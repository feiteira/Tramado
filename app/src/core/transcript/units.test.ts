import { describe, expect, it } from 'vitest';
import { transcriptIndexText, transcriptUnits } from './units';

describe('transcript units', () => {
  const segments = [
    { id: 's_b0000', startMs: 5000, endMs: 9000, speaker: 'lecture', text: 'Isto costuma sair  no exame.' },
    { id: 's_a0000', startMs: 0, endMs: 4000, speaker: 'lecture', text: 'Bom dia.' },
    { id: 's_c0000', startMs: 9000, endMs: 9500, speaker: 'lecture', text: '   ' },
  ];
  it('makes one segment unit per non-empty segment, in time order', () => {
    const { text, units } = transcriptIndexText({ segments });
    expect(text).toBe('Bom dia.\nIsto costuma sair no exame.');
    expect(units).toEqual([
      { start: 0, end: 8, locator: { type: 'segment', segmentId: 's_a0000', startMs: 0, endMs: 4000 } },
      { start: 9, end: 36, locator: { type: 'segment', segmentId: 's_b0000', startMs: 5000, endMs: 9000 } },
    ]);
    expect(text.slice(units[1]!.start, units[1]!.end)).toBe('Isto costuma sair no exame.');
    expect(transcriptUnits({ segments })).toHaveLength(2);
  });
});
