// `[S#]` citations (folder spec §8.15, critique C18, UX §4.1): parsing with lists and pin-points, chip numbering by
// first appearance, hallucinated refs, and the measures of an answer (grounded share, unverified sentences, the
// "materials don't cover this" signal, the chosen option).
import type { Citation } from '../model/files';

/** The marker regex of folder spec §8.15: group 1 the refs, group 2 the pin-point. */
export const CITE_SOURCE = String.raw`\[(S\d+(?:\s*,\s*S\d+)*)(?:\s*,\s*([^\]]{1,40}))?\]`;
export const citeRegex = (): RegExp => new RegExp(CITE_SOURCE, 'g');

export interface Marker { start: number; end: number; refs: string[]; pin: string | null }
export interface Chip { n: number; ref: string; pin: string | null; hallucinated: boolean }
export interface ParsedCitations {
  markers: Marker[];
  /** One chip per distinct ref, numbered 1..k by first appearance. */
  chips: Chip[];
  hallucinated: string[];
}

export function findMarkers(text: string): Marker[] {
  const out: Marker[] = [];
  for (const m of text.matchAll(citeRegex())) {
    const refs = m[1]!.split(/\s*,\s*/).map((r) => r.trim());
    const pin = m[2]?.trim() || null;
    out.push({ start: m.index!, end: m.index! + m[0].length, refs, pin });
  }
  return out;
}

/** Chips in order of first appearance; the pin of a marker belongs to its last ref (UX §4.1). */
export function parseCitations(text: string, valid: ReadonlySet<string>): ParsedCitations {
  const markers = findMarkers(text);
  const chips: Chip[] = [];
  const seen = new Map<string, Chip>();
  for (const m of markers) {
    m.refs.forEach((ref, i) => {
      const pin = i === m.refs.length - 1 ? m.pin : null;
      const hit = seen.get(ref);
      if (hit) {
        if (!hit.pin && pin) hit.pin = pin;
        return;
      }
      const chip: Chip = { n: chips.length + 1, ref, pin, hallucinated: !valid.has(ref) };
      seen.set(ref, chip);
      chips.push(chip);
    });
  }
  return { markers, chips, hallucinated: chips.filter((c) => c.hallucinated).map((c) => c.ref) };
}

/**
 * The stored citations of an answer: one per valid ref that the text uses, in order of first appearance, with the
 * pin-point of its first marker. Refs without an entry stay hallucinated (no citation is stored for them).
 */
export function citationsFor(text: string, table: ReadonlyMap<string, Omit<Citation, 'ref' | 'pin'>>): Citation[] {
  const { chips } = parseCitations(text, new Set(table.keys()));
  return chips.flatMap((c) => {
    const base = table.get(c.ref);
    if (!base) return [];
    return [{ ref: c.ref, ...base, ...(c.pin ? { pin: c.pin } : {}) }];
  });
}

export interface Span { start: number; end: number; text: string }

/** Sentences (and list items / lines) of a Markdown answer, with their UTF-16 ranges. Headings are skipped. */
export function sentences(text: string): Span[] {
  // Mask what must not end a sentence (same length, so ranges map back): citation markers and abbreviations.
  const masked = text
    .replace(citeRegex(), (m) => `[${'x'.repeat(m.length - 2)}]`)
    .replace(/\b(?:arts?|n|al|cf|p|pp|vs|e\.g|i\.e|etc|Prof|Prof\.ª|Dr|Dra|Sr|Sra|ex|nr|núm|apdo|aprox)\.(?=\s)/gi, (m) => `${m.slice(0, -1)}\u0001`);
  const out: Span[] = [];
  const re = /[^\n.!?…]+(?:[.!?…]+(?=\s|$)|$|(?=\n))(?:\s*\[x+\])*/g;
  for (const m of masked.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const len = raw.trim().length;
    const start = m.index! + lead;
    const s = text.slice(start, start + len);
    if (!s || /^#{1,6}\s/.test(s) || /^[-*•\d.)\s]+$/.test(s)) continue;
    if (s.replace(citeRegex(), '').replace(/[\s\-*•:]/g, '').length < 3) {
      // A dangling marker after the sentence end: attach it to the previous sentence.
      const prev = out.at(-1);
      if (prev && citeRegex().test(s)) {
        prev.end = start + len;
        prev.text = text.slice(prev.start, prev.end);
      }
      continue;
    }
    out.push({ start, end: start + len, text: s });
  }
  return out;
}

const INSUFFICIENT = [
  /\b(?:the )?materials? (?:do(?:es)? not|don't|doesn't) (?:cover|contain|answer|say)/i,
  /\bthe sources (?:do not|don't) (?:cover|contain|answer)/i,
  /\bos materiais (?:não|nao) (?:cobrem|contêm|contem|respondem|referem)/i,
  /\bas fontes (?:não|nao) (?:cobrem|contêm|respondem|referem)/i,
  /\blos materiales no (?:cubren|contienen|responden)/i,
  /\blas fuentes no (?:cubren|contienen|responden)/i,
];
const GENERAL = /^(?:\*\*)?(?:General knowledge|Conhecimento geral|Conocimiento general)(?:\*\*)?\s*:/im;

/** The model said the sources don't answer the question (the instructed sentence, in any prompt language). */
export const isInsufficient = (text: string): boolean => INSUFFICIENT.some((re) => re.test(text));

/** Where the "General knowledge:" paragraph starts, or -1. */
export function generalStart(text: string): number {
  const m = GENERAL.exec(text);
  return m ? m.index : -1;
}

export interface Grounding {
  /** Sentences with at least one valid citation / all sentences (0..1; 1 for an empty answer). */
  grounded: number;
  /** UTF-16 ranges not supported by any source: the general-knowledge paragraph and uncited sentences. */
  general: Array<[number, number]>;
  /** The text of those uncited sentences (UX `AiAnswerView.unverified`). */
  unverified: string[];
}

/**
 * Measures how grounded an answer is. With `allowGeneral`, uncited sentences (and the "General knowledge:"
 * paragraph) are the unverified parts; without it only the grounded share is computed and nothing is marked.
 */
export function grounding(text: string, valid: ReadonlySet<string>, allowGeneral: boolean): Grounding {
  const ss = sentences(text);
  if (!ss.length) return { grounded: 1, general: [], unverified: [] };
  const cited = (s: Span) => findMarkers(s.text).some((m) => m.refs.some((r) => valid.has(r)));
  const choice = /^\**\s*(?:Answer|Resposta|Respuesta)\s*\**\s*:/i;
  const counted = ss.filter((s) => !choice.test(s.text) && !isInsufficient(s.text));
  const ok = counted.filter(cited).length;
  const grounded = counted.length ? ok / counted.length : 1;
  if (!allowGeneral) return { grounded, general: [], unverified: [] };
  const g = generalStart(text);
  const general: Array<[number, number]> = [];
  const unverified: string[] = [];
  if (g >= 0) general.push([g, text.length]);
  for (const s of counted) {
    if (cited(s)) continue;
    unverified.push(s.text);
    if (g < 0 || s.start < g) general.push([s.start, s.end]);
  }
  general.sort((a, b) => a[0] - b[0]);
  return { grounded, general, unverified };
}

/** The chosen option of a multiple-choice / true-false answer ("Answer: B", "Resposta: Verdadeiro"). */
export function choiceOf(text: string): string | undefined {
  const m = /^\**\s*(?:Answer|Resposta|Respuesta)\s*\**\s*:\s*\**\s*(Verdadeiro|Falso|Verdadero|True|False|[A-Za-z])\b/im.exec(text);
  if (!m) return undefined;
  const v = m[1]!;
  return v.length === 1 ? v.toUpperCase() : v[0]!.toUpperCase() + v.slice(1).toLowerCase();
}

/** Plain-text copy of an answer (UX §4.2): chips become `[n]` plus a footnote list `[n] title, where`. */
export function plainWithFootnotes(text: string, chips: readonly Chip[], label: (ref: string) => string): string {
  const num = new Map(chips.map((c) => [c.ref, c.n]));
  const body = text.replace(citeRegex(), (_m, refs: string, pin?: string) => {
    const ns = refs.split(/\s*,\s*/).map((r) => num.get(r.trim()) ?? '?');
    return `[${ns.join(', ')}${pin ? `, ${pin.trim()}` : ''}]`;
  });
  const notes = chips.filter((c) => !c.hallucinated).map((c) => `[${c.n}] ${label(c.ref)}`);
  return notes.length ? `${body.trim()}\n\n${notes.join('\n')}` : body.trim();
}
