// The single-shot answer shared by exam Quick answers, hints, Ask, Explain and @AI (critique C17, openrouter-lab
// §11.8): passages that fit the budget get `S#` refs, the model answers with `[S#]` markers, and the answer is read
// back into stored citations, the chosen option and the general-knowledge ranges.
import type { Citation } from '../model/files';
import { MAX_PASSAGES, PASSAGE_BUDGET_CHARS, passagesThatFit } from './budget';
import { choiceOf, citationsFor, grounding, isInsufficient } from './citations';
import type { SourceBlock } from './prompts';
import { RefTable, type PassageLike } from './tools';

export interface Retrieval { refs: RefTable; sources: SourceBlock[]; chars: number; passages: PassageLike[] }

/** Fits the passages to the budget and numbers them S1…Sn (an existing ref table keeps its numbers). */
export function retrieve(passages: readonly PassageLike[], opts: { refs?: RefTable; budgetChars?: number; max?: number } = {}): Retrieval {
  const refs = opts.refs ?? new RefTable();
  const seen = new Set<string>();
  const unique = passages.filter((p) => !seen.has(p.id) && seen.add(p.id));
  const fit = passagesThatFit(unique, opts.budgetChars ?? PASSAGE_BUDGET_CHARS, opts.max ?? MAX_PASSAGES);
  const sources = fit.map((p) => ({ ref: refs.add(p), label: p.label, text: p.text }));
  return { refs, sources, chars: sources.reduce((n, s) => n + s.text.length, 0), passages: fit };
}

export interface ReadAnswer {
  text: string;
  citations: Citation[];
  choice?: string;
  generalKnowledge: Array<[number, number]>;
  unverified: string[];
  grounded: number;
  insufficient: boolean;
}

/** Reads a model's answer against the refs that were sent (hallucinated refs get no stored citation). */
export function readAnswer(content: string, refs: RefTable, allowGeneral: boolean): ReadAnswer {
  const text = content.trim().slice(0, 20_000);
  const citations = citationsFor(text, refs.table());
  const g = grounding(text, new Set(citations.map((c) => c.ref)), allowGeneral);
  const choice = choiceOf(text);
  return {
    text, citations, ...(choice ? { choice } : {}), generalKnowledge: g.general, unverified: g.unverified, grounded: g.grounded,
    insufficient: isInsufficient(text),
  };
}
