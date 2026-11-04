// Class settings (UX §3.3.1), registry dialog `class-settings` (`[class-settings]`): the New class form plus
// vocabulary, admission, audio, notifications and the danger zone.
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useStore } from '../../shell/useStore';
import { Missing } from '../../shell/Placeholder';
import { Dialog } from '../../ui/components/Dialog';
import { useI18n } from '../../ui/i18n';
import { ClassDialog } from './ClassDialog';

export default function ClassSettingsDialog({ props, services, close }: { props: DialogPropsMap['class-settings']; services: AppServices; close(): void }) {
  const { t } = useI18n();
  const classes = useStore(services.library.classes);
  if (!classes.some((c) => c.id === props.classId)) {
    return (
      <Dialog open onClose={close} title={t('classes.dialog.settingsTitle')} size="md" data-testid="class-settings">
        <Missing what="class" inline />
      </Dialog>
    );
  }
  return <ClassDialog services={services} classId={props.classId} close={close} />;
}
