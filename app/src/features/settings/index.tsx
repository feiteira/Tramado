// The settings screen (UX §3.14): a 200 px section list (`nav`) and a content column (max 760 px) hosting the
// SETTINGS_SECTIONS (AI, Transcription and Sharing belong to other packages). Changes apply at once. `data-zoom` on
// the screen is the text size in force (the must-pass check of plan §6.1).
import React, { Suspense, lazy } from 'react';
import { AudioWaveform, Bell, FolderSync, HardDrive, Info, Palette, ShieldCheck, Sparkles, User, type LucideIcon } from 'lucide-react';
import type { AppServices } from '../../services/types/common';
import { SETTINGS_SECTIONS } from '../registry';
import { SETTINGS_SECTIONS as ORDER, type Route, type SettingsSection } from '../../shell/routes';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useAppState } from '../../shell/AppState';
import { ErrorBoundary } from '../../shell/ErrorBoundary';
import { Spinner } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';
import './settings.css';

const sections = Object.fromEntries(Object.entries(SETTINGS_SECTIONS).map(([k, v]) => [k, lazy(v)])) as Record<SettingsSection, React.LazyExoticComponent<React.ComponentType<{ services: AppServices }>>>;

const ICONS: Record<SettingsSection, LucideIcon> = {
  profile: User, appearance: Palette, ai: Sparkles, transcription: AudioWaveform, sharing: FolderSync, notifications: Bell, storage: HardDrive, privacy: ShieldCheck, about: Info,
};

export default function SettingsScreen({ route, services }: { route: Extract<Route, { name: 'settings' }>; services: AppServices }) {
  const { t } = useI18n();
  const { replace } = useRouter();
  const { prefs } = useAppState();
  const section: SettingsSection = route.section ?? 'profile';
  const Section = sections[section];
  return (
    <>
      <ScreenHeader title={t('settings.title')} />
      <div className="settings-screen" data-testid="screen-settings" data-section={section} data-zoom={String(prefs.textSize)}>
        <nav className="settings-screen__nav" aria-label={t('settings.nav')}>
          <ul>
            {ORDER.map((s) => {
              const Icon = ICONS[s];
              return (
                <li key={s}>
                  <button
                    type="button"
                    className={cx('settings-screen__item', s === section && 'settings-screen__item--current')}
                    aria-current={s === section ? 'page' : undefined}
                    onClick={() => replace({ name: 'settings', section: s })}
                    data-testid={`settings-nav-${s}`}
                  >
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                    <span>{t(`settings.sections.${s}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="settings-screen__body">
          <ErrorBoundary key={section}>
            <Suspense fallback={<div className="settings-screen__loading"><Spinner /></div>}>
              <Section services={services} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
