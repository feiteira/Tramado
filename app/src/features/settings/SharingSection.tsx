// PLACEHOLDER (M0) → UI-GROUP builds this in wave 2 (UX §3.14). It renders its UX root test id, a heading and
// `placeholder-data` (plan §2.3 item 7).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import { useI18n } from '../../ui/i18n';
import { PlaceholderPanel } from '../placeholder';

export default function SharingSection({ services }: { services: AppServices }) {
  const { t } = useI18n();
  const p = services.ctx.prefs;
  void p;
  return <PlaceholderPanel testid="settings-sharing" title={t('settings.sections.sharing')} data={{ localOnly: p.get('sync.localOnly'), paused: p.get('sync.paused') }} />;
}
