// PLACEHOLDER (M0) → UI-GROUP builds this in wave 2 (UX §3.12.1). It renders its UX root test id, a heading and
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
  const data = (() => { const v = safeList(() => cls.info.detail); return typeof v === 'string' ? v : { people: summary(v.people, (p) => p.name), organisers: v.organisers.length }; })();
  return <PlaceholderPanel testid="class-members" ready="member-list" title={t('classes.tabs.members')} data={data} />;
}
