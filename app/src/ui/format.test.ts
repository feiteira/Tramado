import { describe, expect, it } from 'vitest';
import { makeI18n } from './i18n';
import { formatBytes, formatDuration } from './format';

describe('formatBytes / formatDuration', () => {
  const en = makeI18n('en');
  const pt = makeI18n('pt');
  it('sizes', () => {
    expect(formatBytes(en.t, 'en-GB', 0)).toBe('0 B');
    expect(formatBytes(en.t, 'en-GB', 1536)).toBe('1.5 KB');
    expect(formatBytes(en.t, 'en-GB', 812 * 1024 ** 2)).toBe('812 MB');
    expect(formatBytes(en.t, 'en-GB', 1.08 * 1024 ** 3)).toBe('1.1 GB');
    expect(formatBytes(pt.t, 'pt-PT', 1536)).toBe('1,5 KB');
    expect(formatBytes(en.t, 'en-GB', 1000 * 1024)).toBe('1 MB');
    expect(formatBytes(en.t, 'en-GB', 999)).toBe('999 B');
    // Just under 1000 KB rounds up: never "1,000 KB".
    expect(formatBytes(en.t, 'en-GB', 999.6 * 1024)).toBe('1 MB');
    expect(formatBytes(en.t, 'en-GB', 1000)).toBe('1 KB');
    expect(formatBytes(en.t, 'en-GB', 9.97 * 1024 ** 2)).toBe('10 MB');
  });
  it('durations', () => {
    expect(formatDuration(en.t, 42_000)).toBe('42 s');
    expect(formatDuration(en.t, 2_880_000)).toBe('48 min');
    expect(formatDuration(en.t, 5_520_000)).toBe('1 h 32 min');
  });
});
