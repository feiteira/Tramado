// Leave a class (UX §3.3.4, sync spec §17): the confirm dialog with "Also delete my copy from this computer"
// (unticked → keep a local, forked copy; ticked → to the trash once a classmate received the departure) and "Also delete
// my private notes and practice". Cancel takes the focus first. The class leaves the rail at once.
import React, { useState } from 'react';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import './members.css';

export default function LeaveDialog({ props, services, close }: { props: DialogPropsMap['leave']; services: AppServices; close(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { route, replace } = useRouter();
  const classes = useStore(services.library.classes);
  const name = classes.find((c) => c.id === props.classId)?.name ?? services.forClass(props.classId).info.detail.get().meta.name;
  const [deleteCopy, setDeleteCopy] = useState(false);
  const [deleteNotes, setDeleteNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    setBusy(true);
    try {
      await services.sync.leave(props.classId, { afterwards: deleteCopy ? 'trash' : 'keepLocal', deleteMyNotes: deleteNotes });
      if ('classId' in route && route.classId === props.classId) replace({ name: 'today' });
      toast.show({ message: t('classes.leave.done', { class: name }), tone: 'success' });
      close();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={close}
      dismissible={!busy}
      size="sm"
      title={t('classes.leave.title', { class: name })}
      onSubmit={() => void leave()}
      data-testid="confirm-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy} data-autofocus data-testid="confirm-cancel">{t('common.cancel')}</Button>
          <Button type="submit" variant="danger" busy={busy} data-testid="confirm-ok">{t('classes.leave.confirm')}</Button>
        </>
      }
    >
      <div className="leave__body">
        <p className="t-secondary">{t('classes.leave.body')}</p>
        <Checkbox checked={deleteCopy} onChange={setDeleteCopy} label={t('classes.leave.deleteCopy')} data-testid="class-leave-delete" />
        <Checkbox checked={deleteNotes} onChange={setDeleteNotes} label={t('members.leave.deleteNotes')} data-testid="class-leave-delete-notes" />
      </div>
    </Dialog>
  );
}
