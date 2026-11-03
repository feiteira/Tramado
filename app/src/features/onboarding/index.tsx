// PLACEHOLDER (M0) → UI-SHELL builds onboarding in wave 2 (UX §3.1, phase `welcome`). M0 renders the
// welcome step's ready marker and a minimal name step so the app can be entered at all.
import React, { useState } from 'react';
import { BrandMark } from '../../shell/BrandMark';
import { useAppState } from '../../shell/AppState';
import { Button } from '../../ui/components/Button';
import { TextField } from '../../ui/components/Field';
import { RadioGroup } from '../../ui/components/Choice';
import { useI18n } from '../../ui/i18n';
import { UI_LOCALES, UI_LOCALE_META, type UiLocale } from '../../core/i18n/languages';
import { renderMarks } from '../../ui/marks';

export default function Onboarding() {
  const { t } = useI18n();
  const app = useAppState();
  const [step, setStep] = useState<'welcome' | 'name'>('welcome');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="onboarding paper-grid">
      <div className="onboarding__panel">
        <div className="onboarding__brand">
          <BrandMark size={36} />
          <span className="wordmark" translate="no">Tramado</span>
        </div>
        {step === 'welcome' ? (
          <section data-testid="onboarding-welcome" className="onboarding__step">
            <h1 className="display onboarding__headline">{renderMarks(t('onboarding.welcome.headline'))}</h1>
            <p className="onboarding__lead">{t('onboarding.welcome.lead')}</p>
            <div className="onboarding__actions">
              <Button variant="primary" size="lg" onClick={() => setStep('name')} data-testid="onboarding-start">{t('onboarding.welcome.start')}</Button>
            </div>
            <RadioGroup
              label={t('onboarding.welcome.language')}
              variant="segmented"
              value={app.locale}
              onChange={(v: UiLocale) => void app.setPref('ui.locale', v)}
              options={UI_LOCALES.map((l) => ({ value: l, label: UI_LOCALE_META[l].nativeName.replace(/ \(.*\)$/, '') }))}
              data-testid="onboarding-language"
            />
            <p className="t-small t-muted">{t('onboarding.welcome.footnote')}</p>
            <pre className="placeholder__data" data-testid="placeholder-data">{JSON.stringify({ phase: 'welcome', locale: app.locale })}</pre>
          </section>
        ) : (
          <form
            data-testid="onboarding-name"
            className="onboarding__step"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setBusy(true);
              void app.finishOnboarding({ name }).finally(() => setBusy(false));
            }}
          >
            <h1>{t('onboarding.name.title')}</h1>
            <TextField label={t('onboarding.name.label')} placeholder={t('onboarding.name.placeholder')} value={name} onChange={setName} hint={t('onboarding.name.hint')} autoFocus data-testid="onboarding-name-input" />
            <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()} data-testid="onboarding-name-continue">{t('common.continue')}</Button>
          </form>
        )}
      </div>
    </main>
  );
}
