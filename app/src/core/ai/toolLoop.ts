// "Deep answer" (openrouter-lab §4 and §11.7, critique C16/C17): a tool loop of at most 8 model turns and 16 tool
// calls (≤ 6 per turn, run concurrently), with duplicate searches answered from cache, the model pinned after the
// first turn, history elision past 24k prompt tokens, and a final turn with `tool_choice: "none"` plus a nudge.
import { PlatformError } from '../errors';
import { fold } from '../search/text';
import { HISTORY_ELIDE_TOKENS, elideOldToolResults } from './budget';
import type { AiClient, RunResult } from './client';
import { PACKS, type PromptLang } from './prompts';
import { RefTable, TOOLS, type PassageLike } from './tools';
import type { ActivityTag, AiEvent, Msg, Priority, ToolCall, Usage } from './types';

export const MAX_TURNS = 8;
export const MAX_TOOL_CALLS = 16;
export const MAX_CALLS_PER_TURN = 6;
const SNIPPET = 300;
const READ_MAX = 3000;

export interface ToolHost {
  search(query: string, limit: number): Promise<PassageLike[]>;
  read(id: string, offset: number, max: number): Promise<(PassageLike & { hasMore: boolean }) | null>;
}
export interface ToolLoopOptions {
  client: AiClient;
  messages: Msg[];                       // system + the question
  host: ToolHost;
  refs?: RefTable;
  lang: PromptLang;
  activity: ActivityTag;
  priority?: Priority;
  signal?: AbortSignal;
  onEvent?: (e: AiEvent) => void;
  busyFallback?: boolean;
  maxTurns?: number;
  maxCalls?: number;
}
export interface ToolLoopResult {
  content: string; model: string; requestedModel: string; chain: string[]; privacy: RunResult['privacy'];
  usage: Usage; turns: number; calls: number; refs: RefTable; searches: string[];
}

const norm = (q: string) => fold(q).replace(/\s+/g, ' ').trim();

const stripReasoning = (msgs: Msg[]): Msg[] =>
  msgs.map((m) => {
    if (m.role !== 'assistant') return m;
    const { reasoning: _r, reasoning_details: _d, ...rest } = m;
    void _r;
    void _d;
    return rest;
  });

export async function runToolLoop(o: ToolLoopOptions): Promise<ToolLoopResult> {
  const refs = o.refs ?? new RefTable();
  const maxTurns = o.maxTurns ?? MAX_TURNS;
  const maxCalls = o.maxCalls ?? MAX_TOOL_CALLS;
  const cache = new Map<string, string[]>();
  const searches: string[] = [];
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let msgs = [...o.messages];
  let pinned: string | undefined;
  let calls = 0;
  let first: RunResult | null = null;

  async function exec(tc: ToolCall): Promise<unknown> {
    let args: Record<string, unknown>;
    try {
      args = tc.function.arguments.trim() ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
    } catch {
      return { error: 'invalid arguments: send JSON' };
    }
    if (tc.function.name === 'search_materials') {
      const query = typeof args.query === 'string' ? args.query : '';
      if (!query.trim()) return { error: 'query is required' };
      const limit = Math.min(6, Math.max(1, Number.isFinite(Number(args.limit)) ? Math.trunc(Number(args.limit)) : 4));
      const key = norm(query);
      const known = cache.get(key);
      if (known) return { note: 'already searched; these are the same results', results: known.map((ref) => brief(ref)) };
      searches.push(query);
      const hits = await o.host.search(query, limit);
      const out = hits.slice(0, limit).map((p) => refs.add(p));
      cache.set(key, out);
      return { results: out.map((ref) => brief(ref)) };
    }
    if (tc.function.name === 'read_passage') {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      const known = refs.get(id);
      const pid = known?.id ?? id;
      const offset = Math.max(0, Number(args.offset) || 0);
      const p = await o.host.read(pid, offset, READ_MAX);
      if (!p) return { error: `unknown id ${id}; use an id or ref returned by search_materials` };
      const ref = refs.add(p);
      return { ref, id: p.id, source: p.label, text: p.text.slice(0, READ_MAX), has_more: p.hasMore, ...(p.hasMore ? { next_offset: offset + READ_MAX } : {}) };
    }
    return { error: `unknown tool ${tc.function.name}` };
  }

  function brief(ref: string) {
    const p = refs.get(ref)!;
    const t = p.text.replace(/\s+/g, ' ').trim();
    return { ref, id: p.id, source: p.label, snippet: t.length > SNIPPET ? `${t.slice(0, SNIPPET)} …` : t };
  }

  for (let turn = 0; turn < maxTurns; turn++) {
    const last = turn === maxTurns - 1 || calls >= maxCalls;
    if (last) msgs.push({ role: 'user', content: PACKS[o.lang].nudge });
    const r = await o.client.run({
      task: 'exam-answer', messages: msgs, tools: TOOLS, toolChoice: last ? 'none' : 'auto', activity: { ...o.activity, passages: refs.size },
      ...(pinned ? { pinned } : {}), ...(o.priority ? { priority: o.priority } : {}), ...(o.signal ? { signal: o.signal } : {}),
      ...(o.onEvent ? { onEvent: o.onEvent } : {}), ...(o.busyFallback ? { busyFallback: true } : {}),
    });
    first ??= r;
    usage.prompt_tokens! += r.usage?.prompt_tokens ?? 0;
    usage.completion_tokens! += r.usage?.completion_tokens ?? 0;
    usage.total_tokens! += r.usage?.total_tokens ?? 0;
    if (pinned && r.model !== pinned) msgs = stripReasoning(msgs);   // the model changed under us
    if (r.model && !r.model.startsWith('private/')) pinned = r.model;
    const toolCalls = last ? [] : r.toolCalls;
    msgs.push({
      role: 'assistant', content: r.content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function' as const, function: t.function })) } : {}),
      ...(r.reasoning ? { reasoning: r.reasoning } : {}), ...(r.reasoningDetails.length ? { reasoning_details: r.reasoningDetails } : {}),
    });
    if (!toolCalls.length) {
      if (!r.content.trim()) throw new PlatformError('AI_UPSTREAM', 'the model ended the search without an answer');
      return { content: r.content, model: r.model, requestedModel: first.requestedModel, chain: first.chain, privacy: r.privacy, usage, turns: turn + 1, calls, refs, searches };
    }
    const now = toolCalls.slice(0, MAX_CALLS_PER_TURN);
    const results = await Promise.all(now.map((tc) => exec(tc).catch((e: unknown) => ({ error: String((e as Error)?.message ?? e).slice(0, 200) }))));
    toolCalls.forEach((tc, i) => {
      const res = i < now.length ? results[i] : { error: `skipped: at most ${MAX_CALLS_PER_TURN} calls per turn` };
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res) });
    });
    calls += toolCalls.length;
    if ((r.usage?.prompt_tokens ?? 0) > HISTORY_ELIDE_TOKENS) msgs = elideOldToolResults(msgs);
  }
  throw new PlatformError('AI_LENGTH', 'the search did not converge');
}
