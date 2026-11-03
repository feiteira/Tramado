// PLACEHOLDER (M0) → UI-SHELL builds this in wave 2 (UX §3.3.1). It renders its UX root test id, a heading and
// `placeholder-data` (plan §2.3 item 7).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useI18n } from '../../ui/i18n';
import { PlaceholderDialog } from '../placeholder';

export default function Dialog_({ props, services, close }: { props: DialogPropsMap['new-class']; services: AppServices; close(): void }) {
  const { t, tp } = useI18n();
  const name = (classId: string) => services.library.classes.get().find((c) => c.id === classId)?.name ?? classId;
  void tp; void name;
  return <PlaceholderDialog testid="class-dialog" title={t('classes.dialog.newTitle')} data={{}} close={close} size="md" />;
}
