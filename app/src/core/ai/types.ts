// The shapes of the AI client (architecture §11.1 core/ai, openrouter-lab §11.2). Pure types: the request body
// OpenRouter takes, the events the SSE parser yields, and the structural twin of the Rust pipe (platform/types/ai.ts),
// redeclared here because core imports only core (architecture §11).
import type { ErrorCode } from '../errors';

/** Privacy levels (architecture §1.2): `zdr` "Keep nothing", `no-training` (default), `standard` "may train". */
export type PrivacyLevel = 'standard' | 'no-training' | 'zdr';
/** What the request is for: picks the profile of ai-defaults.json (max tokens, temperature, reasoning). */
export type Task = 'exam-answer' | 'chat' | 'expand' | 'extract-questions' | 'ocr' | 'summary' | 'explain' | 'title';
export type Priority = 'interactive' | 'bulk';
export type Effort = 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
export interface Reasoning { enabled?: boolean; effort?: Effort; exclude?: boolean; max_tokens?: number }

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
export interface ToolCall { id: string; type: 'function'; index?: number; function: { name: string; arguments: string } }
export type Msg =
  | { role: 'system' | 'user'; content: string | Part[] }
  | { role: 'assistant'; content?: string | null; tool_calls?: ToolCall[]; reasoning?: string; reasoning_details?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ResponseFormat { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: object } }

/** The body of `POST chat/completions` (OpenRouter). Rust rewrites `provider` and removes `user` (arch §5.2 rule 5). */
export interface ChatBody {
  model: string;
  models?: string[];                     // models[0] === model; ≤ 3 (OpenRouter's limit)
  messages: Msg[];
  tools?: ToolDef[];
  tool_choice?: 'auto' | 'none';
  max_tokens: number;
  temperature?: number;
  reasoning?: Reasoning;
  response_format?: ResponseFormat;
  provider?: { data_collection?: 'allow' | 'deny'; zdr?: boolean };
  stream: boolean;
}

export interface Usage {
  prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

/** What the SSE parser and the client report while a request runs (openrouter-lab §11.2). */
export type AiEvent =
  | { kind: 'started'; model: string; provider?: string; generationId?: string }
  | { kind: 'heartbeat' }
  | { kind: 'reasoning'; text: string }
  | { kind: 'content'; text: string }
  | { kind: 'tool_calls'; calls: ToolCall[] }
  | { kind: 'done'; finish: string; usage?: Usage; model: string }
  | { kind: 'retrying'; code: ErrorCode; inMs: number; attempt: number; nextChain?: string[] }
  | { kind: 'error'; code: ErrorCode; detail?: string };

// ── The Rust pipe, structurally (platform/types/ai.ts AiPipeRequest / AiWireEvent; architecture §9) ──
export type PipePath = 'chat/completions' | 'embeddings' | 'key' | 'models' | `models/${string}/endpoints`;
export type PipeBase = { type: 'openrouter' } | { type: 'host'; hostId: string };
export interface ConfirmTextLike { title: string; message: string; confirm: string; cancel: string }
export type ActionTag = 'ask' | 'chat' | 'explain' | 'summary' | 'terms' | 'annotate' | 'studyNotes' | 'examExtract' | 'examOcr'
  | 'examAnswer' | 'hint' | 'deep' | 'title' | 'describe' | 'docOcr' | 'cloudSpeech' | 'keyCheck' | 'catalog';
export interface ActivityTag { classId: string | null; action: ActionTag; passages: number }
export interface PipeRequest {
  requestId: string;
  base: PipeBase;
  method: 'GET' | 'POST';
  path: PipePath;
  body?: unknown;
  stream: boolean;
  privacyOverride?: 'standard';
  overrideText?: ConfirmTextLike;
  busyFallback?: boolean;
  activity?: ActivityTag;
}
export type WireEvent =
  | { type: 'head'; status: number; headers: Record<string, string> }
  | { type: 'line'; line: string }
  | { type: 'body'; text: string }
  | { type: 'end' }
  | { type: 'fail'; code: ErrorCode; message: string; data?: Record<string, unknown> };
/** `platform.ai` as the client needs it (send + cancel). */
export interface AiTransport {
  send(req: PipeRequest, onEvent: (e: WireEvent) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

/** Capabilities of one model, from the `/models` catalog (openrouter-lab §10). */
export interface ModelCaps {
  id: string; name: string; label: string; free: boolean; context: number; maxOut: number | null;
  tools: boolean; vision: boolean; strictJson: boolean; reasoning: boolean; reasoningMandatory: boolean;
  chat: boolean; deprecated: string | null;
}
