// "Remove {name} from {class}?" (UX §3.12.1), local to the members feature (architecture §11.4): an organiser bans the
// person (or one unverified device) for everyone; this also turns on "Ask before letting people in" (sync spec §18.1).
// The "Start a fresh class without {name}…" link is v1.1 (rotation) and is not shown.
import React, { useState } from 'react';
import type { ClassId, DeviceId, MemberId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';

export interface RemoveTarget { name: string; memberId?: MemberId; deviceId?: DeviceId }

export function RemoveDialog({ classId, className, target, services, onClose }: { classId: ClassId; className: string; target: RemoveTarget; services: AppServices; onClose(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await services.sync.ban(classId, target.memberId ? { memberId: target.memberId } : { deviceId: target.deviceId! });
      toast.show({ message: t('members.remove.done', { name: target.name, class: className }), tone: 'success' });
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={t('members.remove.title', { name: target.name, class: className })}
      onSubmit={() => void run()}
      data-testid="member-remove-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus data-testid="member-remove-cancel">{t('common.cancel')}</Button>
          <Button type="submit" variant="danger" busy={busy} data-testid="member-remove-confirm">{t('members.remove.confirm')}</Button>
        </>
      }
    >
      <p className="t-secondary">{t('members.remove.body', { name: target.name })}</p>
    </Dialog>
  );
}
