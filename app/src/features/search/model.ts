// The search palette's pure logic (UX §3.13): passages → result rows grouped by kind, snippets with the hits
// marked, the route each row opens, chat matching (chat is not in the passage index), recent searches and
// recently opened items. No DOM, no services: provider.ts wires it.
import type { Locator, SourceRef } from '../../core/model/files';
import { clockLabel, locatorLabel } from '../../core/search/labels';
import { locatorPage } from '../../core/search/locators';
import { fold, foldWithMap, originalSpan } from '../../core/search/text';
import type { Route } from '../../shell/routes';

export type ResultKind = 'lecture' | 'document' | 'note' | 'exam' | 'chat';
export const GROUP_ORDER: readonly ResultKind[] = ['lecture', 'document', 'note', 'exam', 'chat'];
export const GROUP_ID: Record<ResultKind, 'lectures' | 'documents' | 'notes' | 'exams' | 'chat'> = {
  lecture: 'lectures', document: 'documents', note: 'notes', exam: 'exams', chat: 'chat',
};
export const GROUP_ICON: Record<ResultKind, string> = { lecture: 'mic', document: 'file-text', note: 'notebook-pen', exam: 'clipboard-list', chat: 'message-circle' };
/** A group shows this many rows; "Show all {n}" expands it in place up to MAX_PER_GROUP. */
export const PER_GROUP = 5;
export const MAX_PER_GROUP = 50;
export const RECENT_SEARCHES = 5;
export const RECENT_ITEMS = 8;

/** The passage fields the palette reads (services/types/search Passage). */
export interface PassageLike {
  id: string; classId: string; source: SourceRef; locator: Locator; label: string; text: string; score: number;
  hits: Array<[number, number]>; title?: string; private?: boolean;
}

export interface Snippet { text: string; marks: Array<[number, number]> }

export interface ResultRow {
  id: string;
  kind: ResultKind;
  classId: string;
  title: string;
  /** "p. 9 · art. 18.º", "41:12", "Bruno, 2 Nov" (may be empty). */
  locator: string;
  snippet: Snippet;
  private: boolean;
  /** Opens the row (a lecture: and plays from just before the hit). */
  route: Route;
  /** Shift+Enter: a lecture without playing; otherwise the same as `route`. */
  altRoute: Route;
}

const SNIPPET_MAX = 160;
const SNIPPET_BEFORE = 36;
const clean = (s: string) => s.replace(/\s+/g, ' ');

/**
 * A window of `text` around the first hit (about 160 characters), whitespace collapsed, with "…" where cut and the
 * hits inside the window as [start, end) offsets of the returned text.
 */
export function snippetOf(text: string, hits: ReadonlyArray<readonly [number, number]>, max = SNIPPET_MAX): Snippet {
  const sorted = [...hits].filter(([a, b]) => b > a && a >= 0 && b <= text.length).sort((x, y) => x[0] - y[0]);
  const first = sorted[0]?.[0] ?? 0;
  let start = Math.max(0, first - SNIPPET_BEFORE);
  // Start at a word boundary when cutting (the next one, so the hit stays near the start).
  if (start > 0) {
    const sp = text.slice(start, first).search(/\s/);
    start = sp >= 0 ? start + sp + 1 : first;
  }
  let end = Math.min(text.length, start + max);
  if (end < text.length) {
    const sp = text.indexOf(' ', end - 12);
    if (sp > 0 && sp < end + 12) end = sp;
  }
  // Collapse whitespace while mapping offsets.
  const map: number[] = [];
  let out = '';
  let lastSpace = false;
  for (let i = start; i < end; i++) {
    const ch = text[i]!;
    const space = /\s/.test(ch);
    if (space && (lastSpace || out === '')) {
      map[i - start] = out.length;
      continue;
    }
    map[i - start] = out.length;
    out += space ? ' ' : ch;
    lastSpace = space;
  }
  map[end - start] = out.length;
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const trimmed = out.replace(/\s+$/, '');
  const marks: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    if (b <= start || a >= end) continue;
    const s = map[Math.max(a, start) - start]! + prefix.length;
    const e = Math.min(map[Math.min(b, end) - start]!, trimmed.length) + prefix.length;
    if (e > s) marks.push([s, e]);
  }
  return { text: prefix + trimmed + suffix, marks };
}

/** The snippet without marks, for aria-labels ("{kind}: {title}, {where}. {snippet}"). */
export const plainSnippet = (s: Snippet) => s.text;

/** The words a search looks for: folded, at least 2 characters. */
export function queryWords(q: string): string[] {
  return fold(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
}

/** Hits of every query word in `text` (accent- and case-insensitive), as offsets of `text`. */
export function findHits(text: string, q: string): Array<[number, number]> {
  const words = queryWords(q);
  if (!words.length) return [];
  const f = foldWithMap(text);
  const out: Array<[number, number]> = [];
  for (const w of words) {
    let i = f.folded.indexOf(w);
    while (i >= 0) {
      const sp = originalSpan(f, i, i + w.length);
      out.push([sp.start, sp.end]);
      i = f.folded.indexOf(w, i + w.length);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** True when every query word appears in `text` (accent- and case-insensitive). */
export function matchesAll(text: string, q: string): boolean {
  const words = queryWords(q);
  if (!words.length) return false;
  const f = fold(text);
  return words.every((w) => f.includes(w));
}

/** The passage's hit text, for the document view's find and the lecture view's highlight. */
function hitQuote(p: PassageLike): string | undefined {
  const [a, b] = p.hits[0] ?? [0, 0];
  if (b <= a) return undefined;
  // The hit words plus a little context to the next word boundary, ≤ 80 characters.
  const last = p.hits.filter(([s]) => s - a < 80).at(-1)!;
  return clean(p.text.slice(a, Math.max(b, last[1]))).trim() || undefined;
}

/** A passage as a palette row (UX §3.13 row layout and keys). */
export function rowOf(p: PassageLike, lang: string): ResultRow | null {
  const src = p.source;
  const snippet = snippetOf(p.text, p.hits);
  const quote = hitQuote(p);
  const q = quote ? { quote } : {};
  switch (src.kind) {
    case 'document': {
      const page = locatorPage(p.locator);
      const route: Route = {
        name: 'document', classId: p.classId, relPath: src.path, sha256: src.sha256,
        ...(page ? { page } : {}), ...(p.locator.type === 'slide' ? { slide: p.locator.slide } : {}), ...q,
      };
      return { id: p.id, kind: 'document', classId: p.classId, title: p.title || src.path.slice(src.path.lastIndexOf('/') + 1), locator: locatorText(p.locator, lang), snippet, private: false, route, altRoute: route };
    }
    case 'lecture': {
      const at = p.locator.type === 'segment' ? p.locator.startMs : undefined;
      const segmentId = p.locator.type === 'segment' ? p.locator.segmentId : undefined;
      const base = { name: 'lecture' as const, classId: p.classId, lectureId: src.lectureId, ...(at !== undefined ? { at } : {}), ...(segmentId ? { segmentId } : {}), ...q };
      return {
        id: p.id, kind: 'lecture', classId: p.classId, title: p.title || '', locator: at !== undefined ? clockLabel(at) : '', snippet, private: false,
        route: { ...base, play: true }, altRoute: base,
      };
    }
    case 'note': {
      const priv = !!p.private || src.path.startsWith('notes/');
      const route: Route = { name: 'note', classId: p.classId, relPath: src.path, private: priv, ...q };
      return { id: p.id, kind: 'note', classId: p.classId, title: p.title || src.path.slice(src.path.lastIndexOf('/') + 1).replace(/\.md$/i, ''), locator: '', snippet, private: priv, route, altRoute: route };
    }
    case 'exam': {
      const route: Route = { name: 'exam', classId: p.classId, examId: src.examId, ...(src.questionId ? { questionId: src.questionId } : {}) };
      return { id: p.id, kind: 'exam', classId: p.classId, title: p.title || '', locator: '', snippet, private: false, route, altRoute: route };
    }
  }
}

function locatorText(loc: Locator, lang: string): string {
  if (loc.type === 'whole' || loc.type === 'text') return '';
  return locatorLabel(loc, lang);
}

/** Groups rows in UX order, the best first; each group keeps up to MAX_PER_GROUP rows. */
export function groupRows(rows: readonly ResultRow[]): Array<{ kind: ResultKind; rows: ResultRow[] }> {
  const out: Array<{ kind: ResultKind; rows: ResultRow[] }> = [];
  for (const kind of GROUP_ORDER) {
    const seen = new Set<string>();
    const list: ResultRow[] = [];
    for (const r of rows) {
      if (r.kind !== kind) continue;
      // One row per place: two passages of the same page or the same moment read as duplicates.
      const key = `${r.classId}|${JSON.stringify(r.route)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(r);
      if (list.length >= MAX_PER_GROUP) break;
    }
    if (list.length) out.push({ kind, rows: diverse(list) });
  }
  return out;
}

/** The first rows of a group show at most two places of one source (one lecture, one file); the rest follow. */
function diverse(rows: ResultRow[]): ResultRow[] {
  const head: ResultRow[] = [];
  const tail: ResultRow[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const src = sourceKey(r.route);
    const n = seen.get(src) ?? 0;
    seen.set(src, n + 1);
    (n < 2 ? head : tail).push(r);
  }
  return [...head, ...tail];
}
const sourceKey = (r: Route): string => {
  switch (r.name) {
    case 'lecture': return `l:${r.lectureId}`;
    case 'document': return `d:${r.relPath}`;
    case 'note': return `n:${r.relPath}`;
    case 'exam': return `e:${r.examId}`;
    default: return JSON.stringify(r);
  }
};

/** A chat message as the palette sees it (ChatMessageView fields). */
export interface ChatLike {
  id: string; text: string; kind: string; deleted: boolean; at: string; author: { memberName: string; self: boolean };
  mentions?: ReadonlyArray<{ memberId: string; name: string }>;
}

/** Chat text with `<@member>` tokens as "@Name" (the palette shows plain text). */
export function chatText(m: Pick<ChatLike, 'text' | 'mentions'>): string {
  return m.text.replace(/<@([^>\s]+)>/g, (_, id: string) => {
    const hit = m.mentions?.find((x) => x.memberId === id);
    return `@${hit?.name ?? (id === 'ai' ? 'AI' : id === 'everyone' ? 'everyone' : id)}`;
  });
}

/** Chat messages matching every query word, newest first (chat is not in the passage index, UX §3.13 "Chat"). */
export function chatRows(classId: string, items: readonly ChatLike[], q: string, where: (m: ChatLike) => string): ResultRow[] {
  const out: ResultRow[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i]!;
    if (m.deleted || m.kind === 'system' || m.kind === 'thanks' || !m.text.trim()) continue;
    const text = chatText(m);
    if (!matchesAll(text, q)) continue;
    const route: Route = { name: 'class', classId, tab: 'chat', messageId: m.id };
    const snippet = snippetOf(text, findHits(text, q), 120);
    out.push({
      id: `chat:${classId}:${m.id}`, kind: 'chat', classId, title: snippet.text, locator: where(m),
      snippet, private: false, route, altRoute: route,
    });
    if (out.length >= MAX_PER_GROUP) break;
  }
  return out;
}

/** Adds a search to the recent list (most recent first, de-duplicated by folded text, ≤ 5). */
export function pushRecentSearch(list: readonly string[], q: string): string[] {
  const t = q.trim().slice(0, 200);
  if (t.length < 2) return [...list];
  const f = fold(t);
  return [t, ...list.filter((x) => fold(x) !== f)].slice(0, RECENT_SEARCHES);
}

export function parseRecentSearches(raw: string): string[] {
  try {
    const a: unknown = JSON.parse(raw);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string').slice(0, RECENT_SEARCHES) : [];
  } catch {
    return [];
  }
}

/** A recently opened item (per device, browser storage; UX §3.13 "Recent"). */
export interface RecentItem { kind: ResultKind; classId: string; title: string; locator: string; private: boolean; route: Route; at: number }

export function pushRecentItem(list: readonly RecentItem[], item: RecentItem): RecentItem[] {
  const key = (r: RecentItem) => `${r.classId}|${r.kind}|${JSON.stringify(r.kind === 'lecture' ? { ...r.route, at: undefined, play: undefined, quote: undefined, segmentId: undefined } : { ...r.route, page: undefined, quote: undefined })}`;
  const k = key(item);
  return [item, ...list.filter((x) => key(x) !== k)].slice(0, RECENT_ITEMS);
}

export function parseRecentItems(raw: string | null): RecentItem[] {
  if (!raw) return [];
  try {
    const a: unknown = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is RecentItem => !!x && typeof x === 'object' && typeof (x as RecentItem).title === 'string'
      && GROUP_ORDER.includes((x as RecentItem).kind) && typeof (x as RecentItem).classId === 'string' && !!(x as RecentItem).route
      && typeof (x as RecentItem).route.name === 'string').slice(0, RECENT_ITEMS);
  } catch {
    return [];
  }
}
