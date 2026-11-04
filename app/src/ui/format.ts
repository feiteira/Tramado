// Sizes and durations in the reader's language, from the `common.size.*` and `common.duration.*` catalog strings
// (numbers formatted with the locale's separators). Pure helpers over an i18n `t`.
import type { MessageKey } from './i18n';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** 1536 → "1.5 KB", 812 × 2^20 → "812 MB" (base 1024; one decimal below 10; never "1,000 KB"). */
export function formatBytes(t: T, bcp47: string, bytes: number): string {
  const n = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  const units: Array<['b' | 'kb' | 'mb' | 'gb', number]> = [['b', 1], ['kb', 1024], ['mb', 1024 ** 2], ['gb', 1024 ** 3]];
  for (const [unit, size] of units) {
    const v = n / size;
    const digits = unit !== 'b' && v < 10 ? 1 : 0;
    const shown = Number(v.toFixed(digits));
    // The smallest unit whose rounded value stays below 1000 ("1 MB", not "1,000 KB" for 999.6 KB).
    if (shown < 1000 || unit === 'gb') {
      const text = new Intl.NumberFormat(bcp47, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(shown);
      return t(`common.size.${unit}`, { n: text });
    }
  }
  return t('common.size.b', { n: String(n) });
}

/** 5 520 000 ms → "1 h 32 min", 2 880 000 → "48 min", 42 000 → "42 s". */
export function formatDuration(t: T, ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t('common.duration.s', { s });
  const m = Math.round(s / 60);
  if (m < 60) return t('common.duration.m', { m });
  return t('common.duration.hm', { h: Math.floor(m / 60), m: m % 60 });
}
