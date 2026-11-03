// PLACEHOLDER (M0) → UI-LECTURES builds this in wave 2 (UX §3.14). It renders its UX root test id, a heading and
// `placeholder-data` (plan §2.3 item 7).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import { useI18n } from '../../ui/i18n';
import { PlaceholderPanel } from '../placeholder';

export default function TranscriptionSection({ services }: { services: AppServices }) {
  const { t } = useI18n();
  const p = services.ctx.prefs;
  void p;
  return <PlaceholderPanel testid="settings-transcription" title={t('settings.sections.transcription')} data={{ model: p.get('speech.model'), volunteer: p.get('speech.volunteer'), cloud: p.get('speech.cloud'), bitrate: p.get('speech.bitrate') }} />;
}
