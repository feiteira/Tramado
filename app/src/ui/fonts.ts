// Accessibility fonts load lazily, only when chosen (UX §1.4): Settings → Language and appearance → Font.

export type FontPreference = 'default' | 'atkinson' | 'opendyslexic';

/** Imports the chosen font's CSS (once) and sets html[data-font]; 'default' removes the attribute. */
export async function loadFontPreference(pref: FontPreference): Promise<void> {
  if (pref === 'atkinson') await import('@fontsource-variable/atkinson-hyperlegible-next/wght.css');
  if (pref === 'opendyslexic') {
    await import('@fontsource/opendyslexic/400.css');
    await import('@fontsource/opendyslexic/700.css');
  }
  if (typeof document === 'undefined') return;
  if (pref === 'default') delete document.documentElement.dataset.font;
  else document.documentElement.dataset.font = pref;
}

/** Loads both accessibility fonts' faces without choosing either, so Settings can show each option in its own font. */
export async function preloadFontPreviews(): Promise<void> {
  await Promise.all([
    import('@fontsource-variable/atkinson-hyperlegible-next/wght.css'),
    import('@fontsource/opendyslexic/400.css'),
  ]);
}
