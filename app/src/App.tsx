// The app root: providers, document preferences and the phase switch (architecture §11.4, UX §2.1).
// Never StrictMode (D49): its doubled effects would create the services twice.
import React, { useEffect, useRef } from 'react';
import { UI_LOCALE_META } from './core/i18n/languages';
import type { Platform } from './platform/types';
import { AppStateProvider, useAppState, type AppStateOptions } from './shell/AppState';
import { BrandMark } from './shell/BrandMark';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { Layout } from './shell/Layout';
import { RouterProvider } from './shell/router';
import { DialogsProvider } from './shell/useDialogs';
import { UndoProvider } from './shell/undo';
import { loadFontPreference } from './ui/fonts';
import { I18nProvider, useI18n } from './ui/i18n';
import { ConfirmProvider } from './ui/components/Confirm';
import { Spinner } from './ui/components/Feedback';
import { ToastProvider } from './ui/components/Toast';
import Onboarding from './features/onboarding/index';

function Loading() {
  const { t } = useI18n();
  return (
    <div className="app-loading" data-testid="app-loading">
      <BrandMark size={36} />
      <Spinner size={18} label={t('common.loading')} />
    </div>
  );
}

function Root() {
  const { phase, initialDialog } = useAppState();
  switch (phase.name) {
    case 'loading':
      return <Loading />;
    case 'welcome':
      return <Onboarding />;
    case 'ready':
      return (
        <RouterProvider initial={phase.initialRoute ?? { name: 'today' }}>
          <DialogsProvider initial={initialDialog}>
            <UndoProvider>
              <Layout services={phase.services} />
            </UndoProvider>
          </DialogsProvider>
        </RouterProvider>
      );
  }
}

/** Theme, language, reading font and motion on <html>, so tokens and the browser follow them. */
function DocumentPrefs() {
  const { prefs, platform, phase } = useAppState();
  useEffect(() => {
    const html = document.documentElement;
    if (prefs.theme === 'system') delete html.dataset.theme;
    else html.dataset.theme = prefs.theme;
    html.lang = UI_LOCALE_META[prefs.locale].bcp47;
    if (prefs.reduceMotion) html.dataset.motion = 'reduce';
    else delete html.dataset.motion;
  }, [prefs.theme, prefs.locale, prefs.reduceMotion]);
  useEffect(() => {
    void loadFontPreference(prefs.readingFont).catch(() => undefined);
  }, [prefs.readingFont]);
  useEffect(() => {
    const f = prefs.textSize;
    if (f === 0.875 || f === 1 || f === 1.125 || f === 1.25 || f === 1.5) void platform.window.setZoom(f).catch(() => undefined);
  }, [platform, prefs.textSize]);
  // Boot marker (plan §2.3 item 11): once, after the first render of any phase.
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    platform.log('info', 'webview ready', { phase: phase.name });
  }, [platform, phase.name]);
  return null;
}

function Themed() {
  const { prefs, phase } = useAppState();
  return (
    <I18nProvider locale={prefs.locale}>
      <DocumentPrefs />
      <ErrorBoundary>
        <ToastProvider>
          <ConfirmProvider key={phase.name}>
            <Root />
          </ConfirmProvider>
        </ToastProvider>
      </ErrorBoundary>
    </I18nProvider>
  );
}

export interface AppProps {
  platform: Platform;
  options?: AppStateOptions;
}

export function App({ platform, options }: AppProps) {
  return (
    <AppStateProvider platform={platform} options={options}>
      <Themed />
    </AppStateProvider>
  );
}
