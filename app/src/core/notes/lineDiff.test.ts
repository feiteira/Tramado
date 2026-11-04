import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diffLines, sideBySide, sideOf, splitLines } from './lineDiff';

/** Length of a longest common subsequence (the reference for minimality). */
function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  return dp[a.length]![b.length]!;
}

describe('diffLines (Myers)', () => {
  it('finds the changed lines of a note edited twice', () => {
    const mine = splitLines('# Resumo\nRestrições\nTrês testes\nFim\n');
    const theirs = splitLines('# Resumo\nRestrições aos direitos\nTrês testes\nNota do Bruno\nFim\n');
    const runs = diffLines(mine, theirs);
    expect(runs).toEqual([
      { op: 'equal', lines: ['# Resumo'] },
      { op: 'del', lines: ['Restrições'] },
      { op: 'add', lines: ['Restrições aos direitos'] },
      { op: 'equal', lines: ['Três testes'] },
      { op: 'add', lines: ['Nota do Bruno'] },
      { op: 'equal', lines: ['Fim'] },
    ]);
    expect(sideBySide(runs).map((r) => r.op)).toEqual(['equal', 'change', 'equal', 'add', 'equal']);
    expect(diffLines([], ['a'])).toEqual([{ op: 'add', lines: ['a'] }]);
    expect(diffLines(['a'], [])).toEqual([{ op: 'del', lines: ['a'] }]);
    expect(diffLines([], [])).toEqual([]);
  });

  it('rebuilds both sides and keeps exactly the longest common subsequence (property)', () => {
    const line = fc.constantFrom('a', 'b', 'c', 'd', '', '# T');
    fc.assert(fc.property(fc.array(line, { maxLength: 30 }), fc.array(line, { maxLength: 30 }), (a, b) => {
      const runs = diffLines(a, b);
      expect(sideOf(runs, 'a')).toEqual(a);
      expect(sideOf(runs, 'b')).toEqual(b);
      const equal = runs.filter((r) => r.op === 'equal').reduce((n, r) => n + r.lines.length, 0);
      expect(equal).toBe(lcs(a, b));
    }), { numRuns: Number(process.env.TRAMADO_PROPERTY_RUNS) || 200 });
  });
});
