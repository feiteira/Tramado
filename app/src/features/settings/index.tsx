// The settings screen frame (UX §3.14): the section list and the host of SETTINGS_SECTIONS. M0 builds the
// frame; UI-SHELL owns it in wave 2 (profile, appearance, notifications, storage, privacy, about).
import React, { Suspense, lazy } from 'react';
import type { AppServices } from '../../services/types/common';
import { SETTINGS_SECTIONS } from '../registry';
import { SETTINGS_SECTIONS as ORDER, type Route, type SettingsSection } from '../../shell/routes';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { Spinner } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';

const sections = Object.fromEntries(Object.entries(SETTINGS_SECTIONS).map(([k, v]) => [k, lazy(v)])) as Record<SettingsSection, React.LazyExoticComponent<React.ComponentType<{ services: AppServices }>>>;

export default function SettingsScreen({ route, services }: { route: Extract<Route, { name: 'settings' }>; services: AppServices }) {
  const { t } = useI18n();
  const { replace } = useRouter();
  const section: SettingsSection = route.section ?? 'profile';
  const Section = sections[section];
  return (
    <>
      <ScreenHeader title={t('settings.title')} />
      <div className="settings-screen" data-testid="screen-settings">
        <nav className="settings-screen__nav" aria-label={t('settings.nav')}>
          {ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={cx('settings-screen__item', s === section && 'settings-screen__item--current')}
              aria-current={s === section ? 'page' : undefined}
              onClick={() => replace({ name: 'settings', section: s })}
              data-testid={`settings-nav-${s}`}
            >
              {t(`settings.sections.${s}`)}
            </button>
          ))}
        </nav>
        <div className="settings-screen__body">
          <Suspense fallback={<Spinner />}>
            <Section key={section} services={services} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
