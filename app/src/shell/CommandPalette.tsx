// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ported from Trama (app/src/shell/CommandPalette.tsx), MPL-2.0; extended for UX §2.9 and §3.13.
//
// The palette frame: a combobox over a listbox (`aria-activedescendant`), Tab trapped, #root inert. Search result
// groups come from PALETTE_PROVIDERS (UI-DOCS), the commands from the registry; this frame owns the layout, the
// scope chip (Tab toggles it), Recent and Recent searches, "Show all", the Ask AI row (Ctrl/⌘+Enter), the
// indexing line and the empty states.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ClipboardCheck, Clock, FileText, Files, History, ListFilter, MessagesSquare, Mic, NotebookPen, Search, Sparkles, AudioLines, type LucideIcon,
} from 'lucide-react';
import type { AppServices } from '../services/types/common';
import type { PaletteGroup } from '../features/registry';
import { cx } from '../ui/cx';
import { focusBackTo, pushLayer, trapTab } from '../ui/focus';
import { useI18n } from '../ui/i18n';
import { useToast } from '../ui/components/Toast';
import { Menu } from '../ui/components/Menu';
import { Button } from '../ui/components/Button';
import { ClassChip } from '../ui/tramado/ClassChip';
import { type Command, commands } from './commands';
import { useCommandsVersion } from './useCommands';
import { buildSections, flatRows, nothingFound, pushRecentSearch, type ResultGroup, type Row } from './paletteModel';
import { recentItems } from './recent';
import { useStore } from './useStore';
import { useRouter } from './router';
import type { Route } from './routes';
import { useAppState } from './AppState';
import { useKeyLabel } from './keys';
import './palette.css';

/** A search provider of the registry's PALETTE_PROVIDERS, already bound to the services. */
export interface PaletteProvider {
  id: string;
  search(q: string, ctx: { classId: string | null }, signal: AbortSignal): Promise<PaletteGroup[]>;
}

/** Lucide names a provider may give its rows (`PaletteGroup` items carry the name as a string). */
const ICONS: Record<string, LucideIcon> = {
  mic: Mic, 'audio-lines': AudioLines, 'file-text': FileText, files: Files, 'notebook-pen': NotebookPen, 'clipboard-list': ClipboardCheck,
  'clipboard-check': ClipboardCheck, 'messages-square': MessagesSquare, sparkles: Sparkles, search: Search,
};
const KIND_ICON: Record<string, LucideIcon> = { lecture: AudioLines, document: FileText, note: NotebookPen, exam: ClipboardCheck, class: Files };

export function CommandPalette({ open, onClose, providers, classId = null, services }: { open: boolean; onClose: () => void; providers?: PaletteProvider[]; classId?: string | null; services?: AppServices }) {
  if (!open) return null;
  return createPortal(<Palette onClose={onClose} providers={providers ?? []} classId={classId} services={services ?? null} />, document.body);
}

const NO_CLASSES = { get: () => [] as never[], subscribe: () => () => undefined };
const NO_STATUS = { get: () => ({ running: 0, queued: 0, bySha: {} }), subscribe: () => () => undefined };

function Palette({ onClose, providers, classId, services }: { onClose: () => void; providers: PaletteProvider[]; classId: string | null; services: AppServices | null }) {
  const { t, tp } = useI18n();
  const toast = useToast();
  const key = useKeyLabel();
  const { go } = useRouter();
  const { prefsStore, setPref } = useAppState();
  const version = useCommandsVersion();
  const classes = useStore(services ? services.library.classes : NO_CLASSES);
  const extraction = useStore(services ? services.extraction.status : NO_STATUS);
  const aiSettings = useStore(services ? services.ai.settings : { get: () => null, subscribe: () => () => undefined });
  const recent = useStore(recentItems);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(classId);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const scopeClass = scope ? classes.find((c) => c.id === scope) ?? null : null;
  const recentSearches = useMemo(() => {
    try {
      const v: unknown = JSON.parse(prefsStore?.get('search.recent') ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }, [prefsStore]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matched = useMemo(() => commands.search(query, 60), [query, version]);

  // Provider results (UX §3.13): as you type, debounced 80 ms.
  const [groups, setGroups] = useState<ResultGroup[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!providers.length || q.length < 2) {
      setGroups([]);
      return;
    }
    const ac = new AbortController();
    // `includeArchived` rides along for providers that read it (requested as a contract change of PaletteProvider ctx).
    const ctx = { classId: scope, includeArchived };
    const timer = setTimeout(() => {
      void Promise.all(providers.map((p) => p.search(q, ctx, ac.signal).then((gs) => gs.map((g) => ({ provider: p.id, ...g })), () => [] as ResultGroup[]))).then((lists) => {
        if (!ac.signal.aborted) setGroups(lists.flat());
      });
    }, 80);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query, providers, scope, includeArchived]);

  const aiReady = !!aiSettings && aiSettings.enabled && (aiSettings.key.set || !!aiSettings.customHost);
  const sections = useMemo(
    () =>
      buildSections({
        query, commands: matched, groups, expanded, recent: recent.filter((r) => !scope || (r.route as { classId?: string }).classId === scope || !(r.route as { classId?: string }).classId), recentSearches, ask: !!services,
        labels: { commands: t('search.groups.commands'), recent: t('search.groups.recent'), recentSearches: t('search.groups.recentSearches') },
      }),
    [query, matched, groups, expanded, recent, recentSearches, scope, services, t],
  );
  const rows = useMemo(() => flatRows(sections), [sections]);
  const empty = nothingFound(query, sections);
  const indexing = extraction.running + extraction.queued;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => setActive(0), [query, scope]);
  useEffect(() => {
    const opener = document.activeElement;
    const layer = pushLayer();
    const root = document.getElementById('root');
    const madeInert = root && !root.hasAttribute('inert');
    if (madeInert) root.setAttribute('inert', '');
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!layer.isTop()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && box.current && e.target !== input.current) trapTab(e, box.current);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      layer.pop();
      window.removeEventListener('keydown', onKey, true);
      if (madeInert) root.removeAttribute('inert');
      setTimeout(() => focusBackTo(opener), 0);
    };
  }, []);

  useEffect(() => {
    box.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const later = (f: () => unknown) => {
    onClose();
    // After the palette is gone, so whatever the command opens gets the focus.
    setTimeout(() => {
      void Promise.resolve()
        .then(f)
        .catch((e: unknown) => toast.error(e));
    }, 0);
  };
  const ask = () => {
    if (!services) return;
    const q = query.trim();
    if (!aiReady) {
      later(() => go({ name: 'settings', section: 'ai' }));
      return;
    }
    later(() => go(scope ? { name: 'class', classId: scope, tab: 'ask', ...(q ? { query: q } : {}) } : { name: 'ask', ...(q ? { query: q } : {}) }));
  };
  const runRow = (row: Row | undefined) => {
    if (!row) return;
    switch (row.type) {
      case 'command':
        later(row.command.run);
        return;
      case 'result':
        void setPref('search.recent', JSON.stringify(pushRecentSearch(recentSearches, query)));
        later(row.item.run);
        return;
      case 'more':
        setExpanded((s) => new Set([...s, row.group]));
        return;
      case 'recent':
        later(() => go(row.entry.route as Route));
        return;
      case 'recentSearch':
        setQuery(row.query);
        input.current?.focus();
        return;
      case 'ask':
        ask();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = rows.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n) setActive((a) => (a + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) setActive((a) => (a - 1 + n) % n);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ask();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runRow(rows[active]);
    } else if (e.key === 'Tab' && !e.shiftKey && classId) {
      // Tab toggles the scope between this class and all classes (UX §3.13).
      e.preventDefault();
      setScope((s) => (s ? null : classId));
    }
  };

  const scopeLabel = scopeClass ? t('search.scopeClass', { class: scopeClass.shortName }) : t('search.scopeAll');
  let index = -1;
  const rowEl = (row: Row) => {
    index += 1;
    const i = index;
    const isActive = i === active;
    const common = {
      id: `${listId}-${i}`,
      role: 'option' as const,
      'aria-selected': isActive,
      'data-row': i,
      className: cx('palette__item', isActive && 'palette__item--active'),
      onPointerMove: () => i !== active && setActive(i),
      onClick: () => runRow(row),
    };
    switch (row.type) {
      case 'command': {
        const c: Command = row.command;
        const Icon = c.icon;
        return (
          <div key={row.key} {...common} data-testid={`command-${c.id}`} data-index={i}>
            {Icon ? <Icon size={16} aria-hidden strokeWidth={1.75} /> : <span className="palette__noicon" />}
            <span className="palette__label">{c.label}</span>
            {c.shortcut ? <kbd className="kbd">{c.shortcut}</kbd> : null}
          </div>
        );
      }
      case 'result': {
        const Icon = row.item.icon ? ICONS[row.item.icon] : undefined;
        const kind = row.group.split(':').pop() ?? '';
        return (
          <div key={row.key} {...common} className={cx(common.className, 'palette__item--result')} data-testid="palette-result" data-kind={kind} data-index={i}>
            {Icon ? <Icon size={16} aria-hidden strokeWidth={1.75} /> : <span className="palette__noicon" />}
            <span className="palette__label">{row.item.label}</span>
            {row.item.detail ? <span className="palette__detail palette__snippet">{row.item.detail}</span> : null}
          </div>
        );
      }
      case 'more':
        return (
          <div key={row.key} {...common} className={cx(common.className, 'palette__item--more')} data-testid="palette-more" data-index={i}>
            <span className="palette__noicon" />
            <span className="palette__label">{t('search.showAll', { n: row.n })}</span>
          </div>
        );
      case 'recent': {
        const Icon = KIND_ICON[row.entry.kind] ?? History;
        const cls = classes.find((c) => c.id === (row.entry.route as { classId?: string }).classId);
        return (
          <div key={row.key} {...common} data-testid="palette-recent" data-index={i}>
            <Icon size={16} aria-hidden strokeWidth={1.75} />
            <span className="palette__label">{row.entry.label}</span>
            {cls && !scope ? <ClassChip cls={cls} short className="palette__chip" /> : null}
          </div>
        );
      }
      case 'recentSearch':
        return (
          <div key={row.key} {...common} data-testid="palette-recent-search" data-index={i}>
            <Clock size={16} aria-hidden strokeWidth={1.75} />
            <span className="palette__label">{row.query}</span>
          </div>
        );
      case 'ask':
        return (
          <div key={row.key} {...common} className={cx(common.className, 'palette__item--ask')} data-testid="palette-ask" data-index={i} data-ready={aiReady ? 'true' : 'false'}>
            <Sparkles size={16} aria-hidden strokeWidth={1.75} />
            <span className="palette__label">
              {aiReady ? (query.trim() ? t('search.askAi', { q: query.trim(), scope: scopeClass ? scopeClass.shortName : t('search.scopeAll') }) : t('app.commands.askAll')) : t('search.askAiOff')}
            </span>
            {aiReady ? <kbd className="kbd">{key('Enter')}</kbd> : null}
          </div>
        );
    }
  };

  return (
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="palette" role="dialog" aria-modal="true" aria-label={t('search.label')} data-testid="palette">
        <div className="palette__search">
          <Search size={18} aria-hidden strokeWidth={1.75} />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label={t('search.label')}
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            data-testid="palette-input"
          />
          {services ? (
            <span className="palette__scope">
              <button
                type="button"
                className={cx('palette__chip-btn', scope && 'palette__chip-btn--class')}
                onClick={() => setScope((s) => (s ? null : classId))}
                disabled={!classId}
                aria-label={`${scopeLabel} (Tab)`}
                data-testid="palette-scope"
                data-scope={scope ? 'class' : 'all'}
              >
                {scopeClass ? <ClassChip cls={scopeClass} short className="palette__chip" /> : null}
                {scopeClass ? null : <span>{scopeLabel}</span>}
              </button>
              <button
                ref={filterRef}
                type="button"
                className={cx('palette__filter', includeArchived && 'palette__filter--on')}
                aria-label={t('search.includeArchived')}
                aria-pressed={includeArchived}
                aria-haspopup="menu"
                onClick={() => setFilterOpen((o) => !o)}
                data-testid="palette-filter"
              >
                <ListFilter size={15} strokeWidth={1.75} aria-hidden />
              </button>
              <Menu
                open={filterOpen}
                onClose={() => setFilterOpen(false)}
                anchor={filterRef}
                align="end"
                label={t('search.includeArchived')}
                items={[{ id: 'archived', label: t('search.includeArchived'), checked: includeArchived, onSelect: () => setIncludeArchived((v) => !v), testId: 'palette-include-archived' }]}
              />
            </span>
          ) : null}
          <kbd className="kbd palette__esc" aria-hidden="true">Esc</kbd>
        </div>
        {indexing > 0 && query.trim() ? (
          <p className="palette__indexing" data-testid="palette-indexing" role="status">
            {tp('search.indexing', indexing, { n: indexing })}
          </p>
        ) : null}
        {empty ? (
          <div className="palette__empty" data-testid="palette-empty" role="status">
            <p className="palette__empty-title">{t('search.none.title', { q: query.trim() })}</p>
            {scope ? (
              <>
                <p className="palette__empty-body">{t('search.none.body')}</p>
                <div className="palette__empty-actions">
                  <Button size="sm" onClick={() => setScope(null)} data-testid="palette-search-all">
                    {t('search.none.all')}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="palette__list" role="listbox" id={listId} aria-label={t('search.label')}>
          {sections.map((s) => (
            <div key={s.id} role="group" aria-label={s.label ?? undefined} className={cx('palette__section', `palette__section--${s.kind}`)} data-testid={s.kind === 'results' ? 'palette-group' : undefined} data-kind={s.kind === 'results' ? s.id.split(':').pop() : undefined}>
              {s.label ? (
                <div className="palette__group" role="presentation">
                  <span>{s.label}</span>
                  {s.total !== undefined ? <span className="palette__count">{s.total}</span> : null}
                </div>
              ) : null}
              {s.rows.map(rowEl)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
