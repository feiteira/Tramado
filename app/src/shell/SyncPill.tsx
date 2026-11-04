// The sync pill and its popover (UX §2.4): what sharing is doing, one line per shared class, the problems that need
// a decision (each with its action), Pause sharing, and links to Settings › Sharing. The data is SyncService's and
// PresenceService's (UI-GROUP); this file only renders and counts it. Sync never blocks anything.
import React, { useEffect, useRef, useState } from 'react';
import { CircleCheck, CirclePause, HardDrive, RefreshCw, TriangleAlert, Users, WifiOff, type LucideIcon } from 'lucide-react';
import type { AppServices } from '../services/types/common';
import type { ClassView } from '../services/types/viewModels';
import { Popover } from '../ui/components/Popover';
import { Button } from '../ui/components/Button';
import { Switch } from '../ui/components/Choice';
import { Tooltip } from '../ui/components/Tooltip';
import { useToast } from '../ui/components/Toast';
import { ClassTab } from '../ui/tramado/ClassTab';
import { formatBytes } from '../ui/format';
import { useI18n, type I18n } from '../ui/i18n';
import { cx } from '../ui/cx';
import { useRouter } from './router';
import { useStore } from './useStore';
import { syncPillState, type SyncPillState } from './pills';
import { useSyncFacts } from './syncFacts';
import { IdentityCopiedCard, SyncErrorCard, syncErrorOf } from '../features/sync/cards';
import { requestDiagnostics } from '../features/sync/diagnosticsFlag';
import { windowsNameProblems } from '../features/sync/windowsNames';

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
      return s.n > 0 ? t('sync.pill.upToDate', { n: s.n }) : t('sync.pill.upToDateNone');
    default:
      return t(`sync.pill.${s.id}`);
  }
}

/** The documents of a class whose names can't be saved on Windows computers (UX §3.15.9). */
function windowsNamesOf(services: AppServices, classId: string): string[] {
  try {
    return windowsNameProblems(services.forClass(classId).documents.list.get().map((d) => d.path));
  } catch {
    return [];
  }
}

export function classLine(c: ClassView, i18n: Pick<I18n, 't' | 'tp' | 'meta'>): string {
  const { t, tp } = i18n;
  switch (c.sync.kind) {
    case 'syncing':
      if (c.sync.files === null) return t('sync.pill.syncingUnknown');
      return c.sync.bytesLeft !== null
        ? t('sync.popover.classSyncing', { files: tp('common.count.files', c.sync.files), size: formatBytes(t, i18n.meta.bcp47, c.sync.bytesLeft) })
        : tp('sync.pill.syncing', c.sync.files);
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
      return c.onlineMembers > 0 ? t('sync.popover.classUpToDate', { n: c.onlineMembers }) : t('sync.pill.upToDateNone');
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
  const { t, tp } = i18n;
  const { go } = useRouter();
  const toast = useToast();
  const sync = useStore(services.sync.state);
  const classes = useStore(services.library.classes);
  const online = useOnline();
  const facts = useSyncFacts(services, classes);
  const conflicts = Object.values(facts.conflicts).reduce((a, b) => a + b, 0);
  const state = syncPillState(sync, classes, online, { online: facts.online, conflicts });
  const label = syncPillLabel(state, i18n);
  const look = ICON[state.id];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const tip = state.id === 'waiting' ? `${label}. ${t('sync.pill.waitingTooltip')}` : state.id === 'upToDate' && facts.onlineNames.length ? `${label}: ${facts.onlineNames.join(', ')}` : label;
  const shared = classes.filter((c) => c.shared && !c.archived);
  const nameOf = (id: string) => classes.find((c) => c.id === id);
  const paused = !!sync.status?.paused;
  const started = !!sync.status && sync.status.state !== 'stopped';
  const close = () => setOpen(false);
  // Settings › Sharing with the diagnostics expanded (UI-GROUP's flag, read once when the section mounts).
  const openDiagnostics = () => {
    close();
    requestDiagnostics();
    go({ name: 'settings', section: 'sharing', diagnostics: true });
  };
  const goClass = (classId: string, tab?: 'members' | 'notes' | 'documents') => {
    close();
    go({ name: 'class', classId, ...(tab ? { tab } : {}) });
  };
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const folderErrors = Object.values(sync.folders).filter((f) => f.error || f.pullErrors > 0);
  // UX §3.15.9 (sync spec §22.4): files of a shared class whose names a Windows computer cannot save.
  const windowsNames = open ? shared.map((c) => ({ classId: c.id, names: windowsNamesOf(services, c.id) })).filter((w) => w.names.length > 0) : [];
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
      <Popover open={open} onClose={close} anchor={ref} side="right" align="end" padded className="sync-popover" aria-label={t('sync.popover.title')} data-testid="sync-popover">
        <div className="sync-popover__head">
          <h2 className="sync-popover__title">{t('sync.popover.title')}</h2>
          <span className={cx('sync-popover__state', `pill--${look.tone}`)}>
            <look.icon size={14} strokeWidth={2} aria-hidden className="pill__icon" />
            {label}
          </span>
        </div>
        {sync.identityCopied ? <IdentityCopiedCard services={services} /> : null}
        {state.id === 'error' && !sync.identityCopied ? (
          <SyncErrorCard services={services} code={syncErrorOf(sync.status) ?? 'SYNC_UNAVAILABLE'} compact onDetails={openDiagnostics} />
        ) : null}
        {sync.massDelete.length || sync.massDeleteRemote.length || folderErrors.length || conflicts || windowsNames.length ? (
          <ul className="sync-popover__problems" data-testid="sync-problems">
            {sync.massDelete.map((m) => {
              const c = nameOf(m.classId);
              return (
                <li key={`md-${m.classId}`} className="sync-popover__problem">
                  <TriangleAlert size={14} strokeWidth={2} aria-hidden className="sync-popover__warn" />
                  <span className="sync-popover__problem-text">{t('sync.massDelete.title', { n: m.count, class: c?.shortName ?? '' })}</span>
                  <Button size="sm" busy={busy} onClick={() => void run(() => services.sync.resolveMassDelete(m.classId, 'restore'))} data-testid="sync-problem-restore">
                    {t('sync.massDelete.restore')}
                  </Button>
                </li>
              );
            })}
            {sync.massDeleteRemote.map((m) => (
              <li key={`mdr-${m.classId}-${m.by}`} className="sync-popover__problem">
                <TriangleAlert size={14} strokeWidth={2} aria-hidden className="sync-popover__warn" />
                <span className="sync-popover__problem-text">{`${nameOf(m.classId)?.shortName ?? ''} · ${tp('sync.pill.attention', m.count)}`}</span>
                <Button size="sm" onClick={() => goClass(m.classId)} data-testid="sync-problem-open">
                  {t('common.open')}
                </Button>
              </li>
            ))}
            {windowsNames.map((w) => (
              <li key={`wn-${w.classId}`} className="sync-popover__problem" data-testid="sync-problem-windows-name">
                <TriangleAlert size={14} strokeWidth={2} aria-hidden className="sync-popover__warn" />
                <span className="sync-popover__problem-text">{`${nameOf(w.classId)?.shortName ?? ''} · ${tp('sync.popover.windowsName', w.names.length)}`}</span>
                <Button size="sm" onClick={() => goClass(w.classId, 'documents')} data-testid="sync-problem-open">
                  {t('common.open')}
                </Button>
              </li>
            ))}
            {folderErrors.map((f) => (
              <li key={`fe-${f.classId}`} className="sync-popover__problem">
                <TriangleAlert size={14} strokeWidth={2} aria-hidden className="sync-popover__warn" />
                <span className="sync-popover__problem-text">{`${nameOf(f.classId)?.shortName ?? f.label} · ${tp('sync.pill.attention', Math.max(1, f.pullErrors))}`}</span>
                <Button size="sm" onClick={() => goClass(f.classId, 'documents')} data-testid="sync-problem-open">
                  {t('common.open')}
                </Button>
              </li>
            ))}
            {Object.entries(facts.conflicts).map(([classId, n]) => (
              <li key={`cf-${classId}`} className="sync-popover__problem">
                <TriangleAlert size={14} strokeWidth={2} aria-hidden className="sync-popover__warn" />
                <span className="sync-popover__problem-text">{`${nameOf(classId)?.shortName ?? ''} · ${tp('sync.pill.attention', n)}`}</span>
                <Button size="sm" onClick={() => goClass(classId, 'notes')} data-testid="sync-problem-open">
                  {t('common.open')}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {shared.length > 0 ? (
          <ul className="sync-popover__list">
            {shared.map((c) => (
              <li key={c.id}>
                <button type="button" className="sync-popover__class" onClick={() => goClass(c.id, 'members')} data-testid="sync-popover-class" data-class-id={c.id}>
                  <ClassTab color={c.color} icon={c.icon} size="sm" />
                  <span className="sync-popover__name">{c.name}</span>
                  <span className="sync-popover__line">{classLine(c, i18n)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sync-popover__empty">{t('settings.sharing.notStarted')}</p>
        )}
        {started ? (
          <Switch
            label={t('sync.popover.pause')}
            description={t('sync.popover.pauseHint')}
            checked={paused}
            disabled={busy}
            onChange={(v: boolean) => void run(() => services.sync.applySettings({ paused: v }))}
            data-testid="sync-pause"
          />
        ) : null}
        <div className="sync-popover__links">
          <button type="button" className="link" onClick={() => { close(); go({ name: 'settings', section: 'sharing' }); }} data-testid="sync-open-settings">
            {t('sync.popover.settings')}
          </button>
          <button type="button" className="link" onClick={openDiagnostics} data-testid="sync-open-diagnostics">
            {t('sync.popover.diagnostics')}
          </button>
        </div>
      </Popover>
    </>
  );
}
