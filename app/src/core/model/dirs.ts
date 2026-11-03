// Localised directory names (folder spec §5.2): created on first use in the class creator's app
// language and recorded in meta `dirs`. Discovery never depends on them (§5.3).

export type DirKey = 'lectures' | 'documents' | 'exams' | 'notes' | 'fromChat';
export type ClassDirs = Record<DirKey, string>;
export type DirLang = 'en' | 'pt' | 'es';

export const DIR_NAMES: Record<DirLang, ClassDirs> = {
  en: { lectures: 'Lectures', documents: 'Documents', exams: 'Exams', notes: 'Notes', fromChat: 'From chat' },
  pt: { lectures: 'Aulas', documents: 'Documentos', exams: 'Exames', notes: 'Notas', fromChat: 'Do chat' },
  es: { lectures: 'Clases', documents: 'Documentos', exams: 'Exámenes', notes: 'Notas', fromChat: 'Del chat' },
};

/** The directory names for a language tag (`pt-PT` → pt); English for anything else. */
export function dirsFor(lang: string): ClassDirs {
  const primary = lang.toLowerCase().split('-')[0];
  return DIR_NAMES[(primary === 'pt' || primary === 'es' ? primary : 'en') as DirLang];
}
