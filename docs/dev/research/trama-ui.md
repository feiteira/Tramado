# Trama's UI layer and tooling, and how Tramado reuses it

Research for **Tramado** (Tauri 2 + React 18 + TS + Rust, MPL-2.0). Source studied (read only): `/home/feiteira/Trama`.
Lab (my experiments, all runnable): `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/trama-ui/`
(`LAB` below).

---

## 0. TL;DR

1. **Trama's UI layer ports almost verbatim.** `app/src/ui/**` (tokens, 14 components, focus/position/grow/
   splitSize/media/color helpers, typed i18n) has no QDA or crypto coupling, apart from 3 imports listed in §1.7 (color.ts, ColorPicker, problems.ts).
   Copy it, then change the token *values*, not the token *names*. Every component then picks up Tramado's look.
2. **Shell pattern to copy:** `AppStateProvider` (a phase machine plus prefs, savers and holds), an in-memory history-stack
   `RouterProvider` (typed `Route` union, `go/replace/back/drop`, focus return), a lazy `registry.tsx` (one
   screen per route), `ScreenHeader`, the command palette (`commands.ts` + `useCommands`), `ErrorBoundary`,
   `arrival.ts` (moves the focus to the screen's h1). Drop: lock/unlock/keyring/auto-lock/CoderGate/BackupScheduler.
3. **Identity proposal ("caderno", the exercise book).** Bright, cool paper and graphite ink. The accent is **ballpoint blue `#2f4fd6`**.
   **Highlighter yellow** marks what an AI answer cites. **Violet `#6b46d9`** means "a model wrote this".
   **Rec red** means live. **One colour per class**, used like binder dividers. Dark mode is a "blackboard slate".
   Fonts are **Figtree** (UI), **Bricolage Grotesque** (display), **Source Serif 4** (reading, opsz), all
   `@fontsource-variable` 5.3.x. A full `tokens.css` was written and contrast-checked (every text pair ≥ 4.5:1, both
   themes). It was rendered in two mock screens in light and dark (`LAB/mock/*.png`).
4. **Per-class colour in pure CSS:** `--c` is the only inline value. `--c-text: color-mix(in oklab, var(--c) 50%, var(--ink))`
   reaches ≥ 4.98:1 for all 12 class colours in both themes, because mixing with ink darkens in light mode and lightens in dark mode.
5. **Demo + screenshots:** in a plain browser `main.tsx` boots `demo/boot.ts`, an in-memory platform with fakes,
   driven by URL parameters (`lang, theme, clock, route, demo=empty, speech=fake, service=fake`). `tools/screenshots/
   capture.mjs` runs Vite **in-process** (no HMR) and drives Playwright (`playwright-core`) through `shots.mjs` steps keyed by
   `data-testid`. I wrote and **verified** a one-shot agent tool, `LAB/scripts/peek.mjs`: Vite + Chromium + settle +
   axe-core + overflow check, JSON output, about 2.3 s per screen on this machine.
6. **The desktop e2e** (`tools/desktop-e2e/run.mjs`, WebDriver through `tauri-driver`) can run here: `tauri-driver`,
   `WebKitWebDriver` 2.52.6, `xvfb-run`, `ffmpeg` and `convert` are all installed. Copy its harness. Replace "no network" with
   "only openrouter.ai + 127.0.0.1:<syncthing>", and replace the "encrypted on disk" check with "the API key is never in a synced folder".

---

## 1. Trama's UI layer

### 1.1 Files (line counts)

```
app/index.html                      CSP meta, pre-paint background, inline SVG favicon
app/src/main.tsx (24)               Tauri? createTauriPlatform : await import('./demo/boot').bootDemo()
app/src/App.tsx (102)               provider stack + phase switch
app/src/ui/tokens.css               all design tokens + base element styles
app/src/ui/fonts.css                @fontsource-variable imports
app/src/ui/app.css (15)             #root isolation, .app-loading
app/src/ui/i18n.tsx                 I18nProvider/useI18n/makeI18n (t, tp, date, time, relative)
app/src/ui/icons.ts                 `export * from 'lucide-react'` (one place to swap/trim)
app/src/ui/cx.ts color.ts focus.ts grow.ts position.ts media.ts splitSize.ts problems.ts confirmMatch.ts (+ tests)
app/src/ui/components/  Button(84) Choice(146) ColorPicker(92) Confirm(129) Dialog(162) Feedback(139) Field(248)
                        Menu(239) Popover(98) SplitPane(134) Table(52) Tabs(77) Toast(155) Tooltip(75) floating.ts(86)
                        + one .css per component, index.ts re-exports
app/src/shell/          AppState(406) router(163) ProjectShell(295) ScreenHeader(90) CommandPalette(143) commands(109)
                        useCommands(22) ErrorBoundary(65) arrival(83) activity.web(103) useLive(71) reloadGate(84)
                        savers(87) undo(105) nav(38) keys(23) helpTopic(27) initial(14) LockingScreen CoderGate
                        BackupScheduler Placeholder, shell.css(478) palette.css errorboundary.css
app/src/features/registry.tsx       route name → lazy(() => import('./<feature>'))
app/src/demo/                       boot.ts(106) exampleSession/Library/Project + example/{types,structure,en,pt,es}
tools/screenshots/                  capture.mjs, shots.mjs, fixtures/<lang>/*
tools/desktop-e2e/                  run.mjs (1085), README.md
```

Package versions (app/package.json): react 18.3.1, lucide-react 1.52.0, luxon 3.7.2, vite 8.3.1, @vitejs/plugin-react
6.1.1, vitest 5.0.2, typescript 5.9.3, playwright-core 1.62.1, @fontsource-variable/instrument-sans 5.3.0 and
literata 5.3.0. Latest today: lucide-react **1.67.0**, playwright-core **1.64.1** (see the gotcha in §4.6).

### 1.2 Palette (tokens.css)

The palette rule is written at the top of the file: *"surfaces are paper and text is ink. The colours of codes are the only saturated colour on
screen; interface accents stay in the ink family."*

| token | light | dark | use |
|---|---|---|---|
| `--paper` | `#f3f1eb` | `#1e1d1b` | window |
| `--paper-raised` | `#fbfaf7` | `#272623` | cards, dialogs, fields |
| `--paper-sunk` | `#e9e6de` | `#181715` | rail, wells |
| `--paper-hover` / `-active` | `#e4e0d6` / `#dcd7cb` | `#302e2a` / `#3a3833` | |
| `--paper-reading` | `#fdfcf9` | `#22211e` | document page |
| `--ink` / `-2` / `-3` / `-4` | `#1d2130` `#4a4f5e` `#575c6a` `#8e919b` | `#ebe7de` `#c2bdb2` `#a7a296` `#6d695f` | text tiers (ink-4 is non-text only) |
| `--rule` / `-strong` / `-faint` | `#dad5c9` `#c3bcad` `#e6e2d8` | `#3a3833` `#4d4a43` `#2e2c28` | borders |
| `--accent` / `-hover` / `-ink` | `#26375f` `#1c2a4b` `#fbfaf7` | `#c3cfeb` `#d6def2` `#18203a` | primary button (a deeper ink, not a hue) |
| `--accent-soft` / `-text` | `#e3e6ee` / `#2a4580` | `#2d3240` / `#a9bbe6` | selected rows, links |
| `--focus` / `--selection` | `#3a5cab` / `#c9d3ea` | `#8fa9e6` / `#394766` | |
| `--danger` `-hover` `-soft` `-text` | `#a1342a` `#852a21` `#f5e3de` `#8f2c23` | `#e0897d` `#eaa196` `#3c2622` `#eb9b90` | |
| `--warning/success/info-soft/-text` | `#f4ead2/#75500d`, `#e1ede4/#2c6044`, `#e3e8f1/#2f4a7a` | `#3a311d/#e2c27e`, `#213229/#93c9a6`, `#232c3d/#a9bbe6` | muted states |
| shadows | warm `rgba(60,45,20,…)` | black | `--shadow-1/2/3`, `--scrim` |

The code-colour palette (`core/model/types.ts` `PALETTE`): `#e4572e #f3a712 #a8c256 #29a37a #2b9eb3 #3a6ea5 #6c4ab6
#b5179e #d1495b #8c6d46 #5c946e #7a7f87`. Code colours are adjusted at runtime with `ensureContrast(hex, bg, 3)`.

### 1.3 Typography, space, shape, motion

- Fonts: `--font-ui: 'Instrument Sans Variable'` (wght axis only), `--font-text: 'Literata Variable'` (opsz + italics; used
  for anything a participant said: `.reading`, `TextArea reading`, transcripts), and `--font-mono` (system stack).
  `fonts.css` imports `@fontsource-variable/instrument-sans/{wght,wght-italic}.css` and `literata/{opsz,opsz-italic}.css`.
  Fonts are never loaded from a CDN.
- Sizes: `--fs-xs 11.5 / sm 12.5 / md 13.5 (body) / lg 15 / xl 18 / 2xl 23 / 3xl 31 / reading 17` px. Line heights
  `--lh-tight 1.25`, `--lh-ui 1.45`, `--lh-reading 1.7`. `--measure 68ch`.
- Weights are variable and odd: 500/540/560/600/620/640/650/660. h1–h3 use weight 620, letter-spacing −0.01em and `text-wrap: balance`.
  Screen titles use `--fs-xl` 640 −0.015em.
- Space: 4 px grid, `--s-0..9` = 2, 4, 8, 12, 16, 20, 24, 32, 48, 64.
- Radii: `--r-xs 3, sm 5, md 7, lg 11, pill 999`. Controls: `--control-h 32, -sm 26, -lg 40`.
- Layout: `--rail-w 232`, `--rail-w-collapsed 60`, `--header-h 52`. Window min 1000×660 (tauri.conf.json).
  Below 900 px the rail shows icons only (`NARROW_RAIL` in `ui/media.ts` repeats the number used in shell.css).
- Motion: `--ease cubic-bezier(0.2,0,0,1)`, `--dur-1/2/3 = 90/160/240ms`. Dialogs use `dialog-in` (translateY 6px plus scale .99),
  popovers use `floating-in`. `prefers-reduced-motion` reduces all of them to 0.01ms. A spinner that cannot spin pulses at opacity .7 instead.
- z-index: popover 40, dialog 50, toast 60, tooltip 70, curtain 90.

**Density:** the UI is dense and desktop-first (13.5 px body, 32 px controls, 30 px menu items, 32 px rail items, 28 px under
760 px height). Researchers live in it all day. Tramado should be slightly roomier (§2.3).

### 1.4 Dark mode mechanics (copy as is)

- Each theme is one block of custom properties. The dark values appear **twice**: once in `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {…} }`
  and once in `:root[data-theme='dark'] {…}`. `ui/tokens.test.ts` asserts that both blocks are identical. It also asserts that `--ink`,
  `--ink-2` and `--ink-3` reach 4.5:1 on every `--paper*`, `--accent-soft` and `--*-soft` surface in both themes.
- `App.tsx` `DocumentPrefs` sets `html.dataset.theme` (or deletes it for "system") and `html.lang = bcp47`.
- `index.html` paints `html { background:#f3f1eb }` (dark: `#1e1d1b`) in an inline `<style>`, so the window never flashes before the CSS loads.
- `features/workbench/prefs.ts` `useDarkTheme()` resolves the *effective* theme (data-theme, else matchMedia) for colours computed in JS.
- `button.css` hard-codes the text on `.btn--danger` per theme (`#1e1d1b` in dark) under both selectors. Tramado should make this a
  `--danger-ink` token instead (done in §2.2).
- In forced-colours mode, `span[aria-hidden][style*='background']` swatches keep their colour and get a CanvasText outline.

### 1.5 Visual language (from docs/manual/img/en/{welcome,workbench,workbench-dark,projects}.png)

- Warm cream paper, blue-black text, near-monochrome chrome. The only saturated colours are code highlights (translucent
  fill plus a 2 px inset underline in the code colour) and vertical "coding stripes" in the margin with rotated labels.
- Three-pane workbench: a sunk rail (232 px) holds the project switcher (coloured initial square), a "Search commands Ctrl+K"
  field, nav items with lucide icons at 17 px and stroke 1.75, small group labels ("Analyse", "Manage") and a footer (Settings, Help, lock,
  collapse, version). Then a list pane, a reading pane in Literata with timestamps and small-caps speaker labels, and a codebook pane.
- Welcome: a two-column hero. On the left, a brand mark, a 36 px headline, a lead paragraph, primary and secondary buttons, a 3-column
  "promise" row and a segmented language picker. On the right, a sunk panel with **faint ruled lines** (`repeating-linear-gradient`)
  holding a "specimen" card of a coded transcript.
- Projects: a centred column (max about 940 px) with a big title, a count subtitle, search and sort controls, and a list of rows. Each row has a
  coloured left border and an initial badge.
- Dark mode is warm grey-brown, never pure black. Text is "aged paper".

### 1.6 Component API, with KEEP / ADAPT / DROP for Tramado

All components accept `className` and `'data-testid'`. Labels are `ReactNode` unless noted. Icons are `LucideIcon` drawn at
`strokeWidth 1.75`. Sizes are 14/16/18 px for sm/md/lg buttons.

| Component (file) | Props / behaviour | Verdict |
|---|---|---|
| `Button` (Button.tsx) | `variant 'primary'\|'secondary'\|'ghost'\|'danger'`, `size 'sm'\|'md'\|'lg'`, `icon`, `iconEnd`, `busy` (spinner, keeps width, stays focusable, ignores clicks, `aria-busy`), forwardRef, `type='button'` default | **KEEP** |
| `IconButton` | `icon`, `label` (accessible name **and** tooltip), `shortcut` (shown in the tooltip), `variant 'ghost'\|'secondary'\|'danger'`, `pressed` (aria-pressed), `tooltipSide`, `busy` | **KEEP** |
| `Checkbox` (Choice.tsx) | `checked, onChange(bool), label, description, indeterminate, disabled, id`. A native input sits under a drawn box | **KEEP** |
| `Switch` | `checked, onChange, label, description`. `role="switch"`, applies at once | **KEEP** |
| `RadioGroup<V>` | `value, onChange, options[{value,label,description,disabled}], label, hideLabel, variant 'list'\|'segmented', name`. testid `${id}-${value}` | **KEEP** (segmented: language/theme/engine) |
| `ColorPicker` | `value: string\|null, onChange(hex), label, custom=true`. Swatches as radios, plus a native colour input and a hex field. testids `${id}-${i}`, `${id}-hex` | **ADAPT**: import Tramado's `CLASS_COLORS`, not `core/model/types` `PALETTE`. Add a sibling `IconPicker` for class icons |
| `ConfirmDialog` / `ConfirmProvider` / `useConfirm()` | `await confirm({title, body, confirmLabel, cancelLabel, danger, typeToConfirm, typePrompt})` returns a boolean. Requests queue. Cancel gets the focus. Pending questions resolve `false` on unmount | **KEEP** ("Leave class", "Delete recording", type the class name to delete) |
| `Dialog` | `open, onClose, title, description, footer, size 'sm'\|'md'\|'lg'\|'xl' (420/540/720/960)`, `dismissible`, `onSubmit` (wraps a `<form>`, Enter submits). Focus goes to `[data-autofocus]`, else the first field, else close, else the first button. Tab is trapped. `#root` becomes `inert`. Esc is layered. Focus returns to the opener. The body becomes a focusable region when it scrolls | **KEEP** |
| `Spinner`, `ProgressBar` | `Spinner {size,label}` (role=status only with a label). `ProgressBar {value:number\|null, max, label}` (null means indeterminate) | **KEEP** (model download, transcription) |
| `EmptyState` | `icon, title, children, actions` | **ADAPT** (squared-paper backdrop) |
| `Kbd`, `Badge` | `Badge {tone 'neutral'\|'info'\|'success'\|'warning'\|'danger', color (dot), title}` | **ADAPT**: add tones `ai` and `mark` |
| `Notice` | `tone, title, icon, actions`. role=alert for danger, else status | **KEEP** |
| `Card`, `Section` | `Card {padded}` raised paper. `Section {title, description, actions, id}` | **KEEP** |
| `Toolbar`, `ToolbarSpacer`, `ToolbarDivider` | `label` (required), `roving` (arrow keys, one Tab stop) | **KEEP** |
| `Field` + `Label`/`Hint`/`ErrorText` | render-prop `children(ids)` wires `id`, `aria-describedby` and `aria-invalid` | **KEEP** |
| `TextField` | `value, onChange(string)`, `label, optional, hint, error, labelAside, size, leading, trailing, fieldClassName`, forwardRef | **KEEP**. Add `InviteCodeField` on top (mono, grouping) |
| `TextArea` | `autoGrow, minHeight=72, maxHeight=480, reading` (serif). Uses `grow.ts` slack | **KEEP** (chat composer, notes) |
| `SearchField` | magnifier, clear button, Esc clears | **KEEP** |
| `Select<V>` | native select, `options[{value,label,disabled}]`, `size 'sm'\|'md'` | **KEEP** (model picker fallback) |
| `Menu` / `MenuButton` / `ContextMenu` | `MenuEntry = MenuItem{id,label,icon,hint,danger,disabled,checked,onSelect,testId} \| separator \| heading`. Arrows wrap, Home/End, type-ahead by letter, Tab closes, `onSelect` runs after close (setTimeout 0). `MenuButton {items,label,icon,iconOnly,variant,size,side,align,busy}`. ContextMenu opens on right-click, the Menu key or Shift+F10 | **KEEP** |
| `Popover` | `open,onClose,anchor (ref \| Rect \| ()=>Rect)`, `side, align, padded, autoFocus=true, role='dialog', matchAnchorWidth`. Flips and slides (`position.ts place()`), Esc layered, click outside closes | **KEEP** |
| `SplitPane` | `first, second, direction, sized 'first'\|'second', initial, min, max, minRest, storageKey, label` (required, names the separator), `handleTestId`. Keyboard: arrows ±16 (Shift ×4), Home/End, double-click resets | **KEEP** (storage prefix `trama.split.` → `tramado.split.`) |
| `Table` / `THead` / `TBody` / `TR{selected}` / `TH{sort,onSort,numeric}` / `TD{numeric}` | sticky header, aria-sort | **KEEP** |
| `Tabs<V>` | `value, onChange, items[{value,label,badge,disabled}], label, children` (the panel). WAI-ARIA automatic activation, testid `${id}-${value}` | **ADAPT**: underline in the class colour (`background: var(--c, var(--ink))`) |
| `ToastProvider` / `useToast()` | `show({message, tone 'neutral'\|'success'\|'danger', action{label,run,testId}, durationMs})` (6 s, or 10 s with an action), `error(e)` (uses `problems.ts`), `dismiss(id?)`. One toast at a time, portal beside #root, polite live region, pauses on hover/focus, Esc closes, focus returns | **KEEP** |
| `Tooltip` | `{label, shortcut, side}` wraps one element. 450 ms delay with a "warm" follow-on. Shows on `:focus-visible` only (not on click). `aria-describedby` only when it adds something | **KEEP** |

QDA-specific feature components: **DROP**. That covers `features/workbench/Viewer.tsx` (1655 lines of coding stripes), CodeTree, agreement, analysis,
pseudonyms, exporter/REFI. **Reuse as patterns**: `workbench/MediaBar.tsx` (player imperative handle `seek/toggle/skip/active`,
rates `0.75–2`, Alt+←/→ claim), `formatTime`, the transcript paragraph + sync-point model, `features/speech/SpeechDock.tsx`
(the strip at the bottom of `main` while recording or transcribing: live dot, mic and system meters, progress, time left, stop/cancel),
`RecordDialog.tsx` (name, speakers, language, transcribe checkbox, engine choice, **consent checkbox gating Start**),
`EngineChoice.tsx`, `features/questions/*` (a list + view in a SplitPane, practice "knew it / revise again", BM25
"possible passages", `draftAnswer` with numbered sources), `features/service/ServiceDialog.tsx` (provider radio, key with
show/hide `labelAside`, models in `<details>`, Check button showing credit, Notice result), `ServiceSwitch`, `ServiceBadge`, and
settings `Group`/`Row` (`features/settings/index.tsx`).

### 1.7 Helpers (copy verbatim unless noted)

- `cx.ts`: joins class names, skipping falsy ones.
- `color.ts`: `normalizeHex`, `luminance`, `contrast`, `inkOn(bg)`, `withAlpha(hex,a)`, `ensureContrast(hex,bg,min=3)`.
  **ADAPT** one import: `HEX_COLOR` comes from `core/model/types`.
- `focus.ts`: `focusables`, `overflowsY`, `trapTab`, `OpenerTracker`/`useOpener` (records the opener *during render*, because an
  effect sees the autoFocused field instead), `focusBackTo`, `isTextEntry`, `modalOpen()`, and the `pushLayer()` Escape-layer stack.
- `position.ts`: the pure `place(anchor,size,viewport,side,align,gap)` (flip, slide, maxHeight) and `pointRect(x,y)`. Tested in Node.
- `components/floating.ts`: `Anchor` type, `useFloating`, `floatingStyle` (off-screen until measured, so nothing flashes at 0,0).
- `grow.ts`: `grownHeight(current, contentHeight, min, max)` with `GROW_SLACK=3`. It avoids the render loop at 125 % / 150 % scale.
- `media.ts`: `useMediaQuery`, `NARROW_RAIL '(max-width: 900px)'`, `REDUCED_MOTION`, `scrollBehavior()`.
- `splitSize.ts`: `clampSplit`, `loadSplit`, `saveSplit`. localStorage is guarded with try/catch.
- `confirmMatch.ts`: `typedMatches` (NFC, whitespace-insensitive, case-sensitive).
- `problems.ts`: **ADAPT**. It maps OS errors to translated sentences: disk full, permission, not found. Drop the newerProject/newerFile/wrongKey
  cases (they import `NotTramaFileError`, `NewerSchemaError`, `PlatformError.WRONG_KEY`). Add `aiRateLimited` (OpenRouter
  429 "rate-limited upstream"), `aiNoKey`, `aiOffline`, `syncthingDown`, `modelMissing`.
- `icons.ts`: `export * from 'lucide-react'`. **KEEP**.

### 1.8 i18n (copy the machinery verbatim)

- `core/i18n/languages.ts`: `UI_LOCALES = ['en','pt','es']`, `UI_LOCALE_META` (bcp47 `en-GB`/`pt-PT`/`es-ES`,
  nativeName), `detectUiLocale(navigator.language)`.
- `core/i18n/translate.ts`: `NestedKey` type-level dotted keys (`MessageKeyOf`) and `PluralKeyOf` (keys whose value is
  `{one, other}`). `translate()` falls back to English, then to the key. `{var}` interpolation. `translatePlural` uses `Intl.PluralRules`.
- `core/i18n/locales/en/<namespace>.ts` is the source of truth. `en/index.ts` exports `en` and
  `type Messages = DeepStringify<typeof en>`. `pt/<ns>.ts` is typed `Messages['<ns>']`, so **tsc fails on a missing key**.
- `core/i18n/catalogs.test.ts`: fails if more than 5 % of strings are identical to English, and checks that every `{placeholder}` is kept.
- `ui/i18n.tsx`: `I18nProvider locale`, `useI18n() → {locale, meta, t, tp, date(dt, 'short'|'medium'|'long'|'weekday'), time, relative(iso)}` (luxon),
  `i18nStatic()` for the ErrorBoundary.
- Strings with inline marks (`marks.ts`: `"[a]loneliness[/a]"`) let a sentence be translated whole while parts are styled.
  Useful for Tramado's welcome specimen and onboarding.
- **Suggested Tramado glossary seed** (PT-PT is European, ES is from Spain, formal address as in Trama):

| English | Português | Español |
|---|---|---|
| class (course) | cadeira | asignatura |
| class group (the people) | turma | grupo de clase |
| lecture / lesson | aula | clase |
| recording | gravação | grabación |
| transcript | transcrição | transcripción |
| notes | apontamentos | apuntes |
| document | documento | documento |
| exam / test | exame / teste | examen / prueba |
| question | pergunta | pregunta |
| answer | resposta | respuesta |
| source (citation) | fonte | fuente |
| invite code | código de convite | código de invitación |
| classmate | colega | compañero |
| AI draft | rascunho da IA | borrador de la IA |
| file | ficheiro | archivo |
| save / delete | guardar / eliminar | guardar / eliminar |

---

## 2. Tramado's identity: a sibling that is clearly distinct

### 2.1 Concept

- **Trama** is a researcher's manuscript: iron-gall ink on cream paper, monochrome chrome, colour reserved for codes.
- **Tramado** is a *student's exercise book* (caderno): bright cool paper with squared-paper (quadriculado) backdrops, graphite
  ink, a **ballpoint-blue** accent (the BIC pen every PT/ES student knows), **highlighter yellow** for anything a source says
  that an answer relies on, and **binder-divider colours** for classes. One extra semantic hue is new compared with Trama: **violet means
  a model wrote this**. A student must always be able to tell their own words, a source's words and an AI draft apart.
  This is a trust feature, not decoration.
- Sibling cues kept: the same token names, the 4 px grid, the paper/ink vocabulary, a serif for reading, the warp-and-weft brand mark (Tramado's has
  one weft thread in highlighter yellow), lucide icons at stroke 1.75, and the same layout skeleton (rail, header, panes, dock).
- Distinct cues: cool instead of warm; a saturated accent instead of ink; rounder shapes (9/14 px radii); a display face for headings; slightly roomier
  density; a squared-paper motif instead of ruled lines; a slate "blackboard" dark mode instead of brown.

**Reserved hue roles** (do not reuse them for decoration):

| role | light | dark | where |
|---|---|---|---|
| interactive accent | `#2f4fd6` | `#8ea5ff` | primary buttons, links, focus, selection |
| AI | `#6b46d9` (text `#5b3bc4`, soft `#efeaff`) | `#b7a2ff` (`#c4b3ff`, `#2a2444`) | AI badge, the left bar of AI cards, "AI draft" chips. Always paired with the `Sparkles` icon and the text "AI" |
| highlighter | `#fff1a8` fill, `#f5c518` underline, `#a37800` margin bar | `#3f3a1c`, `#e6c33c` | citation chips `[1]`, cited passage in a source, search hits |
| live | `#e03a3e` | `#ff6b6e` | recording dot, "Record class" dot |

The class palette includes blue and violet hues. On a class screen they stay in "divider" roles only (class mark, tab, tab
underline, rail tab). Accent-coloured *controls* and violet *AI* elements always carry an icon and text, so meaning never rests on colour
alone (WCAG 1.4.1). In the example data, avoid giving the showcased class blue or violet (the mock uses teal for Law).

### 2.2 Tokens: full proposal (written and verified)

File: `LAB/mock/tokens.css` (drop-in replacement for `app/src/ui/tokens.css`'s token blocks. The base element styles from
Trama's file follow unchanged). New tokens compared with Trama: `--grid`, `--mark`, `--mark-strong`, `--mark-edge`, `--mark-ink`, `--ai`,
`--ai-soft`, `--ai-text`, `--rec`, `--rec-soft`, `--danger-ink`, `--font-display`, `--fs-display`, `--r-xl`, `--ease-spring`.

```css
:root {
  color-scheme: light;
  /* Paper: an exercise book, cool and bright */
  --paper: #f3f5f8; --paper-raised: #ffffff; --paper-sunk: #e8ecf2; --paper-hover: #e1e6ee;
  --paper-active: #d7dde8; --paper-reading: #fdfdfc;
  --grid: #d9dfe8;                       /* squared-paper lines on welcome / empty states */
  /* Ink: graphite */
  --ink: #181d29; --ink-2: #434a5b; --ink-3: #545b6c; --ink-4: #8f96a5;
  --rule: #dce1e9; --rule-strong: #c3cad6; --rule-faint: #e9ecf1;
  /* Accent: ballpoint blue */
  --accent: #2f4fd6; --accent-hover: #2440b8; --accent-ink: #ffffff; --accent-soft: #e6ebff;
  --accent-text: #2a47c2; --focus: #3d5cf0; --selection: #cfd9ff;
  /* Highlighter */
  --mark: #fff1a8; --mark-strong: #f5c518; --mark-edge: #a37800; --mark-ink: #181d29;
  /* AI */
  --ai: #6b46d9; --ai-soft: #efeaff; --ai-text: #5b3bc4;
  /* Live */
  --rec: #e03a3e; --rec-soft: #fde8e8;
  /* States */
  --danger: #c0352b; --danger-hover: #a12a21; --danger-ink: #ffffff; --danger-soft: #fce9e6; --danger-text: #a3271e;
  --warning-soft: #fdf1d3; --warning-text: #7a5208; --success-soft: #e0f3e7; --success-text: #1f6a3f;
  --info-soft: #e4ecfb; --info-text: #2a4a8a;
  --shadow-1: 0 1px 0 rgba(20,30,60,.04), 0 1px 2px rgba(20,30,60,.07);
  --shadow-2: 0 2px 4px rgba(20,30,60,.06), 0 10px 28px rgba(20,30,60,.12);
  --shadow-3: 0 4px 12px rgba(20,30,60,.1), 0 24px 56px rgba(20,30,60,.2);
  --scrim: rgba(16,20,32,.4);
  /* Type */
  --font-ui: 'Figtree Variable', 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Bricolage Grotesque Variable', 'Figtree Variable', system-ui, sans-serif;
  --font-text: 'Source Serif 4 Variable', 'Source Serif 4', Georgia, 'Times New Roman', serif;
  --font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', 'DejaVu Sans Mono', Menlo, monospace;
  --fs-xs: 12px; --fs-sm: 13px; --fs-md: 14px; --fs-lg: 16px; --fs-xl: 19px; --fs-2xl: 24px; --fs-3xl: 32px;
  --fs-display: 44px; --fs-reading: 17px;
  --lh-tight: 1.2; --lh-ui: 1.45; --lh-reading: 1.65; --measure: 70ch;
  /* Space: same 4 px grid as Trama (--s-0..9 = 2 4 8 12 16 20 24 32 48 64) */
  /* Shape: rounder */
  --r-xs: 4px; --r-sm: 6px; --r-md: 9px; --r-lg: 14px; --r-xl: 20px; --r-pill: 999px;
  --control-h: 34px; --control-h-sm: 28px; --control-h-lg: 42px;
  --rail-w: 248px; --rail-w-collapsed: 64px; --header-h: 56px;
  --ease: cubic-bezier(0.2,0,0,1); --ease-spring: cubic-bezier(0.34,1.4,0.64,1);
  --dur-1: 90ms; --dur-2: 160ms; --dur-3: 240ms;
  /* z: same as Trama */
}
/* Dark ("blackboard slate"): repeat under BOTH selectors, as Trama does */
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { /* same values as below */ } }
:root[data-theme='dark'] {
  color-scheme: dark;
  --paper: #14171d; --paper-raised: #1c2028; --paper-sunk: #101318; --paper-hover: #252a34;
  --paper-active: #2e3441; --paper-reading: #181b22; --grid: #1f242d;
  --ink: #e8ebf1; --ink-2: #c3c8d2; --ink-3: #a1a8b5; --ink-4: #646b79;
  --rule: #2b303b; --rule-strong: #3c4350; --rule-faint: #21252d;
  --accent: #8ea5ff; --accent-hover: #a8baff; --accent-ink: #0f1430; --accent-soft: #232b48;
  --accent-text: #a3b6ff; --focus: #8ea5ff; --selection: #2e3c6e;
  --mark: #3f3a1c; --mark-strong: #e6c33c; --mark-edge: #e6c33c; --mark-ink: #f4efd8;
  --ai: #b7a2ff; --ai-soft: #2a2444; --ai-text: #c4b3ff;
  --rec: #ff6b6e; --rec-soft: #3d2023;
  --danger: #f08a80; --danger-hover: #f6a59d; --danger-ink: #14171d; --danger-soft: #3d2320; --danger-text: #f59a90;
  --warning-soft: #3a311a; --warning-text: #e8c66f; --success-soft: #1b3326; --success-text: #86d2a2;
  --info-soft: #1f2a40; --info-text: #a3b8e8;
  --shadow-1: 0 1px 2px rgba(0,0,0,.35);
  --shadow-2: 0 2px 6px rgba(0,0,0,.3), 0 10px 28px rgba(0,0,0,.4);
  --shadow-3: 0 6px 14px rgba(0,0,0,.35), 0 24px 56px rgba(0,0,0,.55);
  --scrim: rgba(4,6,10,.62);
}
```

`index.html` pre-paint: `html { background: #f3f5f8 } @media (prefers-color-scheme: dark) { html { background: #14171d } }`.

**Verified** with `node LAB/scripts/contrast.mjs LAB/mock/tokens.css` (Trama's algorithm; port it as `ui/tokens.test.ts`):
both dark blocks agree; `--ink/-2/-3` ≥ 4.5 on every paper, `--mark` and every `*-soft` surface in both themes;
`--accent-ink` on `--accent`/`--accent-hover` ≥ 4.5; `--accent-text` ≥ 4.5 on paper, raised, sunk, hover and accent-soft;
`--ai-text` ≥ 4.5 on paper, raised and ai-soft; `--ai` ≥ 3 (non-text); state texts ≥ 4.5 on their soft tint and on raised; `--focus`
≥ 3 on paper, raised and sunk; `--danger-ink` on `--danger`/`-hover` ≥ 4.5; `--mark-ink` on `--mark` ≥ 7. Light `--mark-strong`
is 1.6:1 and decorative. The non-text cue is `--mark-edge` (3.93:1) plus the numbered chip. One failure in my first draft (dark
`--ink-3` on `--mark` = 4.20) was fixed by darkening dark `--mark` to `#3f3a1c`.

### 2.3 Density and shape

Body 14 px (Trama 13.5). Controls 34/28/42 (Trama 32/26/40). Radii 4/6/9/14/20 (Trama 3/5/7/11). Rail 248. Header 56–64 px
with a 40 px class mark. Tabs are 40 px with a 3 px underline in the class colour. These are still desktop-dense, just friendlier.
Keep Trama's 1000×660 minimum window and the 900 px icon-only rail breakpoint, and test at 125 % scale.

### 2.4 Per-class colours (binder dividers)

Twelve solids, tuned for the label on the solid (`--c-on`, from `inkOn`). Store `#rrggbb` in the class metadata file (plain JSON
in the class folder). Never store the derived values.

| # | hex | label on solid | raw vs white | # | hex | label | raw vs white |
|---|---|---|---|---|---|---|---|
| 1 red | `#e5484d` | ink 4.30 | 3.91 | 7 sky | `#0090c8` | ink 4.67 | 3.61 |
| 2 orange | `#f76b15` | ink 5.67 | 2.97 | 8 blue | `#3e63dd` | white 5.21 | 5.21 |
| 3 amber | `#f5a524` | ink 8.25 | 2.04 | 9 violet | `#6e56cf` | white 5.39 | 5.39 |
| 4 lime | `#8db600` | ink 7.08 | 2.38 | 10 purple | `#ab4aba` | white 4.75 | 4.75 |
| 5 green | `#30a46c` | ink 5.34 | 3.16 | 11 pink | `#d6409f` | white 4.12 | 4.12 |
| 6 teal | `#12a594` | ink 5.48 | 3.07 | 12 graphite | `#8d8d86` | ink 5.04 | 3.34 |

(The "ink" label colour is `#181d29`. Red, pink and graphite labels are under 4.5, so use them for ≥ 14 px bold or icons only, i.e. "large/graphic" text,
or switch to the mixed `--c-text` on `--c-soft` for small text.)

**Pure-CSS derivation, verified** (`node LAB/scripts/classmix.mjs`, OKLab maths identical to `color-mix(in oklab …)`). Only `--c` and
`--c-on` are set inline. Because mixing with `--ink` darkens in light mode and lightens in dark mode, the same rule works in both themes, with no JS
and no `useDarkTheme`:

```css
.cls-scope {               /* any element with style={{'--c': hex, '--c-on': inkOn(hex)}} */
  --c-text: color-mix(in oklab, var(--c) 50%, var(--ink));          /* ≥ 4.98:1 on raised/paper/sunk, both themes, all 12 */
  --c-soft: color-mix(in oklab, var(--c) 16%, var(--paper-raised)); /* --ink-3 on it ≥ 5.14:1 */
  --c-bar:  color-mix(in oklab, var(--c) 75%, var(--ink));          /* non-text bars/underlines ≥ 3.38:1 */
}
```
Measured worst cases: text at 60 % class gives 3.96 and fails (amber), 55 % gives 4.44, **50 % gives 4.98**. Soft at 20 % gives 4.73, at 16 % gives 5.14. Bar at 100 % (the raw
solid) gives 2.04 and fails, **75 % gives 3.38**. `color-mix` works in WebKitGTK 2.52.6 (installed), Chromium ≥ 111 (WebView2) and Safari ≥ 16.2
(macOS 14.2+). Trama already relies on it. Relative colour syntax (`oklch(from …)`) is avoided on purpose.

A React helper to add in `ui/classColor.tsx`:
```tsx
export const CLASS_COLORS = ['#e5484d','#f76b15','#f5a524','#8db600','#30a46c','#12a594','#0090c8','#3e63dd','#6e56cf','#ab4aba','#d6409f','#8d8d86'] as const;
export const classStyle = (hex: string): React.CSSProperties =>
  ({ '--c': hex, '--c-on': inkOn(hex, '#181d29', '#ffffff') } as React.CSSProperties);
// <div className="cls-scope" style={classStyle(cls.color)}> … class screen … </div>
```
Uses: a rail item tab (22 px rounded square: `--c-soft` fill, `--c-text` icon, 3 px `--c-bar` inset spine; filled `--c` with
`--c-on` when current), a 40 px header mark, the tab underline, the question-number chip when selected, an "eyebrow" label in `--c-text`, the welcome
card "divider tab", chat author tags.

**Class icons** (lucide, all verified to exist in lucide-static 1.67.0): `scale` / `gavel` / `landmark` (law), `calculator`, `sigma`, `pi`,
`square-pi`, `chart-line` (maths/economics), `flask-conical`, `atom`, `dna`, `microscope` (science), `stethoscope`, `heart-pulse`
(health), `brain` (psychology), `code`, `cpu` (computing), `palette`, `music`, `drafting-compass`, `pencil-ruler` (arts/architecture),
`globe`, `earth`, `languages` (languages/geography), `book-open`, `library`, `book-marked`, `briefcase-business`, `building-2`, `leaf`,
`utensils`, `hammer`, `lightbulb`, `graduation-cap`. App icons used in the mock: `audio-lines`, `mic`, `files`, `clipboard-check`,
`notebook-pen`, `messages-square`, `sparkles`, `quote`, `highlighter`, `folder-sync`, `users`, `user-plus`, `calendar-days`,
`sticky-note`, `copy-plus`, `refresh-cw`, `key-round`, `circle-help`, `settings`, `search`, `layout-dashboard`, `triangle-alert`.
Note: lucide-react **1.x** exists (Trama pins 1.52.0, latest 1.67.0). Pin an exact version. Icon names change across majors.

### 2.5 Fonts (self-hosted, @fontsource-variable)

| role | package (latest, checked on npm) | CSS family | axes | why |
|---|---|---|---|---|
| UI | `@fontsource-variable/figtree@5.3.0` | `'Figtree Variable'` | wght 300–900, italic file | friendly geometric, open apertures, very legible at 13–14 px, distinct from Instrument Sans |
| Display | `@fontsource-variable/bricolage-grotesque@5.3.0` | `'Bricolage Grotesque Variable'` | opsz 12–96, wdth 75–100, wght 200–800 | characterful headings (class names, welcome, empty states). Use `font-variation-settings:'opsz' 28–72`. Headings only |
| Reading | `@fontsource-variable/source-serif-4@5.3.1` | `'Source Serif 4 Variable'` | opsz 8–60, wght 200–900, italics | built for long reading (law codes, transcripts, AI answers). Greek/Cyrillic subsets for sciences |
| Accessible alternative UI (setting) | `@fontsource-variable/atkinson-hyperlegible-next@5.3.0` | `'Atkinson Hyperlegible Next Variable'` | wght 200–800, italic | offer as "Easier-to-read font" in Settings (low vision, dyslexia-friendly shapes) |

`app/src/ui/fonts.css`:
```css
@import '@fontsource-variable/figtree/wght.css';
@import '@fontsource-variable/figtree/wght-italic.css';
@import '@fontsource-variable/bricolage-grotesque/index.css';   /* opsz+wdth+wght (standard.css = all axes) */
@import '@fontsource-variable/source-serif-4/opsz.css';
@import '@fontsource-variable/source-serif-4/opsz-italic.css';
```
Licence: all four are SIL OFL 1.1. List them in the in-app licences (Trama: `features/settings/licences.ts`). A desktop e2e font
check like Trama's (`document.fonts.load('16px "Figtree Variable"')`) guards against CSP `font-src` regressions.
Fonts used in the mock rendered correctly in headless Chromium: `Figtree Variable, Bricolage Grotesque Variable, Source Serif 4 Variable`.

### 2.6 Brand mark

Trama's mark (`features/onboarding/Frame.tsx` `BrandMark`) is warp and weft threads in a 28×28 rounded square in ink. Tramado's
keeps the weave, swaps the ground to `--accent`, and draws the bottom weft thread in highlighter yellow. It reads as "Trama, but
marked up":
```tsx
<svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className="brand-mark">
  <rect x="0.5" y="0.5" width="27" height="27" rx="8" fill="var(--accent)" />
  <path d="M10 5v.6M10 10.4v7.2M10 22.4v.6M18 5v6.6M18 16.4V23" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" opacity=".55" fill="none" />
  <path d="M5 8h10.6M20.4 8H23M5 14h2.6M12.4 14H23" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
  <path d="M5 20h10.6M20.4 20H23" stroke="#f5c518" strokeWidth="2.4" strokeLinecap="round" fill="none" />
</svg>
```
Wordmark: "Tramado" in Bricolage Grotesque 700, −0.02em, `translate="no"`.

### 2.7 Signature components to add (new to Tramado)

- **`ClassTab` / `ClassMark`**: the divider tab described in §2.4, plus `initial()` fallback when no icon is chosen.
- **`AiCard`**: raised card with a 4 px `--ai` left bar, a header `Badge tone="ai"` with `Sparkles` + "AI draft", and the model id in `--ink-3`
  (e.g. `nvidia/nemotron-3.5-super-vl:free` when the fallback answered). The body is in `--font-text`. The footer has a "Grounded" meter (the share
  of sentences with a citation), "Try again" (ghost) and "Copy to my answer" (secondary). `aria-label` is "AI draft".
- **`CitationChip`**: `[n]` in `--mark` with an inset underline of `--mark-strong`, 11 px weight 750. It is a `<button>` that opens the source at
  the page/article or transcript timestamp, with `aria-label="Source 2: Constitution… Article 18(3), page 12"`. The cited passage
  in the source viewer gets `<mark>` in `--mark` plus a 4 px `--mark-edge` margin bar.
- **`SourceRow`**: chip, file-type icon, title, "Article 18(2) · page 12" or "Transcript · 34:12 · transcribed by Beatriz", chevron.
- **`RecordDock`**: Trama's SpeechDock layout. `--rec` live dot with a `color-mix(… 22%)` halo, title, name, tabular time,
  "Mic"/"Computer" meters (role=meter), "Beatriz will transcribe it" (the transcription claim, from the Syncthing claim protocol), Stop (`danger`).
- **`InviteCodeField`**: TextField in `--font-mono` with letter-spacing .08em, auto-uppercase, grouping `XXXX-XXXX-XXXX-XX`, paste-friendly,
  `autoComplete="off"`, `spellCheck={false}`.
- **Squared-paper backdrop** (welcome and `EmptyState`):
  `background-color: var(--paper-sunk); background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 24px 24px;`
- **Highlighter emphasis** for display headlines: `background: linear-gradient(transparent 58%, var(--mark) 58% 92%, transparent 92%)`.
- Chat (new): `MessageList` (author avatar = `initial()` on the member colour, grouped by minute, day separators via `i18n.date`), `Composer`
  (= `TextArea autoGrow` + send IconButton, Enter sends, Shift+Enter adds a newline), presence/sync dots (`--success-text` synced, `--accent-text` syncing).
- PDF page viewer (new; Trama only *imports* PDF text with pdfjs-dist 6.3.289): render the page and highlight the cited range.

### 2.8 Mocks (rendered, to look at)

Static HTML using the proposed tokens, real fonts and lucide-static SVGs, screenshotted at 1440×900 by `LAB/scripts/shoot.mjs`:

- `LAB/mock/template-light.png`, `LAB/mock/template-dark.png`: the class shell. Rail with "This week", "Exams & tests" and the class list with
  divider tabs and sync/unread markers. Class header with mark, teacher, members, Invite, Record class and Add. Tabs Overview / Lectures / Documents / **Exams** / Notes / Chat.
  An exam question list, the AI answer card with citation chips, a Sources list, a transcript side pane with player, highlighted cited passage and a
  personal note, the recording dock, and a toast.
- `LAB/mock/welcome-light.png`, `LAB/mock/welcome-dark.png`: the welcome screen. Brand, display headline with highlighter emphasis,
  "Create a class" and "Try the example", an invite-code join box ("Shared through Syncthing… no server, no account"), a promise row, the language picker,
  and on the right a squared-paper panel with class cards, an AI card and the 12 class swatches.
- Sources: `LAB/mock/template.html`, `LAB/mock/welcome.html`, `LAB/mock/tokens.css`. Rebuild with
  `node LAB/scripts/shoot.mjs` and `node LAB/scripts/shoot.mjs welcome`.

---

## 3. Shell, router and app state: how Trama works and what to copy

### 3.1 Boot and provider stack

`main.tsx` imports `./ui/fonts.css`, `./ui/tokens.css` and `./ui/app.css`, then picks `createTauriPlatform()` if `isTauri()`, else
`await import('./demo/boot').bootDemo()`. It renders `<App {...props}/>` **without StrictMode** (doubled effects would run discovery
and example creation twice).

```
<AppStateProvider platform initialPhase libraryOptions>      // renders nothing until prefs are read (no wrong-language flash)
  <I18nProvider locale={prefs.locale}>
    <DocumentPrefs/>                                          // html[data-theme], html[lang]
    <ErrorBoundary>                                           // class component, uses i18nStatic()
      <ToastProvider>
        <ToastReset phase={key}/>                             // dismiss toasts (and their Undo) on lock
        <ConfirmProvider key={phaseKey(phase)}>               // remount ⇒ pending questions answer "no"
          <Root/>                                             // switch (phase.name) → Loading | Welcome | Unlock | ProjectsScreen | <ProjectShell key={project.id}/>
```

### 3.2 AppState (`shell/AppState.tsx`)

A `Phase` discriminated union (`loading | welcome | locked | library | project`). Discovery runs in an effect: read prefs,
then `Library.state(platform)`. The `useAppState()` value: `platform, example, phase, prefs, setPrefs(patch), unlocked, openProject(id, route?),
enterProject, closeProject, lock, locking, erased, startExample, leaveExample, canLeaveExample, registerSaver,
runSavers, hold, libraryRevision` (`useSyncExternalStore` on the library). Hooks: `usePlatform`, `useLibrary`, `useProject` (throws
outside a project), `usePrefs`, `useRegisterSaver(fn, {stage, limitMs})`, `useHold(active)`. Window close calls
`platform.onBeforeExit(() => lock())`, which runs the savers.

**For Tramado:** keep the provider/phase/prefs/savers/holds/example-session skeleton. Drop the keyring, unlock, auto-lock, Ctrl+L and
`LockingScreen`. Proposed phases:
```ts
type Phase =
  | { name: 'loading' }
  | { name: 'welcome' }                                   // first run: name, language, where classes live, optional AI key
  | { name: 'ready'; workspace: Workspace; initialRoute?: Route };   // one shell for everything (the rail lists classes)
```
Keep `savers` (flush notes/drafts before exit and before switching class; stage `flush`, then e.g. `index`) and `oneAtATime`.
Use `hold()` to keep the system awake while recording or transcribing (Trama: `speech/awake.rs`). Keep `startExample/leaveExample` (the in-memory
example beside the real platform). Device prefs (`services/prefs.ts`: `locale, theme, lastClassId, speechSpeed…`) stay in the app
config dir, **never in a synced class folder**. The same goes for the OpenRouter key.

### 3.3 Router (`shell/router.tsx`)

There is no URL. It is a typed in-memory history stack: `Entry {key, route}`, `MAX_STEPS 50`, `routeId()` (key-order-independent
JSON), `pushEntry` (no duplicate of the top), `replaceTop` (keeps the key, so a screen keyed on it keeps its state), `popEntry`, `dropEntries` (forget
deleted records). `useRouter() → {route, routeKey, go, replace, back, canGoBack, drop, takeReturnFocus}`. `go()` records the
`selectorFor(document.activeElement)` of the place being left. `back()` marks which entry is returning, and the shell then restores that
focus (`arriveFocus({scope:'.shell__screen', restore})`). `ScreenProps<N> = { route: RouteOf<N> }`.
`features/registry.tsx`: `SCREENS: {[N in RouteName]: lazy(() => import('./x'))}`. `ScreenView` renders `<Screen key={route.name} route={route}/>`,
so a new route *name* remounts and new *params* arrive as props. `router.test.ts` covers the pure functions.

**Tramado `Route` proposal:**
```ts
export type ClassTab = 'overview' | 'lectures' | 'documents' | 'exams' | 'notes' | 'chat';
export type Route =
  | { name: 'home' }                                                     // "This week": upcoming exams, recent lectures, unread chat
  | { name: 'class'; classId: string; tab?: ClassTab }
  | { name: 'lecture'; classId: string; lectureId: string; at?: number } // ms into the recording
  | { name: 'document'; classId: string; docId: string; page?: number; quote?: string }
  | { name: 'exam'; classId: string; examId: string; questionId?: string; practice?: boolean }
  | { name: 'notes'; classId: string; noteId?: string }
  | { name: 'chat'; classId: string }
  | { name: 'search'; query?: string; classId?: string }
  | { name: 'join'; code?: string }
  | { name: 'settings'; section?: 'general' | 'ai' | 'speech' | 'sync' }
  | { name: 'help'; topic?: string };
```
A citation chip is then just `go({ name: 'document', classId, docId, page: 12, quote })` or `go({ name: 'lecture', …, at: 2052000 })`,
and Back (Alt+←, the mouse back button, or the header back button) returns to the exam with the focus on the chip.

### 3.4 Layout (`shell/ProjectShell.tsx` → `Layout`)

`ProjectShell` mounts `RouterProvider`, `UndoProvider` and `SpeechProvider`, each keyed on the project id (a fresh history and undo stack per project).
`Layout` is a CSS grid (`.shell { grid-template-columns: var(--rail-w) minmax(0,1fr) }`). Its parts:
- `nav.rail`: project switcher (Menu), "Search commands Ctrl+K" button, grouped `NAV` items (`nav.ts`: `{name, icon, label: MessageKey,
  group, keywords?}`), and a footer (Settings, Help, lock, `ServiceBadge`, collapse toggle, version). Collapsed or narrow widths show icons only, with each item
  wrapped in `Tooltip side="right"` and given `aria-label`. `aria-current="page"` marks the current item. testid `nav-<route>`.
- `main.shell__main#main`: an example ribbon (`role="note"`, "Leave example"), `.shell__screen` > `<Suspense fallback={Spinner}>
  <ScreenView/>`, then `<SpeechDock/>` at the bottom.
- Global behaviour: `watchBack(back)` (Alt+← and the mouse back button), Ctrl+K opens the palette, F1 opens help at `currentHelpTopic(route)` (not over a modal),
  `platform.setTitle("<project> · Trama")`, and `useCommands` registers navigation, theme, open-project and lock commands.
- `ScreenHeader {title, subtitle, actions, leading, undo=true, helpTopic}`: h1 + subtitle, actions that wrap on a second row
  when narrow, then the help IconButton (F1) and Undo/Redo IconButtons whose labels say what will be undone.

**For Tramado:** the rail lists **classes** (with ClassTabs, unread counts and sync dots) instead of project screens, plus "This week" and
"Exams & tests". The class screen's own header carries the tabs (`Tabs` with the class-colour underline). Keep the palette button,
the footer and the dock slot (recording, transcription, model download progress). Keep `Placeholder` while screens are built.

### 3.5 Live data (`shell/useLive.ts`, `reloadGate.ts`)

`useLive(load(store), deps, kinds[])` reloads when the store reports a change of those kinds. `ReloadGate` coalesces bursts (one
load at a time, a trailing reload after a pause as long as the last load took, capped at 500 ms) and drops stale results. **For Tramado,** keep
the hook and the gate, and feed it from a *file-system/Syncthing change feed*. A Rust watcher (or Syncthing's `/rest/events`
`ItemFinished`/`LocalIndexUpdated`) emits `{classId, kinds}`, and the store's `subscribe` maps those to kinds such as `lecture`, `document`,
`exam`, `chat`, `note`, `transcript`. Without the gate, a peer pushing 40 PDFs would trigger 40 reloads.

### 3.6 Commands (`shell/commands.ts`, `useCommands.ts`, `CommandPalette.tsx`)

There is one registry. `useCommands(() => Command[], deps)` registers while a component is mounted. `Command {id, label, run, keywords?, group?,
shortcut?, icon?, disabled?, priority?}`. Scoring: an accent-folded match where every query word must appear (label start 100, word start 70,
substring 40, keywords 30/15). The palette is a combobox over a listbox (`aria-activedescendant`), traps Tab, makes `#root` inert, and runs the command
after it closes. **KEEP verbatim.** For students it becomes the universal "do anything" box: "Go to Constitutional Law", "Record class",
"Ask AI about this class", "Join a class", "New exam". Note: `commands.ts` imports `fold` from `core/text/normalize`, so copy that too.

### 3.7 Undo, savers, arrival focus, error boundary

- `shell/undo.tsx` + `services/undo.ts`: per-project `UndoManager`. Screens call `record(undo)` with what a domain op returns. Ctrl/⌘+Z
  and Shift+Z / Ctrl+Y work outside text fields and not over modals. Every step shows a toast that names it and offers the reverse action. **KEEP** (deleting a
  document or question, moving files). Note: with Syncthing, an undo can lose to a peer's newer edit. Trama already has a
  `ServiceError('changed_since')` path that refuses the step and toasts it, so reuse that.
- `savers.ts`: `Savers.register(fn,{stage,limitMs=8000})`, `run()` stage by stage, failures logged and never thrown. **KEEP.**
- `arrival.ts`: `selectorFor(el)` (testid plus the first of `data-coding|data-code-id|data-doc-id|data-memo-id|data-id|data-index`),
  `arriveFocus({scope, restore, waitMs})`, which focuses the new screen's first visible `h1` (made `tabindex=-1`, no ring) only while focus is
  adrift. **KEEP.** Change KEYS to `data-class-id|data-lecture-id|data-doc-id|data-question-id|data-message-id|data-id|data-index`.
- `ErrorBoundary.tsx`: a last-resort screen with Reload and "Copy details" (version, error, 12 stack lines, 16 component-stack lines) in a
  selectable `<pre tabIndex=0 data-testid="crash-details">`. Release builds have no devtools. **KEEP.**

### 3.8 Platform boundary (pattern to copy)

`platform/types.ts` defines `Platform` (one interface. Implementations: `tauri.ts` for desktop, `memory.ts` for tests and the demo, plus fakes `fakeSpeech.ts` and
`fakeService.ts`). Speech and service are **optional** members, and screens show "not available here" when they are absent. `PlatformError(code, message)`.
**Tramado sketch** (UI-relevant only): `info()`, `prefs`, `secrets` (API key; OS keychain or app-config file, outside class folders),
`classes` (list, read/write/watch files inside a class folder, `onChange`), `sync` (Syncthing REST wrapper: status, devices, folders,
invite create/accept, `events()`), `ai` (OpenRouter `chat` with streaming via Tauri `ipc::Channel`, `models`, `check` → credit),
`speech?` (model `download(progress)`, `transcribe`, `recorder`), `dialogs`, `setTitle`, `onBeforeExit`. Then `memory.ts` +
`fakeSync.ts` (simulated classmates) + `fakeAi.ts` (scripted answers with citations) + `fakeSpeech.ts` serve the demo and the tests.

---

## 4. Demo + Playwright screenshot pipeline

### 4.1 How the browser demo boots (`app/src/demo/boot.ts`)

URL parameters: `demo=empty` (first-run welcome), `lang=en|pt|es`, `theme=light|dark`, `clock=2026-10-05T10:30`,
`route=locked|library|<route name>`, `name=Ana`, `speech=fake`, `service=fake`. `bootDemo()`:
1. `freeze(clock)` makes the pictures reproducible. It seeds `crypto.getRandomValues` with an LCG (`Math.imul`; a plain `*` loses bits), seeds
   `Math.random`, sets luxon `Settings.now` and `defaultZone='Europe/Lisbon'`, and subclasses `Date` so `new Date()`/`Date.now()`
   return the fixed instant.
2. `createMemoryPlatform({locateFile: () => wasmUrl /* sql.js wasm via ?url */, defaultFolder: '/home/demo/Documents', speech, service})`.
3. Exposes **test hooks** `window.__tramaDemo = { addFile(path, base64), queueAnswer(dialogAnswer) }`. Screenshot steps
   use these to put fixture files on the fake disk and to answer "pick files/folder" dialogs.
4. Writes prefs (locale, theme, coder name), creates the example library and project (`createExampleLibrary`), and returns
   `{platform, libraryOptions, initialPhase}` for the requested route.

Example content (`demo/example/`): `types.ts` (typed keys: documents, codes, cases…), `structure.ts` (the shape shared by every language),
and `en|pt|es/index.ts` + `documents.ts` (the text). `exampleProject.ts` seeds through the domain services, so it is real data. **Codings name
their passage by exact quote** (`resolveQuote` throws if a quote is missing or ambiguous), and `exampleProject.test.ts` checks every language.
Transcripts get deterministic timings (about 160 wpm with pauses from `(i*7919)%1100`, never random).

**Tramado demo plan** (same files, new content):
- `?demo=empty`, `?lang`, `?theme`, `?clock`, `?route=home|class|lecture|exam|chat|settings…&class=<key>&tab=exams`, `?ai=fake`,
  `?speech=fake`, `?sync=fake` (classmates online, chat messages arriving, a peer claiming a transcription), `?model=missing|ready`
  (shows the on-demand speech-model download state).
- `window.__tramadoDemo = { addFile, queueAnswer, peerSays(classKey, author, text), peerAdds(classKey, path, base64),
  claimTranscription(lectureKey, member), aiNext(text|fn), aiFail(code /* 'RATE_LIMITED' etc. */) }`.
- Example classes per language: Constitutional Law I (law PDF excerpts with articles; lecture transcripts with timestamps;
  a mock exam whose AI answers cite *exact quotes*. Port `resolveQuote` so a test fails when a citation no longer resolves), Organic
  Chemistry, Microeconomics, History of Art. Members (Beatriz, Diogo, Inês…) and a chat history. Keep the fiction obvious, as Trama does ("nothing here is real").
- The `?clock` freeze is essential for "This week", relative chat times and exam countdowns.

### 4.2 The screenshot runner (`tools/screenshots/capture.mjs`)

`npm run screenshots` (app script `node ../tools/screenshots/capture.mjs`), with flags `--only=a,b --lang=pt --jobs=3 --port=1524`.
- `createServer({root: APP, configFile: APP/vite.config.ts, server: {port, strictPort:false, hmr:false, watch:null}, logLevel:'error'})`.
  An in-process Vite with no HMR, so a file saved mid-run cannot reload a page. Then `chromium.launch()` from `playwright-core`.
- Per shot: `browser.newContext({viewport:{1440,900}, deviceScaleFactor:1, colorScheme: theme, reducedMotion:'reduce',
  locale: en-GB|pt-PT|es-ES, timezoneId:'Europe/Lisbon'})`, `goto(base?lang&theme&clock=2026-10-05T10:30&<query>)`, wait for
  `#root` children, then `getByTestId(shot.ready)`, `document.fonts.ready`, and `shot.steps(page, lang, {addFiles})`.
- `settle()`: move the mouse to the corner, blur the active element (unless `keepFocus`), close toasts, wait for fonts, then **restyle every element once** (an
  injected `* { outline-offset: .01px !important }`) because Chromium can keep `ch/em` lengths computed with the fallback font. Wait until there is
  no `[role=progressbar]:not([aria-valuenow])`, `.spinner` or `[aria-busy=true]`, wait for non-infinite animations to finish, then wait 500 ms.
- Fails a shot on `pageerror` or a **Vite error overlay** (read from `vite-error-overlay`'s shadow root). Writes `<file>.tmp.png`
  (`animations:'disabled', caret:'hide'`), runs `convert -strip -quality 95` if ImageMagick exists, then renames into `docs/manual/img/<lang>/<name>.png`.
- A warm-up load first, because the dep optimiser can reload the page on first visit. Jobs run in parallel workers (`JOBS=3`).
- `shots.mjs`: `SHOTS = [{name, query, ready?, steps?, keepFocus?, theme?, langs?}]`. Steps only use `getByTestId` and
  wait for what they need, so a changed screen fails loudly instead of producing a wrong picture. Shot names are pinned by
  `features/help/manual.test.ts` (each manual image must exist).

### 4.3 Replicating it for Tramado (files and commands)

```
tools/screenshots/capture.mjs      copy; change warm-up ready id ('doc-list' → 'screen-home'), OUT, CLOCK, hook name
tools/screenshots/shots.mjs        Tramado shots (below)
tools/screenshots/fixtures/<lang>/ fictional PDFs/DOCX/audio for "add document" shots
tools/peek.mjs                     NEW one-shot visual check for agents (verified, LAB/scripts/peek.mjs)
app/package.json scripts:          "screenshots": "node ../tools/screenshots/capture.mjs", "peek": "node ../tools/peek.mjs --app=."
root package.json:                 "screenshots": "npm run screenshots --workspace app", "peek": "node tools/peek.mjs"
app devDependencies:               "playwright-core": "1.62.1" (matches cached chromium-1234; see gotchas), "axe-core": "4.14.0"
```
Example Tramado shots:
```js
export const SHOTS = [
  { name: 'welcome', query: 'demo=empty', ready: 'welcome' },
  { name: 'home', query: 'route=home', ready: 'screen-home' },
  { name: 'class-lectures', query: 'route=class&class=law&tab=lectures', ready: 'lecture-list' },
  { name: 'lecture', query: 'route=lecture&class=law&lecture=l7', ready: 'transcript', steps: async (p) => { await p.getByTestId('cite-jump').first().click(); } },
  { name: 'exam', query: 'route=exam&class=law&exam=mock&ai=fake', ready: 'question-list',
    steps: async (p) => { await p.getByTestId('question-item').nth(1).click(); await p.getByTestId('ai-answer').waitFor(); } },
  { name: 'chat', query: 'route=chat&class=law&sync=fake', ready: 'chat-list' },
  { name: 'join', query: 'route=join&code=TRMD-7KQ4-PX9A-W2&sync=fake', ready: 'join-dialog' },
  { name: 'record', query: 'route=class&class=law&speech=fake', ready: 'screen-class', steps: async (p) => { await p.getByTestId('record-class').click(); await p.getByTestId('record-dialog').waitFor(); } },
  { name: 'settings-ai', query: 'route=settings&section=ai&ai=fake', ready: 'settings-ai' },
  { name: 'exam-dark', query: 'route=exam&class=law&exam=mock&ai=fake', ready: 'question-list', theme: 'dark', langs: ['en'] },
];
```

### 4.4 `peek.mjs`: verified one-shot tool for agents

File: `LAB/scripts/peek.mjs` (about 110 lines, adapted from capture.mjs). Usage:
```
node tools/peek.mjs --app=app --route=exam --query='class=law&exam=mock&ai=fake' --lang=pt --theme=dark \
     --ready=question-list --click=question-item --size=1440x900 --scale=1.25 --axe --out=/tmp/peek.png
```
It prints JSON `{png, errors[], console[], overflow, axe[]}` and exits 1 on page errors, a Vite overlay, a missing `ready` testid,
sideways overflow, or (with `--axe`) serious/critical axe violations. Agents then open the PNG (Read tool) to look at it.
**Tested** against a minimal Vite 8.3.1 + React 18.3.1 + lucide-react 1.67.0 app (`LAB/peek/app`) with the proposed tokens:
a dark/pt run passed in about 2.3 s wall time (`LAB/peek/out/classes-dark.png`), and a planted unlabelled icon button was caught (`button-name`,
critical, exit 1). axe is injected with `page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })` and run via `window.axe.run`.

### 4.5 Desktop e2e (`tools/desktop-e2e/run.mjs`, README.md)

It drives the real release build in WebKitGTK through W3C WebDriver: `tauri-driver --port P --native-port N`, under `dbus-run-session`
(otherwise portals stall about 30 s per start under Xvfb), with `xvfb-run -a node tools/desktop-e2e/run.mjs`. There are no npm dependencies; it uses `fetch` against
the driver. Building blocks worth copying: `wd(method,path,body)`, `js(script,…args)`, `run(asyncBody)` (execute/async with error capture),
`invoke(cmd,args)` through `window.__TAURI_INTERNALS__.invoke`, `until(what, script, args, timeout)` (detects the crash screen),
`find/click/type/keys` by testid, `screenshot(name)`, `step(name, fn)` (on failure: screenshot, crash text, page errors,
body text, driver log tail), `titleBecomes`, `CLOSE_WINDOWS_PY` (an X11 `WM_DELETE_WINDOW` via ctypes, so the app's exit handlers run),
`overflowTour(label)` (visits every `nav-*` and asserts no sideways overflow at the 1000×660 minimum), `GDK_DPI_SCALE=1.25`
runs with DOM clicks (WebKitWebDriver aims wrongly at fractional scales), `window.__TRAMA_E2E_DIALOGS__` queued answers for
native dialogs (`platform/tauri.ts` `queuedAnswer()`), `TRAMA_DATA_DIR` for a throwaway data dir, and a stand-in OpenAI-style HTTP
server on 127.0.0.1.
**Present on this machine:** `/home/feiteira/.cargo/bin/tauri-driver`, `/usr/bin/WebKitWebDriver` (webkit2gtk-driver
2.52.6), `xvfb-run`, `ffmpeg` (flite voice for spoken samples), `convert`.
**Adapt for Tramado:** "no network" becomes an allow-list (`openrouter.ai` plus `127.0.0.1:<syncthing GUI port>`). The "plaintext on disk"
check becomes "the API-key marker appears in no class folder and no Syncthing config". Add a two-instance sync test (two `TRAMADO_DATA_DIR`s, two
syncthing processes, invite → join → a file and a chat message cross over → exactly one member claims the transcription). Keep the CSP style probe
(next item).

### 4.6 Gotchas (from Trama's code and my runs)

- **Tauri CSP vs inline styles:** set `"dangerousDisableAssetCspModification": ["style-src"]` in tauri.conf.json. Otherwise Tauri adds a
  nonce to `style-src`, WebKit then ignores `'unsafe-inline'`, and every `style={{}}` (class colours!) disappears in the desktop app while
  the browser demo looks fine. Trama's e2e step "real-app styles" probes CSSOM, attribute and `<style>` styles in the real webview.
- Trama's CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: asset:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost blob: data:; media-src 'self' blob:`.
  Tramado plays audio from plain files, so either read the bytes into a Blob URL (Trama's MediaBar) or use `convertFileSrc` and add
  `asset: http://asset.localhost` to `media-src` and `img-src`. Keep OpenRouter and Syncthing calls in **Rust** so `connect-src` stays IPC-only.
  Stream AI tokens to the UI over `ipc::Channel`.
- **playwright-core ↔ browser revision:** the cache `~/.cache/ms-playwright/` holds `chromium-1234` and `chromium_headless_shell-1234`,
  which match **playwright-core 1.62.1** (browsers.json: chromium 151.0.7922.34). Latest is 1.64.1, and it would need
  `npx playwright-core install chromium` first. Either pin 1.62.1 or add an install step to the docs.
- **Vite `server.fs.allow: ['..']`**: in an npm workspace, `node_modules` is hoisted to the repo root, outside `app/`. Without it, font
  files are refused with 403 ("outside of Vite serving allow list"). I reproduced this in the peek test. Trama's vite.config.ts has it.
- Run Vite with `hmr:false, watch:null` for shots, warm up once (dep optimisation reloads the page), and treat the Vite overlay as an error.
- Font-metric nudge after `document.fonts.ready` (see settle). Use `reducedMotion:'reduce'` and `animations:'disabled'` in screenshots.
- Never `StrictMode` (doubled effects create the example twice).
- `localStorage` may throw (private window); every helper wraps it (`splitSize.ts`, `workbench/prefs.ts`, `localPrefs.ts`).
  Prefix keys `tramado.` and forget per-class keys when a class is left (`features/common/localPrefs.ts` pattern).
- Test at **125 % scale**: Playwright `deviceScaleFactor: 1.25`, desktop `GDK_DPI_SCALE=1.25`. Auto-growing fields must use `grow.ts`.
- `color-mix()` is fine. Avoid relative colour syntax (macOS 14.2's WebKit is the weakest target).

---

## 5. Accessibility, keyboard and data-testid conventions

### 5.1 Accessibility and keyboard (Trama's rules; adopt all of them)

- **Keyboard first**: every action can be reached by keyboard. Shortcuts are shown with `useKeyLabel()(key,{shift,alt})`, giving "Ctrl+K" or "⌘K" from
  `platform.info().os`. Global shortcuts go through `watchShortcuts(map, overModals)` in the capture phase, Ctrl/⌘ only, and are ignored while a modal is
  open unless listed. Trama's map: **Ctrl+K** palette, **Ctrl+L** lock (works over modals), **Ctrl+Z / Shift+Ctrl+Z / Ctrl+Y**
  undo/redo (not in text fields, not over modals), **F1** help at the current topic, **Alt+←** and **mouse button 3** go back (not in text fields or modals,
  and not when a screen `claimAltArrows()`, e.g. the media player for ±5 s), **Esc** closes the top layer only (`pushLayer`).
  For Tramado, suggested additions: **Ctrl+R** start/stop recording (show the shortcut in the tooltip; never without the consent dialog the first time), **Space**
  play/pause in the lecture view when focus is not in a field, **Ctrl+Enter** send a chat message or ask the AI, **Ctrl+F** search in the current
  class.
- Focus: visible only for the keyboard (`:focus { outline:none } :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`).
  On a screen change the focus moves to the screen's `h1` (`arriveFocus`). Going Back restores the control that had it. Dialogs trap focus, make `#root`
  `inert`, and return focus to the opener (`useOpener` + `focusBackTo`). Toasts and dialogs are portalled to `document.body` beside `#root`, so the
  toast stays usable while a dialog is open.
- ARIA patterns: Tabs (roving, automatic activation), Menu (menuitem/menuitemradio, type-ahead), command palette (combobox +
  listbox + `aria-activedescendant`), SplitPane (separator with `aria-valuenow`), Switch (`role=switch`), RadioGroup (native radios),
  Toolbar (`roving` option), ProgressBar/meter roles, Notice (alert for danger, status otherwise), Toast (polite live region,
  `aria-atomic`), a busy Button keeps the focus with `aria-busy`, and a scrolling dialog body becomes a focusable named region.
- Icon-only controls must use `IconButton` (its label is both the accessible name and the tooltip). Decorative icons get `aria-hidden`.
  Colour swatches are `span[aria-hidden][style*=background]` with a forced-colours outline.
- Destructive confirmations focus **Cancel** first, and type-to-confirm for the worst cases.
- WCAG: text tokens ≥ 4.5:1 (unit-tested), non-text indicators ≥ 3:1 (`ensureContrast`, `--mark-edge`, `--c-bar`). Meaning is never carried by colour
  alone (AI = violet + Sparkles + "AI"; citation = yellow + number).
- `prefers-reduced-motion` and forced colours are handled globally. `.visually-hidden` is available for screen-reader-only text.
- Errors use plain words (`problems.ts`). The crash screen shows selectable details.
- Recording consent: Trama's RecordDialog requires a consent checkbox before Start (a different text when audio goes to a cloud service).
  Keep this for lectures ("I have the lecturer's permission to record").

### 5.2 data-testid conventions (about 960 distinct ids in Trama)

- **Every element a test or screenshot step touches has a `data-testid`** (AGENTS.md rule). Components accept `'data-testid'`
  and derive child ids from it:
  - `RadioGroup` options `${id}-${value}`; `Tabs` tabs `${id}-${value}`; `ColorPicker` swatches `${id}-${i}` and `${id}-hex`;
  - `Menu` items via `MenuItem.testId`; `Toast` action `toast-action` (or `action.testId`, e.g. `toast-undo`/`toast-redo`); the toast is `toast`;
  - `Dialog` close `dialog-close`, scrolling body `dialog-body`; `ConfirmDialog` → `confirm-dialog`, `confirm-ok`, `confirm-cancel`,
    `confirm-type`; crash → `crash-reload`, `crash-copy`, `crash-details`.
- Naming: kebab-case `<feature>-<thing>[-<action>]`: `project-dialog`, `project-name`, `project-dialog-save`, `service-key`,
  `service-check`, `service-check-result`, `record-start`, `record-consent`, `speech-dock`, `speech-stop`, `backup-row`.
  Screens use `screen-<route>` (`screen-workbench`, `screen-questions`, `screen-settings`). Navigation uses `nav-<route>`. Palette commands use `command-<command id>`.
  The project switcher uses `project-switcher` and `switch-<id>`/`switch-all`. Settings groups use `settings-<id>`. Lists use the same testid for every row (`question-item`,
  `project-open`, `import-row`) and pick by `.nth(i)`. Use a **data attribute** for the identity (`data-doc-id`, `data-code-id`, `data-index`), not
  the testid; `arrival.ts` relies on that. Per-record ids also appear (`project-${p.id}`, `code-segment-check-${id}`).
- Ready markers for screenshot steps: one stable testid per screen state (`doc-list`, `codes-tree`, `memo-editor`, `analysis`).
- Proposed Tramado ids: `screen-home`, `screen-class`, `class-<id>` (rail), `class-tabs-<tab>`, `lecture-list`, `lecture-item`
  (+`data-lecture-id`), `transcript`, `transcript-turn`, `player-toggle`, `record-class`, `record-dialog`, `record-consent`,
  `record-start`, `speech-dock`, `speech-stop`, `transcribe-claim`, `model-download`, `doc-list`, `doc-item`, `doc-add`,
  `pdf-page`, `exam-list`, `question-list`, `question-item` (+`data-question-id`), `ai-answer`, `ai-retry`, `ai-copy`, `cite-chip`
  (+`data-index`), `source-row`, `chat-list`, `chat-message`, `chat-composer`, `chat-send`, `invite-open`, `invite-code`,
  `join-dialog`, `join-code`, `join-submit`, `sync-status`, `settings-ai`, `ai-key`, `ai-model`, `ai-check`, `ai-check-result`.

---

## 6. Port checklist (order of work)

1. Copy `ui/` (components, helpers, i18n.tsx, icons.ts, cx.ts) and `core/i18n/{translate,languages,catalogs}.ts` plus the tests.
   Fix the 3 imports: `color.ts` → HEX_COLOR, `ColorPicker` → CLASS_COLORS, `problems.ts` → Tramado errors. Rename `trama.` storage prefixes.
2. Replace the token values with `LAB/mock/tokens.css`, `fonts.css` with the Figtree/Bricolage/Source Serif imports, and the `index.html` pre-paint
   colours. Port `tokens.test.ts` and extend it with the pairs in `LAB/scripts/contrast.mjs` and the class-mix checks in `LAB/scripts/classmix.mjs`.
3. Copy the shell: `router.tsx`, `commands.ts`, `useCommands.ts`, `CommandPalette.tsx`, `palette.css`, `ErrorBoundary.tsx`,
   `arrival.ts`, `activity.web.ts` (without `watchActivity`), `keys.ts`, `savers.ts`, `reloadGate.ts`, `useLive.ts` (re-target),
   `undo.tsx`, `ScreenHeader.tsx`, `Placeholder.tsx`, `initial.ts`, `helpTopic.ts`. Rewrite `AppState.tsx` (phases), `nav.ts`, `Layout`.
4. Platform: `types.ts` + `memory.ts` + fakes (ai, sync, speech) + `tauri.ts` (keep the `__TRAMADO_E2E_DIALOGS__` hook).
5. Demo: `demo/boot.ts` (copy `freeze()` verbatim) + typed example content per language + `resolveQuote` tests.
6. Tools: `tools/screenshots/{capture,shots}.mjs`, `tools/peek.mjs`, `tools/desktop-e2e/run.mjs` (adapted).
7. Tauri: `dangerousDisableAssetCspModification: ["style-src"]`, CSP as above, window 1360×860 (min 1000×660), category Education.
