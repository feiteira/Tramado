// Human labels of citations (architecture §11.1 `labels.ts`, folder spec §8.15 `Citation.label`):
// the label is stored with the citation at creation time, in the language of the answer, e.g.
// "Código Civil.pdf · art. 251.º (p. 52)", "Aula 6 · 41:12", "Slides.pptx · diapositivo 3".
// It is data, not UI text: the screens build their own chips from the locator (UX §4.3).
import type { Locator, SourceRef } from '../model/files';

type L = 'en' | 'pt' | 'es';
const WORDS: Record<L, { p: string; pp: string; art: string; slide: string; section: string; question: string }> = {
  en: { p: 'p.', pp: 'pp.', art: 'art.', slide: 'slide', section: '§', question: 'question' },
  pt: { p: 'p.', pp: 'pp.', art: 'art.', slide: 'diapositivo', section: '§', question: 'pergunta' },
  es: { p: 'p.', pp: 'pp.', art: 'art.', slide: 'diapositiva', section: '§', question: 'pregunta' },
};

/** 'pt-PT' → 'pt'; anything unknown → 'en' (the folder spec's language matching, §2). */
export function labelLang(lang: string | null | undefined): L {
  const p = (lang ?? '').toLowerCase().split('-')[0];
  return p === 'pt' || p === 'es' ? p : 'en';
}

/** "m:ss" under an hour, "h:mm:ss" from an hour on. */
export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The label of a locator alone: "p. 9", "p. ix", "art. 18.º (p. 9)", "art. 2.º (pp. 1–2)", "slide 3", "41:12", "§ Introdução". */
export function locatorLabel(loc: Locator, lang: string | null | undefined): string {
  const w = WORDS[labelLang(lang)];
  switch (loc.type) {
    case 'page': return `${w.p} ${loc.pageLabel ?? loc.page}`;
    case 'article': {
      const art = `${w.art} ${loc.article}`;
      if (!loc.pages) return art;
      const [a, b] = loc.pages;
      return a === b ? `${art} (${w.p} ${a})` : `${art} (${w.pp} ${a}–${b})`;
    }
    case 'slide': return `${w.slide} ${loc.slide}`;
    case 'segment': return clockLabel(loc.startMs);
    case 'heading': return loc.path.length ? `${w.section} ${loc.path[loc.path.length - 1]}` : '';
    case 'text':
    case 'whole':
      return '';
  }
}

/** The file name of a class path ("Documentos/Lei.pdf" → "Lei.pdf"). */
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * The stored label of a citation: the source's title (a document's file name when no title is
 * given; lectures and exams need the caller's title) and the locator label, joined by " · ".
 */
export function citationLabel(source: SourceRef, locator: Locator, lang: string | null | undefined, title?: string): string {
  const name = title ?? (source.kind === 'document' || source.kind === 'note' ? fileName(source.path) : '');
  const where = locatorLabel(locator, lang);
  return [name, where].filter(Boolean).join(' · ');
}
