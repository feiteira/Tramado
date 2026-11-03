import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { cx } from '../ui/cx';
import { focusBackTo, pushLayer, trapTab } from '../ui/focus';
import { useI18n } from '../ui/i18n';
import { useToast } from '../ui/components/Toast';
import { type Command, commands } from './commands';
import { useCommandsVersion } from './useCommands';
import type { PaletteGroup } from '../features/registry';
import './palette.css';

/**
 * The command palette: type to find any command a screen or the shell registered, arrows to
 * choose, Enter to run. A combobox over a listbox, as screen readers expect.
 */
/** A search provider of the registry's PALETTE_PROVIDERS, already bound to the services. */
export interface PaletteProvider {
  id: string;
  search(q: string, ctx: { classId: string | null }, signal: AbortSignal): Promise<PaletteGroup[]>;
}

interface Item extends Command {
  detail?: string;
  /** A provider's result (`palette-result`) rather than a command. */
  result?: boolean;
}

export function CommandPalette({ open, onClose, providers, classId = null }: { open: boolean; onClose: () => void; providers?: PaletteProvider[]; classId?: string | null }) {
  if (!open) return null;
  return createPortal(<Palette onClose={onClose} providers={providers} classId={classId} />, document.body);
}

function Palette({ onClose, providers, classId }: { onClose: () => void; providers?: PaletteProvider[]; classId: string | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const version = useCommandsVersion();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matched = useMemo(() => commands.search(query, 60), [query, version]);
  // Provider results (UX §3.13) come after the commands, grouped by the provider's headings.
  const [found, setFound] = useState<Item[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!providers?.length || q.length < 2) {
      setFound([]);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all(providers.map((p) => p.search(q, { classId }, ac.signal).then((gs) => gs.map((g) => ({ p: p.id, g })), () => [])))
        .then((lists) => {
          if (ac.signal.aborted) return;
          setFound(lists.flat().flatMap(({ p, g }) => g.items.map((it) => ({ id: `${p}:${g.id}:${it.id}`, label: it.label, detail: it.detail, group: g.label, run: it.run, result: true }))));
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query, providers, classId]);
  const results: Item[] = useMemo(() => [...matched, ...found], [matched, found]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => setActive(0), [query]);
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
      } else if (e.key === 'Tab' && box.current) trapTab(e, box.current);
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
    box.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    onClose();
    // After the palette is gone, so whatever the command opens gets the focus.
    setTimeout(() => {
      void Promise.resolve()
        .then(cmd.run)
        .catch((e: unknown) => toast.error(e));
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = results.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n) setActive((a) => (a + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) setActive((a) => (a - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    }
  };

  // Group headings in the order the groups first appear.
  let lastGroup: string | undefined;
  return (
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="palette" role="dialog" aria-modal="true" aria-label={t('search.label')} data-testid="palette">
        <div className="palette__search">
          <Search size={17} aria-hidden strokeWidth={1.75} />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
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
        </div>
        <div className="palette__list" role="listbox" id={listId} aria-label={t('search.label')}>
          {results.length === 0 ? <p className="palette__empty">{t('search.none.title', { q: query })}</p> : null}
          {results.map((cmd, i) => {
            const heading = (!query || cmd.result) && cmd.group && cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            const Icon = cmd.icon;
            return (
              <React.Fragment key={cmd.id}>
                {heading ? <div className="palette__group" role="presentation">{heading}</div> : null}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  data-testid={cmd.result ? 'palette-result' : `command-${cmd.id}`}
                  className={cx('palette__item', i === active && 'palette__item--active')}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => run(cmd)}
                >
                  {Icon ? <Icon size={16} aria-hidden strokeWidth={1.75} /> : <span className="palette__noicon" />}
                  <span className="palette__label">{cmd.label}</span>
                  {cmd.detail ? <span className="palette__detail">{cmd.detail}</span> : null}
                  {cmd.shortcut ? <kbd className="kbd">{cmd.shortcut}</kbd> : null}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
