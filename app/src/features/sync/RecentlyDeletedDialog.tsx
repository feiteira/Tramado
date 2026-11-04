// Recently deleted (UX §3.15.5, sync spec §22.1): Syncthing's kept versions of paths that are deleted now (the last
// 30 days; machine files, transcript.md/.vtt and conflict copies left out), newest first, with [Restore] per row
// ("Restored “{file}” for everyone."). Empty: "Nothing deleted in the last 30 days."
import React, { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import type { VersionEntry } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { EmptyState, Notice, Spinner } from '../../ui/components/Feedback';
import { Table, TBody, TD, TH, THead, TR } from '../../ui/components/Table';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { formatSize } from './format';
import { toPlatformError } from '../../core/errors';
import './sync.css';

const DAYS_30 = 30 * 86_400_000;

export default function RecentlyDeletedDialog({ props, services, close }: { props: DialogPropsMap['recently-deleted']; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const classes = useStore(services.library.classes);
  const name = classes.find((c) => c.id === props.classId)?.name ?? '';
  const [rows, setRows] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    void services.sync.versions(props.classId).then((v) => {
      if (!live) return;
      const now = services.ctx.clock.now();
      // One row per path: its newest kept version.
      const seen = new Set<string>();
      setRows(v.filter((x) => now - Date.parse(x.versionTime) <= DAYS_30).filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true))));
    }, (e: unknown) => live && setError(toPlatformError(e).code));
    return () => {
      live = false;
    };
  }, [props.classId, services, attempt]);
  const restore = async (v: VersionEntry) => {
    setBusy(v.path);
    try {
      await services.sync.restore(props.classId, [{ path: v.path, versionTime: v.versionTime }]);
      toast.show({ message: t('sync.recentlyDeleted.restored', { file: fileName(v.path) }), tone: 'success' });
      setRows((r) => r?.filter((x) => x.path !== v.path) ?? null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open
      onClose={close}
      size="lg"
      title={t('sync.recentlyDeleted.title', { class: name })}
      data-testid="recently-deleted"
      footer={<Button variant="primary" onClick={close} data-testid="recently-deleted-close">{t('common.close')}</Button>}
    >
      <p className="recently-deleted__intro">{t('sync.recentlyDeleted.intro')}</p>
      {error ? (
        <Notice tone="danger" actions={<Button size="sm" onClick={() => setAttempt((a) => a + 1)} data-testid="recently-deleted-retry">{t('common.tryAgain')}</Button>} data-testid="recently-deleted-error">
          {t(`errors.${error}` as 'errors.AI_BUSY')}
        </Notice>
      ) : rows === null ? (
        <div className="invite__waiting" data-testid="recently-deleted-loading"><Spinner label={t('common.loading')} /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Trash2} title={t('sync.recentlyDeleted.empty')} data-testid="recently-deleted-empty" />
      ) : (
        <div className="recently-deleted__table">
          <Table>
            <THead>
              <TR>
                <TH>{t('sync.recentlyDeleted.file')}</TH>
                <TH>{t('sync.recentlyDeleted.deleted')}</TH>
                <TH numeric>{t('sync.recentlyDeleted.size')}</TH>
                <TH><span className="visually-hidden">{t('sync.recentlyDeleted.restore')}</span></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((v) => {
                const when = DateTime.fromISO(v.versionTime);
                const dir = v.path.includes('/') ? v.path.slice(0, v.path.lastIndexOf('/')) : '';
                return (
                  <TR key={v.path} data-testid="recently-deleted-row" data-path={v.path}>
                    <TD>
                      <span className="recently-deleted__file">
                        <span className="recently-deleted__name">{fileName(v.path)}</span>
                        {dir ? <span className="recently-deleted__dir">{dir}</span> : null}
                      </span>
                    </TD>
                    <TD>{when.isValid ? `${i18n.date(when)} ${i18n.time(when)}` : '—'}</TD>
                    <TD numeric>{formatSize(v.size, i18n)}</TD>
                    <TD>
                      <Button size="sm" icon={ArchiveRestore} busy={busy === v.path} disabled={!!busy && busy !== v.path} onClick={() => void restore(v)} data-testid="recently-deleted-restore">{t('sync.recentlyDeleted.restore')}</Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}

const fileName = (p: string) => p.split('/').pop() ?? p;
