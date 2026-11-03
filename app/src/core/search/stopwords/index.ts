// Stop word lists by language code. Lists are lower case, NFC, with straight apostrophes.
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { nl } from './nl';
import { pt } from './pt';

export const STOPWORD_LANGUAGES = ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl'] as const;
export type StopwordLanguage = (typeof STOPWORD_LANGUAGES)[number];

const LISTS: Record<StopwordLanguage, readonly string[]> = { en, pt, es, fr, de, it, nl };
const cache = new Map<string, ReadonlySet<string>>();

/**
 * The stop words for a language ('pt-PT' and 'pt' both give Portuguese). Unknown languages
 * have none. Elided forms (French "l'", Italian "dell'") are listed with their apostrophe.
 */
export function stopwordsFor(language: string | null | undefined): ReadonlySet<string> {
  const code = (language ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  let set = cache.get(code);
  if (!set) {
    const list = (LISTS as Record<string, readonly string[] | undefined>)[code] ?? [];
    set = new Set(list.map((w) => w.normalize('NFC').toLowerCase()));
    cache.set(code, set);
  }
  return set;
}
