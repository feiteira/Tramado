// PLACEHOLDER (M0) → UI-SHELL builds this in wave 2 (UX §3.14). It renders its UX root test id, a heading and
// `placeholder-data` (plan §2.3 item 7).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import { useI18n } from '../../ui/i18n';
import { PlaceholderPanel } from '../placeholder';

export default function AppearanceSection({ services }: { services: AppServices }) {
  const { t } = useI18n();
  const p = services.ctx.prefs;
  void p;
  return <PlaceholderPanel testid="settings-appearance" title={t('settings.sections.appearance')} data={{ locale: p.get('ui.locale'), theme: p.get('ui.theme'), textSize: p.get('ui.textSize'), font: p.get('ui.readingFont'), motion: p.get('ui.reduceMotion') }} />;
}
