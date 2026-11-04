// The search provider of the palette (UX §3.13; registry PALETTE_PROVIDERS). Results come from SearchService
// (the class PassageIndex: lectures with the effective transcript, documents, notes, exam questions) plus a Chat
// group from ChatService (chat is not in the passage index). Rows navigate: a document at its page and quote, a
// lecture at the time (Enter plays, Shift+Enter does not), a note, an exam question, a chat message.
//
// The frozen PaletteGroup shape (label, detail, icon, run) is always filled, so the palette frame of M0 shows
// usable rows. The richer fields UX §3.13 needs (kind, snippet marks, locator, class chip, aria-label, "Show all",
// the indexing line, recent items and searches, the Ask AI row with its own test id) ride along as extra fields
// (`PaletteResultItem`, `PaletteResultGroup`) for the frame to render — contract change requested from UI-SHELL.
import { isUiLocale } from '../../core/i18n/languages';
import { DateTime } from 'luxon';
import type { AppServices } from '../../services/types/common';
import type { Route } from '../../shell/routes';
import { makeI18n } from '../../ui/i18n';
import type { PaletteGroup } from '../registry';
import {
  GROUP_ICON, GROUP_ID, PER_GROUP, chatRows, groupRows, parseRecentItems, parseRecentSearches, pushRecentItem, pushRecentSearch, rowOf,
  type ChatLike, type RecentItem, type ResultKind, type ResultRow,
} from './model';
import { navigate } from './navigate';

/** One palette row with the extra fields of UX §3.13 (the frozen PaletteGroup item fields are always set). */
export interface PaletteResultItem {
  id: string; label: string; detail?: string; icon?: string; run(): void;
  kind: ResultKind | 'ask' | 'recent' | 'recentSearch';
  /** data-testid for the frame (`palette-result`, `palette-ask`, `palette-recent`). */
  testid: string;
  classId?: string;
  /** "p. 9 · art. 18.º", "41:12", "Bruno, 2 Nov". */
  locator?: string;
  /** The snippet in the reading font with the hits as [start, end) offsets (`mark.cite`). */
  snippet?: { text: string; marks: Array<[number, number]> };
  private?: boolean;
  /** "{kind}: {title}, {locator}. {snippet without marks}". */
  ariaLabel: string;
  /** Shift+Enter (a lecture opens without playing). */
  runAlt?(): void;
  /** Ctrl/⌘+Enter on the Ask AI row. */
  shortcut?: string;
}

export interface PaletteResultGroup {
  id: string; label: string; items: PaletteResultItem[];
  kind: ResultKind | 'ask' | 'recent' | 'recentSearches' | 'none';
  /** All results of the group (the items hold the first 5); with `more`, "Show all {n}" (`palette-more`). */
  total?: number;
  more?(): PaletteResultItem[];
  /** A line under the input (`palette-indexing`): "Still reading {n} files; results may be incomplete." */
  notice?: string;
  /** No results: the body "Try fewer words, or search all classes." (`palette-empty`). */
  empty?: { title: string; body: string };
}

/** The search context the palette frame passes (`classId` frozen; the others requested from UI-SHELL). */
export interface SearchContext {
  classId: string | null;
  /** Tab / the chip: "In {class}" or "All classes" (default: the class when there is one). */
  scope?: 'class' | 'all';
  includeArchived?: boolean;
  /** The router's go (rows navigate through it when given). */
  go?: (route: Route) => void;
}

const RECENT_ITEMS_KEY = 'tramado.search.recentItems';
/** How long a query waits for a class that is still reading its files. */
const SETTLE_WAIT_MS = 1500;

function readRecentItems(): RecentItem[] {
  try {
    return parseRecentItems(localStorage.getItem(RECENT_ITEMS_KEY));
  } catch {
    return [];
  }
}
function writeRecentItems(items: RecentItem[]) {
  try {
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(items));
  } catch {
    // per-device convenience only
  }
}

export default function provider(services: AppServices) {
  const i18n = () => {
    const l = services.ctx.prefs.get('ui.locale');
    return makeI18n(isUiLocale(l) ? l : 'en');
  };

  const remember = (q: string, row: Pick<RecentItem, 'kind' | 'classId' | 'title' | 'locator' | 'private' | 'route'>) => {
    writeRecentItems(pushRecentItem(readRecentItems(), { ...row, at: services.ctx.clock.now() }));
    if (q.trim().length >= 2) {
      const next = pushRecentSearch(parseRecentSearches(services.ctx.prefs.get('search.recent')), q);
      void services.ctx.prefs.set('search.recent', JSON.stringify(next)).catch(() => undefined);
    }
  };

  function classLabel(classId: string): { short: string; name: string } {
    const c = services.library.classes.get().find((x) => x.id === classId);
    return { short: c?.shortName ?? '', name: c?.name ?? '' };
  }

  function item(q: string, r: ResultRow, all: boolean, go: SearchContext['go']): PaletteResultItem {
    const { t } = i18n();
    const kindLabel = t(`search.kinds.${r.kind}`);
    const cls = all ? classLabel(r.classId).short : '';
    const where = [cls, r.locator].filter(Boolean).join(' · ');
    const snippetText = r.snippet.text;
    const open = (route: Route) => () => {
      remember(q, { kind: r.kind, classId: r.classId, title: r.title, locator: r.locator, private: r.private, route: r.kind === 'lecture' ? r.altRoute : r.route });
      navigate(route, go);
    };
    return {
      id: r.id, label: r.title || kindLabel, detail: [where, r.kind === 'chat' ? '' : snippetText].filter(Boolean).join(' · '), icon: r.private ? 'lock' : GROUP_ICON[r.kind],
      run: open(r.route), runAlt: open(r.altRoute),
      kind: r.kind, testid: 'palette-result', classId: r.classId, locator: r.locator, snippet: r.snippet, private: r.private,
      ariaLabel: t('search.result', { kind: kindLabel, title: r.title || kindLabel, where: where || '—', snippet: snippetText }),
    };
  }

  function askItem(q: string, scopeClass: string | null, go: SearchContext['go']): PaletteResultItem {
    const { t } = i18n();
    const s = services.ai.settings.get();
    const on = s.enabled && s.key.set;
    if (!on) {
      const label = t('search.askAiOff');
      return { id: 'ask', label, icon: 'sparkles', kind: 'ask', testid: 'palette-ask', ariaLabel: label, run: () => void navigate({ name: 'settings', section: 'ai' }, go) };
    }
    const label = scopeClass
      ? t('search.askAi', { q: q.trim(), scope: classLabel(scopeClass).short || classLabel(scopeClass).name })
      : t('search.askAiAll', { q: q.trim() });
    const route: Route = scopeClass ? { name: 'class', classId: scopeClass, tab: 'ask', query: q.trim() } : { name: 'ask', query: q.trim() };
    return { id: 'ask', label, icon: 'sparkles', kind: 'ask', testid: 'palette-ask', ariaLabel: label, shortcut: 'Mod+Enter', run: () => void navigate(route, go) };
  }

  /** Classes in scope: one class, or every class (archived ones only when asked). */
  function scopeClasses(ctx: SearchContext): string[] {
    const scope = ctx.scope ?? (ctx.classId ? 'class' : 'all');
    if (scope === 'class' && ctx.classId) return [ctx.classId];
    return services.library.classes.get().filter((c) => ctx.includeArchived || !c.archived).map((c) => c.id);
  }

  function indexingNotice(classIds: string[]): string | undefined {
    let pending = 0;
    for (const id of classIds) {
      try {
        const st = services.search.status(id).get();
        if (st.state === 'building' || st.pending > 0) pending += st.pending;
      } catch {
        // a class without an index yet
      }
    }
    const ex = services.extraction.status.get();
    pending = Math.max(pending, ex.running + ex.queued);
    return pending > 0 ? i18n().tp('search.indexing', pending) : undefined;
  }

  function chatResults(classIds: string[], q: string): ResultRow[] {
    const { meta } = i18n();
    const zone = 'local';
    const out: ResultRow[] = [];
    for (const id of classIds) {
      const cls = services.library.classes.get().find((c) => c.id === id);
      if (!cls?.shared) continue;
      let items: readonly ChatLike[] = [];
      try {
        items = services.forClass(id).chat.view.get().items.map((m) => ({ id: m.id, text: m.text, kind: m.kind, deleted: m.deleted, at: m.at, author: { memberName: m.author.memberName, self: m.author.self }, mentions: m.mentions }));
      } catch {
        items = [];
      }
      out.push(...chatRows(id, items, q, (m) => {
        const dt = DateTime.fromISO(m.at, { zone }).setLocale(meta.bcp47);
        return i18n().t('search.chatWhere', { name: m.author.memberName, date: dt.isValid ? dt.toLocaleString({ day: 'numeric', month: 'short' }) : '' });
      }));
    }
    return out;
  }

  function recentGroups(go: SearchContext['go']): PaletteResultGroup[] {
    const { t } = i18n();
    const groups: PaletteResultGroup[] = [];
    const known = new Set(services.library.classes.get().map((c) => c.id));
    const items = readRecentItems().filter((r) => known.has(r.classId));
    if (items.length) {
      groups.push({
        id: 'recent', kind: 'recent', label: t('search.groups.recent'),
        items: items.map((r, i) => ({
          id: `recent:${i}`, label: r.title || t(`search.kinds.${r.kind}`), detail: [classLabel(r.classId).short, r.locator].filter(Boolean).join(' · '),
          icon: r.private ? 'lock' : GROUP_ICON[r.kind], kind: 'recent' as const, testid: 'palette-recent', classId: r.classId, locator: r.locator, private: r.private,
          ariaLabel: t('search.result', { kind: t(`search.kinds.${r.kind}`), title: r.title, where: r.locator || classLabel(r.classId).short, snippet: '' }),
          run: () => {
            writeRecentItems(pushRecentItem(readRecentItems(), { ...r, at: services.ctx.clock.now() }));
            navigate(r.route, go);
          },
        })),
      });
    }
    const searches = parseRecentSearches(services.ctx.prefs.get('search.recent'));
    if (searches.length) {
      groups.push({
        id: 'recentSearches', kind: 'recentSearches', label: t('search.groups.recentSearches'),
        items: searches.map((s, i) => ({ id: `recentSearch:${i}`, label: s, icon: 'history', kind: 'recentSearch' as const, testid: 'palette-recent', ariaLabel: s, run: () => undefined })),
      });
    }
    return groups;
  }

  return {
    id: 'search',
    async search(q: string, ctx: SearchContext, signal: AbortSignal): Promise<PaletteGroup[]> {
      const { t } = i18n();
      const go = ctx.go;
      const query = q.trim();
      if (query.length < 2) return recentGroups(go) as PaletteGroup[];
      const classIds = scopeClasses(ctx);
      const all = (ctx.scope ?? (ctx.classId ? 'class' : 'all')) === 'all';
      const scopeArg = !all && ctx.classId ? ctx.classId : 'all';
      // A class still reading its files: give the index a moment (the palette shows the indexing line otherwise).
      if (indexingNotice(classIds) && services.search.settled) {
        const wait = Promise.all((scopeArg === 'all' ? classIds : [scopeArg]).map((id) => services.search.settled!(id).catch(() => undefined)));
        await Promise.race([wait, new Promise((r) => setTimeout(r, SETTLE_WAIT_MS))]);
        if (signal.aborted) return [];
      }
      let passages: Awaited<ReturnType<AppServices['search']['passages']>> = [];
      try {
        if (scopeArg === 'all' && ctx.includeArchived) {
          for (const id of classIds) passages.push(...(await services.search.passages(id, query, { limit: 60 })));
          passages.sort((a, b) => b.score - a.score);
        } else passages = await services.search.passages(scopeArg, query, { limit: 120 });
      } catch {
        passages = [];
      }
      if (signal.aborted) return [];
      const lang = services.ctx.prefs.get('ui.locale') || 'en';
      const rows = passages.map((p) => rowOf(p, lang)).filter((r): r is ResultRow => !!r && classIds.includes(r.classId));
      // Lecture titles come from the passages; fill any missing one from the lecture list.
      for (const r of rows) {
        if (r.kind !== 'lecture' || r.title) continue;
        try {
          r.title = services.forClass(r.classId).lectures.list.get().find((l) => r.route.name === 'lecture' && l.id === r.route.lectureId)?.title ?? '';
        } catch {
          // keep the kind as the label
        }
      }
      rows.push(...chatResults(classIds, query));
      const grouped = groupRows(rows);
      const notice = indexingNotice(classIds);
      const out: PaletteResultGroup[] = grouped.map((g) => {
        const items = g.rows.map((r) => item(query, r, all, go));
        return {
          id: GROUP_ID[g.kind], kind: g.kind, label: t(`search.groups.${GROUP_ID[g.kind]}`), items: items.slice(0, PER_GROUP), total: items.length,
          ...(items.length > PER_GROUP ? { more: () => items } : {}),
        };
      });
      if (!out.length) {
        out.push({
          id: 'none', kind: 'none', label: t('search.none.title', { q: query }), items: [], empty: { title: t('search.none.title', { q: query }), body: t('search.none.body') },
        });
      }
      if (notice) out[0] = { ...out[0]!, notice };
      out.push({ id: 'ask', kind: 'ask', label: '', items: [askItem(query, all ? null : ctx.classId, go)] });
      return out as PaletteGroup[];
    },
  };
}
