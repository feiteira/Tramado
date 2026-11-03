// PLACEHOLDER (M0) → UI-GROUP builds this in wave 2 (UX §3.15.4). It renders its UX root test id, a heading and
// `placeholder-data` (plan §2.3 item 7).
import React from 'react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useI18n } from '../../ui/i18n';
import { PlaceholderPanel } from '../placeholder';

export default function FolderMissing({ classId, services }: { classId: ClassId; services: AppServices }) {
  const { t } = useI18n();
  const name = services.library.classes.get().find((c) => c.id === classId)?.name ?? classId;
  return <PlaceholderPanel testid="folder-missing" title={t('sync.folderMissing.title', { class: name })} data={{ classId }} />;
}
