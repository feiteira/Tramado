// Pure helpers of the chat tab (UX §3.10.2): which lines show, day separators, grouping by author within 5 minutes,
// whose message mentions me, and the find bar's matches. No React, no DOM (tested under Node).
import type { ChatMessageView } from '../../services/types/viewModels';

export const GROUP_MS = 5 * 60_000;
/** The list renders a window of the last messages (UX: "virtualised with a window of the last 200"). */
export const WINDOW = 200;
/** INT: at most this many messages are in the DOM; scrolling slides the window by STEP (smooth with 5 000 messages). */
export const MAX_ROWS = 400;
export const STEP = 100;

/**
 * The slice of `total` messages the list renders: the last WINDOW while it follows the end (`start` null), else
 * at most MAX_ROWS from `start`. `tail` = the newest message is in the window.
 */
export function chatWindow(total: number, start: number | null): { start: number; end: number; tail: boolean } {
  if (start === null || start < 0) return { start: Math.max(0, total - WINDOW), end: total, tail: true };
  const s = Math.min(start, Math.max(0, total - 1));
  const end = Math.min(total, s + MAX_ROWS);
  return { start: s, end, tail: end === total };
}

/** Where the window starts after sliding: `earlier` by STEP, `later` by STEP (null = follow the end again). */
export function slide(total: number, start: number, dir: 'earlier' | 'later'): number | null {
  if (dir === 'earlier') return Math.max(0, start - STEP);
  const next = start + STEP;
  return next + MAX_ROWS >= total ? null : next;
}

/** The window start that shows message `index` (null when the end-following window already shows it). */
export function startFor(total: number, index: number): number | null {
  return index >= total - WINDOW ? null : Math.max(0, index - 50);
}

/** A failed @AI answer line: shown to its asker as a notice under the question, to nobody as a card. */
export const isFailedAi = (m: ChatMessageView): boolean => m.kind === 'ai' && !!m.ai?.insufficient && !m.text.trim();

/** The lines the list shows: failed @AI answers are hidden (the asker sees a notice instead). */
export const visibleItems = (items: readonly ChatMessageView[]): ChatMessageView[] => items.filter((m) => !isFailedAi(m));

export type ChatRow =
  | { kind: 'day'; key: string; day: string }                          // `day` = local YYYY-MM-DD
  | { kind: 'line'; key: string; message: ChatMessageView; first: boolean; last: boolean };

/** The local calendar day of an instant ("2026-11-02"), in the given IANA zone (default: the system's). */
export function dayOf(iso: string, zone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(zone ? { timeZone: zone } : {}) }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whether two consecutive messages share one header (same author device and person, ≤ 5 min, plain messages). */
export function sameGroup(a: ChatMessageView, b: ChatMessageView): boolean {
  if (a.kind !== 'message' || b.kind !== 'message') return false;
  if (a.author.deviceId !== b.author.deviceId || a.unverified !== b.unverified) return false;
  const gap = Date.parse(b.at) - Date.parse(a.at);
  return gap >= 0 && gap <= GROUP_MS;
}

/** Rows with day separators and author groups (`first` carries the header, `last` closes the group). */
export function chatRows(items: readonly ChatMessageView[], zone?: string): ChatRow[] {
  const rows: ChatRow[] = [];
  let day = '';
  items.forEach((m, i) => {
    const d = dayOf(m.at, zone);
    if (d !== day) {
      day = d;
      rows.push({ kind: 'day', key: `day-${d}`, day: d });
    }
    const prev = items[i - 1];
    const next = items[i + 1];
    const first = !prev || dayOf(prev.at, zone) !== d || !sameGroup(prev, m);
    const last = !next || dayOf(next.at, zone) !== d || !sameGroup(m, next);
    rows.push({ kind: 'line', key: m.id, message: m, first, last });
  });
  return rows;
}

/** Whether a message mentions me (my member id, or @everyone). */
export const mentionsMe = (m: ChatMessageView, memberId: string): boolean =>
  !m.author.self && m.mentions.some((x) => x.memberId === memberId || x.memberId === 'everyone');

/** The id of my last plain message that can still be edited (↑ in an empty composer). */
export function lastEditable(items: readonly ChatMessageView[]): ChatMessageView | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i]!;
    if (m.author.self && m.kind === 'message' && !m.deleted) return m;
  }
  return null;
}

/** Messages whose text contains the query (accents and case ignored), oldest first. */
export function findMatches(items: readonly ChatMessageView[], query: string, names: (m: ChatMessageView) => string = () => ''): string[] {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  if (!q) return [];
  return items.filter((m) => !m.deleted && (fold(m.text).includes(q) || fold(names(m)).includes(q) || m.attachments.some((a) => fold(a.name).includes(q)))).map((m) => m.id);
}

/** "Bruno: Alguém tem os slides…" excerpts, at most `n` characters, without chat tokens. */
export function excerpt(text: string, n = 60): string {
  const flat = text.replace(/<@[a-z2-7]{26}>|<@(ai|everyone)>/g, (t) => (t === '<@ai>' ? '@AI' : t === '<@everyone>' ? '@everyone' : '@…')).replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}
