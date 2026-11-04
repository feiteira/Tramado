// Class form helpers (UX §3.3.1) without a DOM: the language list, the default language for the UI, the
// "already have a class called" check, and the meta patch of the settings dialog (per-field LWW: only changes).
import type { UiLocale } from '../../core/i18n/languages';
import type { ClassIconName } from '../../ui/classIcons';

/** UX §3.3.1 language options, native names (never translated), then "Detect automatically". */
export const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'es-ES', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
];

export const languageForUi = (l: UiLocale): string => (l === 'pt' ? 'pt-PT' : l === 'es' ? 'es-ES' : 'en');

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

/** Whether another class (not `except`) already has this name (accents, case and spacing ignored). */
export function nameTaken(name: string, classes: ReadonlyArray<{ id: string; name: string }>, except?: string): boolean {
  const n = fold(name);
  return !!n && classes.some((c) => c.id !== except && fold(c.name) === n);
}

export interface ClassForm {
  name: string; shortName: string; colour: string; icon: ClassIconName; lecturer: string; term: string; language: string; vocabulary: string; askBeforeJoin: boolean;
}

/** The meta fields that changed (folder spec §8.2 per-field LWW: unchanged fields are not rewritten). */
export function metaPatch(before: ClassForm, after: ClassForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const text = (s: string) => s.replace(/\s+/g, ' ').trim();
  const opt = (s: string) => (text(s) ? text(s) : null);
  if (text(after.name) !== text(before.name)) patch.name = text(after.name).slice(0, 120);
  if (text(after.shortName) !== text(before.shortName)) patch.shortName = text(after.shortName).slice(0, 12);
  if (after.colour !== before.colour) patch.colour = after.colour;
  if (after.icon !== before.icon) patch.icon = after.icon;
  if (opt(after.lecturer) !== opt(before.lecturer)) patch.lecturer = opt(after.lecturer)?.slice(0, 80) ?? null;
  if (opt(after.term) !== opt(before.term)) patch.term = opt(after.term)?.slice(0, 40) ?? null;
  if (after.language !== before.language) patch.language = after.language;
  if (after.vocabulary.trim() !== before.vocabulary.trim()) patch.vocabulary = after.vocabulary.trim() ? after.vocabulary.trim().slice(0, 500) : null;
  if (after.askBeforeJoin !== before.askBeforeJoin) patch.askBeforeAdmit = after.askBeforeJoin;
  return patch;
}
