// Architecture §9 (verbatim): the TypeScript side of the IPC contract (§6–§7). A field added here MUST be
// added to the Rust twin in the same change (§19.2: additive changes only, by the owning work package).
import type { ClassId, ConfirmText, ErrorCode, Instant } from './common';
export type SecretName = 'openrouter' | `host:${string}`;
export interface SecretStatus { set: boolean; last4: string | null; store: 'keychain' | 'file' | 'memory' }   // 'memory': demo only (no Rust twin value)
export type PrivacyLevel = 'standard' | 'no-training' | 'zdr';
export interface AiHost { id: string; base: string; label: string }
export type AiPath = 'chat/completions' | 'embeddings' | 'key' | 'models' | `models/${string}/endpoints`;   // audio: Rust-internal (D-12)
export type AiBase = { type: 'openrouter' } | { type: 'host'; hostId: string };
export type AiAction = 'ask' | 'chat' | 'explain' | 'summary' | 'terms' | 'annotate' | 'studyNotes' | 'examExtract' | 'examOcr'
  | 'examAnswer' | 'hint' | 'deep' | 'title' | 'describe' | 'docOcr' | 'cloudSpeech' | 'keyCheck' | 'catalog';
export interface AiPipeRequest {
  requestId: string;                                   // uuid; used by ai_cancel
  base: AiBase;
  method: 'GET' | 'POST';
  path: AiPath;
  body?: unknown;                                      // JSON; `provider` and `user` are rewritten by Rust
  stream: boolean;
  privacyOverride?: 'standard';                        // per-request relaxation, native confirmation (D-10)
  overrideText?: ConfirmText;
  busyFallback?: boolean;                              // the busy chooser's NVIDIA fallback; no dialog when busyRelax is on
  activity?: { classId: ClassId | null; action: AiAction; passages: number };   // for the activity log (no content)
}
export type AiWireEvent =
  | { type: 'head'; status: number; headers: Record<string, string> }
  | { type: 'line'; line: string }
  | { type: 'body'; text: string }
  | { type: 'end' }
  | { type: 'fail'; code: ErrorCode; message: string; data?: Record<string, unknown> };
export interface AiActivityEntry {   // one entry per request; the UI groups them per action
  at: Instant; host: string; path: string; model: string | null; status: number | null; code: ErrorCode | null;
  ms: number; bytesOut: number; bytesIn: number; privacy: PrivacyLevel | 'custom-host';
  classId: ClassId | null; action: AiAction | null; passages: number;
}

