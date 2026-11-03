import { describe, expect, it } from 'vitest';
import { typedMatches } from './confirmMatch';

describe('typedMatches', () => {
  it('needs the exact name, ignoring outer and repeated spaces', () => {
    expect(typedMatches('Nurses on night shifts', 'Nurses on night shifts')).toBe(true);
    expect(typedMatches('  Nurses  on night shifts ', 'Nurses on night shifts')).toBe(true);
    expect(typedMatches('nurses on night shifts', 'Nurses on night shifts')).toBe(false);
    expect(typedMatches('Nurses on night', 'Nurses on night shifts')).toBe(false);
  });
  it('treats composed and decomposed accents alike, and keeps emoji', () => {
    expect(typedMatches('Ética do cuidado 🌱', 'Ética do cuidado 🌱')).toBe(true);
  });
  it('never matches an empty expectation', () => {
    expect(typedMatches('', '')).toBe(false);
    expect(typedMatches(' ', '  ')).toBe(false);
  });
});
