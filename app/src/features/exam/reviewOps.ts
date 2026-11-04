// The Review screen's question operations (UX §3.9.6), pure: split at the caret (the number goes on, II.a → II.b,
// 3 → 4), merge with the next question of the same level, delete, move, add, and "choose some" groups.
import type { Question } from '../../core/model/files';

const ROMAN: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const toRoman = (n: number) => ROMAN.reduce((s, [v, r]) => {
  let out = s;
  while (n >= v) {
    out += r;
    n -= v;
  }
  return out;
}, '');
const fromRoman = (s: string): number | null => {
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }[s[i] as 'I']!;
    const next = i + 1 < s.length ? { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }[s[i + 1] as 'I']! : 0;
    n += v < next ? -v : v;
  }
  return toRoman(n) === s ? n : null;
};

/** The number after `n`: "3" → "4", "II.a" → "II.b", "2a" → "2b", "IV" → "V", "1.2" → "1.3"; otherwise `n` + "′". */
export function nextNumber(n: string): string {
  const t = n.trim();
  const digits = /^(.*?)(\d+)$/.exec(t);
  if (digits) return `${digits[1]}${Number(digits[2]) + 1}`;
  const roman = fromRoman(t);
  if (roman !== null) return toRoman(roman + 1);
  const letter = /^(.*?)([a-yA-Y])$/.exec(t);
  if (letter && (letter[1] === '' || /[\d.)\s(-]$|[IVXLCDM]$/.test(letter[1]!))) return `${letter[1]}${String.fromCharCode(letter[2]!.charCodeAt(0) + 1)}`;
  return `${t}′`;
}

/** A number not used yet, starting from `n` (the split and add suggestions). */
export function freeNumber(qs: readonly Question[], n: string): string {
  const used = new Set(qs.map((q) => q.number.trim()));
  let c = n;
  for (let i = 0; i < 50 && used.has(c); i++) c = nextNumber(c);
  return c;
}

/** Splits `id` at `caret`: the first part keeps the number, the rest becomes a new question right after it. */
export function splitAt(qs: readonly Question[], id: string, caret: number, newId: string): Question[] {
  const i = qs.findIndex((q) => q.id === id);
  if (i < 0) return [...qs];
  const q = qs[i]!;
  const at = Math.max(0, Math.min(q.text.length, caret));
  const head = q.text.slice(0, at).trimEnd();
  const tail = q.text.slice(at).trimStart();
  if (!head || !tail) return [...qs];
  const second: Question = { ...q, id: newId, number: freeNumber(qs, nextNumber(q.number)), text: tail, points: null, options: [], answerKey: null };
  delete second.fieldHlc;
  const out = [...qs];
  out.splice(i, 1, { ...q, text: head }, second);
  return out;
}

const levelOf = (qs: readonly Question[], q: Question) => qs.filter((x) => x.parent === q.parent);

/** Merges `id` with the next question of its level (texts joined by a blank line, points added). */
export function mergeNext(qs: readonly Question[], id: string): Question[] {
  const q = qs.find((x) => x.id === id);
  if (!q || q.kind === 'container') return [...qs];
  const level = levelOf(qs, q).filter((x) => x.kind !== 'container');
  const next = level[level.indexOf(q) + 1];
  if (!next) return [...qs];
  const points = q.points !== null && next.points !== null ? q.points + next.points : q.points ?? next.points;
  return qs.filter((x) => x.id !== next.id).map((x) => (x.id === id ? { ...x, text: `${x.text.trimEnd()}\n\n${next.text.trimStart()}`, points, options: [...x.options, ...next.options] } : x));
}

/** Deletes a question (a container with its children). */
export function remove(qs: readonly Question[], id: string): Question[] {
  return qs.filter((x) => x.id !== id && x.parent !== id);
}

/** The block of a question in the array: itself, or a container and its children. */
function block(qs: readonly Question[], id: string): Question[] {
  const q = qs.find((x) => x.id === id);
  if (!q) return [];
  return q.kind === 'container' ? [q, ...qs.filter((x) => x.parent === id)] : [q];
}

/** Moves a question (or a group) one place up or down among its level. */
export function move(qs: readonly Question[], id: string, dir: -1 | 1): Question[] {
  const q = qs.find((x) => x.id === id);
  if (!q) return [...qs];
  const level = levelOf(qs, q);
  const j = level.indexOf(q) + dir;
  const other = level[j];
  if (!other) return [...qs];
  const a = block(qs, id);
  const b = block(qs, other.id);
  const rest = qs.filter((x) => !a.includes(x) && !b.includes(x));
  const firstIndex = Math.min(qs.indexOf(a[0]!), qs.indexOf(b[0]!));
  const ordered = dir < 0 ? [...a, ...b] : [...b, ...a];
  const before = rest.filter((x) => qs.indexOf(x) < firstIndex);
  const after = rest.filter((x) => qs.indexOf(x) > firstIndex);
  return [...before, ...ordered, ...after];
}

/** Adds an empty question at the end (top level), numbered after the last one. */
export function add(qs: readonly Question[], newId: string): Question[] {
  const top = qs.filter((x) => x.parent === null);
  const last = top.at(-1);
  const number = freeNumber(qs, last ? nextNumber(last.number) : '1');
  return [...qs, { id: newId, number, parent: null, group: null, kind: 'other', text: '', points: null, options: [], choose: null, source: null, answerKey: null }];
}

/** "Make a choose-some group": a container around `id` and the next top-level question ("answer 1 of"). */
export function makeGroup(qs: readonly Question[], id: string, containerId: string): Question[] {
  const q = qs.find((x) => x.id === id);
  if (!q || q.parent !== null || q.kind === 'container') return [...qs];
  const level = qs.filter((x) => x.parent === null);
  const next = level[level.indexOf(q) + 1];
  const members = [q, ...(next && next.kind !== 'container' ? [next] : [])];
  const container: Question = { id: containerId, number: freeNumber(qs, q.number.replace(/[.\s]*[a-z]$/i, '') || q.number), parent: null, group: null, kind: 'container', text: '', points: null, options: [], choose: 1, source: q.source, answerKey: null };
  const at = qs.indexOf(q);
  const out = qs.map((x) => (members.includes(x) ? { ...x, parent: containerId } : x));
  out.splice(at, 0, container);
  return out;
}

/** "Edit group": how many to answer, and which questions belong to it. */
export function editGroup(qs: readonly Question[], containerId: string, choose: number, members: readonly string[]): Question[] {
  const set = new Set(members);
  return qs.map((x) => {
    if (x.id === containerId) return { ...x, choose: Math.max(1, Math.min(choose, Math.max(1, set.size))) };
    if (set.has(x.id) && x.kind !== 'container') return { ...x, parent: containerId };
    if (x.parent === containerId && !set.has(x.id)) return { ...x, parent: null };
    return x;
  });
}

/** "Ungroup": the container goes, its questions stay at the top level. */
export function ungroup(qs: readonly Question[], containerId: string): Question[] {
  return qs.filter((x) => x.id !== containerId).map((x) => (x.parent === containerId ? { ...x, parent: null } : x));
}

/** Inline problems of the Review screen: duplicate or missing numbers and empty texts (containers need no text). */
export type ReviewProblem = { kind: 'dup'; n: string } | { kind: 'empty' } | { kind: 'number' };
export function problemsOf(qs: readonly Question[]): Map<string, ReviewProblem[]> {
  const out = new Map<string, ReviewProblem[]>();
  const push = (id: string, p: ReviewProblem) => out.set(id, [...(out.get(id) ?? []), p]);
  const seen = new Map<string, string>();
  for (const q of qs) {
    const n = q.number.trim();
    if (n && seen.has(n)) push(q.id, { kind: 'dup', n });
    else if (n) seen.set(n, q.id);
    if (q.kind !== 'container' && !q.text.trim()) push(q.id, { kind: 'empty' });
    if (!n) push(q.id, { kind: 'number' });
  }
  return out;
}

/** Multiple-choice options as editable lines ("A) …") and back. */
export const optionsText = (o: Question['options']): string => o.map((x) => `${x.key}) ${x.text}`).join('\n');
export function parseOptions(text: string): Question['options'] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const m = /^([A-Za-z0-9]{1,2})[).:-]\s*(.*)$/.exec(l);
    return m ? { key: m[1]!.toUpperCase(), text: m[2]!.slice(0, 1000) } : { key: String.fromCharCode(65 + i), text: l.slice(0, 1000) };
  });
}

