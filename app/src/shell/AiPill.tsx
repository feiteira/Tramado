// The AI pill (UX §2.5): the model and today's free requests left; "AI: check key" after OpenRouter refused the key;
// click → Settings › AI. The quota is read with `GET key` (the key only; no model call, no content) when a key is
// set and AI is on: once at start, and again when the window comes back after 15 minutes or more. Nothing is sent
// when AI is off or has no key (core/privacy/flows.ts `keyCheck`).
import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { errorCode } from '../core/errors';
import type { AppServices } from '../services/types/common';
import { Tooltip } from '../ui/components/Tooltip';
import { useI18n, type I18n } from '../ui/i18n';
import { cx } from '../ui/cx';
import { useRouter } from './router';
import { useStore } from './useStore';
import { aiPillState, type AiPillState } from './pills';

const QUOTA_AGAIN_MS = 15 * 60_000;

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
  const [lastCode, setLastCode] = useState<string | null>(null);
  const wantsQuota = settings.enabled && settings.key.set && !settings.customHost;
  const keyId = `${settings.key.set}:${settings.key.last4 ?? ''}`;
  useEffect(() => {
    setLastCode(null);
    if (!wantsQuota) return undefined;
    let live = true;
    let last = 0;
    const check = () => {
      last = Date.now();
      void services.ai.refreshQuota().then(
        () => live && setLastCode(null),
        (e: unknown) => live && setLastCode(errorCode(e) ?? null),
      );
    };
    check();
    const onFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= QUOTA_AGAIN_MS) check();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      live = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [services, wantsQuota, keyId]);
  const state = aiPillState(settings, lastCode);
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
