// PLACEHOLDER (M0) → UI-LECTURES builds this in wave 2 (UX §3.4). It renders its UX root test id, a heading and
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
  const data = summary(safeList(() => cls.lectures.list), (l: { id: string; title: string; transcription: { kind: string } }) => `${l.id} ${l.title} [${l.transcription.kind}]`);
  return <PlaceholderPanel testid="class-lectures" ready="lecture-list" title={t('classes.tabs.lectures')} data={data} />;
}
