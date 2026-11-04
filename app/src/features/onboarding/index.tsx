// Onboarding (UX §3.1): four steps, about a minute, only the name required. Steps 1–2 run in the welcome
// phase (no services: nothing leaves the computer); Continue on step 2 creates the sharing identity, the person
// key and identity.json, starts the services and steps 3–4 continue in the ready phase (Layout renders this
// component with `services`), so the AI key test goes through AiService.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardPaste, Copy, Eye, EyeOff, ExternalLink, FolderOpen, KeyRound, LogIn, Plus, ShieldCheck, Sparkles, UserRoundX, Folders } from 'lucide-react';
import { UI_LOCALES, UI_LOCALE_META, type UiLocale } from '../../core/i18n/languages';
import { errorCode, toPlatformError } from '../../core/errors';
import type { AppServices } from '../../services/types/common';
import { BrandMark } from '../../shell/BrandMark';
import { useAppState } from '../../shell/AppState';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { Notice, Spinner } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { renderMarks } from '../../ui/marks';
import { problemKey } from '../../ui/problems';
import { cx } from '../../ui/cx';
import { cloudServiceOf, firstName } from './cloud';
import { Specimen } from './Specimen';
import './onboarding.css';

type Step = 'welcome' | 'name' | 'ai' | 'ready';
const STEP_N: Record<Step, number> = { welcome: 1, name: 2, ai: 3, ready: 4 };
const KEYS_URL = 'https://openrouter.ai/keys';
/** The Recommended speech model's size (UX X7). */
const MODEL_MB = 574;

export interface OnboardingProps {
  /** The ready phase's services: steps 3–4 (AI key, ready). Absent in the welcome phase (steps 1–2). */
  services?: AppServices;
  /** Leaves onboarding; `then` opens the New class or Join dialog over Today. */
  onFinish?: (then: 'create' | 'join' | null) => void;
}

export default function Onboarding({ services, onFinish }: OnboardingProps) {
  const [step, setStep] = useState<Step>(services ? 'ai' : 'welcome');
  return (
    <main className="onb" data-testid="onboarding" data-step={step}>
      <div className="onb__intro">
        <div className="onb__column">
          {step !== 'welcome' ? <Steps n={STEP_N[step]} /> : null}
          {step === 'welcome' ? <Welcome onStart={() => setStep('name')} /> : null}
          {step === 'name' ? <NameStep services={services} onBack={services ? null : () => setStep('welcome')} onDone={() => setStep('ai')} /> : null}
          {step === 'ai' && services ? <AiStep services={services} onBack={() => setStep('name')} onDone={() => setStep('ready')} /> : null}
          {step === 'ready' && services ? <ReadyStep services={services} onBack={() => setStep('ai')} onFinish={(then) => onFinish?.(then)} /> : null}
        </div>
      </div>
      <div className="onb__picture paper-grid" aria-hidden="true">
        <Specimen />
      </div>
    </main>
  );
}

/** "Step {n} of 4": four dots, the words for screen readers. */
function Steps({ n }: { n: number }) {
  const { t } = useI18n();
  return (
    <div className="onb__steps" data-testid="onboarding-step">
      <span className="visually-hidden">{t('onboarding.step', { n })}</span>
      <span className="onb__dots" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cx('onb__dot', i < n && 'onb__dot--done', i === n && 'onb__dot--current')} />
        ))}
      </span>
      <span className="onb__steps-label" aria-hidden="true">{t('onboarding.step', { n })}</span>
    </div>
  );
}

function Welcome({ onStart }: { onStart(): void }) {
  const { t } = useI18n();
  const app = useAppState();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tryExample = async () => {
    setBusy(true);
    try {
      await app.startExample();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <section className="onb__step onb__step--welcome" data-testid="onboarding-welcome" aria-labelledby="onb-title">
      <div className="onb__brand">
        <BrandMark size={36} />
        <span className="wordmark onb__wordmark" translate="no">Tramado</span>
      </div>
      <h1 id="onb-title" className="display onb__headline" tabIndex={-1}>{renderMarks(t('onboarding.welcome.headline'))}</h1>
      <p className="onb__lead">{t('onboarding.welcome.lead')}</p>
      <div className="onb__actions">
        <Button variant="primary" size="lg" onClick={onStart} iconEnd={ArrowRight} data-testid="onboarding-start">
          {t('onboarding.welcome.start')}
        </Button>
        <Button variant="secondary" size="lg" icon={Sparkles} busy={busy} onClick={() => void tryExample()} data-testid="onboarding-example">
          {t('onboarding.welcome.example')}
        </Button>
      </div>
      <ul className="onb__promise">
        <li>
          <UserRoundX size={18} strokeWidth={1.75} aria-hidden />
          <span>
            <b>{t('onboarding.welcome.promise.accountTitle')}</b>
            {t('onboarding.welcome.promise.account')}
          </span>
        </li>
        <li>
          <Folders size={18} strokeWidth={1.75} aria-hidden />
          <span>
            <b>{t('onboarding.welcome.promise.foldersTitle')}</b>
            {t('onboarding.welcome.promise.folders')}
          </span>
        </li>
        <li>
          <KeyRound size={18} strokeWidth={1.75} aria-hidden />
          <span>
            <b>{t('onboarding.welcome.promise.aiTitle')}</b>
            {t('onboarding.welcome.promise.ai')}
          </span>
        </li>
      </ul>
      <RadioGroup
        className="onb__language"
        label={t('onboarding.welcome.language')}
        variant="segmented"
        value={app.locale}
        onChange={(v: UiLocale) => void app.setPref('ui.locale', v)}
        options={UI_LOCALES.map((l) => ({ value: l, label: <span lang={UI_LOCALE_META[l].bcp47}>{UI_LOCALE_META[l].nativeName.replace(/ \(.*\)$/, '')}</span> }))}
        data-testid="onboarding-language"
      />
      <p className="onb__footnote">{t('onboarding.welcome.footnote')}</p>
    </section>
  );
}

/** Step 2: the name, this computer's name, where classes are kept. */
function NameStep({ services, onBack, onDone }: { services?: AppServices; onBack: (() => void) | null; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const app = useAppState();
  const { platform } = app;
  const toast = useToast();
  const me = useStore(services ? services.ctx.identity : NO_IDENTITY);
  const [name, setName] = useState(me?.name ?? '');
  const [device, setDevice] = useState<string | null>(me?.deviceName ?? null);
  const [editingDevice, setEditingDevice] = useState(false);
  const [laptop, setLaptop] = useState(true);
  const [root, setRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [showRequired, setShowRequired] = useState(false);
  const deviceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void platform.system.power().then((p) => live && setLaptop(p.source === 'battery'), () => undefined);
    void platform.classes.root().then((r) => live && setRoot(r.path), () => undefined);
    return () => {
      live = false;
    };
  }, [platform]);
  useEffect(() => {
    if (editingDevice) deviceRef.current?.focus();
  }, [editingDevice]);

  const first = firstName(name);
  const suggested = first ? t(laptop ? 'onboarding.name.deviceLaptop' : 'onboarding.name.deviceComputer', { name: first }) : '';
  const deviceName = (device ?? suggested).trim();
  const cloud = root ? cloudServiceOf(root) : null;

  const chooseFolder = async () => {
    try {
      const pick = await platform.dialogs.pickFolder({ title: t('onboarding.name.folderChange') });
      if (!pick) return;
      const r = await platform.classes.setRoot(pick.token);
      setRoot(r.path);
    } catch (e) {
      toast.error(e);
    }
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setShowRequired(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (services) await app.updateIdentity({ name: trimmed, deviceName: deviceName || trimmed });
      else await app.finishOnboarding({ name: trimmed, deviceName: deviceName || trimmed });
      onDone();
    } catch (e) {
      const pe = toPlatformError(e);
      setError({ code: pe.code, message: pe.message });
      setBusy(false);
    }
  };

  const copyDiagnostics = async () => {
    try {
      const d = await platform.system.diagnostics().catch(() => null);
      const info = await platform.info().catch(() => null);
      await navigator.clipboard.writeText(JSON.stringify({ app: info, diagnostics: d, error }, null, 2));
      toast.show({ message: t('settings.about.diagnosticsCopied'), tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <form
      className="onb__step"
      data-testid="onboarding-name"
      aria-labelledby="onb-name-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1 id="onb-name-title" className="onb__title" tabIndex={-1}>{t('onboarding.name.title')}</h1>
      <TextField
        label={t('onboarding.name.label')}
        placeholder={t('onboarding.name.placeholder')}
        value={name}
        onChange={(v) => {
          setName(v.slice(0, 64));
          if (v.trim()) setShowRequired(false);
        }}
        hint={t('onboarding.name.hint')}
        error={showRequired ? t('onboarding.name.required') : undefined}
        maxLength={64}
        required
        autoFocus
        autoComplete="name"
        size="lg"
        data-testid="onboarding-name-input"
      />
      {deviceName || editingDevice ? (
        <div className="onb__line" data-testid="onboarding-device">
          {editingDevice ? (
            <TextField
              ref={deviceRef}
              label={t('onboarding.name.deviceLabel')}
              value={device ?? suggested}
              onChange={(v) => setDevice(v.slice(0, 64))}
              maxLength={64}
              onBlur={() => {
                if (!device?.trim()) setDevice(null);
                setEditingDevice(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  if (!device?.trim()) setDevice(null);
                  setEditingDevice(false);
                }
              }}
              data-testid="onboarding-device-input"
            />
          ) : (
            <>
              <span>{t('onboarding.name.device', { device: deviceName })}</span>
              <Button variant="ghost" size="sm" onClick={() => setEditingDevice(true)} data-testid="onboarding-device-change">
                {t('common.change')}
              </Button>
            </>
          )}
        </div>
      ) : null}
      {!services ? (
        <div className="onb__line onb__folder" data-testid="onboarding-folder">
          <FolderOpen size={16} strokeWidth={1.75} aria-hidden />
          <span>{withNode(t('onboarding.name.folder', { path: '\u0000' }), <code className="onb__path">{root ?? '…'}</code>)}</span>
          <Button variant="ghost" size="sm" onClick={() => void chooseFolder()} data-testid="onboarding-folder-change">
            {t('onboarding.name.folderChange')}
          </Button>
        </div>
      ) : null}
      {cloud && !services ? (
        <Notice
          tone="warning"
          data-testid="onboarding-cloud-warning"
          actions={
            <Button size="sm" onClick={() => void chooseFolder()}>
              {t('onboarding.name.cloudChoose')}
            </Button>
          }
        >
          {t('onboarding.name.cloudWarning', { service: cloud })}
        </Notice>
      ) : null}
      {error ? (
        error.code === 'SYNC_UNAVAILABLE' ? (
          <Notice
            tone="danger"
            data-testid="onboarding-identity-error"
            actions={
              <Button size="sm" icon={Copy} onClick={() => void copyDiagnostics()} data-testid="onboarding-copy-diagnostics">
                {t('settings.about.copyDiagnostics')}
              </Button>
            }
          >
            {t('onboarding.name.identityError')}
          </Notice>
        ) : (
          <Notice tone="danger" data-testid="onboarding-name-error">
            {t(problemKey(error) ?? 'common.unknownError', { message: error.message })}
          </Notice>
        )
      ) : null}
      <div className="onb__nav">
        {onBack ? (
          <Button variant="ghost" icon={ArrowLeft} onClick={onBack} disabled={busy} data-testid="onboarding-back">
            {t('common.back')}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!name.trim()} data-testid="onboarding-name-continue">
          {t('common.continue')}
        </Button>
      </div>
    </form>
  );
}

type AiResult =
  | { kind: 'checking' }
  | { kind: 'ok'; model: string; n: number | null }
  | { kind: 'bad' }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string };

/** Step 3: the OpenRouter key, tested through AiService (`GET key`). */
function AiStep({ services, onBack, onDone }: { services: AppServices; onBack(): void; onDone(): void }) {
  const { t } = useI18n();
  const { platform } = useAppState();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const checking = result?.kind === 'checking';
  const ok = result?.kind === 'ok';

  const test = async () => {
    if (!key.trim()) return;
    setResult({ kind: 'checking' });
    try {
      await services.ai.setKey(key.trim());
      const r = await services.ai.testKey();
      const model = services.ai.label(services.ai.settings.get().model).label;
      if (r.ok) setResult({ kind: 'ok', model, n: r.remaining ?? null });
      else if (r.code === 'AI_AUTH') {
        await services.ai.clearKey().catch(() => undefined);
        setResult({ kind: 'bad' });
      } else if (r.code === 'AI_OFFLINE') setResult({ kind: 'offline' });
      else setResult({ kind: 'failed', message: t(problemKey({ code: r.code }) ?? 'common.unknownError', { message: r.code ?? '' }) });
    } catch (e) {
      const code = errorCode(e);
      setResult({ kind: 'failed', message: t(problemKey(e) ?? 'common.unknownError', { message: code ?? String(e) }) });
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setKey(text.trim());
    } catch {
      // The clipboard may be refused; typing still works.
    }
  };

  const openKeys = () =>
    void platform.system
      .openExternal(KEYS_URL, { title: t('app.external.title'), message: t('app.external.body', { host: 'openrouter.ai' }), confirm: t('app.external.open'), cancel: t('common.cancel') })
      .catch(() => undefined);

  return (
    <form
      className="onb__step"
      data-testid="onboarding-ai"
      aria-labelledby="onb-ai-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onDone();
        else void test();
      }}
    >
      <h1 id="onb-ai-title" className="onb__title" tabIndex={-1}>
        {t('onboarding.ai.title')}
      </h1>
      <p className="onb__body">{t('onboarding.ai.body')}</p>
      <div className="onb__key">
        <TextField
          label={t('onboarding.ai.keyLabel')}
          type={show ? 'text' : 'password'}
          placeholder="sk-or-…"
          value={key}
          onChange={(v) => {
            setKey(v);
            if (result && result.kind !== 'checking') setResult(null);
          }}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="onb__key-input"
          trailing={<IconButton icon={show ? EyeOff : Eye} size="sm" label={show ? t('onboarding.ai.hideKey') : t('onboarding.ai.showKey')} onClick={() => setShow((s) => !s)} data-testid="onboarding-ai-show" />}
          data-testid="onboarding-ai-key"
        />
        <Button icon={ClipboardPaste} onClick={() => void paste()} data-testid="onboarding-ai-paste">
          {t('common.paste')}
        </Button>
      </div>
      <button type="button" className="link onb__getkey" onClick={openKeys} data-testid="onboarding-ai-getkey">
        {t('onboarding.ai.getKey')}
        <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
      </button>
      <Notice tone="info" className="onb__age">{t('onboarding.ai.age')}</Notice>
      <p className="onb__privacy">
        <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
        <span>{t('onboarding.ai.privacy')}</span>
      </p>
      {result ? <AiResultLine result={result} /> : null}
      <div className="onb__nav">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack} disabled={checking} data-testid="onboarding-back">
          {t('common.back')}
        </Button>
        <div className="onb__nav-end">
          <Button variant="ghost" onClick={onDone} disabled={checking} data-testid="onboarding-ai-skip">
            {t('onboarding.ai.skip')}
          </Button>
          {ok ? (
            <Button type="submit" variant="primary" size="lg" iconEnd={ArrowRight} data-testid="onboarding-ai-continue">
              {t('common.continue')}
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="lg" busy={checking} disabled={!key.trim()} data-testid="onboarding-ai-test">
              {t('onboarding.ai.test')}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function AiResultLine({ result }: { result: AiResult }) {
  const { t } = useI18n();
  switch (result.kind) {
    case 'checking':
      return (
        <div className="notice notice--neutral onb__checking" role="status" data-testid="onboarding-ai-result" data-state="checking">
          <Spinner size={16} />
          <span className="notice__content">{t('onboarding.ai.checking')}</span>
        </div>
      );
    case 'ok':
      return (
        <Notice tone="success" data-testid="onboarding-ai-result" data-state="ok">
          {result.n !== null ? t('onboarding.ai.ok', { model: result.model, n: result.n }) : t('onboarding.ai.okNoQuota', { model: result.model })}
        </Notice>
      );
    case 'bad':
      return <Notice tone="danger" data-testid="onboarding-ai-result">{t('onboarding.ai.bad')}</Notice>;
    case 'offline':
      return <Notice tone="warning" data-testid="onboarding-ai-result">{t('onboarding.ai.offline')}</Notice>;
    default:
      return <Notice tone="danger" data-testid="onboarding-ai-result">{result.message}</Notice>;
  }
}

/** Step 4: create or join, or go to Today. */
function ReadyStep({ services, onBack, onFinish }: { services: AppServices; onBack(): void; onFinish(then: 'create' | 'join' | null): void }) {
  const { t } = useI18n();
  const me = useStore(services.ctx.identity);
  return (
    <section className="onb__step" data-testid="onboarding-ready" aria-labelledby="onb-ready-title">
      <h1 id="onb-ready-title" className="onb__title display" tabIndex={-1}>
        {t('onboarding.ready.title', { name: firstName(me?.name ?? '') })}
      </h1>
      <div className="onb__cards">
        <button type="button" className="onb__card" onClick={() => onFinish('create')} data-testid="onboarding-create">
          <span className="onb__card-icon" aria-hidden>
            <Plus size={20} strokeWidth={1.75} />
          </span>
          <span className="onb__card-title">{t('onboarding.ready.createTitle')}</span>
          <span className="onb__card-body">{t('onboarding.ready.create')}</span>
        </button>
        <button type="button" className="onb__card" onClick={() => onFinish('join')} data-testid="onboarding-join">
          <span className="onb__card-icon" aria-hidden>
            <LogIn size={20} strokeWidth={1.75} />
          </span>
          <span className="onb__card-title">{t('onboarding.ready.joinTitle')}</span>
          <span className="onb__card-body">{t('onboarding.ready.join')}</span>
        </button>
      </div>
      <p className="onb__body onb__model">{t('onboarding.ready.model', { size: t('common.size.mb', { n: MODEL_MB }) })}</p>
      <div className="onb__nav">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack} data-testid="onboarding-back">
          {t('common.back')}
        </Button>
        <Button variant="ghost" iconEnd={ArrowRight} onClick={() => onFinish(null)} data-testid="onboarding-finish">
          {t('onboarding.ready.finish')}
        </Button>
      </div>
    </section>
  );
}

const NO_IDENTITY = { get: () => null, subscribe: () => () => undefined };

/** A translated sentence with one React node where the placeholder was (the template got '\u0000' for it). */
function withNode(text: string, node: React.ReactNode): React.ReactNode {
  const [before, after] = text.split('\u0000');
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}
