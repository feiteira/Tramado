import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { catalogs } from '../../core/i18n/catalogs';
import { translate, translatePlural } from '../../core/i18n/translate';
import type { UiLocale } from '../../core/i18n/languages';
import { dayMonth, defaultLectureTitle, duration, findAll, groupByWeek, parseClock, rowDate, shortDay, size, spokenTime, timeLeft, weekOf } from './format';

const fmt = (locale: UiLocale) => ({
  locale,
  t: (k: string, v?: Record<string, string | number>) => translate(catalogs[locale], catalogs.en, k as never, v),
  tp: (k: string, n: number, v?: Record<string, string | number>) => translatePlural(catalogs[locale], catalogs.en, k as never, n, locale, v),
});
const zone = 'Europe/Lisbon';
const now = DateTime.fromISO('2026-11-03T15:30', { zone });   // the demo's Tuesday

describe('lecture formatting (UX §3.4–§3.6)', () => {
  it('writes the short day the UX prints in each language', () => {
    const d = DateTime.fromISO('2026-11-03T10:00', { zone });
    expect(shortDay(d, 'en')).toBe('Tue 3 Nov');
    expect(shortDay(d, 'pt')).toBe('ter., 3 nov.');
    expect(shortDay(d, 'es')).toBe('mar. 3 nov.');
    expect(dayMonth(d, 'pt')).toBe('3 nov.');
    expect(defaultLectureTitle(8, d, fmt('en'))).toBe('Lecture 8 — Tue 3 Nov');
  });

  it('groups by Monday-based weeks, newest first', () => {
    expect(weekOf('2026-11-02T09:00:00Z', now)).toEqual({ kind: 'thisWeek' });
    expect(weekOf('2026-11-01T09:00:00Z', now)).toEqual({ kind: 'lastWeek' });
    expect(weekOf('2026-10-20T09:00:00Z', now)).toEqual({ kind: 'weekOf', monday: '2026-10-19' });
    const g = groupByWeek([{ startedAt: '2026-10-20T09:00:00Z' }, { startedAt: '2026-11-03T10:00:00Z' }, { startedAt: '2026-10-27T10:00:00Z' }], now);
    expect(g.map((x) => [x.key, x.items.length])).toEqual([['thisWeek', 1], ['lastWeek', 1], ['2026-10-19', 1]]);
  });

  it('dates rows as Today/Yesterday with the time, else the short day', () => {
    expect(rowDate('2026-11-03T10:00:00Z', now, fmt('en'))).toBe('Today 10:00');
    expect(rowDate('2026-11-02T14:00:00Z', now, fmt('en'))).toBe('Yesterday 14:00');
    expect(rowDate('2026-10-27T10:00:00Z', now, fmt('en'))).toBe('Tue 27 Oct');
  });

  it('formats durations, sizes and time left', () => {
    expect(duration(5_520_000, fmt('en'))).toBe('1 h 32 min');
    expect(duration(3_120_000, fmt('en'))).toBe('52 min');
    expect(duration(40_000, fmt('en'))).toBe('40 s');
    expect(size(574_000_000, fmt('en'))).toBe('574 MB');
    expect(size(1_080_000_000, fmt('en'))).toBe('1.08 GB');
    expect(timeLeft(25, fmt('en'))).toBe('about 25 minutes left');
    expect(timeLeft(1, fmt('en'))).toBe('about 1 minute left');
    expect(timeLeft(65, fmt('en'))).toBe('about 1 h 5 min left');
    expect(timeLeft(null, fmt('en'))).toBe('');
  });

  it('reads a typed time', () => {
    expect(parseClock('1:02:03')).toBe(3_723_000);
    expect(parseClock('41:12')).toBe(2_472_000);
    expect(parseClock('90')).toBe(90_000);
    expect(parseClock('41.12')).toBe(2_472_000);
    expect(parseClock('4:75')).toBeNull();
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('')).toBeNull();
  });

  it('speaks the slider value', () => {
    expect(spokenTime(2_472_000, 'en')).toBe('41 minutes 12 seconds');
    expect(spokenTime(5_525_000, 'en')).toBe('1 hour 32 minutes');
  });

  it('finds case- and accent-insensitively, with offsets in the original text', () => {
    const text = 'O conteúdo essencial; CONTEUDO.';
    expect(findAll(text, 'conteudo')).toEqual([[2, 10], [22, 30]]);
    expect(findAll(text, '  ')).toEqual([]);
  });
});
