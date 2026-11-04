// The Share tab of a class kept only on this computer (UX §3.3.3): it turns sharing on (as the settings switch) and
// then opens the Invite dialog — or, the first time a class is shared, the first-share question (§3.15.1, D48).
import React, { useState } from 'react';
import { FolderSync } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useAppState } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { Button } from '../../ui/components/Button';
import { EmptyState } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';

export default function ShareTab({ classId, services }: { classId: ClassId; services: AppServices }) {
  const { t } = useI18n();
  const app = useAppState();
  const { replace } = useRouter();
  const dialogs = useDialogs();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      await services.sync.share(classId);
      await services.library.load();
      replace({ name: 'class', classId, tab: 'lectures' });
      if (services.ctx.prefs.get('app.trayAsked') !== '1') {
        await app.setPref('app.trayAsked', '1');
        dialogs.open('first-share', { classId });
      } else dialogs.open('invite', { classId });
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <section className="class-share-tab" data-testid="class-share-tab" aria-label={t('classes.tabs.share')}>
      <EmptyState
        icon={FolderSync}
        title={t('classes.shareTab.title')}
        actions={
          <Button variant="primary" icon={FolderSync} busy={busy} onClick={() => void share()} data-testid="class-share-start">
            {t('classes.shareTab.action')}
          </Button>
        }
      >
        {t('classes.shareTab.body')}
      </EmptyState>
    </section>
  );
}
