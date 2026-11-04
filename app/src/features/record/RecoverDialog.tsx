// A recording was interrupted (UX §3.6.5, audio-pipeline §4.3): at start-up, for each journal still recording.
// Not dismissible: keep what was recorded (→ the Save dialog) or delete it (confirmed).
import React, { useState } from 'react';
import { DateTime } from 'luxon';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Dialog } from '../../ui/components/Dialog';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { duration, hhmm } from '../lectures/format';
import { handledRecoveries } from './Recovery';
import './record.css';

export default function RecoverDialog({ props, services, close }: { props: DialogPropsMap['recover']; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t, meta } = i18n;
  const confirm = useConfirm();
  const toast = useToast();
  const dialogs = useDialogs();
  const rec = props.recording;
  const view = useStore(services.library.classes).find((c) => c.id === rec.classId);
  const [busy, setBusy] = useState(false);
  const end = DateTime.fromISO(rec.startedAt).plus({ milliseconds: rec.durationMs });
  handledRecoveries.add(rec.recordingId);
  const remove = async () => {
    const ok = await confirm({ title: t('record.recover.delete'), body: t('record.recover.deleteConfirm'), confirmLabel: t('record.recover.delete'), danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await services.recording.discard(rec.recordingId);
      close();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={close}
      dismissible={false}
      size="sm"
      title={t('record.recover.title')}
      data-testid="record-recover"
      footer={
        <>
          <Button variant="ghost" busy={busy} onClick={() => void remove()} data-testid="record-recover-delete">
            {t('record.recover.delete')}
          </Button>
          <Button variant="primary" onClick={() => dialogs.open('save', { recording: rec })} data-testid="record-recover-keep">
            {t('record.recover.keep')}
          </Button>
        </>
      }
    >
      <p>{t('record.recover.body', { class: view?.name ?? '', time: hhmm(end), date: end.setLocale(meta.bcp47).toLocaleString(DateTime.DATE_MED) })}</p>
      <p className="record-hint">{t('record.recover.length', { duration: duration(rec.durationMs, i18n) })}</p>
    </Dialog>
  );
}
