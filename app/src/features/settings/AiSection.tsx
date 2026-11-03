// PLACEHOLDER (M0) → UI-EXAMS builds this in wave 2 (UX §3.14). It renders its UX root test id, a heading and
// `placeholder-data` (plan §2.3 item 7).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import { useI18n } from '../../ui/i18n';
import { PlaceholderPanel } from '../placeholder';

export default function AiSection({ services }: { services: AppServices }) {
  const { t } = useI18n();
  const p = services.ctx.prefs;
  void p;
  return <PlaceholderPanel testid="settings-ai" title={t('settings.sections.ai')} data={{ enabled: p.get('ai.enabled'), model: p.get('ai.model'), answerLanguage: p.get('ai.answerLanguage') }} />;
}
