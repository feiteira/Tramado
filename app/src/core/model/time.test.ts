import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { instant, parseRfc3339 } from './time';

const V = JSON.parse(readFileSync(new URL('../../../../test-vectors/time.json', import.meta.url), 'utf8')) as {
  instant: Array<{ ms: number; instant: string }>;
  parse: Array<{ s: string; ms: number }>;
  invalid: string[];
};

describe('time (test-vectors/time.json)', () => {
  it('formats instants', () => {
    for (const c of V.instant) expect(instant(c.ms)).toBe(c.instant);
  });
  it('parses RFC 3339 with fractions and offsets', () => {
    for (const c of V.parse) expect(parseRfc3339(c.s), c.s).toBe(c.ms);
    for (const s of V.invalid) expect(parseRfc3339(s), s).toBeNull();
  });
  it('round-trips', () => {
    for (const c of V.instant) expect(parseRfc3339(instant(c.ms))).toBe(c.ms);
  });
});
