// createFakeAi() (architecture §10, UX §7.2): `platform.ai` for the browser demo and Vitest. It answers through the
// same wire events Rust emits — `head`, `line`s with real `chat.completion.chunk` JSON, heartbeats, `[DONE]`, and the
// real OpenRouter error bodies — so core/ai's parser, classifier and retry policy run unchanged. Demo modes:
// `fake` (scripted answers built from the sources the request carries, then the `aiNext` queue), `off` (AI_NO_KEY),
// `busy` (every chain → 429; the busy chooser's NVIDIA fallback answers), `quota` (AI_FREE_LIMIT, 0 left), `badkey`
// (AI_AUTH), and `real` (OpenRouter through `fetch` with a session-only key, CORS `*`).
import { PlatformError, type ErrorCode } from '../../core/errors';
import { ERROR_REPLIES, bodyOf, createScriptedTransport, type FakeReply } from '../../core/ai/fake';
import { createFetchTransport, type FetchLike } from '../../core/ai/fetchTransport';
import { detectLang } from '../../core/ai/prompts';
import { presplit } from '../../core/exam/presplit';
import type { AiActivityEntry, AiHost, AiPipeRequest, AiWireEvent, Platform, PrivacyLevel } from '../types';

export interface FakeAiControls {
  /** The next answer (text, or a function of the request body). */
  next(textOrFn: string | ((req: unknown) => string)): void;
  /** The next request (and its retries) fails with this code. */
  fail(code: ErrorCode): void;
}
export interface FakeAiOptions {
  /** Default `off` (no key); the demo passes its `ai=` mode. */
  mode?: 'fake' | 'off' | 'busy' | 'quota' | 'badkey' | 'real' | 'ratelimit' | 'cut';
  /** `real`: the session-only key and the fetch to use. */
  key?: () => string | null;
  fetch?: FetchLike;
  /** Wall clock (activity entries, quota reset). */
  now?: () => number;
  /** Demo pacing: delay per streamed line, so answers appear as they stream (0 in tests). */
  lineMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
export type FakeAi = Platform['ai'] & { controls: FakeAiControls; requests: AiPipeRequest[] };

const DEMO_MODEL = 'google/gemma-4-31b-it:free';
const NVIDIA = 'nvidia/nemotron-3.5-super-vl:free';

/** A small catalog for the demo's model pickers (ids, prices and capabilities as on OpenRouter, 2026-11-03). */
export const DEMO_CATALOG = [
  { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (free)', context_length: 262144, architecture: { input_modalities: ['image', 'text', 'video'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, top_provider: { context_length: 262144, max_completion_tokens: 32768 }, supported_parameters: ['include_reasoning', 'max_tokens', 'reasoning', 'response_format', 'seed', 'temperature', 'tool_choice', 'tools', 'top_p'], reasoning: { mandatory: false }, endpoints: ['/api/v1/chat/completions'] },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google: Gemma 4 26B A4B (free)', context_length: 262144, architecture: { input_modalities: ['image', 'text', 'video'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, top_provider: { context_length: 262144, max_completion_tokens: 32768 }, supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'temperature', 'tool_choice', 'tools'], reasoning: { mandatory: false }, endpoints: ['/api/v1/chat/completions'] },
  { id: 'dots-studio/dots-3-note-preview:free', name: 'Dots Studio: Dots 3 Note Preview (free)', context_length: 524288, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, top_provider: { context_length: 524288, max_completion_tokens: 65536 }, supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs', 'temperature', 'tool_choice', 'tools'], reasoning: { mandatory: false }, endpoints: ['/api/v1/chat/completions'] },
  { id: NVIDIA, name: 'NVIDIA: Nemotron 3.5 Super VL (free)', context_length: 1000000, architecture: { input_modalities: ['text', 'image', 'video'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, top_provider: { context_length: 1000000, max_completion_tokens: 131072 }, supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs', 'temperature', 'tool_choice', 'tools'], reasoning: { mandatory: false }, endpoints: ['/api/v1/chat/completions'] },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'NVIDIA: Nemotron 3 Ultra (free)', context_length: 1000000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, top_provider: { context_length: 1000000, max_completion_tokens: 131072 }, supported_parameters: ['max_tokens', 'reasoning', 'temperature', 'tool_choice', 'tools'], reasoning: { mandatory: false }, endpoints: ['/api/v1/chat/completions'] },
  { id: 'anthropic/claude-haiku-5.5', name: 'Anthropic: Claude Haiku 5.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0.000001', completion: '0.000005' }, top_provider: { context_length: 200000, max_completion_tokens: 64000 }, supported_parameters: ['max_tokens', 'reasoning', 'temperature', 'tool_choice', 'tools', 'structured_outputs'], reasoning: { mandatory: false }, endpoints: ['/api/v1/chat/completions'] },
];

/** A fictional exam page, as a vision model would transcribe it (the demo's "read this photo"). */
export const DEMO_OCR_TEXT = [
  'FACULDADE DE DIREITO — Direito Constitucional I',
  'Exame — época normal — Duração: 2 horas',
  'Permitida a consulta de legislação não anotada.',
  '',
  'GRUPO I (8 valores)',
  'A Câmara Municipal de Vila Nova aprovou um regulamento que proíbe a afixação de cartazes de um só partido. Pronuncie-se sobre a validade do regulamento.',
  '',
  'GRUPO II (6 valores)',
  'Responda a duas das seguintes questões:',
  'a) Distinga direitos, liberdades e garantias de direitos sociais.',
  'b) O que é o princípio da proporcionalidade?',
  'c) Em que casos pode ser declarado o estado de sítio?',
  '',
  'GRUPO III (4 valores)',
  'Comente: «A lei não pode restringir o conteúdo essencial dos direitos.»',
  '',
  'Ponderação global da redação: 2 valores.',
].join('\n');

type Message = { role: string; content?: unknown; tool_calls?: unknown };
const textOf = (m: Message | undefined): string => {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (p && typeof p === 'object' && (p as { type?: string }).type === 'text' ? String((p as { text?: string }).text ?? '') : '')).join(' ');
  return '';
};
const hasImage = (msgs: Message[]) => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => (p as { type?: string })?.type === 'image_url'));
const words = (s: string, n: number) => s.replace(/[^\p{L}\p{N}\s.º-]/gu, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, n);

/** The sources block of an answering request: `[S1] (label)\ntext`. */
export function sourcesIn(user: string): Array<{ ref: string; label: string; text: string }> {
  const out: Array<{ ref: string; label: string; text: string }> = [];
  const re = /^\[(S\d+)\] \(([^)\n]*)\)\n([\s\S]*?)(?=\n\n\[S\d+\] \(|$)/gm;
  for (const m of user.matchAll(re)) out.push({ ref: m[1]!, label: m[2]!, text: m[3]!.trim() });
  return out;
}

/** The scripted answer to a request (UX §7.2 `ai=fake`): plausible, cites what was sent, never invents a source. */
export function fakeReply(req: AiPipeRequest): FakeReply {
  const b = bodyOf(req as never);
  const msgs = (b.messages ?? []) as Message[];
  const system = textOf(msgs.find((m) => m.role === 'system'));
  const user = textOf([...msgs].reverse().find((m) => m.role === 'user'));
  const model = req.busyFallback ? NVIDIA : DEMO_MODEL;
  if (hasImage(msgs)) return { kind: 'text', text: DEMO_OCR_TEXT, model, chunk: 48 };
  if (/"exam_questions"|JSON Schema|JSON-Schema/.test(system) && /^Exam:/m.test(user)) {
    const exam = user.replace(/^Exam:\n/, '').replace(/\n\nA deterministic splitter[\s\S]*$/, '');
    const pre = presplit(exam);
    const questions = pre.blocks.map((q) => ({
      number: q.number, parent: q.parent, group: q.group, text: q.text, points: q.points,
      kind: q.container ? 'container' : q.options.length ? 'multiple_choice' : 'open', options: q.options.map((o) => o.text),
    }));
    return { kind: 'text', text: JSON.stringify({ title: pre.title, questions }), model, chunk: 64 };
  }
  if (/"queries"/.test(system)) {
    const queries: Record<string, string[]> = {};
    for (const line of user.split('\n')) {
      const m = /^(q_[0-9A-Za-z]{6,8}|\w+): (.*)$/.exec(line);
      if (m) queries[m[1]!] = words(m[2]!, 5);
    }
    return { kind: 'text', text: JSON.stringify({ queries }), model };
  }
  const tools = Array.isArray(b.tools) && b.tools.length > 0;
  const toolMsgs = msgs.filter((m) => m.role === 'tool');
  if (tools && b.tool_choice !== 'none' && toolMsgs.length === 0) {
    const question = textOf(msgs.find((m) => m.role === 'user'));
    return { kind: 'tools', model, calls: [{ name: 'search_materials', args: { query: words(question, 6).join(' '), limit: 4 } }] };
  }
  const lang = detectLang(user) ?? 'pt';
  let sources = sourcesIn(user);
  if (!sources.length && toolMsgs.length) {
    for (const t of toolMsgs) {
      try {
        const r = JSON.parse(String(t.content)) as { results?: Array<{ ref: string; source: string; snippet: string }> };
        for (const x of r.results ?? []) sources.push({ ref: x.ref, label: x.source, text: x.snippet });
      } catch {
        // not a search result
      }
    }
  }
  if (/"terms"/.test(system)) {
    const terms = sources.slice(0, 3).map((s) => ({ term: words(s.text, 1)[0] ?? 'conceito', note: s.text.slice(0, 160), ref: s.ref }));
    return { kind: 'text', text: JSON.stringify({ terms }), model };
  }
  sources = sources.slice(0, 3);
  if (!sources.length) {
    const none = { pt: 'Os materiais não cobrem esta pergunta. Tente outra formulação ou acrescente documentos à cadeira.', es: 'Los materiales no cubren esta pregunta. Pruebe otra formulación o añada documentos a la asignatura.', en: 'The materials do not cover this question. Try other words or add documents to the class.' }[lang];
    return { kind: 'text', text: none, model };
  }
  const lead = { pt: ['Segundo os materiais da cadeira,', 'Além disso,', 'Por fim,'], es: ['Según los materiales de la asignatura,', 'Además,', 'Por último,'], en: ['According to the class materials,', 'Also,', 'Finally,'] }[lang];
  const hint = /hint|pista|orientadoras/i.test(system);
  if (hint) {
    // A guiding question, never the answer: each source named once with all its refs ("Reread X [S1, S2].").
    const byLabel = new Map<string, string[]>();
    for (const s of sources) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s.ref]);
    const say = { pt: ['Releia', 'O que dizem estes excertos sobre a pergunta?'], es: ['Relea', '¿Qué dicen estos fragmentos sobre la pregunta?'], en: ['Reread', 'What do these passages say about the question?'] }[lang];
    const look = [...byLabel].map(([label, refs]) => `${label} [${refs.join(', ')}]`).join('; ');
    return { kind: 'text', text: `${say[0]} ${look}. ${say[1]}`, model, reasoning: '', heartbeats: 1 };
  }
  const sentences = sources.map((s, i) => {
    const first = (s.text.split(/(?<=[.!?])\s/)[0] ?? s.text).slice(0, 220).replace(/[.!?]?$/, '');
    return `${lead[Math.min(i, lead.length - 1)]} ${first.charAt(0).toLowerCase()}${first.slice(1)} [${s.ref}].`;
  });
  const choice = /fixed options|opções fixas|opciones fijas/.test(system) ? `${{ pt: 'Resposta', es: 'Respuesta', en: 'Answer' }[lang]}: B\n` : '';
  return { kind: 'text', text: `${choice}${sentences.join(' ')}`, model, reasoning: '', heartbeats: 1 };
}

function failReply(code: ErrorCode, now: number): FakeReply {
  switch (code) {
    case 'AI_BUSY': return ERROR_REPLIES.busy();
    case 'AI_AUTH': return ERROR_REPLIES.auth();
    case 'AI_FREE_LIMIT': return ERROR_REPLIES.freeLimit(nextMidnight(now));
    case 'AI_PRIVACY_BLOCKS': return ERROR_REPLIES.privacy();
    case 'AI_MODEL_UNKNOWN': return ERROR_REPLIES.modelUnknown(DEMO_MODEL);
    case 'AI_NO_CREDIT': return ERROR_REPLIES.noCredit();
    case 'AI_TOO_LONG': return ERROR_REPLIES.tooLong();
    case 'AI_MODEL_GATED': return ERROR_REPLIES.gated();
    case 'AI_FLAGGED': return ERROR_REPLIES.flagged();
    case 'AI_UNSUPPORTED': return ERROR_REPLIES.unsupported();
    case 'AI_UPSTREAM': return ERROR_REPLIES.upstream();
    case 'AI_UNAVAILABLE': return ERROR_REPLIES.unavailable(0);
    case 'AI_BAD_REQUEST': return ERROR_REPLIES.badRequest();
    case 'AI_LENGTH': return { kind: 'text', text: '', finish: 'length' };
    default: return { kind: 'fail', code };
  }
}
const nextMidnight = (now: number) => (Math.floor(now / 86_400_000) + 1) * 86_400_000;
const TRANSIENT = new Set<ErrorCode>(['AI_BUSY', 'AI_UPSTREAM', 'AI_TIMEOUT', 'AI_UNAVAILABLE', 'AI_OFFLINE']);

export function createFakeAi(opts: FakeAiOptions = {}): FakeAi {
  // No options = a fresh install without a key (AI_NO_KEY); the demo passes its `ai=` mode (default `fake`).
  const mode = opts.mode ?? 'off';
  const now = opts.now ?? (() => Date.now());
  let privacy: PrivacyLevel = 'no-training';
  let busyRelax = false;
  const hosts: AiHost[] = [];
  const activity: AiActivityEntry[] = [];
  const requests: AiPipeRequest[] = [];
  const queue: Array<{ kind: 'text'; value: string | ((req: unknown) => string) } | { kind: 'fail'; code: ErrorCode; left: number }> = [];

  const keyBody = (remaining: number) => ({
    data: { label: 'sk-or-v1-…demo', is_free_tier: true, limit: null, limit_remaining: null, usage: 0, free_model_daily_requests: { used: 50 - remaining, limit: 50, remaining } },
  });

  function script(req: AiPipeRequest): FakeReply {
    if (mode === 'off') return { kind: 'fail', code: 'AI_NO_KEY', message: 'AI is not set up' };
    if (mode === 'badkey') return ERROR_REPLIES.auth();
    if (req.method === 'GET') {
      if (req.path === 'key') return { kind: 'json', body: keyBody(mode === 'quota' ? 0 : 38) };
      if (req.path === 'models') return { kind: 'json', body: { data: DEMO_CATALOG } };
      // INT: one endpoint per model; `busy` reports it failing most requests of the last minutes (the key test's "busy").
      const uptime = mode === 'busy' ? 14 : 100;
      return { kind: 'json', body: { data: { id: req.path, endpoints: [{ name: 'Google AI Studio', provider_name: 'Google AI Studio', status: 0, uptime_last_5m: uptime, uptime_last_30m: uptime }] } } };
    }
    if (mode === 'quota') return ERROR_REPLIES.freeLimit(nextMidnight(now()));
    // INT demo modes: the per-minute limit with Retry-After, and answers cut off at the length limit.
    if (mode === 'ratelimit') return ERROR_REPLIES.rateLimited(120);
    if (mode === 'busy' && !req.busyFallback) {
      const r = ERROR_REPLIES.busy();
      // The demo shows the chooser without the real 14 s of backoff: "retry now" is what Retry-After 0 means.
      return r.kind === 'error' ? { ...r, headers: { ...r.headers, 'retry-after': '0' } } : r;
    }
    const q = queue[0];
    if (q?.kind === 'fail') {
      q.left--;
      if (q.left <= 0) queue.shift();
      return failReply(q.code, now());
    }
    if (q?.kind === 'text') {
      queue.shift();
      const text = typeof q.value === 'function' ? q.value(req.body) : q.value;
      return { kind: 'text', text, model: req.busyFallback ? NVIDIA : DEMO_MODEL };
    }
    const reply = fakeReply(req);
    return mode === 'cut' && reply.kind === 'text' ? { ...reply, finish: 'length' } : reply;
  }

  const scripted = createScriptedTransport((r) => script(r as AiPipeRequest), {
    ...(opts.lineMs ? { lineMs: opts.lineMs } : {}),
    ...(opts.sleep ? { pace: opts.sleep } : opts.lineMs ? { pace: (ms: number) => new Promise<void>((res) => setTimeout(res, ms)) } : {}),
  });
  const real = mode === 'real' && opts.fetch
    ? createFetchTransport({ fetch: opts.fetch, key: opts.key ?? (() => null), level: () => privacy })
    : null;
  const transport = real ?? scripted;

  function log(req: AiPipeRequest, status: number | null, code: ErrorCode | null, started: number, bytesIn: number) {
    const body = req.body as { model?: string } | undefined;
    activity.unshift({
      at: new Date(now()).toISOString(), host: req.base.type === 'host' ? req.base.hostId : 'openrouter.ai', path: req.path, model: body?.model ?? null,
      status, code, ms: Math.max(0, now() - started), bytesOut: req.body ? JSON.stringify(req.body).length : 0, bytesIn,
      privacy: req.base.type === 'host' ? 'custom-host' : req.privacyOverride === 'standard' && req.busyFallback ? 'standard' : privacy,
      classId: req.activity?.classId ?? null, action: req.activity?.action ?? null, passages: req.activity?.passages ?? 0,
    });
    if (activity.length > 500) activity.length = 500;
  }

  return {
    requests,
    controls: {
      next(textOrFn) {
        queue.push({ kind: 'text', value: textOrFn });
      },
      fail(code) {
        queue.push({ kind: 'fail', code, left: TRANSIENT.has(code) ? 4 : 1 });
      },
    },
    async send(req: AiPipeRequest, onEvent: (e: AiWireEvent) => void) {
      requests.push(req);
      const started = now();
      if (mode === 'off') {
        log(req, null, 'AI_NO_KEY', started, 0);
        queueMicrotask(() => onEvent({ type: 'fail', code: 'AI_NO_KEY', message: `AI is not set up (request ${req.requestId})` }));
        return;
      }
      let status: number | null = null;
      let bytesIn = 0;
      await transport.send(req as never, (e) => {
        if (e.type === 'head') status = e.status;
        if (e.type === 'line') bytesIn += e.line.length + 1;
        if (e.type === 'body') bytesIn += e.text.length;
        if (e.type === 'end') log(req, status, null, started, bytesIn);
        if (e.type === 'fail') log(req, status, e.code, started, bytesIn);
        onEvent(e as AiWireEvent);
      });
    },
    async cancel(requestId) {
      await transport.cancel(requestId);
    },
    async hosts() {
      return [...hosts];
    },
    async allowHost(base) {
      let url: URL;
      try {
        url = new URL(base);
      } catch {
        throw new PlatformError('AI_BAD_ADDRESS', 'not a URL');
      }
      const id = url.host.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) || 'host';
      const host: AiHost = { id, base: base.replace(/\/+$/, ''), label: url.host };
      const i = hosts.findIndex((h) => h.id === id);
      if (i >= 0) hosts[i] = host;
      else hosts.push(host);
      return host;
    },
    async forgetHost(hostId) {
      const i = hosts.findIndex((h) => h.id === hostId);
      if (i >= 0) hosts.splice(i, 1);
    },
    async privacy() {
      return privacy;
    },
    async setPrivacy(level) {
      privacy = level;
      return true;
    },
    async busyPolicy() {
      return busyRelax;
    },
    async setBusyPolicy(relax) {
      busyRelax = relax;
      return true;
    },
    async activity(limit) {
      return activity.slice(0, Math.max(0, Math.min(500, limit)));
    },
    async clearActivity() {
      activity.length = 0;
    },
  };
}
