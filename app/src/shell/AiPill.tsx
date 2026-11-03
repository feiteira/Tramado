// The AI pill (UX §2.5): the model and today's remaining requests; click → Settings › AI. M0 shows the
// placeholder states of the AiService stub; UI-SHELL owns this file in wave 2.
import React from 'react';
import { Sparkles } from 'lucide-react';
import type { AppServices } from '../services/types/common';
import { Tooltip } from '../ui/components/Tooltip';
import { useI18n, type I18n } from '../ui/i18n';
import { cx } from '../ui/cx';
import { useRouter } from './router';
import { useStore } from './useStore';
import { aiPillState, type AiPillState } from './pills';

export function aiPillLabel(s: AiPillState, { t }: Pick<I18n, 't'>): string {
  switch (s.id) {
    case 'model':
      return t('ai.pill.model', { model: s.model, n: s.n });
    case 'modelOnly':
      return t('ai.pill.modelOnly', { model: s.model });
    case 'local':
      return t('ai.pill.local');
    case 'checkKey':
      return t('ai.pill.checkKey');
    default:
      return t('ai.pill.off');
  }
}

export function AiPill({ services, compact }: { services: AppServices; compact?: boolean }) {
  const i18n = useI18n();
  const { go } = useRouter();
  const settings = useStore(services.ai.settings);
  const state = aiPillState(settings);
  const label = aiPillLabel(state, i18n);
  const tone = state.id === 'off' ? 'muted' : state.id === 'checkKey' ? 'warning' : 'ai';
  return (
    <Tooltip label={`${label} · ${i18n.t('ai.pill.label')}`} side="right">
      <button
        type="button"
        className={cx('pill', `pill--${tone}`, compact && 'pill--compact')}
        aria-label={compact ? label : undefined}
        onClick={() => go({ name: 'settings', section: 'ai' })}
        data-testid="ai-pill"
        data-state={state.id}
      >
        <Sparkles size={14} strokeWidth={2} aria-hidden className="pill__icon pill__icon--ai" />
        <span className="pill__label rail__label">{label}</span>
      </button>
    </Tooltip>
  );
}
