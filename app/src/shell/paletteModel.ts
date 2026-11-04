// The command palette's sections (UX §2.9, §3.13) as a pure function, so the order rules are tested: search
// groups first (each up to 5 rows, "Show all {n}" expands to 50), then Commands — last and at most 3 when content
// matched, first and all of them otherwise — then the Ask AI row, always last. An empty query shows Recent items,
// Recent searches, then the commands.
import type { Command } from './commands';

export interface PaletteItem { id: string; label: string; detail?: string; icon?: string; run(): void }
export interface ResultGroup { provider: string; id: string; label: string; items: PaletteItem[] }
export interface RecentEntry { key: string; label: string; detail?: string; kind: 'lecture' | 'document' | 'note' | 'exam' | 'class'; route: unknown }

export type Row =
  | { type: 'command'; key: string; command: Command }
  | { type: 'result'; key: string; group: string; item: PaletteItem }
  | { type: 'more'; key: string; group: string; n: number }
  | { type: 'recent'; key: string; entry: RecentEntry }
  | { type: 'recentSearch'; key: string; query: string }
  | { type: 'ask'; key: string };

export interface Section { id: string; kind: 'results' | 'commands' | 'recent' | 'recentSearches' | 'ask'; label: string | null; rows: Row[]; total?: number }

export const GROUP_ROWS = 5;
export const GROUP_ROWS_ALL = 50;
export const COMMANDS_AFTER_CONTENT = 3;
export const RECENT_ITEMS = 8;
export const RECENT_SEARCHES = 5;

export interface PaletteInput {
  query: string;
  commands: readonly Command[];
  groups: readonly ResultGroup[];
  expanded: ReadonlySet<string>;
  recent: readonly RecentEntry[];
  recentSearches: readonly string[];
  /** Show the Ask AI row (always, once the query is not empty). */
  ask: boolean;
  labels: { commands: string; recent: string; recentSearches: string };
}

const groupKey = (g: ResultGroup) => `${g.provider}:${g.id}`;

export function buildSections(p: PaletteInput): Section[] {
  const q = p.query.trim();
  const out: Section[] = [];
  if (!q) {
    if (p.recent.length) {
      out.push({ id: 'recent', kind: 'recent', label: p.labels.recent, rows: p.recent.slice(0, RECENT_ITEMS).map((entry) => ({ type: 'recent', key: `recent:${entry.key}`, entry })) });
    }
    if (p.recentSearches.length) {
      out.push({ id: 'recentSearches', kind: 'recentSearches', label: p.labels.recentSearches, rows: p.recentSearches.slice(0, RECENT_SEARCHES).map((query) => ({ type: 'recentSearch', key: `rs:${query}`, query })) });
    }
    if (p.commands.length) out.push({ id: 'commands', kind: 'commands', label: p.labels.commands, rows: p.commands.map((command) => ({ type: 'command', key: `cmd:${command.id}`, command })) });
    return out;
  }
  const content = p.groups.filter((g) => g.items.length > 0);
  for (const g of content) {
    const k = groupKey(g);
    const max = p.expanded.has(k) ? GROUP_ROWS_ALL : GROUP_ROWS;
    const rows: Row[] = g.items.slice(0, max).map((item) => ({ type: 'result', key: `res:${k}:${item.id}`, group: k, item }));
    if (g.items.length > max && max === GROUP_ROWS) rows.push({ type: 'more', key: `more:${k}`, group: k, n: g.items.length });
    out.push({ id: k, kind: 'results', label: g.label, rows, total: g.items.length });
  }
  if (p.commands.length) {
    const list = content.length ? p.commands.slice(0, COMMANDS_AFTER_CONTENT) : p.commands;
    const section: Section = { id: 'commands', kind: 'commands', label: p.labels.commands, rows: list.map((command) => ({ type: 'command', key: `cmd:${command.id}`, command })) };
    out.push(section);
  }
  if (p.ask) out.push({ id: 'ask', kind: 'ask', label: null, rows: [{ type: 'ask', key: 'ask' }] });
  return out;
}

/** The selectable rows in order (the keyboard's list). */
export const flatRows = (sections: readonly Section[]): Row[] => sections.flatMap((s) => s.rows);

/** Whether the query found nothing at all (the "Nothing found" state). */
export const nothingFound = (query: string, sections: readonly Section[]): boolean =>
  query.trim() !== '' && !sections.some((s) => s.kind === 'results' || s.kind === 'commands');

/** The recent searches after running `q`: newest first, no duplicates (accents and case kept), at most 5. */
export function pushRecentSearch(list: readonly string[], q: string): string[] {
  const t = q.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!t) return [...list];
  return [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_SEARCHES);
}

/** The recent items after opening `entry`: newest first, one per key, at most 8. */
export function pushRecent(list: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...list.filter((x) => x.key !== entry.key)].slice(0, RECENT_ITEMS);
}
