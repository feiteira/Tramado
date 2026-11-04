// Reads the saved OpenRouter outputs of app/test-fixtures/ai/ (copied from the labs, redacted; plan §4.2).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../test-fixtures/ai/', import.meta.url));

export const fixtureText = (rel: string): string => readFileSync(ROOT + rel, 'utf8');
export const fixtureJson = <T = Record<string, unknown>>(rel: string): T => JSON.parse(fixtureText(rel)) as T;

export interface SavedCall {
  request?: { method?: string; path?: string; body?: Record<string, unknown> };
  response: { status: number; headers?: Record<string, string>; json?: unknown; text?: string; lines?: Array<[number, string]> };
}
export const savedCall = (name: string): SavedCall => fixtureJson<SavedCall>(`openrouter/${name}.json`);
/** The SSE lines of a saved streamed call, as Rust forwards them (blank lines dropped). */
export const savedLines = (name: string): string[] => (savedCall(name).response.lines ?? []).map(([, l]) => l).filter((l) => l !== '');
