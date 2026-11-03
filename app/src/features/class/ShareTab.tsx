// PLACEHOLDER (M0) → UI-SHELL builds this in wave 2 (UX §3.3.3). It renders its UX root test id, a heading and
// `placeholder-data` (plan §2.3 item 7).
import React from 'react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useI18n } from '../../ui/i18n';
import { PlaceholderPanel, summary, useStoreSafe } from '../placeholder';

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  const { t } = useI18n();
  
  void summary; void useStoreSafe;
  const data = { classId, shared: false };
  return <PlaceholderPanel testid="class-share-tab" title={t('classes.tabs.share')} data={data} />;
}
