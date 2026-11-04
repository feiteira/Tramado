// The free-models-busy chooser (UX §3.15.6, critique C14/D9): an inline card in the place of the answer, never a
// modal. It names the models tried, offers [Try again] (with a countdown when the provider said when), NVIDIA's free
// models for this one request, "Always use them when busy" (AiService.setBusyPolicy → the native confirmation, the
// same as the "may train" privacy level), and [Change model]. The footnote says NVIDIA's free models may train.
import React, { useEffect, useState } from 'react';
import { CloudOff, RefreshCw, Settings2, Zap } from 'lucide-react';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { useI18n } from '../../ui/i18n';
import './ask.css';

export interface BusyChooserProps {
  services: AppServices;
  onRetry(): void;
  /** "Use NVIDIA free models for this request" (the request runs again with `busyFallback`). */
  onOnce(): void;
  /** Seconds the provider asked to wait (Retry-After), when known. */
  retryAfterS?: number | null;
  'data-testid'?: string;
}

export const triedLabel = (label: string): string => label.replace(/\s*\((?:free|gratuito|gratis)\)\s*$/i, '');

export function BusyChooser({ services, onRetry, onOnce, retryAfterS = null, ...rest }: BusyChooserProps) {
  const { t } = useI18n();
  const { go } = useRouter();
  const settings = useStore(services.ai.settings);
  const [left, setLeft] = useState<number>(retryAfterS && retryAfterS > 0 ? Math.ceil(retryAfterS) : 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);
  const tried = settings.chain.map((id) => triedLabel(services.ai.label(id).label)).join(', ');
  return (
    <section className="busy" role="status" aria-labelledby="busy-title" data-testid={rest['data-testid'] ?? 'ai-busy-chooser'}>
      <div className="busy__head">
        <CloudOff size={18} strokeWidth={1.75} aria-hidden className="busy__icon" />
        <div>
          <p className="busy__title" id="busy-title">{t('ai.busy.title')}</p>
          {tried ? <p className="busy__tried t-small">{t('ai.busy.tried', { models: tried })}</p> : null}
        </div>
      </div>
      <div className="busy__actions">
        <Button icon={RefreshCw} disabled={left > 0} onClick={onRetry} data-testid="ai-busy-retry">
          {left > 0 ? t('ai.busy.retryIn', { s: left }) : t('ai.recovery.tryAgain')}
        </Button>
        <Button variant="primary" icon={Zap} onClick={onOnce} data-testid="ai-busy-nvidia-once">{t('ai.busy.once')}</Button>
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (await services.ai.setBusyPolicy(true)) onRetry();
            } finally {
              setBusy(false);
            }
          }}
          data-testid="ai-busy-nvidia-always"
        >
          {t('ai.busy.always')}
        </Button>
        <Button variant="ghost" icon={Settings2} onClick={() => go({ name: 'settings', section: 'ai' })} data-testid="ai-busy-change">{t('ai.busy.change')}</Button>
      </div>
      <p className="busy__foot t-small">{t('ai.busy.footnote')}</p>
    </section>
  );
}
