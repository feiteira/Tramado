// Notices of UX §3.15 that appear in more than one place: the sync error card (§3.15.2: the sync popover, Settings ›
// Sharing, the invite dialog), the copied-identity card (§3.15.12), the received mass-deletion notice (§3.15.3) and the
// Windows file-name notice (§3.15.9). The shell's sync popover (UI-SHELL) may render SyncErrorCard and
// IdentityCopiedCard with the same props.
import React, { useState } from 'react';
import type { ClassId, ShortId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Notice } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import './sync.css';

const SYNC_ERRORS = new Set(['SYNC_UNAVAILABLE', 'SYNC_PORT', 'SYNC_LOCKED']);

/** The error code that keeps sharing from running, or null (status error or a failed start). */
export function syncErrorOf(status: { state: string; error: string | null } | null, failed?: string | null): string | null {
  if (failed && SYNC_ERRORS.has(failed)) return failed;
  if (!status) return null;
  if (status.error && SYNC_ERRORS.has(status.error)) return status.error;
  return status.state === 'error' ? 'SYNC_UNAVAILABLE' : null;
}

/** "Sharing isn't running…" with [Try again] and [Details] (UX §3.15.2). */
export function SyncErrorCard({ services, code, onRetried, compact }: { services: AppServices; code: string; onRetried?(): void; compact?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const { go } = useRouter();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await services.sync.restart();
      onRetried?.();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Notice
      tone="danger"
      className={compact ? 'sync-card sync-card--compact' : 'sync-card'}
      actions={
        <>
          <Button size="sm" busy={busy} onClick={() => void retry()} data-testid="sync-retry">{t('sync.error.retry')}</Button>
          <Button size="sm" variant="ghost" onClick={() => go({ name: 'settings', section: 'sharing' })} data-testid="sync-details">{t('sync.error.details')}</Button>
        </>
      }
      data-testid="sync-error-card"
    >
      <p>{t('sync.error.notRunning')}</p>
      {code === 'SYNC_LOCKED' ? <p>{t('sync.error.locked')}</p> : null}
      {code === 'SYNC_PORT' ? <p>{t('sync.error.port')}</p> : null}
    </Notice>
  );
}

/** "This looks like a copy of another computer's Tramado." (UX §3.15.12) */
export function IdentityCopiedCard({ services }: { services: AppServices }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<'new' | 'same' | null>(null);
  const run = async (action: 'new' | 'same') => {
    setBusy(action);
    try {
      await services.sync.resolveCopiedIdentity(action);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Notice
      tone="danger"
      className="sync-card"
      title={t('sync.identityCopied.title')}
      actions={
        <>
          <Button size="sm" variant="primary" busy={busy === 'new'} disabled={!!busy} onClick={() => void run('new')} data-testid="identity-copied-new">{t('sync.identityCopied.new')}</Button>
          <Button size="sm" variant="ghost" busy={busy === 'same'} disabled={!!busy} onClick={() => void run('same')} data-testid="identity-copied-same">{t('sync.identityCopied.same')}</Button>
        </>
      }
      data-testid="identity-copied"
    >
      {t('sync.identityCopied.body')}
    </Notice>
  );
}

/** "{name}'s computer deleted {n} files from {class}." [Restore for everyone] [Keep deleted] (UX §3.15.3). */
export function MassDeleteRemoteNotice({ services, classId, by, byName, count, className }: { services: AppServices; classId: ClassId; by: ShortId; byName: string; count: number; className: string }) {
  const { t, tp } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<'restore' | 'keep' | null>(null);
  const run = async (action: 'restore' | 'keep') => {
    setBusy(action);
    try {
      await services.sync.resolveRemoteMassDelete(classId, by, action);
      if (action === 'restore') toast.show({ message: t('sync.massDeleteRemote.restored'), tone: 'success' });
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };
  return (
    <Notice
      tone="warning"
      className="sync-card"
      actions={
        <>
          <Button size="sm" variant="primary" busy={busy === 'restore'} disabled={!!busy} onClick={() => void run('restore')} data-testid="mass-delete-remote-restore">{t('sync.massDeleteRemote.restore')}</Button>
          <Button size="sm" variant="ghost" busy={busy === 'keep'} disabled={!!busy} onClick={() => void run('keep')} data-testid="mass-delete-remote-keep">{t('sync.massDeleteRemote.keep')}</Button>
        </>
      }
      data-testid="mass-delete-remote"
    >
      {tp('sync.massDeleteRemote.text', count, { name: byName, class: className })}
    </Notice>
  );
}

/** "{n} file can't be saved on Windows computers: {name}. Rename it." [Rename…] (UX §3.15.9). */
export function WindowsNameNotice({ names, onRename }: { names: string[]; onRename?(name: string): void }) {
  const { tp, t } = useI18n();
  if (!names.length) return null;
  return (
    <Notice
      tone="warning"
      className="sync-card"
      actions={onRename ? <Button size="sm" onClick={() => onRename(names[0]!)} data-testid="windows-name-rename">{t('sync.windowsName.rename')}</Button> : undefined}
      data-testid="windows-name"
    >
      {tp('sync.windowsNames', names.length, { name: names.slice(0, 3).join(', ') })}
    </Notice>
  );
}

/** The sync error, copied identity and received mass deletions of one class (or all), stacked. */
export function SyncProblems({ services, classId }: { services: AppServices; classId?: ClassId }) {
  const sync = useStore(services.sync.state);
  const classes = useStore(services.library.classes);
  const code = syncErrorOf(sync.status);
  const remote = sync.massDeleteRemote.filter((m) => !classId || m.classId === classId);
  return (
    <>
      {sync.identityCopied ? <IdentityCopiedCard services={services} /> : null}
      {code && !sync.identityCopied ? <SyncErrorCard services={services} code={code} /> : null}
      {remote.map((m) => (
        <MassDeleteRemoteNotice key={`${m.classId}-${m.by}`} services={services} classId={m.classId} by={m.by} byName={m.byName} count={m.count} className={classes.find((c) => c.id === m.classId)?.name ?? ''} />
      ))}
    </>
  );
}
