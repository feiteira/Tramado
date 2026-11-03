import { en, type Messages } from './locales/en';
import { es } from './locales/es';
import { pt } from './locales/pt';
import type { UiLocale } from './languages';

export const catalogs: Record<UiLocale, Messages> = { en, pt, es };
export type { Messages };
