/**
 * Interface languages. Adding one: append the code, fill its metadata, add
 * `locales/<code>.ts` typed as `Messages`, and register it in `catalogs.ts`.
 * TypeScript fails the build until every key exists in every language.
 */
export const UI_LOCALES = ['en', 'pt', 'es'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export interface UiLocaleMeta {
  /** BCP 47 tag for Intl — the variety, not just the language. */
  bcp47: string;
  nativeName: string;
  englishName: string;
}

export const UI_LOCALE_META: Record<UiLocale, UiLocaleMeta> = {
  en: { bcp47: 'en-GB', nativeName: 'English', englishName: 'English' },
  pt: { bcp47: 'pt-PT', nativeName: 'Português (Portugal)', englishName: 'European Portuguese' },
  es: { bcp47: 'es-ES', nativeName: 'Español (España)', englishName: 'European Spanish' },
};

export const DEFAULT_UI_LOCALE: UiLocale = 'en';

export function isUiLocale(value: string | null | undefined): value is UiLocale {
  return (UI_LOCALES as readonly string[]).includes(value ?? '');
}

/** Maps an OS or browser tag (pt, pt-PT, pt-BR, es-419, en-US…) onto a supported UI locale. */
export function detectUiLocale(raw: string | null | undefined): UiLocale {
  if (!raw) return DEFAULT_UI_LOCALE;
  const primary = raw.toLowerCase().replace(/_/g, '-').split('-')[0];
  return isUiLocale(primary) ? primary : DEFAULT_UI_LOCALE;
}
