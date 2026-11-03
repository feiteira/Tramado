// The three ways Tramado writes JSON (folder spec §4.1): manifests indented, everything else compact,
// JSONL lines compact with one '\n' and at most 65 536 bytes.
import { PlatformError } from './errors';

export const MAX_LINE_BYTES = 65_536;

/** Manifests (`class.json`, `lecture.json`, `exam.json`): 2-space indentation and a final newline. */
export const manifestJson = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

/** Every other JSON file: compact. */
export const compactJson = (v: unknown): string => JSON.stringify(v);

/** One JSONL line: compact JSON + '\n'; throws INVALID when it would exceed 65 536 bytes. */
export function jsonlLine(v: unknown): string {
  const line = JSON.stringify(v) + '\n';
  const bytes = new TextEncoder().encode(line).length;
  if (bytes > MAX_LINE_BYTES) throw new PlatformError('INVALID', `JSONL line of ${bytes} bytes exceeds ${MAX_LINE_BYTES}`);
  return line;
}
