// Folder missing (UX §3.15.4, sync spec §22.3): shown by the class screen in place of the tabs when the class's
// folder (or its marker) is gone. "Put it back at {path}, or remove the class from this computer." [Remove from
// Tramado]. (v1.1: [Find it…] and [Get a fresh copy from classmates].)
import React, { useState } from 'react';
import { FolderX } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import './sync.css';

export default function FolderMissing({ classId, services }: { classId: ClassId; services: AppServices }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { replace } = useRouter();
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === classId);
  const name = cls?.name ?? classId;
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    const ok = await confirm({ title: t('sync.folderMissingMore.removeTitle', { class: name }), body: t('sync.folderMissingMore.removeBody'), confirmLabel: t('sync.folderMissing.remove'), danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await services.ctx.platform.classes.forget(classId);
      await services.library.load();
      replace({ name: 'today' });
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <div className="folder-missing" data-testid="folder-missing" data-class-id={classId}>
      <div className="folder-missing__card" role="alert">
        <h2 className="folder-missing__title"><FolderX size={22} aria-hidden strokeWidth={1.75} /> {t('sync.folderMissing.title', { class: name })}</h2>
        <p className="t-secondary" data-testid="folder-missing-text">{t('sync.folderMissing.body')} {t('sync.folderMissingMore.putBack', { path: cls?.path ?? '—' })}</p>
        <div className="folder-missing__actions">
          <Button variant="danger" busy={busy} onClick={() => void remove()} data-testid="folder-missing-remove">{t('sync.folderMissing.remove')}</Button>
        </div>
      </div>
    </div>
  );
}
