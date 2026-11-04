// The mass-deletion guard on the deleting device (UX §3.15.3, sync spec §22.2). Not dismissible: the folder is
// paused until the student answers. [Restore the files] (primary) brings them back from classmates' computers;
// [Yes, delete them for everyone] (danger) lets the deletions spread.
import React, { useEffect, useState } from 'react';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import './sync.css';

const RECENT_MS = 10 * 60_000;

export default function MassDeleteDialog({ props, services, close }: { props: DialogPropsMap['mass-delete']; services: AppServices; close(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const sync = useStore(services.sync.state);
  const classes = useStore(services.library.classes);
  const name = classes.find((c) => c.id === props.classId)?.name ?? '';
  const entry = sync.massDelete.find((m) => m.classId === props.classId) ?? null;
  // Opened without a guard event (the demo's dialog=, a restart): the files deleted in the last minutes.
  const [fallback, setFallback] = useState<{ count: number; sample: string[] } | null>(null);
  const [busy, setBusy] = useState<'restore' | 'confirm' | null>(null);
  useEffect(() => {
    if (entry) return;
    let live = true;
    void services.sync.versions(props.classId).then((v) => {
      if (!live) return;
      const now = services.ctx.clock.now();
      const recent = [...new Set(v.filter((x) => now - Date.parse(x.versionTime) < RECENT_MS).map((x) => x.path))];
      const list = recent.length ? recent : [...new Set(v.map((x) => x.path))];
      setFallback({ count: list.length, sample: list.slice(0, 10) });
    }, () => live && setFallback({ count: 0, sample: [] }));
    return () => {
      live = false;
    };
  }, [entry, props.classId, services]);
  const count = entry?.count ?? fallback?.count ?? 0;
  const sample = entry?.sample ?? fallback?.sample ?? [];
  const run = async (action: 'restore' | 'confirm') => {
    setBusy(action);
    try {
      await services.sync.resolveMassDelete(props.classId, action);
      if (action === 'restore') toast.show({ message: t('sync.massDelete.restored'), tone: 'success' });
      close();
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };
  return (
    <Dialog
      open
      onClose={() => undefined}
      dismissible={false}
      size="md"
      title={t('sync.massDelete.title', { n: count, class: name })}
      data-testid="mass-delete-dialog"
      footer={
        <>
          <Button variant="danger" busy={busy === 'confirm'} disabled={!!busy} onClick={() => void run('confirm')} data-testid="mass-delete-confirm">{t('sync.massDelete.confirm')}</Button>
          <Button variant="primary" busy={busy === 'restore'} disabled={!!busy} onClick={() => void run('restore')} data-autofocus data-testid="mass-delete-restore">{t('sync.massDelete.restore')}</Button>
        </>
      }
    >
      <p className="t-secondary">{t('sync.massDelete.body', { class: name })}</p>
      {sample.length ? (
        <ul className="mass-delete__sample" aria-label={t('sync.massDeleteMore.sample')} data-testid="mass-delete-sample">
          {sample.map((p) => <li key={p}>{p}</li>)}
          {count > sample.length ? <li>{t('sync.massDeleteMore.andMore', { n: count - sample.length })}</li> : null}
        </ul>
      ) : null}
    </Dialog>
  );
}
