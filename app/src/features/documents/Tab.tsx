// PLACEHOLDER (M0) → UI-DOCS builds this in wave 2 (UX §3.7.1). It renders its UX root test id, a heading and
// `placeholder-data` (plan §2.3 item 7).
import React from 'react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useI18n } from '../../ui/i18n';
import { PlaceholderPanel, summary, useStoreSafe } from '../placeholder';

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  const { t } = useI18n();
  const cls = services.forClass(classId);
  const safeList = useStoreSafe;
  void summary; void useStoreSafe;
  const data = summary(safeList(() => cls.documents.list), (d: { path: string }) => d.path);
  return <PlaceholderPanel testid="class-documents" ready="doc-list" title={t('classes.tabs.documents')} data={data} />;
}
