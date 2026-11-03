import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkWords, parseCheckWords } from './checkWords';

const root = new URL('../../../../', import.meta.url);
const vectors = JSON.parse(readFileSync(new URL('test-vectors/check-words.json', root), 'utf8')) as {
  cases: Array<{ deviceId: string; words: string }>;
};

describe('checkWords', () => {
  it('matches every vector of test-vectors/check-words.json', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
    for (const c of vectors.cases) expect(checkWords(c.deviceId), c.deviceId).toBe(c.words);
  });

  it('has 256 + 256 distinct ASCII words of 3–7 letters', () => {
    const { adj, noun } = parseCheckWords(readFileSync(new URL('docs/spec/check-words-v1.txt', root), 'utf8'));
    expect(new Set(adj).size).toBe(256);
    expect(new Set(noun).size).toBe(256);
    for (const w of [...adj, ...noun]) expect(w).toMatch(/^[a-z]{3,7}$/);
  });
});
