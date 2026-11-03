import React, { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { catalogs, type Messages } from '../core/i18n/catalogs';
import { UI_LOCALE_META, type UiLocale, type UiLocaleMeta } from '../core/i18n/languages';
import { type MessageKeyOf, type PluralKeyOf, translate, translatePlural, type Vars } from '../core/i18n/translate';

export type MessageKey = MessageKeyOf<Messages>;
export type PluralKey = PluralKeyOf<Messages>;

export interface I18n {
  locale: UiLocale;
  meta: UiLocaleMeta;
  t: (key: MessageKey, vars?: Vars) => string;
  tp: (key: PluralKey, n: number, vars?: Vars) => string;
  /** 28 Sep 2026 / 28/09/2026 … */
  date: (dt: DateTime, style?: 'short' | 'medium' | 'long' | 'weekday') => string;
  time: (dt: DateTime) => string;
  relative: (iso: string | null, now?: DateTime) => string;
}

let current: UiLocale = 'en';

const I18nContext = createContext<I18n | null>(null);

export function makeI18n(locale: UiLocale): I18n {
  const meta = UI_LOCALE_META[locale];
  const m = catalogs[locale];
  const t = (key: MessageKey, vars?: Vars) => translate(m, catalogs.en, key, vars);
  const tp = (key: PluralKey, n: number, vars?: Vars) => translatePlural(m, catalogs.en, key, n, meta.bcp47, vars);
  return {
    locale,
    meta,
    t,
    tp,
    date: (dt, style = 'medium') => {
      const d = dt.setLocale(meta.bcp47);
      if (style === 'short') return d.toLocaleString(DateTime.DATE_SHORT);
      if (style === 'long') return d.toLocaleString({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (style === 'weekday') return d.toLocaleString({ weekday: 'short', day: 'numeric', month: 'short' });
      return d.toLocaleString(DateTime.DATE_MED);
    },
    time: (dt) => dt.setLocale(meta.bcp47).toLocaleString({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    // Tramado: relative times come from Intl.RelativeTimeFormat (no catalog strings; UX §5 "Dates and
    // times are never written into strings").
    relative: (iso, now = DateTime.now()) => {
      const rtf = new Intl.RelativeTimeFormat(meta.bcp47, { numeric: 'auto' });
      if (!iso) return '—';
      const then = DateTime.fromISO(iso);
      const mins = Math.round(now.diff(then, 'minutes').minutes);
      if (Math.abs(mins) < 1) return rtf.format(0, 'minute');
      if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
      if (Math.abs(mins) < 24 * 60) return rtf.format(-Math.round(mins / 60), 'hour');
      const days = Math.round(now.startOf('day').diff(then.startOf('day'), 'days').days);
      return rtf.format(-days, 'day');
    },
  };
}

export function I18nProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  current = locale;
  const value = useMemo(() => makeI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** For code outside React (error boundary). */
export const i18nStatic = (): I18n => makeI18n(current);

export function useT() {
  const { t } = useI18n();
  return useCallback(t, [t]);
}
