// Exam radar (product-ux §9.3): moments where the lecturer says something like "isto costuma sair no
// exame". Run on accent-folded, lower-case paragraph text, with the phrases of the transcript's language
// only. Each hit becomes an automatic 🎯 marker at the start of the segment where the phrase begins
// (`LectureDetail.autoMarkers`, removable).
import type { Lang, SegmentId } from '../model/ids';
import type { TranscriptFile } from '../model/files';
import { fileLang } from './labels';
import { paragraphs } from './render';
import { langMatches } from '../model/ids';

export const RADAR: Readonly<Record<'pt' | 'es' | 'en', RegExp>> = {
  pt: /\b(?:isto|isso|esta materia|este tema|esta parte|esta pergunta)\s+(?:\S+\s+){0,2}(?:sai|vai sair|costuma sair|pode sair|entra|vai entrar|e para)\s+(?:\S+\s+){0,3}(?:exame|teste|frequencia)\b|\b(?:importante|fundamental)\s+para\s+o\s+(?:exame|teste)\b|\bpergunta\s+de\s+exame\b|\btomem\s+nota\b/gu,
  es: /\b(?:esto|esta parte|este tema|esta pregunta)\s+(?:\S+\s+){0,2}(?:entra|va a entrar|cae|suele caer|puede caer|sale|va a salir)\s+(?:\S+\s+){0,3}(?:examen|parcial|final)\b|\bpregunta\s+de\s+examen\b|\bapuntad(?:lo)?\s+esto\b|\bimportante\s+para\s+el\s+examen\b/gu,
  en: /\b(?:this|that|it)\s+(?:will|is going to|might|could|may|is likely to)\s+(?:be|come up|appear|show up)\s+(?:on|in)\s+the\s+(?:exam|test|final|midterm)\b|\bexam\s+question\b|\bwrite\s+this\s+down\b|\bmake\s+sure\s+you\s+know\b/gu,
};

/** product-ux §9.3 `fold`: NFD, marks removed, lower case. */
export const radarFold = (s: string): string => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

/** The radar language of a transcript, or null when none of the three applies. */
export function radarLang(lang: Lang | 'auto' | null | undefined): 'pt' | 'es' | 'en' | null {
  if (!lang || lang === 'auto') return null;
  const l = fileLang(lang);
  return l === 'en' && !langMatches(lang, 'en') ? null : l;
}

/** The segments where an exam-radar phrase starts, with the segment's start time (one per segment). */
export function examRadar(t: Pick<TranscriptFile, 'segments'>, lang: Lang | 'auto'): Array<{ segmentId: SegmentId; atMs: number }> {
  const l = radarLang(lang);
  if (!l) return [];
  const re = new RegExp(RADAR[l].source, 'gu');
  const out: Array<{ segmentId: SegmentId; atMs: number }> = [];
  const seen = new Set<SegmentId>();
  for (const p of paragraphs(t)) {
    let text = '';
    const starts: number[] = [];
    for (const s of p.segments) {
      if (text) text += ' ';
      starts.push(text.length);
      text += radarFold(s.text);
    }
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      let k = 0;
      while (k + 1 < starts.length && starts[k + 1]! <= m.index) k++;
      const seg = p.segments[k]!;
      if (!seen.has(seg.id)) {
        seen.add(seg.id);
        out.push({ segmentId: seg.id, atMs: seg.startMs });
      }
    }
  }
  return out;
}
