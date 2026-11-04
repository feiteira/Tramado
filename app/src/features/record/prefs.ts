// The record dialog's remembered answers (prefs `record.<classId>`, architecture §13.3) and the spoken-language
// choices of the record and import dialogs.
import type { UiLocale } from '../../core/i18n/languages';
import type { ClassId } from '../../core/model/ids';
import type { ShareMode } from '../../platform/types';
import type { PrefsStore } from '../../services/prefs';

export type ShareChoice = 'both' | 'transcript' | 'none';
export interface RecordPrefs { mode: 'room' | 'online'; includeMic: boolean; share: ShareMode; language: string; device?: string }

export const shareKey = (s: ShareMode): ShareChoice => (s === 'audio+transcript' ? 'both' : s === 'transcript-only' ? 'transcript' : 'none');
export const shareMode = (c: ShareChoice): ShareMode => (c === 'both' ? 'audio+transcript' : c === 'transcript' ? 'transcript-only' : 'none');

export function readRecordPrefs(prefs: PrefsStore | null, classId: ClassId): RecordPrefs | null {
  const raw = prefs?.get(`record.${classId}`);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as RecordPrefs;
    return v && (v.mode === 'room' || v.mode === 'online') ? v : null;
  } catch {
    return null;
  }
}

/** Languages a lecture may be spoken in (whisper's strongest for the students Tramado serves), plus "detect". */
const SPOKEN = ['pt-PT', 'pt-BR', 'es-ES', 'en', 'fr', 'it', 'de', 'ca', 'gl'] as const;

export function LANGUAGE_OPTIONS(locale: UiLocale, autoLabel: string): Array<{ value: string; label: string }> {
  const tag = locale === 'en' ? 'en-GB' : locale === 'pt' ? 'pt-PT' : 'es-ES';
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([tag], { type: 'language', languageDisplay: 'standard' });
  } catch {
    names = null;
  }
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase(tag) + s.slice(1);
  return [...SPOKEN.map((l) => ({ value: l, label: cap(names?.of(l) ?? l) })), { value: 'auto', label: autoLabel }];
}
