// The left rail (UX §2.3): brand, search, Today, the classes (status slot from the class views and RAIL_BADGES,
// context menu, manual order with Alt+Shift+↑/↓), New class, Join, the Archive disclosure, then Settings, the two
// pills, collapse and the version.
import React, { useEffect, useState } from 'react';
import {
  Archive, ArchiveRestore, ArrowDown, ArrowUp, CheckCheck, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleDot, FolderSync, HardDrive,
  LogIn, Plus, RefreshCw, Search, Settings, Settings2, SquareArrowOutUpRight, Sun, TriangleAlert, UserPlus, type LucideIcon,
} from 'lucide-react';
import type { AppServices } from '../services/types/common';
import type { ClassView } from '../services/types/viewModels';
import type { ReadableStore } from '../services/store';
import { RAIL_BADGES } from '../features/registry';
import { IconButton } from '../ui/components/Button';
import { Badge } from '../ui/components/Feedback';
import { Menu, type MenuEntry } from '../ui/components/Menu';
import { pointRect, type Rect } from '../ui/position';
import { Tooltip } from '../ui/components/Tooltip';
import { useToast } from '../ui/components/Toast';
import { ClassTab } from '../ui/tramado/ClassTab';
import { useI18n, type I18n } from '../ui/i18n';
import { cx } from '../ui/cx';
import { Brand, BrandMark } from './BrandMark';
import { useKeyLabel } from './keys';
import { useRouter } from './router';
import { useStore } from './useStore';
import { useDialogs } from './useDialogs';
import { SyncPill } from './SyncPill';
import { AiPill } from './AiPill';

type BadgeValue = { count: number; tone: 'neutral' | 'info' | 'danger' } | null;
type BadgeFactory = (s: AppServices, classId: string) => ReadableStore<BadgeValue>;

/** The registry's badge factories, loaded once. */
function useBadgeFactories(): BadgeFactory[] {
  const [list, setList] = useState<BadgeFactory[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(RAIL_BADGES.map((l) => l().then((m) => m.default))).then((fs) => live && setList(fs), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  return list;
}

const NULL_BADGE: ReadableStore<BadgeValue> = { get: () => null, subscribe: () => () => undefined };

export type RailSlot = { kind: 'rec' | 'mentions' | 'unread' | 'syncing' | 'problem' | 'local'; n?: number; tone?: 'neutral' | 'info' };

/**
 * The right slot of a class row: the first of UX §2.3's list that applies. `recordingHere`: this computer records
 * this class; `badges`: the RAIL_BADGES stores' values (a `danger` badge is "recording now").
 */
export function railSlot(c: ClassView, badges: readonly BadgeValue[], recordingHere: boolean): RailSlot | null {
  if (c.archived) return null;
  if (recordingHere || c.recordingBy || badges.some((b) => b?.tone === 'danger')) return { kind: 'rec' };
  if (c.mentions > 0) return { kind: 'mentions', n: c.mentions };
  const other = badges.find((b) => b && b.tone !== 'danger' && b.count > 0);
  const unread = Math.max(c.unread, other?.count ?? 0);
  if (unread > 0) return { kind: 'unread', n: unread, tone: other?.tone === 'info' ? 'info' : 'neutral' };
  if (c.sync.kind === 'syncing') return { kind: 'syncing' };
  if (c.sync.kind === 'problems' || c.sync.kind === 'missingFolder') return { kind: 'problem' };
  if (!c.shared) return { kind: 'local' };
  return null;
}

function slotStatus(s: RailSlot, { t, tp }: Pick<I18n, 't' | 'tp'>): string {
  switch (s.kind) {
    case 'rec':
      return t('app.rail.classStatus.recording');
    case 'mentions':
      return tp('app.rail.classStatus.mentions', s.n ?? 0);
    case 'unread':
      return tp('app.rail.classStatus.unread', s.n ?? 0);
    case 'syncing':
      return t('app.rail.classStatus.syncing');
    case 'problem':
      return t('app.rail.classStatus.problem');
    default:
      return t('app.rail.classStatus.local');
  }
}

function SlotView({ s }: { s: RailSlot }) {
  switch (s.kind) {
    case 'rec':
      return <span className="rec-dot" aria-hidden />;
    case 'mentions':
      return <Badge tone="info">@{s.n}</Badge>;
    case 'unread':
      return <Badge tone={s.tone ?? 'neutral'}>{(s.n ?? 0) > 99 ? '99+' : s.n}</Badge>;
    case 'syncing':
      return <RefreshCw size={12} strokeWidth={2} className="rail__slot-icon rail__slot-icon--accent spin" aria-hidden />;
    case 'problem':
      return <TriangleAlert size={14} strokeWidth={1.75} className="rail__slot-icon rail__slot-icon--warning" aria-hidden />;
    default:
      return <HardDrive size={14} strokeWidth={1.75} className="rail__slot-icon" aria-hidden />;
  }
}

interface RowProps {
  c: ClassView;
  current: boolean;
  services: AppServices;
  factories: BadgeFactory[];
  narrow: boolean;
  recordingHere: boolean;
  index: number;
  count: number;
  onMove(classId: string, delta: -1 | 1): void;
}

function ClassRow({ c, current, services, factories, narrow, recordingHere, index, count, onMove }: RowProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const dialogs = useDialogs();
  const toast = useToast();
  const [stores] = useState(() => new Map<BadgeFactory, ReadableStore<BadgeValue>>());
  const storeOf = (f: BadgeFactory) => {
    let s = stores.get(f);
    if (!s) {
      try {
        s = f(services, c.id);
      } catch {
        s = NULL_BADGE;
      }
      stores.set(f, s);
    }
    return s;
  };
  const b0 = useStore(factories[0] ? storeOf(factories[0]) : NULL_BADGE);
  const b1 = useStore(factories[1] ? storeOf(factories[1]) : NULL_BADGE);
  const slot = railSlot(c, [b0, b1], recordingHere);
  // The row's context menu (right-click, the Menu key or Shift+F10).
  const [menuAt, setMenuAt] = useState<Rect | null>(null);
  const [entries, setEntries] = useState<MenuEntry[]>([]);
  const openMenu = (r: Rect) => {
    setEntries(items());
    setMenuAt(r);
  };
  const label = slot ? `${c.name}, ${slotStatus(slot, i18n)}` : c.name;
  const archive = async (on: boolean) => {
    try {
      await services.library.archive(c.id, on);
      toast.show({
        message: t(on ? 'classes.archived' : 'classes.unarchived', { class: c.shortName }),
        action: { label: t('common.undo'), run: () => services.library.archive(c.id, !on), testId: 'toast-undo' },
      });
    } catch (e) {
      toast.error(e);
    }
  };
  const items = (): MenuEntry[] => [
    { id: 'open', label: t('app.rail.classMenu.open'), icon: SquareArrowOutUpRight, onSelect: () => go({ name: 'class', classId: c.id }), testId: 'rail-class-menu-open' },
    ...(c.archived
      ? []
      : ([
          { id: 'record', label: t('app.rail.classMenu.record'), icon: CircleDot, onSelect: () => dialogs.open('record', { classId: c.id }), testId: 'rail-class-menu-record' },
          c.shared
            ? { id: 'invite', label: t('app.rail.classMenu.invite'), icon: UserPlus, onSelect: () => dialogs.open('invite', { classId: c.id }), testId: 'rail-class-menu-invite' }
            : { id: 'share', label: t('app.rail.classMenu.share'), icon: FolderSync, onSelect: () => go({ name: 'class', classId: c.id, tab: 'share' }), testId: 'rail-class-menu-share' },
          { kind: 'separator' },
          { id: 'up', label: t('app.rail.classMenu.moveUp'), icon: ArrowUp, hint: 'Alt+Shift+↑', disabled: index === 0, onSelect: () => onMove(c.id, -1), testId: 'rail-class-menu-up' },
          { id: 'down', label: t('app.rail.classMenu.moveDown'), icon: ArrowDown, hint: 'Alt+Shift+↓', disabled: index >= count - 1, onSelect: () => onMove(c.id, 1), testId: 'rail-class-menu-down' },
          ...(c.shared ? [{ id: 'read', label: t('app.rail.classMenu.markRead'), icon: CheckCheck, disabled: c.unread === 0 && c.mentions === 0, onSelect: () => services.forClass(c.id).chat.markRead(), testId: 'rail-class-menu-read' }] : []),
          { kind: 'separator' },
        ] as MenuEntry[])),
    { id: 'settings', label: t('app.rail.classMenu.settings'), icon: Settings2, onSelect: () => dialogs.open('class-settings', { classId: c.id }), testId: 'rail-class-menu-settings' },
    c.archived
      ? { id: 'unarchive', label: t('app.rail.classMenu.unarchive'), icon: ArchiveRestore, onSelect: () => void archive(false), testId: 'rail-class-menu-archive' }
      : { id: 'archive', label: t('app.rail.classMenu.archive'), icon: Archive, onSelect: () => void archive(true), testId: 'rail-class-menu-archive' },
  ];
  return (
    <li>
        <Tooltip label={label} side="right">
          <button
            type="button"
            className={cx('rail__item', 'rail__class', current && 'rail__item--current', c.archived && 'rail__class--archived')}
            aria-current={current ? 'page' : undefined}
            aria-label={label}
            aria-haspopup="menu"
            onClick={() => go({ name: 'class', classId: c.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(pointRect(e.clientX, e.clientY));
            }}
            onKeyDown={(e) => {
              if (e.altKey && e.shiftKey && !c.archived && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                onMove(c.id, e.key === 'ArrowUp' ? -1 : 1);
              } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                openMenu({ top: r.top, left: r.left + 12, width: 0, height: r.height });
              }
            }}
            data-testid="rail-class"
            data-class-id={c.id}
            data-slot={slot?.kind}
          >
            <ClassTab color={c.color} icon={c.icon} size="md" filled={current} />
            <span className="rail__label rail__class-name">{c.name}</span>
            {slot && !narrow ? (
              <span className="rail__slot">
                <SlotView s={slot} />
              </span>
            ) : null}
            {slot && narrow && slot.kind !== 'local' ? <span className={cx('rail__dot', `rail__dot--${slot.kind}`)} aria-hidden /> : null}
          </button>
        </Tooltip>
        <Menu open={menuAt !== null} onClose={() => setMenuAt(null)} anchor={menuAt} items={entries} label={c.name} data-testid="rail-class-menu" />
    </li>
  );
}

function NavItem({ icon: Icon, label, current, onClick, testid, shortcut }: { icon: LucideIcon; label: string; current?: boolean; onClick(): void; testid: string; shortcut?: string }) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="right">
      <button type="button" className={cx('rail__item', current && 'rail__item--current')} aria-current={current ? 'page' : undefined} aria-label={label} onClick={onClick} data-testid={testid}>
        <Icon size={17} strokeWidth={1.75} aria-hidden />
        <span className="rail__label">{label}</span>
      </button>
    </Tooltip>
  );
}

export interface RailProps {
  services: AppServices;
  version: string;
  collapsed: boolean;
  /** Collapsed by choice or forced by a narrow window: names hide, tooltips carry them. */
  narrow: boolean;
  onToggleCollapsed(): void;
  onSearch(): void;
}

export function Rail({ services, version, collapsed, narrow, onToggleCollapsed, onSearch }: RailProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const key = useKeyLabel();
  const toast = useToast();
  const { route, go } = useRouter();
  const dialogs = useDialogs();
  const classes = useStore(services.library.classes);
  const recording = useStore(services.recording.state);
  const factories = useBadgeFactories();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const active = classes.filter((c) => !c.archived);
  const archived = classes.filter((c) => c.archived);
  const currentClass = 'classId' in route ? route.classId : null;
  const move = (classId: string, delta: -1 | 1) => {
    const ids = active.map((c) => c.id);
    const i = ids.indexOf(classId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void services.library
      .setOrder([...ids, ...archived.map((c) => c.id)])
      .then(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`.rail [data-testid="rail-class"][data-class-id="${classId}"]`)?.focus()))
      .catch((e: unknown) => toast.error(e));
  };
  const row = (c: ClassView, index: number, count: number) => (
    <ClassRow
      key={c.id}
      c={c}
      current={c.id === currentClass}
      services={services}
      factories={factories}
      narrow={narrow}
      recordingHere={recording?.classId === c.id}
      index={index}
      count={count}
      onMove={move}
    />
  );
  return (
    <nav className="rail" aria-label={t('app.rail.label')} data-testid="rail">
      <div className="rail__top">
        <div className="rail__brand">{narrow ? <BrandMark size={28} /> : <Brand size={28} />}</div>
        <Tooltip label={t('app.rail.search')} shortcut={key('K')} side="right">
          <button type="button" className="rail__search" onClick={onSearch} aria-label={narrow ? t('app.rail.search') : undefined} aria-keyshortcuts="Control+K" data-testid="rail-search">
            <Search size={15} strokeWidth={1.75} aria-hidden />
            <span className="rail__label">{t('app.rail.search')}</span>
            <kbd className="rail__kbd" aria-hidden="true">{key('K')}</kbd>
          </button>
        </Tooltip>
        <ul className="rail__list">
          <li>
            <NavItem icon={Sun} label={t('app.rail.today')} current={route.name === 'today'} onClick={() => go({ name: 'today' })} testid="nav-today" shortcut={key('H', { shift: true })} />
          </li>
        </ul>
      </div>
      <div className="rail__scroll">
        <div className="rail__group">
          <div className="rail__group-head">
            <span className="rail__group-label" id="rail-classes-label">{t('app.rail.classes')}</span>
            {narrow ? null : <IconButton icon={Plus} size="sm" label={t('app.rail.newClass')} onClick={() => dialogs.open('new-class', {})} tooltipSide="right" data-testid="rail-new-class" />}
          </div>
          <ul className="rail__list" aria-labelledby="rail-classes-label" data-testid="rail-classes">
            {active.map((c, i) => row(c, i, active.length))}
          </ul>
          <ul className="rail__list rail__list--actions">
            <li>
              <NavItem icon={Plus} label={t('app.rail.newClass')} onClick={() => dialogs.open('new-class', {})} testid="rail-new-class-row" />
            </li>
            <li>
              <NavItem icon={LogIn} label={t('app.rail.join')} onClick={() => dialogs.open('join', {})} testid="rail-join" shortcut={key('J', { shift: true })} />
            </li>
          </ul>
        </div>
        {archived.length > 0 ? (
          <div className="rail__group">
            <Tooltip label={t('app.rail.archive', { n: archived.length })} side="right">
              <button
                type="button"
                className="rail__item rail__disclosure"
                aria-expanded={archiveOpen}
                aria-label={t('app.rail.archive', { n: archived.length })}
                onClick={() => setArchiveOpen((o) => !o)}
                data-testid="rail-archive"
              >
                {archiveOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                <span className="rail__label">{t('app.rail.archive', { n: archived.length })}</span>
              </button>
            </Tooltip>
            {archiveOpen ? <ul className="rail__list" data-testid="rail-archive-list">{archived.map((c, i) => row(c, i, archived.length))}</ul> : null}
          </div>
        ) : null}
      </div>
      <div className="rail__foot">
        <ul className="rail__list">
          <li>
            <NavItem icon={Settings} label={t('app.rail.settings')} current={route.name === 'settings'} onClick={() => go({ name: 'settings' })} testid="nav-settings" shortcut={key(',')} />
          </li>
        </ul>
        <div className="rail__pills">
          <SyncPill services={services} compact={narrow} />
          <AiPill services={services} compact={narrow} />
        </div>
        <div className="rail__actions">
          <IconButton
            icon={collapsed ? ChevronsRight : ChevronsLeft}
            label={collapsed ? t('app.rail.expand') : t('app.rail.collapse')}
            onClick={onToggleCollapsed}
            size="sm"
            className="rail__collapse"
            tooltipSide="right"
            data-testid="rail-collapse"
          />
          <span className="rail__version" title={t('app.rail.version', { version })} data-testid="version">
            {version}
          </span>
        </div>
      </div>
    </nav>
  );
}
