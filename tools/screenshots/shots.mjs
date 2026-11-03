// The manual's screenshots (UX §7.4). Each is taken from the browser demo (fictional, app/src/demo) in en,
// pt and es, with a fixed clock and seeded randomness, so the same code gives the same pictures.
// M0 ships two shots; UI-SHELL adds the rest of UX §7.4's table in wave 2.
//
// A shot is { name, query, ready?, steps?, keepFocus?, theme?, langs? }:
//   query      demo URL parameters (UX §7.2) besides lang, theme and clock
//   ready      a data-testid that must be visible before the steps run
//   steps      async (page, lang, { addFiles }) => drives the screen into the state shown
//   keepFocus  leave the focused element alone (a popover that closes on blur)
//   theme      'light' (default) or 'dark'; langs limits the languages (default: all)

export const SHOTS = [
  { name: 'welcome', query: 'demo=empty', ready: 'onboarding-welcome' },
  { name: 'today', query: 'route=today&sync=fake&ai=fake', ready: 'screen-today' },
];
