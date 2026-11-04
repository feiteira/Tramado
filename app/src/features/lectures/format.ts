// Formatting shared by the lectures tab, the lecture view, the recording flow and the dock (UX §3.4–§3.6, §2.7).
// Pure: no DOM, no React. Dates follow the UI language with the short forms the UX spec prints
// ("Tue 20 Oct", "ter., 20 out.", "mar. 20 oct."), which Intl does not produce for pt-PT.
import { DateTime } from 'luxon';
import type { UiLocale } from '../../core/i18n/languages';
import { hms } from '../../core/transcript/render';
import { clock } from '../../core/speech/timing';

/** The parts of I18n these helpers need (structural, so tests can pass a stub). */
export interface Fmt {
  locale: UiLocale;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- I18n's typed keys; these helpers pass known catalog keys
  t: (key: any, vars?: Record<string, string | number>) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tp: (key: any, n: number, vars?: Record<string, string | number>) => string;
}

const WEEKDAYS: Record<UiLocale, readonly string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  pt: ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'],
  es: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
};
const MONTHS: Record<UiLocale, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
};

/** "Tue 3 Nov" · "ter., 3 nov." · "mar. 3 nov." (UX §3.6.4 default titles, §3.4 row meta). */
export function shortDay(dt: DateTime, locale: UiLocale): string {
  const wd = WEEKDAYS[locale][dt.weekday - 1]!;
  const mon = MONTHS[locale][dt.month - 1]!;
  if (locale === 'pt') return `${wd}., ${dt.day} ${mon}.`;
  if (locale === 'es') return `${wd}. ${dt.day} ${mon}.`;
  return `${wd} ${dt.day} ${mon}`;
}

/** "3 Nov" · "3 nov." (week headings). */
export function dayMonth(dt: DateTime, locale: UiLocale): string {
  const mon = MONTHS[locale][dt.month - 1]!;
  return locale === 'en' ? `${dt.day} ${mon}` : `${dt.day} ${mon}.`;
}

/** "10:00" (24 h in every UI language). */
export const hhmm = (dt: DateTime): string => dt.toFormat('HH:mm');

/** "00:41:12" — the player, transcript timestamps and the dock (tabular). */
export const longClock = (ms: number): string => hms(ms);
/** "41:12", "1:05:00" — compact times (markers, notes, toasts). */
export const shortClock = (ms: number): string => clock(ms);

/** "1 h 32 min", "52 min", "40 s" (common.duration). */
export function duration(ms: number, f: Pick<Fmt, 't'>): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return f.t('common.duration.s', { s: total });
  const minutes = Math.round(total / 60);
  if (minutes < 60) return f.t('common.duration.m', { m: minutes });
  return f.t('common.duration.hm', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/** "about 12 minutes left", "about 1 h 5 min left", "less than a minute left" (lectures.transcription.left.*). */
export function timeLeft(etaMin: number | null, f: Pick<Fmt, 't' | 'tp'>, ns: 'lectures.transcription' | 'speech' = 'lectures.transcription'): string {
  if (etaMin === null || !Number.isFinite(etaMin)) return '';
  if (etaMin < 1) return f.t(`${ns}.left.underMinute`);
  const m = Math.round(etaMin);
  if (m < 60) return f.tp(`${ns}.left.minutes`, m, { n: m });
  return f.t(`${ns}.left.hours`, { h: Math.floor(m / 60), m: m % 60 });
}

/** "574 MB", "1.08 GB" (common.size, decimal units as the UX prints them). */
export function size(bytes: number, f: Pick<Fmt, 't' | 'locale'>): string {
  const nf = (n: number, digits: number) => new Intl.NumberFormat(f.locale === 'en' ? 'en-GB' : f.locale === 'pt' ? 'pt-PT' : 'es-ES', { maximumFractionDigits: digits }).format(n);
  if (bytes < 1000) return f.t('common.size.b', { n: nf(bytes, 0) });
  if (bytes < 1e6) return f.t('common.size.kb', { n: nf(bytes / 1e3, 0) });
  if (bytes < 1e9) return f.t('common.size.mb', { n: nf(bytes / 1e6, 0) });
  return f.t('common.size.gb', { n: nf(bytes / 1e9, 2) });
}

/** Megabytes as a bare number ("212"), for "{done} of {total} MB". */
export const mb = (bytes: number): string => String(Math.round(bytes / 1e6));

// ── grouping of the lectures list (UX §3.4) ──────────────────────────────────────────────────────

export type WeekKey = { kind: 'thisWeek' } | { kind: 'lastWeek' } | { kind: 'weekOf'; monday: string /* ISO date */ };

/** Monday-based week of `iso` relative to `now` (both read in `zone`). */
export function weekOf(iso: string, now: DateTime): WeekKey {
  const d = DateTime.fromISO(iso, { zone: now.zone });
  const monday = d.startOf('day').minus({ days: d.weekday - 1 });
  const thisMonday = now.startOf('day').minus({ days: now.weekday - 1 });
  const weeks = Math.round(thisMonday.diff(monday, 'weeks').weeks);
  if (weeks <= 0) return { kind: 'thisWeek' };
  if (weeks === 1) return { kind: 'lastWeek' };
  return { kind: 'weekOf', monday: monday.toISODate() ?? '' };
}

/** Lectures grouped by week, newest first (the input order is kept inside a group). */
export function groupByWeek<L extends { startedAt: string }>(lectures: readonly L[], now: DateTime): Array<{ key: string; week: WeekKey; items: L[] }> {
  const sorted = [...lectures].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  const out: Array<{ key: string; week: WeekKey; items: L[] }> = [];
  for (const l of sorted) {
    const week = weekOf(l.startedAt, now);
    const key = week.kind === 'weekOf' ? week.monday : week.kind;
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(l);
    else out.push({ key, week, items: [l] });
  }
  return out;
}

/** The row date: "Today 10:00", "Yesterday 14:00", else "Tue 27 Oct". */
export function rowDate(iso: string, now: DateTime, f: Pick<Fmt, 't' | 'locale'>): string {
  const d = DateTime.fromISO(iso, { zone: now.zone });
  const days = Math.round(now.startOf('day').diff(d.startOf('day'), 'days').days);
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase(f.locale) + s.slice(1);
  if (days === 0) return `${cap(f.t('common.relative.today'))} ${hhmm(d)}`;
  if (days === 1) return `${cap(f.t('common.relative.yesterday'))} ${hhmm(d)}`;
  return shortDay(d, f.locale);
}

// ── typing a time into the player (UX §3.5.2 `h:mm:ss`) ──────────────────────────────────────────

/** "1:02:03" → 3 723 000; "41:12" → 2 472 000; "90" → 90 000; null when it is not a time. */
export function parseClock(s: string): number | null {
  const raw = s.trim().replace(/[.,]/g, ':');
  if (!/^\d{1,5}(?::\d{1,2}){0,2}$/.test(raw)) return null;
  const parts = raw.split(':').map((x) => Number(x));
  if (parts.some((x) => !Number.isFinite(x) || x < 0)) return null;
  let secs = 0;
  if (parts.length === 1) secs = parts[0]!;
  else if (parts.length === 2) {
    if (parts[1]! >= 60) return null;
    secs = parts[0]! * 60 + parts[1]!;
  } else if (parts.length === 3) {
    if (parts[1]! >= 60 || parts[2]! >= 60) return null;
    secs = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  } else return null;
  return secs * 1000;
}

/** The spoken value of the timeline slider: "41 minutes 12 seconds of 1 hour 32 minutes" (UX §3.5.2). */
export function spokenTime(ms: number, locale: UiLocale): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const tag = locale === 'en' ? 'en-GB' : locale === 'pt' ? 'pt-PT' : 'es-ES';
  const unit = (n: number, u: 'hour' | 'minute' | 'second') => new Intl.NumberFormat(tag, { style: 'unit', unit: u, unitDisplay: 'long' }).format(n);
  const parts: string[] = [];
  if (h) parts.push(unit(h, 'hour'));
  if (m || h) parts.push(unit(m, 'minute'));
  if (!h) parts.push(unit(s, 'second'));
  return parts.join(' ');
}

/** The default title of a new lecture (UX §3.6.4): "Lecture {n} — Tue 3 Nov". */
export function defaultLectureTitle(n: number, at: DateTime, f: Pick<Fmt, 't' | 'locale'>): string {
  return f.t('record.save.defaultTitle', { n, date: shortDay(at, f.locale) });
}

/** The first name of a person ("Thank Bruno"). */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** Case- and accent-insensitive find (UX §3.5.3 `fold`): every [start, end) of `q` in `text`. */
export function findAll(text: string, q: string): Array<[number, number]> {
  const needle = foldText(q.trim());
  if (!needle) return [];
  const { folded, map } = foldWithMap(text);
  const out: Array<[number, number]> = [];
  let at = folded.indexOf(needle);
  while (at >= 0) {
    out.push([map[at]!, map[at + needle.length]!]);
    at = folded.indexOf(needle, at + Math.max(1, needle.length));
  }
  return out;
}

export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Folds `s` one UTF-16 unit at a time, keeping where each folded index came from. */
function foldWithMap(s: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const f = foldText(s[i]!);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
  }
  map.push(s.length);
  return { folded, map };
}
