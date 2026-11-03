// The sync pill and its popover (UX §2.4). M0: the states come from SyncService.state and the class
// views (placeholder data until T-SYNC); UI-SHELL owns this file in wave 2. Sync never blocks anything.
import React, { useEffect, useRef, useState } from 'react';
import { CircleCheck, CirclePause, HardDrive, RefreshCw, TriangleAlert, Users, WifiOff, type LucideIcon } from 'lucide-react';
import type { AppServices } from '../services/types/common';
import type { ClassView } from '../services/types/viewModels';
import { Popover } from '../ui/components/Popover';
import { Switch } from '../ui/components/Choice';
import { Tooltip } from '../ui/components/Tooltip';
import { ClassTab } from '../ui/tramado/ClassTab';
import { useI18n, type I18n } from '../ui/i18n';
import { cx } from '../ui/cx';
import { useRouter } from './router';
import { useStore } from './useStore';
import { useAppState } from './AppState';
import { syncPillState, type SyncPillState } from './pills';

const ICON: Record<SyncPillState['id'], { icon: LucideIcon; tone: string; spin?: boolean }> = {
  local: { icon: HardDrive, tone: 'muted' },
  starting: { icon: RefreshCw, tone: 'accent', spin: true },
  error: { icon: TriangleAlert, tone: 'danger' },
  paused: { icon: CirclePause, tone: 'muted' },
  attention: { icon: TriangleAlert, tone: 'warning' },
  offline: { icon: WifiOff, tone: 'muted' },
  syncing: { icon: RefreshCw, tone: 'accent', spin: true },
  waiting: { icon: Users, tone: 'muted' },
  upToDate: { icon: CircleCheck, tone: 'success' },
};

export function syncPillLabel(s: SyncPillState, { t, tp }: Pick<I18n, 't' | 'tp'>): string {
  switch (s.id) {
    case 'attention':
      return tp('sync.pill.attention', s.n);
    case 'syncing':
      return s.n === null ? t('sync.pill.syncingUnknown') : tp('sync.pill.syncing', s.n);
    case 'upToDate':
      return t('sync.pill.upToDate', { n: s.n });
    default:
      return t(`sync.pill.${s.id}`);
  }
}

function classLine(c: ClassView, { t, tp }: Pick<I18n, 't' | 'tp'>): string {
  switch (c.sync.kind) {
    case 'syncing':
      return c.sync.files === null ? t('sync.pill.syncingUnknown') : tp('sync.pill.syncing', c.sync.files);
    case 'waiting':
      return t('sync.popover.classWaiting');
    case 'relay':
      return t('sync.popover.classRelay');
    case 'paused':
      return t('sync.popover.classPaused');
    case 'missingFolder':
      return t('sync.popover.classMissing');
    case 'problems':
      return tp('sync.pill.attention', c.sync.count);
    default:
      return t('sync.popover.classUpToDate', { n: c.onlineMembers });
  }
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  return online;
}

export function SyncPill({ services, compact }: { services: AppServices; compact?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const { prefsStore, setPref } = useAppState();
  const sync = useStore(services.sync.state);
  const classes = useStore(services.library.classes);
  const online = useOnline();
  const state = syncPillState(sync, classes, online);
  const label = syncPillLabel(state, i18n);
  const look = ICON[state.id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const tip = state.id === 'waiting' ? `${label}. ${t('sync.pill.waitingTooltip')}` : label;
  const shared = classes.filter((c) => c.shared && !c.archived);
  const paused = prefsStore?.get('sync.paused') === '1';
  return (
    <>
      <Tooltip label={tip} side="right">
        <button
          ref={ref}
          type="button"
          className={cx('pill', `pill--${look.tone}`, compact && 'pill--compact')}
          aria-label={compact ? label : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid="sync-pill"
          data-state={state.id}
        >
          <look.icon size={14} strokeWidth={2} aria-hidden className={cx('pill__icon', look.spin && 'spin')} />
          <span className="pill__label rail__label">{label}</span>
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} side="right" align="end" padded className="sync-popover" aria-label={t('sync.popover.title')} data-testid="sync-popover">
        <h2 className="sync-popover__title">{t('sync.popover.title')}</h2>
        {shared.length > 0 ? (
          <ul className="sync-popover__list">
            {shared.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="sync-popover__class"
                  onClick={() => {
                    setOpen(false);
                    go({ name: 'class', classId: c.id, tab: 'members' });
                  }}
                  data-testid="sync-popover-class"
                >
                  <ClassTab color={c.color} icon={c.icon} size="sm" />
                  <span className="sync-popover__name">{c.name}</span>
                  <span className="sync-popover__line t-small t-muted">{classLine(c, i18n)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-small t-muted">{t('common.onlyThisComputer')}</p>
        )}
        <Switch label={t('sync.popover.pause')} description={t('sync.popover.pauseHint')} checked={paused} onChange={(v: boolean) => void setPref('sync.paused', v ? '1' : '0')} data-testid="sync-pause" />
        <div className="sync-popover__links">
          <button type="button" className="link" onClick={() => { setOpen(false); go({ name: 'settings', section: 'sharing' }); }} data-testid="sync-open-settings">
            {t('sync.popover.settings')}
          </button>
          <button type="button" className="link" onClick={() => { setOpen(false); go({ name: 'settings', section: 'sharing' }); }} data-testid="sync-open-diagnostics">
            {t('sync.popover.diagnostics')}
          </button>
        </div>
      </Popover>
    </>
  );
}
