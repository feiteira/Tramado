// "Quick answer" (critique C17): one request expands the search words of every question (cross-language, JSON),
// local BM25 finds the passages per question, and one request answers each question with `[S#]` sources. A 10-question
// exam costs 11 requests instead of 40–80 for tool loops.
import type { Question } from '../model/files';
import type { QuestionId } from '../model/ids';
import { PACKS, type PromptLang } from '../ai/prompts';
import { tolerantParse } from '../ai/tolerantJson';
import type { Msg } from '../ai/types';

export interface QuickPlan {
  /** The questions that get an answer request, in display order (containers are not answered themselves). */
  order: Question[];
  /** 1 expansion + 1 per question (0 when there is nothing to answer). */
  requests: number;
}

export function quickPlan(questions: readonly Question[], only?: readonly QuestionId[]): QuickPlan {
  const want = only ? new Set(only) : null;
  const order = questions.filter((q) => q.kind !== 'container' && q.text.trim() && (!want || want.has(q.id)));
  return { order, requests: order.length ? order.length + 1 : 0 };
}

/** The expansion request: question ids and texts, JSON back. */
export function expansionMessages(lang: PromptLang, questions: readonly Question[], materialsLang: string | null): Msg[] {
  const p = PACKS[lang];
  const list = questions.map((q) => `${q.id}: ${q.text.replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n');
  const where = materialsLang ? ` The materials are mostly in ${materialsLang}.` : '';
  return [
    { role: 'system', content: `${p.expandRole}${where}` },
    { role: 'user', content: list },
  ];
}

/** Keywords per question from the model's JSON ({"queries": {qid: [...]}}), tolerant; unknown ids are dropped. */
export function parseExpansion(text: string, ids: readonly QuestionId[]): Record<QuestionId, string[]> {
  const raw = tolerantParse(text) as { queries?: unknown } | null;
  const q = (raw && typeof raw === 'object' && 'queries' in raw ? raw.queries : raw) as Record<string, unknown> | null;
  const out: Record<QuestionId, string[]> = {};
  if (!q || typeof q !== 'object' || Array.isArray(q)) return out;
  for (const id of ids) {
    const v = q[id];
    const words = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : [];
    const clean = words.filter((w): w is string => typeof w === 'string').map((w) => w.trim()).filter((w) => w && w.length <= 80).slice(0, 8);
    if (clean.length) out[id] = clean;
  }
  return out;
}

/** The search query of a question: its text plus the expansion keywords. */
export function queryFor(q: Question, keywords: readonly string[] = []): string {
  const opts = q.options.map((o) => o.text).join(' ');
  return [q.text, opts, ...keywords].join(' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
}
