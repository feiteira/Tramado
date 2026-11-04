// Legal references in a transcript (product-ux §9.3): "artigo 483.º do CC", "art. 1902 CC", "Article 8
// ECHR". Only the regex of the transcript's language runs ("art. 24" matches in all three). Offsets are
// UTF-16 positions in the segment text; the lecture view links them to the class's law texts.
import type { Lang, SegmentId } from '../model/ids';
import type { TranscriptFile } from '../model/files';
import { radarLang } from './radar';

// product-ux §9.3, with the leading word also capitalised (a sentence may start with "Artigo").
export const PT_ARTICLE = /\b[Aa]rt(?:igo)?s?\.?\s*(\d{1,4})(?:\.?\s*[º°o])?(?:-([A-Z]))?(?:\s*(?:a|e|-)\s*(\d{1,4})(?:\.?\s*[º°o])?)?(?:\s*,?\s*n\.?\s*[º°o]\.?\s*(\d{1,3}))?(?:\s*,?\s*al(?:[íi]nea)?\.?\s*([a-z])\))?(?:\s+(?:do|da)\s+(CC|CP|CPC|CPP|CRP|CT|CSC|CPA|CPTA|CIRE|RGPD|C[óo]digo\s+(?:Civil|Penal|do\s+Trabalho|de\s+Processo\s+(?:Civil|Penal)|das\s+Sociedades\s+Comerciais)|Constitui[çc][ãa]o))?/gu;
export const ES_ARTICLE = /\b[Aa]rt(?:[íi]culo)?s?\.?\s*(\d{1,4})(?:\.(\d{1,3}))?(?:\s*(bis|ter|quater))?(?:\s+(?:(?:del?|de\s+la)\s+)?(CC|CE|CP|LEC|LECrim|ET|LOPDGDD|C[óo]digo\s+(?:Civil|Penal)|Constituci[óo]n(?:\s+Espa[ñn]ola)?))?/gu;
export const EN_ARTICLE = /\b(?:[Ss](?:ection)?\.?|[Aa]rt(?:icle)?\.?)\s*(\d{1,4}[A-Z]?)(?:\((\d{1,3})\))?(?:\s+(?:of\s+the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+Act(?:\s+\d{4})?|ECHR|TFEU|TEU|GDPR))?/gu;

export interface LegalRef { segmentId: SegmentId; start: number; end: number; article: string; code: string | null }

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ');

const PT_CODES: Record<string, string> = {
  'codigo civil': 'CC', 'codigo penal': 'CP', 'codigo do trabalho': 'CT', 'codigo de processo civil': 'CPC',
  'codigo de processo penal': 'CPP', 'codigo das sociedades comerciais': 'CSC', constituicao: 'CRP',
};
const ES_CODES: Record<string, string> = {
  'codigo civil': 'CC', 'codigo penal': 'CP', constitucion: 'CE', 'constitucion espanola': 'CE',
};

/** The abbreviation of a code as said ("Código Civil" → "CC"); abbreviations stay as they are. */
export function normalizeCode(code: string | undefined, lang: 'pt' | 'es' | 'en'): string | null {
  if (!code) return null;
  const table = lang === 'pt' ? PT_CODES : lang === 'es' ? ES_CODES : {};
  return table[fold(code)] ?? code.replace(/\s+/g, ' ');
}

/** "483.º", "483.º-A" (PT); "1902", "10 bis" (ES); "8", "3" (EN). */
function articleOf(m: RegExpMatchArray, lang: 'pt' | 'es' | 'en'): string {
  if (lang === 'pt') return `${Number(m[1])}.º${m[2] ? `-${m[2]}` : ''}`;
  if (lang === 'es') return `${Number(m[1])}${m[3] ? ` ${m[3]}` : ''}`;
  return m[1]!;
}

const REGEX = { pt: PT_ARTICLE, es: ES_ARTICLE, en: EN_ARTICLE } as const;

/** Every article mention in the transcript's segments, in segment order. */
export function legalRefs(t: Pick<TranscriptFile, 'segments'>, lang: Lang | 'auto'): LegalRef[] {
  const l = radarLang(lang);
  if (!l) return [];
  const re = new RegExp(REGEX[l].source, 'gu');
  const codeGroup = l === 'pt' ? 6 : l === 'es' ? 4 : 3;
  const out: LegalRef[] = [];
  for (const s of [...t.segments].sort((a, b) => a.startMs - b.startMs)) {
    for (const m of s.text.matchAll(re)) {
      const raw = m[0].replace(/[\s,]+$/u, '');
      if (!raw) continue;
      out.push({ segmentId: s.id, start: m.index, end: m.index + raw.length, article: articleOf(m, l), code: normalizeCode(m[codeGroup], l) });
    }
  }
  return out;
}
