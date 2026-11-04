// Tolerant JSON for model output (openrouter-lab §5, §11.9; critique R14): free models wrap JSON in fences, add
// prose, trailing commas and smart quotes. Returns null instead of throwing.

/** The JSON object (or array) in a model's answer, or null. */
export function tolerantParse(input: string | null | undefined): unknown | null {
  if (!input) return null;
  let s = input.replace(/^﻿/, '');
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(s);
  if (fence?.[1] && /[{[]/.test(fence[1])) s = fence[1];
  const candidates: string[] = [];
  const oi = s.indexOf('{');
  const oj = s.lastIndexOf('}');
  if (oi >= 0 && oj > oi) candidates.push(s.slice(oi, oj + 1));
  const ai = s.indexOf('[');
  const aj = s.lastIndexOf(']');
  if (ai >= 0 && aj > ai && (oi < 0 || ai < oi)) candidates.unshift(s.slice(ai, aj + 1));
  for (const core of candidates) {
    for (const t of [core, repair(core)]) {
      try {
        return JSON.parse(t) as unknown;
      } catch {
        // try the next variant
      }
    }
  }
  return null;
}

/** Light repairs: trailing commas, smart quotes, single-line `//` comments, unquoted NaN. */
export function repair(s: string): string {
  return s
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/:\s*NaN\b/g, ': null');
}
