// The left rail (UX §2.3): brand, search, Today, the classes (with RAIL_BADGES), New class, Join, the
// Archive disclosure, then Settings, the two pills, collapse and the version. M0 builds it; UI-SHELL owns
// it in wave 2 (context menu, Move up/down, Ctrl+1…9 live in Layout's key handler).
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, HardDrive, LogIn, Plus, RefreshCw, Search, Settings, Sun, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { AppServices } from '../services/types/common';
import type { ClassView } from '../services/types/viewModels';
import type { ReadableStore } from '../services/store';
import { RAIL_BADGES } from '../features/registry';
import { IconButton } from '../ui/components/Button';
import { Badge } from '../ui/components/Feedback';
import { Tooltip } from '../ui/components/Tooltip';
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

/** The right slot of a class row: the first of UX §2.3's list that applies, with its status words. */
function slotOf(c: ClassView, badges: BadgeValue[], { t, tp }: Pick<I18n, 't' | 'tp'>): { node: React.ReactNode; status: string } | null {
  const rec = badges.find((b) => b?.tone === 'danger');
  if (rec || c.recordingBy) return { node: <span className="rec-dot" aria-hidden />, status: t('app.rail.classStatus.recording') };
  if (c.mentions > 0) return { node: <Badge tone="info">@{c.mentions}</Badge>, status: tp('app.rail.classStatus.mentions', c.mentions) };
  const other = badges.find((b) => b && b.count > 0);
  const unread = c.unread || other?.count || 0;
  if (unread > 0) return { node: <Badge tone={other?.tone === 'info' ? 'info' : 'neutral'}>{unread > 99 ? '99+' : unread}</Badge>, status: tp('app.rail.classStatus.unread', unread) };
  if (c.sync.kind === 'syncing') return { node: <RefreshCw size={10} className="rail__slot-icon rail__slot-icon--accent" aria-hidden />, status: t('app.rail.classStatus.syncing') };
  if (c.sync.kind === 'problems' || c.sync.kind === 'missingFolder') return { node: <TriangleAlert size={14} className="rail__slot-icon rail__slot-icon--warning" aria-hidden />, status: t('app.rail.classStatus.problem') };
  if (!c.shared) return { node: <HardDrive size={14} className="rail__slot-icon" aria-hidden />, status: t('app.rail.classStatus.local') };
  return null;
}

function ClassRow({ c, current, services, factories, narrow }: { c: ClassView; current: boolean; services: AppServices; factories: BadgeFactory[]; narrow: boolean }) {
  const i18n = useI18n();
  const { go } = useRouter();
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
  const slot = c.archived ? null : slotOf(c, [b0, b1], i18n);
  const label = slot ? `${c.name}, ${slot.status}` : c.name;
  return (
    <li>
      <Tooltip label={label} side="right">
        <button
          type="button"
          className={cx('rail__item', 'rail__class', current && 'rail__item--current')}
          aria-current={current ? 'page' : undefined}
          aria-label={label}
          onClick={() => go({ name: 'class', classId: c.id })}
          data-testid="rail-class"
          data-class-id={c.id}
        >
          <ClassTab color={c.color} icon={c.icon} size="md" filled={current} />
          <span className="rail__label rail__class-name">{c.name}</span>
          {slot && !narrow ? <span className="rail__slot">{slot.node}</span> : null}
        </button>
      </Tooltip>
    </li>
  );
}

function NavItem({ icon: Icon, label, current, onClick, testid, shortcut }: { icon: LucideIcon; label: string; current?: boolean; onClick(): void; testid: string; shortcut?: string }) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="right">
      <button type="button" className={cx('rail__item', current && 'rail__item--current')} aria-current={current ? 'page' : undefined} aria-label={label} onClick={onClick} data-testid={testid}>
        <Icon size={18} strokeWidth={1.75} aria-hidden />
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
  const { route, go } = useRouter();
  const dialogs = useDialogs();
  const classes = useStore(services.library.classes);
  const factories = useBadgeFactories();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const active = classes.filter((c) => !c.archived);
  const archived = classes.filter((c) => c.archived);
  const currentClass = 'classId' in route ? route.classId : null;
  const row = (c: ClassView) => <ClassRow key={c.id} c={c} current={c.id === currentClass} services={services} factories={factories} narrow={narrow} />;
  return (
    <aside className="rail" aria-label={t('app.rail.label')} data-testid="rail">
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
            <NavItem icon={Sun} label={t('app.rail.today')} current={route.name === 'today'} onClick={() => go({ name: 'today' })} testid="nav-today" />
          </li>
        </ul>
      </div>
      <div className="rail__scroll">
        <div className="rail__group">
          <div className="rail__group-head">
            <span className="rail__group-label">{t('app.rail.classes')}</span>
            {narrow ? null : <IconButton icon={Plus} size="sm" label={t('app.rail.newClass')} onClick={() => dialogs.open('new-class', {})} data-testid="rail-new-class" />}
          </div>
          <nav aria-label={t('app.rail.classesLabel')}>
            <ul className="rail__list">{active.map(row)}</ul>
          </nav>
          <ul className="rail__list rail__list--actions">
            <li>
              <NavItem icon={Plus} label={t('app.rail.newClass')} onClick={() => dialogs.open('new-class', {})} testid="rail-new-class-row" />
            </li>
            <li>
              <NavItem icon={LogIn} label={t('app.rail.join')} onClick={() => dialogs.open('join', {})} testid="rail-join" />
            </li>
          </ul>
        </div>
        {archived.length > 0 ? (
          <div className="rail__group">
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
            {archiveOpen ? <ul className="rail__list" data-testid="rail-archive-list">{archived.map(row)}</ul> : null}
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
    </aside>
  );
}
