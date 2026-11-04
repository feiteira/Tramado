// The manual's screenshots (UX §7.4). Each is taken from the browser demo (fictional, app/src/demo) in en, pt and
// es (unless `langs` says otherwise), with a fixed clock and seeded randomness, so the same code gives the same
// pictures. `npm run screenshots` (tools/screenshots/capture.mjs) runs them and writes PNGs to docs/manual/img/<lang>/
// (git-ignored there); the manual commits lossless WebP copies of the ones it uses (AGENTS.md, "Manual screenshots").
//
// A shot is { name, query, ready?, steps?, keepFocus?, theme?, langs? }:
//   query      demo URL parameters (UX §7.2) besides lang, theme and clock
//   ready      a data-testid that must be visible before the steps run
//   steps      async (page, lang, { addFiles }) => drives the screen into the state shown
//   keepFocus  leave the focused element alone (a popover that closes on blur)
//   theme      'light' (default) or 'dark'; langs limits the languages (default: all)

/** The join shot's invite: `code=demo` is the demo's fictional fixture (app/src/demo/keys.ts DEMO_JOIN_CODE). */
export const JOIN_CODE = 'demo';

const byId = (page, id) => page.getByTestId(id).first();
const NAME = { en: 'Ana Ribeiro', pt: 'Ana Ribeiro', es: 'Ana Ribeiro' };

export const SHOTS = [
  { name: 'welcome', query: 'demo=empty', ready: 'onboarding-welcome' },
  {
    name: 'onboarding-ai',
    query: 'demo=empty&ai=fake',
    ready: 'onboarding-welcome',
    steps: async (page, lang) => {
      await byId(page, 'onboarding-start').click();
      await byId(page, 'onboarding-name-input').fill(NAME[lang]);
      await byId(page, 'onboarding-name-continue').click();
      await byId(page, 'onboarding-ai').waitFor();
    },
  },
  { name: 'today', query: 'route=today&sync=fake&ai=fake', ready: 'screen-today' },
  { name: 'class-lectures', query: 'route=class&class=law&tab=lectures&sync=fake', ready: 'lecture-list' },
  { name: 'lecture', query: 'route=lecture&class=law&lecture=l6&cite=1&ai=fake', ready: 'lecture-transcript' },
  { name: 'lecture-dark', query: 'route=lecture&class=law&lecture=l6&cite=1&ai=fake', ready: 'lecture-transcript', theme: 'dark', langs: ['en'] },
  {
    name: 'lecture-ai',
    query: 'route=lecture&class=law&lecture=l6&ai=fake',
    ready: 'lecture-transcript',
    steps: async (page) => {
      await byId(page, 'lecture-side-ai').click();
    },
  },
  { name: 'record-dialog', query: 'route=class&class=law&speech=fake&dialog=record', ready: 'record-dialog' },
  { name: 'recording', query: 'route=lecture&class=law&lecture=l7&speech=fake&recording=1', ready: 'record-dock' },
  { name: 'model-prompt', query: 'route=lecture&class=bio&lecture=b4&model=missing&dialog=model', ready: 'model-prompt' },
  { name: 'documents', query: 'route=class&class=law&tab=documents', ready: 'doc-list' },
  {
    name: 'document-pdf',
    query: 'route=document&class=law&doc=lf&page=9&quote=nunca%20podem%20atingir',
    ready: 'doc-pdf-page',
    steps: async (page) => {
      await page.locator('mark.cite').first().waitFor({ timeout: 30000 });
    },
  },
  { name: 'exam-review', query: 'route=exam&class=law&exam=mock&mode=review', ready: 'exam-review' },
  {
    name: 'exam-answers',
    query: 'route=exam&class=law&exam=mock&q=IIb&ai=fake',
    ready: 'question-list',
    steps: async (page) => {
      await byId(page, 'reveal-answer').click();
    },
  },
  {
    name: 'exam-practice',
    query: 'route=exam&class=law&exam=mock&mode=practice',
    ready: 'exam-practice',
    steps: async (page) => {
      await page.keyboard.press('Space');
    },
  },
  { name: 'chat', query: 'route=class&class=law&tab=chat&sync=fake', ready: 'chat-list' },
  { name: 'ask', query: 'route=class&class=law&tab=ask&ai=fake', ready: 'ask-thread' },
  { name: 'members', query: 'route=class&class=law&tab=members&sync=fake&join=ask', ready: 'member-list' },
  { name: 'invite', query: 'route=class&class=law&tab=members&sync=fake&dialog=invite', ready: 'invite-dialog' },
  {
    name: 'join',
    query: `route=today&sync=fake&dialog=join&code=${JOIN_CODE}`,
    ready: 'join-dialog',
    steps: async (page) => {
      await byId(page, 'join-continue').click();
    },
  },
  {
    name: 'palette',
    query: 'route=class&class=law',
    ready: 'screen-class',
    keepFocus: true,
    steps: async (page) => {
      await page.keyboard.press('Control+K');
      await byId(page, 'palette-input').fill('conteúdo essencial');
      await byId(page, 'palette-result').waitFor({ timeout: 30000 }).catch(() => {});
    },
  },
  { name: 'settings-ai', query: 'route=settings&section=ai&ai=fake', ready: 'settings-ai' },
  { name: 'settings-transcription', query: 'route=settings&section=transcription&model=downloading', ready: 'settings-transcription' },
  {
    name: 'settings-sharing',
    query: 'route=settings&section=sharing&sync=fake',
    ready: 'settings-sharing',
    steps: async (page) => {
      await byId(page, 'sharing-diagnostics').click();
    },
  },
  { name: 'settings-privacy', query: 'route=settings&section=privacy&ai=fake', ready: 'settings-privacy' },
  { name: 'empty-class', query: 'route=class&class=stats&tab=lectures', ready: 'lectures-empty' },
  {
    name: 'ai-busy',
    query: 'route=class&class=law&tab=ask&ai=busy',
    ready: 'ask-thread',
    langs: ['en'],
    steps: async (page) => {
      const input = page.getByTestId('ask-input').first();
      const field = (await input.evaluate((n) => n.tagName)) === 'TEXTAREA' || (await input.evaluate((n) => n.tagName)) === 'INPUT' ? input : input.locator('textarea, input').first();
      await field.fill('teste');
      await byId(page, 'ask-send').click();
      await byId(page, 'ai-busy-chooser').waitFor({ timeout: 30000 });
    },
  },
];
