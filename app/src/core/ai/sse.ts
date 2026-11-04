// The line-based SSE parser of openrouter-lab §11.6. Rust forwards one `line` wire event per SSE line (blank lines
// dropped), so the parser takes lines, never bytes: `push(line)` returns the events that line produced, `end()`
// finishes a stream that closed with or without `data: [DONE]`. It never throws on a bad line.
import type { AiEvent, ToolCall, Usage } from './types';

export interface SseResult {
  model: string; provider: string | null; generationId: string | null;
  content: string; reasoning: string; reasoningDetails: unknown[];
  toolCalls: ToolCall[]; finish: string | null; usage: Usage | null;
  error: { code: string | number | null; message: string } | null;
  done: boolean;          // `[DONE]` seen or end() called
  sawDone: boolean;       // `[DONE]` seen
  heartbeats: number;
}

export interface SseParser {
  push(line: string): AiEvent[];
  end(): AiEvent[];
  result(): SseResult;
}

interface Chunk {
  id?: string; model?: string; provider?: string; debug?: unknown; usage?: Usage;
  error?: { code?: string | number; message?: string };
  choices?: Array<{
    delta?: { content?: string | null; reasoning?: string | null; reasoning_details?: unknown[]; tool_calls?: Array<Partial<ToolCall> & { index?: number; function?: { name?: string; arguments?: string } }> };
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

export function createSseParser(): SseParser {
  const r: SseResult = {
    model: '', provider: null, generationId: null, content: '', reasoning: '', reasoningDetails: [], toolCalls: [],
    finish: null, usage: null, error: null, done: false, sawDone: false, heartbeats: 0,
  };
  const calls: ToolCall[] = [];
  let started = false;

  function finish(): AiEvent[] {
    if (r.done) return [];
    r.done = true;
    r.toolCalls = calls.filter(Boolean);
    const out: AiEvent[] = [];
    if (r.toolCalls.length) out.push({ kind: 'tool_calls', calls: r.toolCalls });
    out.push({ kind: 'done', finish: r.finish ?? 'unknown', ...(r.usage ? { usage: r.usage } : {}), model: r.model });
    return out;
  }

  return {
    push(raw: string): AiEvent[] {
      if (r.done) return [];
      const line = raw.replace(/\r$/, '');
      if (line === '') return [];                                     // event separator
      if (line.startsWith(':')) {                                     // ": OPENROUTER PROCESSING"
        r.heartbeats++;
        return [{ kind: 'heartbeat' }];
      }
      if (!line.startsWith('data:')) return [];                       // event:/id:/retry: fields
      const data = line.slice(5).trimStart();
      if (data === '[DONE]') {
        r.sawDone = true;
        return finish();
      }
      let j: Chunk;
      try {
        j = JSON.parse(data) as Chunk;
      } catch {
        return [];
      }
      if (!j || typeof j !== 'object' || j.debug) return [];          // debug echo chunk (choices: [])
      const out: AiEvent[] = [];
      if (!started && typeof j.model === 'string' && j.model) {
        started = true;
        r.model = j.model;
        r.provider = typeof j.provider === 'string' ? j.provider : null;
        r.generationId = typeof j.id === 'string' ? j.id : null;
        out.push({ kind: 'started', model: j.model, ...(r.provider ? { provider: r.provider } : {}), ...(r.generationId ? { generationId: r.generationId } : {}) });
      }
      if (j.error) {
        r.error = { code: j.error.code ?? null, message: String(j.error.message ?? '') };
        r.finish = 'error';
        out.push({ kind: 'error', code: 'AI_UPSTREAM', detail: r.error.message });
        r.done = true;
        r.toolCalls = calls.filter(Boolean);
        return out;
      }
      if (j.usage) r.usage = j.usage;                                 // final accounting chunk
      const c = j.choices?.[0];
      if (!c) return out;
      const d = c.delta ?? {};
      if (typeof d.reasoning === 'string' && d.reasoning) {
        r.reasoning += d.reasoning;
        out.push({ kind: 'reasoning', text: d.reasoning });
      }
      if (Array.isArray(d.reasoning_details)) r.reasoningDetails.push(...d.reasoning_details);
      const text = typeof d.content === 'string' ? d.content : typeof c.message?.content === 'string' ? c.message.content : '';
      if (text) {
        r.content += text;
        out.push({ kind: 'content', text });
      }
      for (const t of d.tool_calls ?? []) {                           // first fragment: id/type/name; then argument pieces
        const k = typeof t.index === 'number' ? t.index : 0;
        calls[k] ??= { id: t.id ?? '', type: 'function', index: k, function: { name: t.function?.name ?? '', arguments: '' } };
        const call = calls[k]!;
        if (t.id) call.id = t.id;
        if (t.function?.name) call.function.name = t.function.name;
        if (t.function?.arguments) call.function.arguments += t.function.arguments;
      }
      if (c.finish_reason && !r.finish) r.finish = c.finish_reason;  // the FIRST one; the usage chunk repeats it
      if (r.finish === 'error') {
        out.push({ kind: 'error', code: 'AI_UPSTREAM' });
        r.done = true;
        r.toolCalls = calls.filter(Boolean);
      }
      return out;
    },
    end(): AiEvent[] {
      return finish();
    },
    result(): SseResult {
      return { ...r, toolCalls: r.done ? r.toolCalls : calls.filter(Boolean) };
    },
  };
}

/** Splits raw SSE text into the lines Rust would forward (blank lines dropped). */
export function sseLines(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');
}

/** The result of a non-streamed 2xx body (`chat.completion`), in the parser's shape. */
export function resultFromBody(body: unknown): SseResult {
  const j = (body ?? {}) as {
    id?: string; model?: string; provider?: string; usage?: Usage;
    choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; reasoning?: string | null; reasoning_details?: unknown[]; tool_calls?: ToolCall[] } }>;
    error?: { code?: string | number; message?: string };
  };
  const c = j.choices?.[0];
  const m = c?.message ?? {};
  return {
    model: typeof j.model === 'string' ? j.model : '', provider: typeof j.provider === 'string' ? j.provider : null,
    generationId: typeof j.id === 'string' ? j.id : null,
    content: typeof m.content === 'string' ? m.content : '', reasoning: typeof m.reasoning === 'string' ? m.reasoning : '',
    reasoningDetails: Array.isArray(m.reasoning_details) ? m.reasoning_details : [],
    toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls.map((t, i) => ({ id: t.id, type: 'function' as const, index: i, function: { name: t.function?.name ?? '', arguments: t.function?.arguments ?? '' } })) : [],
    finish: c?.finish_reason ?? null, usage: j.usage ?? null,
    error: j.error ? { code: j.error.code ?? null, message: String(j.error.message ?? '') } : null,
    done: true, sawDone: false, heartbeats: 0,
  };
}
