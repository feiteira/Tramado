// Localised directory names (folder spec §5.2): created on first use in the class creator's app
// language and recorded in meta `dirs`. Discovery never depends on them (§5.3).

export type DirKey = 'lectures' | 'documents' | 'exams' | 'notes' | 'fromChat';
export type ClassDirs = Record<DirKey, string>;
export type DirLang = 'en' | 'pt' | 'es';

/** Names used before G3 (PT/ES notes were `Notas`, PT chat files `Do chat`): still recognised where a class's meta
 *  carries no `dirs`. New classes get the names above. */
export const LEGACY_DIR_NAMES: Partial<Record<DirKey, string[]>> = { notes: ['Notas'], fromChat: ['Do chat'] };

export const DIR_NAMES: Record<DirLang, ClassDirs> = {
  en: { lectures: 'Lectures', documents: 'Documents', exams: 'Exams', notes: 'Notes', fromChat: 'From chat' },
  pt: { lectures: 'Aulas', documents: 'Documentos', exams: 'Exames', notes: 'Apontamentos', fromChat: 'Da conversa' },
  es: { lectures: 'Clases', documents: 'Documentos', exams: 'Exámenes', notes: 'Apuntes', fromChat: 'Del chat' },
};

/** The directory names for a language tag (`pt-PT` → pt); English for anything else. */
export function dirsFor(lang: string): ClassDirs {
  const primary = lang.toLowerCase().split('-')[0];
  return DIR_NAMES[(primary === 'pt' || primary === 'es' ? primary : 'en') as DirLang];
}
