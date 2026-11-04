// Token budgeting for passages and history (openrouter-lab §11.8): 3.5 characters per token (conservative across
// PT/ES/EN and the Gemma tokenizer), at most 12k tokens of retrieved material per request.
import type { Msg } from './types';

export const CHARS_PER_TOKEN = 3.5;
export const PASSAGE_BUDGET_TOKENS = 12_000;
export const PASSAGE_BUDGET_CHARS = Math.floor(PASSAGE_BUDGET_TOKENS * CHARS_PER_TOKEN);
export const MAX_PASSAGE_CHARS = 2_500;
export const MAX_PASSAGES = 12;
export const HISTORY_ELIDE_TOKENS = 24_000;

export const tokensOf = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')} …` : s);

/** The passages that fit the budget, in order, each cut to MAX_PASSAGE_CHARS (whitespace collapsed). */
export function passagesThatFit<T extends { text: string }>(passages: readonly T[], budgetChars = PASSAGE_BUDGET_CHARS, max = MAX_PASSAGES): Array<T & { text: string }> {
  const out: Array<T & { text: string }> = [];
  let total = 0;
  for (const p of passages) {
    if (out.length >= max) break;
    const text = clip(p.text.replace(/\s+/g, ' ').trim(), MAX_PASSAGE_CHARS);
    if (!text) continue;
    if (total + text.length > budgetChars && out.length) break;
    total += text.length;
    out.push({ ...p, text });
  }
  return out;
}

const textOf = (m: Msg): string => {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
  return '';
};
export const messagesChars = (msgs: readonly Msg[]): number => msgs.reduce((n, m) => n + textOf(m).length, 0);

/** "Stuff the whole document" is allowed when `chars / 3.5 + max_tokens < 0.8 × context` (openrouter-lab §11.8). */
export const fitsWhole = (chars: number, maxTokens: number, context: number): boolean => tokensOf(chars) + maxTokens < 0.8 * context;

/**
 * The AI_TOO_LONG retry (openrouter-lab §11.5 rule 5): old tool results become a stub, and every long user or tool
 * message is cut to 60 %. The system prompt and the last user message's question part are kept.
 */
export function shrinkMessages(msgs: readonly Msg[]): Msg[] {
  const lastTool = msgs.map((m) => m.role).lastIndexOf('tool');
  return msgs.map((m, i): Msg => {
    if (m.role === 'tool') {
      if (i < lastTool) return { ...m, content: '[result elided to save space; its refs are still valid]' };
      return { ...m, content: clip(m.content, Math.floor(m.content.length * 0.6)) };
    }
    if (m.role === 'user' && typeof m.content === 'string' && m.content.length > 2_000) {
      return { ...m, content: clip(m.content, Math.floor(m.content.length * 0.6)) };
    }
    return m;
  });
}

/** History elision of the tool loop: tool results before the last turn become stubs once prompts exceed 24k tokens. */
export function elideOldToolResults(msgs: Msg[]): Msg[] {
  const lastAssistant = msgs.map((m) => m.role).lastIndexOf('assistant');
  return msgs.map((m, i) => (m.role === 'tool' && i < lastAssistant ? { ...m, content: '[result elided; its refs are still valid]' } : m));
}
