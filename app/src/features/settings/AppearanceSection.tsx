// Settings › Language and appearance (UX §3.14.2): language (native names), theme, text size (webview zoom on the
// desktop, CSS zoom in the demo: `platform.window.setZoom`, applied by App's DocumentPrefs from prefs `ui.textSize`),
// font (each option in its own face) and reduced motion.
import React, { useEffect } from 'react';
import { UI_LOCALES, UI_LOCALE_META, type UiLocale } from '../../core/i18n/languages';
import type { AppServices } from '../../services/types/common';
import { useAppState } from '../../shell/AppState';
import { RadioGroup } from '../../ui/components/Choice';
import { Select } from '../../ui/components/Field';
import { preloadFontPreviews } from '../../ui/fonts';
import { useI18n } from '../../ui/i18n';
import { Group, Row, SectionRoot } from './Group';

const SIZES = ['0.875', '1', '1.125', '1.25', '1.5'] as const;
type Size = (typeof SIZES)[number];
type Font = 'default' | 'atkinson' | 'opendyslexic';

export default function AppearanceSection({ services }: { services: AppServices }) {
  void services;
  const i18n = useI18n();
  const { t } = i18n;
  const app = useAppState();
  const { prefs } = app;
  useEffect(() => {
    void preloadFontPreviews().catch(() => undefined);
  }, []);
  const pct = (v: Size) => `${new Intl.NumberFormat(i18n.meta.bcp47, { maximumFractionDigits: 1 }).format(Number(v) * 100)} %`;
  const size = (SIZES as readonly string[]).includes(String(prefs.textSize)) ? (String(prefs.textSize) as Size) : '1';
  return (
    <SectionRoot testid="settings-appearance" title={t('settings.sections.appearance')}>
      <Group id="language">
        <Row label={t('settings.appearance.language')} stack>
          <RadioGroup
            label={t('settings.appearance.language')}
            hideLabel
            value={app.locale}
            onChange={(v: UiLocale) => void app.setPref('ui.locale', v)}
            options={UI_LOCALES.map((l) => ({ value: l, label: <span lang={UI_LOCALE_META[l].bcp47}>{UI_LOCALE_META[l].nativeName.replace(/ \(.*\)$/, '')}</span> }))}
            data-testid="appearance-language"
          />
        </Row>
      </Group>
      <Group id="look">
        <Row label={t('settings.appearance.theme')} labelId="appearance-theme-label">
          <RadioGroup
            label={t('settings.appearance.theme')}
            hideLabel
            variant="segmented"
            value={prefs.theme}
            onChange={(v: 'system' | 'light' | 'dark') => void app.setPref('ui.theme', v)}
            options={[
              { value: 'system', label: t('settings.appearance.themeSystem') },
              { value: 'light', label: t('settings.appearance.themeLight') },
              { value: 'dark', label: t('settings.appearance.themeDark') },
            ]}
            data-testid="appearance-theme"
          />
        </Row>
        <Row label={t('settings.appearance.textSize')} labelId="appearance-text-size-label">
          <Select
            aria-labelledby="appearance-text-size-label"
            value={size}
            onChange={(v: Size) => void app.setPref('ui.textSize', v)}
            options={SIZES.map((v) => ({ value: v, label: pct(v) }))}
            className="set-select"
            data-testid="appearance-text-size"
          />
        </Row>
        <Row label={t('settings.appearance.font')} stack>
          <RadioGroup
            label={t('settings.appearance.font')}
            hideLabel
            value={prefs.readingFont}
            onChange={(v: Font) => void app.setPref('ui.readingFont', v)}
            options={[
              { value: 'default', label: <span className="font-sample font-sample--default">{t('settings.appearance.fontDefault')}</span> },
              { value: 'atkinson', label: <span className="font-sample font-sample--atkinson">{t('settings.appearance.fontAtkinson')}</span> },
              { value: 'opendyslexic', label: <span className="font-sample font-sample--dyslexic">{t('settings.appearance.fontDyslexic')}</span> },
            ]}
            data-testid="appearance-font"
          />
        </Row>
        <Row label={t('settings.appearance.motion')}>
          <RadioGroup
            label={t('settings.appearance.motion')}
            hideLabel
            variant="segmented"
            value={prefs.reduceMotion ? '1' : 'system'}
            onChange={(v: 'system' | '1') => void app.setPref('ui.reduceMotion', v)}
            options={[
              { value: 'system', label: t('settings.appearance.motionSystem') },
              { value: '1', label: t('settings.appearance.motionOn') },
            ]}
            data-testid="appearance-motion"
          />
        </Row>
      </Group>
    </SectionRoot>
  );
}
