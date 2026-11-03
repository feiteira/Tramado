import { describe, expect, it } from 'vitest';
import { clampSpans, codeRows, intersectLength, intersectSpans, live, lowerBound, mergeSpans, totalLength, upperBound } from './util';

describe('spans', () => {
  it('merges overlapping and touching spans and drops empty ones', () => {
    expect(mergeSpans([{ start: 5, end: 9 }, { start: 0, end: 5 }, { start: 3, end: 3 }, { start: 12, end: 14 }, { start: 13, end: 20 }])).toEqual([
      { start: 0, end: 9 },
      { start: 12, end: 20 },
    ]);
    expect(mergeSpans([])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [{ start: 0, end: 5 }, { start: 2, end: 9 }];
    mergeSpans(input);
    expect(input).toEqual([{ start: 0, end: 5 }, { start: 2, end: 9 }]);
  });

  it('measures and intersects merged spans', () => {
    const a = mergeSpans([{ start: 0, end: 10 }, { start: 20, end: 30 }]);
    const b = mergeSpans([{ start: 5, end: 25 }, { start: 28, end: 40 }]);
    expect(totalLength(a)).toBe(20);
    expect(intersectSpans(a, b)).toEqual([{ start: 5, end: 10 }, { start: 20, end: 25 }, { start: 28, end: 30 }]);
    expect(intersectLength(a, b)).toBe(12);
    expect(intersectLength(a, [])).toBe(0);
  });

  it('clamps spans to a length', () => {
    expect(clampSpans([{ start: -5, end: 3 }, { start: 8, end: 20 }, { start: 30, end: 40 }], 10)).toEqual([{ start: 0, end: 3 }, { start: 8, end: 10 }]);
  });

  it('binary searches', () => {
    const xs = [1, 3, 3, 7];
    expect([0, 1, 3, 4, 8].map((x) => upperBound(xs, x))).toEqual([0, 1, 3, 3, 4]);
    expect([0, 1, 3, 4, 8].map((x) => lowerBound(xs, x))).toEqual([0, 0, 1, 3, 4]);
  });
});

describe('codeRows', () => {
  it('maps codes and, on request, their descendants to rows', () => {
    const d = (id: string) => (id === 'P' ? ['K', 'G'] : id === 'K' ? ['G'] : []);
    expect([...codeRows(['P', 'K'])]).toEqual([['P', [0]], ['K', [1]]]);
    expect([...codeRows(['P', 'K'], true, d)]).toEqual([['P', [0]], ['K', [0, 1]], ['G', [0, 1]]]);
    expect(() => codeRows(['P'], true)).toThrow();
    // Records with ids (as tree.ts returns them) work too.
    expect([...codeRows(['P'], true, () => [{ id: 'K' }])]).toEqual([['P', [0]], ['K', [0]]]);
  });

  it('filters tombstones', () => {
    expect(live([{ deleted: false }, { deleted: true }])).toHaveLength(1);
  });
});
