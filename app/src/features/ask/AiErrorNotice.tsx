// AI errors in the place of an answer (UX §3.11 "Errors", §5.14 `ai.errors.*` + `ai.recovery.*`): one sentence per
// code and its way out — [Set up AI], [Update key], [Use the free model], [Choose another model], [Change privacy
// level…], [Try again]. AI_BUSY shows the busy chooser instead (§3.15.6).
import React from 'react';
import { RefreshCw, Settings2 } from 'lucide-react';
import { DEFAULT_MODEL } from '../../core/ai/defaults';
import type { ErrorCode } from '../../core/errors';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Notice } from '../../ui/components/Feedback';
import { useI18n, type MessageKey } from '../../ui/i18n';
import { useResetTime } from '../../ui/tramado/QuotaMeter';
import { BusyChooser } from './BusyChooser';

export interface AiErrorNoticeProps {
  services: AppServices;
  code: ErrorCode;
  onRetry?(): void;
  /** The busy chooser's "Use NVIDIA free models for this request". */
  onBusyFallback?(): void;
  /** INT: when a rate limit said to come back (Retry-After, epoch ms): [Try again] counts down until then. */
  retryAt?: number;
  'data-testid'?: string;
}

/** Seconds left until `at` (0 when past), ticking once a second while it counts. */
function useSecondsLeft(at: number | undefined, now: () => number): number {
  const left = () => (at === undefined ? 0 : Math.max(0, Math.ceil((at - now()) / 1000)));
  const [s, setS] = React.useState(left);
  React.useEffect(() => {
    setS(left());
    if (at === undefined) return undefined;
    const id = window.setInterval(() => {
      const v = left();
      setS(v);
      if (v === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  return s;
}

const AI_CODES = new Set(['AI_NO_KEY', 'AI_AUTH', 'AI_NO_CREDIT', 'AI_MODEL_GATED', 'AI_FLAGGED', 'AI_PRIVACY_BLOCKS', 'AI_UNSUPPORTED', 'AI_MODEL_UNKNOWN', 'AI_TOO_LONG', 'AI_BAD_REQUEST', 'AI_BUSY', 'AI_FREE_LIMIT', 'AI_UPSTREAM', 'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_OFFLINE', 'AI_LENGTH', 'AI_HOST_NOT_ALLOWED', 'AI_BAD_ADDRESS']);
const RETRY = new Set(['AI_UPSTREAM', 'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_OFFLINE', 'AI_LENGTH', 'AI_TOO_LONG', 'AI_BAD_REQUEST', 'AI_UNSUPPORTED', 'AI_FLAGGED', 'CANCELLED', 'IO_ERROR', 'NOT_FOUND']);

/** The sentence for an error code (AI codes from `ai.errors`, the rest from `errors`). */
export function useAiErrorText(services: AppServices): (code: ErrorCode) => string {
  const { t } = useI18n();
  const reset = useResetTime();
  const s = useStore(services.ai.settings);
  return (code) => {
    if (!AI_CODES.has(code)) {
      try {
        return t(`errors.${code}` as MessageKey);
      } catch {
        return code;
      }
    }
    const model = services.ai.label(s.chain[0] ?? s.model).label;
    const level = t(s.privacy === 'zdr' ? 'ai.privacy.zdr' : s.privacy === 'standard' ? 'ai.privacy.standard' : 'ai.privacy.noTraining');
    return t(`ai.errors.${code}` as MessageKey, {
      model, level, limit: s.quota?.limit ?? 50, time: s.quota ? reset(s.quota) : '00:00', host: s.customHost?.label ?? '',
    });
  };
}

/** A failure as the student reads it: the sentence of its error code (never a raw English message), else its text. */
export function useErrorMessage(services: AppServices): (e: unknown) => string {
  const text = useAiErrorText(services);
  return (e) => {
    const code = (e as { code?: unknown } | null)?.code;
    return typeof code === 'string' && code ? text(code as ErrorCode) : String((e as Error | null)?.message ?? e);
  };
}

export function AiErrorNotice({ services, code, onRetry, onBusyFallback, retryAt, ...rest }: AiErrorNoticeProps) {
  const { t } = useI18n();
  const { go } = useRouter();
  const text = useAiErrorText(services);
  const wait = useSecondsLeft(retryAt, () => services.ctx.clock.now());
  // A rate limit with Retry-After (429 per minute, or 503): its own sentence, and [Try again] once the wait is over.
  const rateLimited = retryAt !== undefined && (code === 'AI_FREE_LIMIT' || code === 'AI_UNAVAILABLE' || code === 'AI_BUSY');
  if (code === 'AI_BUSY' && onRetry && onBusyFallback && !rateLimited) return <BusyChooser services={services} onRetry={onRetry} onOnce={onBusyFallback} />;
  const settings = () => go({ name: 'settings', section: 'ai' });
  const actions: React.ReactNode[] = [];
  switch (code) {
    case 'AI_NO_KEY':
      actions.push(<Button key="setup" variant="primary" icon={Settings2} onClick={settings} data-testid="ai-recover-setup">{t('ai.recovery.setUp')}</Button>);
      break;
    case 'AI_AUTH':
      actions.push(<Button key="key" variant="primary" onClick={settings} data-testid="ai-recover-key">{t('ai.recovery.updateKey')}</Button>);
      break;
    case 'AI_NO_CREDIT':
      actions.push(
        <Button key="free" variant="primary" onClick={() => void services.ai.setModel(DEFAULT_MODEL).then(() => onRetry?.())} data-testid="ai-recover-free">{t('ai.recovery.useFree')}</Button>,
      );
      break;
    case 'AI_MODEL_GATED':
    case 'AI_MODEL_UNKNOWN':
      actions.push(<Button key="model" onClick={settings} data-testid="ai-recover-model">{t('ai.recovery.changeModel')}</Button>);
      break;
    case 'AI_PRIVACY_BLOCKS':
      actions.push(<Button key="privacy" onClick={settings} data-testid="ai-recover-privacy">{t('ai.recovery.changePrivacy')}</Button>);
      break;
    case 'AI_HOST_NOT_ALLOWED':
    case 'AI_BAD_ADDRESS':
      actions.push(<Button key="host" onClick={settings} data-testid="ai-recover-host">{t('ai.recovery.setUp')}</Button>);
      break;
    case 'AI_BUSY':
      break;
    default:
      break;
  }
  if (onRetry && (RETRY.has(code) || code === 'AI_BUSY' || rateLimited)) {
    actions.push(
      <Button key="retry" icon={RefreshCw} onClick={onRetry} disabled={rateLimited && wait > 0} data-testid="ai-recover-retry" data-wait={rateLimited ? wait : undefined}>
        {rateLimited && wait > 0 ? t('ai.recovery.tryAgainIn', { s: wait }) : t('ai.recovery.tryAgain')}
      </Button>,
    );
  }
  return (
    <Notice tone={code === 'AI_FREE_LIMIT' || code === 'AI_OFFLINE' || rateLimited ? 'warning' : 'danger'} actions={actions.length ? <>{actions}</> : undefined} data-testid={rest['data-testid'] ?? 'ai-error'}>
      <span data-code={code} data-rate-limited={rateLimited || undefined}>{rateLimited ? t('ai.rateLimit.text') : text(code)}</span>
    </Notice>
  );
}
