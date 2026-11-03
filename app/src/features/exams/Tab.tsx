// PLACEHOLDER (M0) → UI-EXAMS builds this in wave 2 (UX §3.9.2). It renders its UX root test id, a heading and
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
  const data = (() => { const v = safeList(() => cls.exams.list); return typeof v === 'string' ? v : { dates: summary(v.dates, (d) => d.title), papers: summary(v.papers, (p) => p.title) }; })();
  return <PlaceholderPanel testid="class-exams" ready="exam-list" title={t('classes.tabs.exams')} data={data} />;
}
