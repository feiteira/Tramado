// System prompts per task and language (architecture §11.1 core/ai/prompts). The prompt language follows the
// question (or the UI language when `ai.answerLanguage` is `ui`); every answering prompt asks for `[S#]` citations.
import type { Msg } from '../types';
import { en } from './en';
import { es } from './es';
import { pt } from './pt';
import type { PromptLang, PromptPack } from './types';

export type { PromptLang, PromptPack };
export const PACKS: Record<PromptLang, PromptPack> = { en, pt, es };

/** BCP 47 → prompt language (`pt-PT`, `pt-BR` → pt; `es-ES` → es; anything else → en). */
export function promptLang(lang: string | null | undefined): PromptLang {
  const l = (lang ?? '').toLowerCase();
  if (l.startsWith('pt')) return 'pt';
  if (l.startsWith('es')) return 'es';
  return 'en';
}

const WORDS: Record<PromptLang, RegExp> = {
  pt: /\b(o|os|as|um|uma|não|são|está|também|pode|pelo|pela|que|com|para|qual|quais|é|da|do|dos|das|no|na|ao|em)\b/g,
  es: /\b(el|los|las|un|una|no|son|está|también|puede|por|que|con|para|cuál|cuáles|es|del|al|en|y|se)\b/g,
  en: /\b(the|a|an|is|are|not|can|what|which|of|to|in|and|does|do|how|why|with|for|on)\b/g,
};
const PT_ONLY = /[ãõ]|\b(não|são|também|está|uma|ç[ãõ])\b|ção\b|ções\b/;
const ES_ONLY = /[ñ¿¡]|\b(qué|cuál|también|está|una|el|los)\b|ción\b|ciones\b/;

/** A rough language guess for a short text (question language rule); null when it cannot tell. */
export function detectLang(text: string): PromptLang | null {
  const t = text.toLowerCase();
  const score = (l: PromptLang) => (t.match(WORDS[l]) ?? []).length;
  const s = { pt: score('pt') + (PT_ONLY.test(t) ? 3 : 0), es: score('es') + (ES_ONLY.test(t) ? 3 : 0), en: score('en') };
  const best = (Object.keys(s) as PromptLang[]).sort((a, b) => s[b] - s[a])[0]!;
  return s[best] >= 2 ? best : null;
}

export interface SourceBlock { ref: string; label: string; text: string }

/** "[S1] (label)\ntext" blocks, or the pack's "no sources" line. */
export function sourcesBlock(pack: PromptPack, sources: readonly SourceBlock[]): string {
  if (!sources.length) return pack.labels.noSources;
  return sources.map((s) => `[${s.ref}] (${s.label})\n${s.text}`).join('\n\n');
}

export interface AnswerSpec {
  lang: PromptLang;
  /** `question` = the language of the question; else always this language (prefs `ai.answerLanguage = ui`). */
  answerLanguage: 'question' | PromptLang;
  general: boolean;
  role: 'exam' | 'ask' | 'hint' | 'tools' | 'explain';
  kind?: string;                       // the question kind (multiple choice, true/false, case …)
  explain?: keyof PromptPack['explainRole'];
}

export function languageRule(pack: PromptPack, answerLanguage: AnswerSpec['answerLanguage']): string {
  return answerLanguage === 'question' ? pack.answerInQuestionLanguage : pack.answerIn(pack.languageNames[answerLanguage]);
}

export function answerSystem(spec: AnswerSpec): string {
  const p = PACKS[spec.lang];
  const parts = [p.role];
  if (spec.role === 'exam' || spec.role === 'tools') parts.push(p.examRole);
  else if (spec.role === 'ask') parts.push(p.askRole);
  else if (spec.role === 'hint') parts.push(p.hintRole);
  else if (spec.role === 'explain') parts.push(p.explainRole[spec.explain ?? 'simpler']);
  if (spec.role === 'tools') parts.push(p.toolsRole);
  parts.push(spec.general ? p.generalAllowed(p.marks.general) : p.onlySources);
  parts.push(p.citeRule);
  if (spec.role !== 'hint') parts.push(p.insufficientRule(p.marks.insufficient));
  if (spec.role !== 'hint' && (spec.kind === 'multiple_choice' || spec.kind === 'true_false')) parts.push(p.choiceRule(p.marks.choice));
  if (spec.role !== 'hint' && spec.kind === 'case') parts.push(p.caseRule(p.caseTemplate.map((h) => `"${h}"`).join(' → ')));
  parts.push(languageRule(p, spec.answerLanguage));
  parts.push(p.concise);
  return parts.join(' ');
}

export interface QuestionForPrompt {
  number: string; text: string; points: number | null;
  options: ReadonlyArray<{ key: string; text: string }>;
  group?: { choose: number; numbers: string[] } | null;
}

export function questionText(pack: PromptPack, q: QuestionForPrompt, rules: readonly string[] = [], unit?: string): string {
  const head = `${pack.labels.question} ${q.number}${q.points !== null ? ` (${q.points} ${unit ?? pack.labels.points})` : ''}:`;
  const lines = [`${head} ${q.text.trim()}`];
  if (q.group) lines.push(`(${pack.labels.group(q.group.choose, q.group.numbers.join(', '))})`);
  if (q.options.length) lines.push(`${pack.labels.options}:`, ...q.options.map((o) => `${o.key}) ${o.text}`));
  if (rules.length) lines.push(`${pack.labels.rules}: ${rules.join('; ')}`);
  return lines.join('\n');
}

/** The single-shot answer request: system prompt + the question with its numbered sources. */
export function answerMessages(spec: AnswerSpec, question: string, sources: readonly SourceBlock[]): Msg[] {
  const p = PACKS[spec.lang];
  return [
    { role: 'system', content: answerSystem(spec) },
    { role: 'user', content: `${question}\n\n${p.labels.sources}:\n${sourcesBlock(p, sources)}` },
  ];
}
