# Tramado — MVP UX specification

Status: design baseline for 0.1, revised after review round 1 (2026-11-03). Audience: the agents and people who build Tramado's UI.
Items marked **(v1.1)** are specified for later and are not built in 0.1 (architecture §1.1): their entry points are hidden.

This document tells a UI implementer what to draw, what it says, how it behaves and how tests find it.
It is meant to be built from without asking further questions. Where something is still open, §8
names it and gives the default to build.

**Inputs.**
- The adopted baseline is the research critique, `…/scratchpad/research/critique.md`: §5 DECISIONS (cited
  here as "D1"…"D59"), §6 class-folder layout, §7 identity model and §8 error codes.
- `product-ux.md` §3 (information architecture), §4 (flows), §5.1 (MVP), §5.4 (delights), §6
  (privacy) and §7 (empty and error states).
- `trama-ui.md`: the "caderno" identity, tokens, components, test-id conventions and demo URL parameters.
- Trama's real screens (`/home/feiteira/Trama/docs/manual/img/en/*.png`) and the mocks in
  `…/scratchpad/lab/trama-ui/mock/*.png`.

`…/scratchpad` means `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad`.

---

## 0. Conventions

### 0.1 Words used in this document

- **MUST / MUST NOT** are requirements. **SHOULD** is a strong default: if you deviate, say why in the pull request.
- **Class** is a subject: one folder, which may be shared as one Syncthing folder. **Lecture** is one recording
  and its transcript. **Exam** is either an *exam date* (a countdown with no questions) or an *exam paper*
  (with questions). **Member** is a person, identified by a `memberId`. **Device** is one computer,
  identified by its Syncthing device ID (critique §7).
- **Ctrl/⌘** means Ctrl on Windows and Linux and ⌘ on macOS. It is shown with `useKeyLabel()`.
- `ns.key` is an i18n message key (namespace `ns`). §5 holds every English string.
- `[testid]` is a `data-testid` value.
- In wireframes, glyphs such as ⚖ 🧬 Σ 🎙 🗎 ● ◐ ○ ★ ◎ ✦ stand for the lucide icons and dots of §1.5. The UI never renders them as emoji.

### 0.2 Code locations (the same layout as Trama)

| What | Path |
|---|---|
| Tokens, fonts, base styles | `app/src/ui/tokens.css`, `app/src/ui/fonts.css`, `app/src/ui/fonts.ts` (lazy accessibility fonts) |
| Generic components (ported from Trama) | `app/src/ui/components/*.tsx` + one `.css` each |
| New Tramado components | `app/src/ui/tramado/*.tsx` (ClassTab, AiCard, CitationChip, …; see §2.11) |
| Class colours and icons | `app/src/ui/classColor.ts`, `app/src/ui/classIcons.ts` |
| Shell | `app/src/shell/*` (router, Layout, Rail, CommandPalette, RecordDock, SyncPill, AiPill) |
| Screens | `app/src/features/<feature>/index.tsx`, loaded lazily from `app/src/features/registry.tsx` |
| English strings (the source of truth) | `app/src/core/i18n/locales/en/<namespace>.ts` (§5) |
| Demo | `app/src/demo/boot.ts`, `app/src/demo/example/**` (§7) |

### 0.3 Test ids and identity attributes

- Every element a test or a screenshot step touches has a `data-testid`, following `trama-ui §5.2`:
  - names are kebab-case `<feature>-<thing>[-<action>]`;
  - screens are `screen-<route name>`;
  - all rows of a list share one test id and are picked by `.nth(i)`;
  - components derive child ids from their own id: `RadioGroup` → `${id}-${value}`, `Tabs` → `${id}-${value}`, `ColorPicker` → `${id}-${i}`.
- The **identity** of a row goes in a data attribute, never in the test id. The attributes are
  `data-class-id`, `data-lecture-id`, `data-doc-path`, `data-exam-id`, `data-question-id`, `data-message-id`,
  `data-member-id`, `data-device-id`, `data-segment-id`, `data-thread-id` and `data-index`. Add all of them to
  `shell/arrival.ts` `KEYS`, so that Back can restore focus to them.
- A screen exposes **one ready marker** per state for screenshot steps (for example `[lecture-transcript]`).

### 0.4 Deviations from the inputs (with reasons)

| # | Input said | This spec does | Why |
|---|---|---|---|
| X1 | The task brief and `product-ux` describe a class **emoji** (rail, header, markers) | Uses **lucide icons** for class icons and markers | Critique C26/D50: icons render the same on every OS (Linux may have no colour-emoji font), take the class colour, and suit the identity. Emoji are a v1.1 option. |
| X2 | `product-ux §3.5` tab order: …Exams, Ask, Chat, Members | Order is **Lectures, Documents, Notes, Exams, Chat, Ask, Members** | The task brief's order. Chat is the busiest social tab, so it sits next to the content tabs; Ask is reachable from everywhere anyway (Ctrl/⌘+K "Ask AI", "Ask about this…" buttons). |
| X3 | `product-ux §4.10`: class-visible comments on transcripts and documents | **MVP comments and highlights are private only** | The shared format exists (folder spec §8.17); 0.1 writes and shows private annotations only, and D44 lists highlights as private. Shared comments are v1.1 (§8, OQ3). |
| X4 | `product-ux §4.3`: "you confirm each person", "let people in without asking for 24 h", "other members can let people in" | **Auto-accept by folder-ID proof**, plus a per-class "Ask before letting people in" switch | Critique C8/D36. |
| X5 | `product-ux §4.3`: invite link `https://tramado.app/join#…` | The **invite code** is primary. A link to a static page on GitHub Pages is optional, and `tramado://` is used where the OS has registered it | Critique G17/D37. There is no domain decision; see §8, OQ1. |
| X6 | `product-ux §3.10`: "open the Syncthing web UI", "use an existing Syncthing" | A **Sharing diagnostics** panel instead, plus an info line when the user's own Syncthing is detected | Critique C28, C29, G1. |
| X7 | `product-ux §4.6`: speech models "Fast 190 MB / Best 575 MB" | **Recommended (574 MB) / Draft (190 MB) / Most accurate (1.08 GB)** | Critique C11/D23. |
| X8 | `product-ux §8.3` key names `strict / standard / open` | Identifiers follow folder spec §8.14: `zdr` ("Keep nothing"), `no-training` ("No training (recommended)", the default) and `standard` ("Allow free models that may train") | The folder spec is normative on disk (`Answer.privacy`, `ChatAi.privacy`), and there `standard` is the level that allows training. |
| X9 | `product-ux §7.2`: "Existing Syncthing found → [Use it]" | Never offered | Critique C29/G1. |
| X10 | `product-ux §3.3` "Practice due" uses FSRS | MVP practice is a **session queue** with Again / Got it. FSRS scheduling is v1.1 | D52. |
| X11 | `trama-ui §2.7`: `InviteCodeField` grouped as `XXXX-XXXX-…` | A multi-line monospace code field. No short codes | Critique G17: a real 3-device invite is about 1,000 characters (sync spec §7.2). Pretending otherwise would mislead. |
| X12 | Several flows of this document | Rotation ("Start a fresh class without…"), pairing a second computer, exam edits by non-importers, shared markers, chat reactions, pins and hides, the "Since you were away" digest, AI title suggestions, the exam-date chip in chat and relocating a moved folder are **v1.1** | Architecture §1.1 (scope of 0.1). The sections stay for v1.1; 0.1 hides their entry points and test ids. |

---

## 1. Visual identity: "caderno" (the student's exercise book)

### 1.1 Concept (binding rules)

- **Paper and ink.** Surfaces are bright, cool paper and text is graphite ink. The interactive accent is **ballpoint blue**.
  Dark mode is a **blackboard slate**: cool and never pure black.
- **Four reserved meanings.** Each one is always paired with an icon and words, so meaning never rests on colour alone (WCAG 1.4.1):

  | Meaning | Token | Always paired with |
  |---|---|---|
  | Interactive (buttons, links, focus, selection) | `--accent*` | a label |
  | **A model wrote this** | `--ai*` (violet) | the `Sparkles` icon and the word "AI" (badge), plus the model's name |
  | **A source says this** (a cited passage, a citation chip, a search hit) | `--mark*` (highlighter yellow) | a number (chips) or a 4 px `--mark-edge` margin bar (passages) |
  | **Live** (recording now) | `--rec*` (red) | the word "Recording" / "REC" and a dot |

- **The student's own marks** (markers and private highlights) use the five `--mk-*` colours. Each is always shown with its icon and name.
- **Class colours are binder dividers.** They appear only in the rail tab, the header mark, the class-tab underline, the
  eyebrow label, countdown chips, chat author tags and member avatars. They never colour buttons or text blocks.
- **Never red for countdowns** (it causes anxiety). Exam countdowns use the class colour and a calendar icon.
- **Squared paper** (`.paper-grid`) is the backdrop for the welcome screen and empty states.
  **Highlighter emphasis** (`.hl-emph`) marks one phrase per display headline, at most.

### 1.2 `app/src/ui/tokens.css` (final content)

Copy this file verbatim. It extends `trama-ui §2.2` with `--rec-text`, `--mk-*`, `--tabs-h`, `--dock-h`, `--side-w`,
`--z-dock`, the font-preference and motion-preference attributes, the class scope, highlight classes and motifs.
**Verified on 2026-11-03** with Trama's contrast algorithm (`…/scratchpad/lab/trama-ui/scripts/contrast.mjs`)
plus an OKLab mixing check (`…/scratchpad/ux-check/scripts/extra.mjs`). Every pair passes:
- the dark blocks are identical;
- `--ink`, `--ink-2` and `--ink-3` reach at least 4.5:1 on every paper, every soft tint and `--mark`;
- every `--mk-*` reaches at least 3:1 on all four papers (light worst case: `--mk-important` on `--paper-sunk`, 3.54);
- `--ink` and `--ink-3` reach at least 4.5:1 on every `.hl` tint (worst case: dark `--ink-3` on the important tint, 4.76);
- `--rec-text` reaches at least 5.54:1 on `--rec-soft`.

Port both scripts as `app/src/ui/tokens.test.ts`, which must fail the build if a pair drops below its minimum.

```css
/* Tramado design tokens: "caderno", a student's exercise book.
   Same token NAMES and structure as Trama's app/src/ui/tokens.css, so Trama's ported components keep
   their CSS. Bright cool paper, graphite ink, ballpoint-blue accent, highlighter yellow for what an
   AI answer cites, violet for anything a model wrote, red only for "live", and one colour per class
   used like binder dividers.

   Reserved hues (never decoration): --accent (interactive), --ai (a model wrote this), --mark
   (a source passage an answer relies on / search hit), --rec (recording now), --mk-* (the student's
   own markers and highlights). Class colours live only in divider roles (rail tab, header mark,
   tab underline, eyebrow, chat author tag).

   Theme: html[data-theme="light" | "dark"]; no attribute follows the system. The dark values are
   written twice (media query + attribute); ui/tokens.test.ts asserts both blocks are identical. */

:root {
  color-scheme: light;

  /* Paper */
  --paper: #f3f5f8;
  --paper-raised: #ffffff;
  --paper-sunk: #e8ecf2;
  --paper-hover: #e1e6ee;
  --paper-active: #d7dde8;
  --paper-reading: #fdfdfc;
  --grid: #d9dfe8;

  /* Ink: graphite */
  --ink: #181d29;
  --ink-2: #434a5b;
  --ink-3: #545b6c;
  --ink-4: #8f96a5;

  /* Rules */
  --rule: #dce1e9;
  --rule-strong: #c3cad6;
  --rule-faint: #e9ecf1;

  /* Accent: ballpoint blue */
  --accent: #2f4fd6;
  --accent-hover: #2440b8;
  --accent-ink: #ffffff;
  --accent-soft: #e6ebff;
  --accent-text: #2a47c2;
  --focus: #3d5cf0;
  --selection: #cfd9ff;

  /* Highlighter: cited passages, citation chips, search hits */
  --mark: #fff1a8;
  --mark-strong: #f5c518;
  --mark-edge: #a37800;
  --mark-ink: #181d29;

  /* AI: everything a model wrote */
  --ai: #6b46d9;
  --ai-soft: #efeaff;
  --ai-text: #5b3bc4;

  /* Live recording */
  --rec: #e03a3e;
  --rec-soft: #fde8e8;
  --rec-text: #b3262b;

  /* The student's own markers and highlights (non-text 3:1; always with icon + name) */
  --mk-important: #b46a00;
  --mk-confused: #0a7fb0;
  --mk-exam: #c2307f;
  --mk-todo: #2f8a4f;
  --mk-note: #5f6676;

  /* States */
  --danger: #c0352b;
  --danger-hover: #a12a21;
  --danger-ink: #ffffff;
  --danger-soft: #fce9e6;
  --danger-text: #a3271e;
  --warning-soft: #fdf1d3;
  --warning-text: #7a5208;
  --success-soft: #e0f3e7;
  --success-text: #1f6a3f;
  --info-soft: #e4ecfb;
  --info-text: #2a4a8a;

  /* Elevation */
  --shadow-1: 0 1px 0 rgba(20, 30, 60, 0.04), 0 1px 2px rgba(20, 30, 60, 0.07);
  --shadow-2: 0 2px 4px rgba(20, 30, 60, 0.06), 0 10px 28px rgba(20, 30, 60, 0.12);
  --shadow-3: 0 4px 12px rgba(20, 30, 60, 0.1), 0 24px 56px rgba(20, 30, 60, 0.2);
  --scrim: rgba(16, 20, 32, 0.4);

  /* Type */
  --font-ui: 'Figtree Variable', 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Bricolage Grotesque Variable', 'Figtree Variable', system-ui, sans-serif;
  --font-text: 'Source Serif 4 Variable', 'Source Serif 4', Georgia, 'Times New Roman', serif;
  --font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', 'DejaVu Sans Mono', Menlo, monospace;
  --fs-xs: 12px;
  --fs-sm: 13px;
  --fs-md: 14px;
  --fs-lg: 16px;
  --fs-xl: 19px;
  --fs-2xl: 24px;
  --fs-3xl: 32px;
  --fs-display: 44px;
  --fs-reading: 17px;
  --lh-tight: 1.2;
  --lh-ui: 1.45;
  --lh-reading: 1.65;
  --measure: 70ch;

  /* Space: 4 px grid */
  --s-0: 2px;
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 20px;
  --s-6: 24px;
  --s-7: 32px;
  --s-8: 48px;
  --s-9: 64px;

  /* Shape */
  --r-xs: 4px;
  --r-sm: 6px;
  --r-md: 9px;
  --r-lg: 14px;
  --r-xl: 20px;
  --r-pill: 999px;
  --control-h: 34px;
  --control-h-sm: 28px;
  --control-h-lg: 42px;

  /* Layout */
  --rail-w: 248px;
  --rail-w-collapsed: 64px;
  --header-h: 56px;
  --tabs-h: 40px;
  --dock-h: 56px;
  --side-w: 360px;

  /* Motion */
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  --dur-1: 90ms;
  --dur-2: 160ms;
  --dur-3: 240ms;

  /* Stacking */
  --z-dock: 30;
  --z-popover: 40;
  --z-dialog: 50;
  --z-toast: 60;
  --z-tooltip: 70;
  --z-curtain: 90;
}

/* Dark: "blackboard slate", cool, never pure black. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --paper: #14171d;
    --paper-raised: #1c2028;
    --paper-sunk: #101318;
    --paper-hover: #252a34;
    --paper-active: #2e3441;
    --paper-reading: #181b22;
    --grid: #1f242d;
    --ink: #e8ebf1;
    --ink-2: #c3c8d2;
    --ink-3: #a1a8b5;
    --ink-4: #646b79;
    --rule: #2b303b;
    --rule-strong: #3c4350;
    --rule-faint: #21252d;
    --accent: #8ea5ff;
    --accent-hover: #a8baff;
    --accent-ink: #0f1430;
    --accent-soft: #232b48;
    --accent-text: #a3b6ff;
    --focus: #8ea5ff;
    --selection: #2e3c6e;
    --mark: #3f3a1c;
    --mark-strong: #e6c33c;
    --mark-edge: #e6c33c;
    --mark-ink: #f4efd8;
    --ai: #b7a2ff;
    --ai-soft: #2a2444;
    --ai-text: #c4b3ff;
    --rec: #ff6b6e;
    --rec-soft: #3d2023;
    --rec-text: #ff9a9c;
    --mk-important: #f0b04a;
    --mk-confused: #5cc0ea;
    --mk-exam: #f07ab8;
    --mk-todo: #6fcf8f;
    --mk-note: #a1a8b5;
    --danger: #f08a80;
    --danger-hover: #f6a59d;
    --danger-ink: #14171d;
    --danger-soft: #3d2320;
    --danger-text: #f59a90;
    --warning-soft: #3a311a;
    --warning-text: #e8c66f;
    --success-soft: #1b3326;
    --success-text: #86d2a2;
    --info-soft: #1f2a40;
    --info-text: #a3b8e8;
    --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.35);
    --shadow-2: 0 2px 6px rgba(0, 0, 0, 0.3), 0 10px 28px rgba(0, 0, 0, 0.4);
    --shadow-3: 0 6px 14px rgba(0, 0, 0, 0.35), 0 24px 56px rgba(0, 0, 0, 0.55);
    --scrim: rgba(4, 6, 10, 0.62);
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --paper: #14171d;
  --paper-raised: #1c2028;
  --paper-sunk: #101318;
  --paper-hover: #252a34;
  --paper-active: #2e3441;
  --paper-reading: #181b22;
  --grid: #1f242d;
  --ink: #e8ebf1;
  --ink-2: #c3c8d2;
  --ink-3: #a1a8b5;
  --ink-4: #646b79;
  --rule: #2b303b;
  --rule-strong: #3c4350;
  --rule-faint: #21252d;
  --accent: #8ea5ff;
  --accent-hover: #a8baff;
  --accent-ink: #0f1430;
  --accent-soft: #232b48;
  --accent-text: #a3b6ff;
  --focus: #8ea5ff;
  --selection: #2e3c6e;
  --mark: #3f3a1c;
  --mark-strong: #e6c33c;
  --mark-edge: #e6c33c;
  --mark-ink: #f4efd8;
  --ai: #b7a2ff;
  --ai-soft: #2a2444;
  --ai-text: #c4b3ff;
  --rec: #ff6b6e;
  --rec-soft: #3d2023;
  --rec-text: #ff9a9c;
  --mk-important: #f0b04a;
  --mk-confused: #5cc0ea;
  --mk-exam: #f07ab8;
  --mk-todo: #6fcf8f;
  --mk-note: #a1a8b5;
  --danger: #f08a80;
  --danger-hover: #f6a59d;
  --danger-ink: #14171d;
  --danger-soft: #3d2320;
  --danger-text: #f59a90;
  --warning-soft: #3a311a;
  --warning-text: #e8c66f;
  --success-soft: #1b3326;
  --success-text: #86d2a2;
  --info-soft: #1f2a40;
  --info-text: #a3b8e8;
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.35);
  --shadow-2: 0 2px 6px rgba(0, 0, 0, 0.3), 0 10px 28px rgba(0, 0, 0, 0.4);
  --shadow-3: 0 6px 14px rgba(0, 0, 0, 0.35), 0 24px 56px rgba(0, 0, 0, 0.55);
  --scrim: rgba(4, 6, 10, 0.62);
}

/* Font preference (Settings → Language and appearance → Font). The font files are imported
   lazily by ui/fonts.ts only when chosen. */
:root[data-font='atkinson'] {
  --font-ui: 'Atkinson Hyperlegible Next Variable', system-ui, sans-serif;
  --font-display: 'Atkinson Hyperlegible Next Variable', system-ui, sans-serif;
  --font-text: 'Atkinson Hyperlegible Next Variable', system-ui, sans-serif;
}
:root[data-font='opendyslexic'] {
  --font-ui: 'OpenDyslexic', system-ui, sans-serif;
  --font-display: 'OpenDyslexic', system-ui, sans-serif;
  --font-text: 'OpenDyslexic', system-ui, sans-serif;
  --lh-reading: 1.8;
}

/* ── Per-class colour (binder dividers) ─────────────────────────────────────────────────────
   Only --c (the stored #rrggbb) and --c-on (inkOn(--c)) are set inline, via classStyle(hex).
   Mixing with --ink darkens in light mode and lightens in dark mode, so one rule serves both. */
.cls-scope {
  --c-text: color-mix(in oklab, var(--c) 50%, var(--ink));          /* text: ≥ 4.98:1, both themes */
  --c-soft: color-mix(in oklab, var(--c) 16%, var(--paper-raised)); /* tint: --ink-3 on it ≥ 5.14:1 */
  --c-bar: color-mix(in oklab, var(--c) 75%, var(--ink));           /* bars/underlines: ≥ 3.38:1 */
}

/* ── Markers and private highlights ──────────────────────────────────────────────────────────
   data-mk on any element picks the marker colour; .hl is a highlighted run of transcript or
   document text (text stays --ink). */
[data-mk='important'] { --mk: var(--mk-important); }
[data-mk='confused']  { --mk: var(--mk-confused); }
[data-mk='exam']      { --mk: var(--mk-exam); }
[data-mk='todo']      { --mk: var(--mk-todo); }
[data-mk='note']      { --mk: var(--mk-note); }
[data-mk='other']     { --mk: var(--mk-note); }   /* highlight colour "Other" (folder spec §8.17 colour: "other") */
.hl {
  background: color-mix(in oklab, var(--mk) 22%, var(--paper-reading));
  box-shadow: inset 0 -2px 0 var(--mk);
  color: var(--ink);
  border-radius: 2px;
}
/* A passage an AI answer cites, opened from a citation chip. */
mark.cite, .cite-mark {
  background: var(--mark);
  color: var(--mark-ink);
  box-shadow: inset 0 -2px 0 var(--mark-strong);
  border-radius: 2px;
}
.cite-block {
  border-inline-start: 4px solid var(--mark-edge);
  padding-inline-start: var(--s-3);
}

/* ── Motifs ──────────────────────────────────────────────────────────────────────────────── */
.paper-grid {
  background-color: var(--paper-sunk);
  background-image: linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px;
}
.hl-emph {
  background: linear-gradient(transparent 58%, var(--mark) 58% 92%, transparent 92%);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.display {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 48;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: var(--lh-tight);
}

/* ── Base (Trama's, unchanged except where noted) ────────────────────────────────────────── */
*,
*::before,
*::after {
  box-sizing: border-box;
}
html,
body,
#root {
  height: 100%;
  margin: 0;
}
body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--fs-md);
  line-height: var(--lh-ui);
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-width: 320px;
}
button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: default;
}
h1,
h2,
h3,
h4,
p {
  margin: 0;
}
h1,
h2,
h3 {
  font-weight: 620;
  line-height: var(--lh-tight);
  letter-spacing: -0.01em;
  text-wrap: balance;
}
h1 {
  font-family: var(--font-display); /* Tramado: screen titles and class names use the display face */
  font-variation-settings: 'opsz' 32;
  font-weight: 650;
}
p {
  text-wrap: pretty;
}
a {
  color: var(--accent-text);
  text-underline-offset: 2px;
}
::selection {
  background: var(--selection);
}
:focus {
  outline: none;
}
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
kbd {
  font-family: var(--font-ui);
}
* {
  scrollbar-width: thin;
  scrollbar-color: var(--rule-strong) transparent;
}
.visually-hidden {
  position: absolute !important;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.reading {
  font-family: var(--font-text);
  font-size: var(--fs-reading);
  line-height: var(--lh-reading);
  max-width: var(--measure);
}
.t-muted {
  color: var(--ink-3);
}
.t-secondary {
  color: var(--ink-2);
}
.t-small {
  font-size: var(--fs-sm);
}
.t-tabular {
  font-variant-numeric: tabular-nums;
}

/* Reduced motion: the OS setting, or Settings → Reduce motion (html[data-motion='reduce']). */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
:root[data-motion='reduce'] *,
:root[data-motion='reduce'] *::before,
:root[data-motion='reduce'] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}

/* Forced colours: swatches (class tabs, marker dots, member dots) keep their colour. */
@media (forced-colors: active) {
  span[aria-hidden='true'][style*='background'],
  span[aria-hidden='true'][data-mk] {
    forced-color-adjust: none;
    outline: 1px solid CanvasText;
    outline-offset: 0;
  }
  .hl,
  mark.cite,
  .cite-mark {
    forced-color-adjust: none;
    outline: 1px solid Highlight;
  }
}

h1[tabindex='-1']:focus {
  outline: none;
}
```

`index.html` pre-paints the background in an inline `<style>`, so the window never flashes white or black:
`html{background:#f3f5f8}@media (prefers-color-scheme:dark){html{background:#14171d}}`.
`App.tsx` `DocumentPrefs` sets these attributes on `<html>`:
- `data-theme` (absent for "System");
- `data-font` (absent for "Default");
- `data-motion="reduce"` (only when the setting is "On");
- `lang` (BCP 47: `en-GB`, `pt-PT` or `es-ES`).

### 1.3 Class colours and icons

**Colours.** `app/src/ui/classColor.ts` holds them. Store `#rrggbb` in class metadata (`meta/<dev>.json`, field `colour`).
Never store derived values.

```ts
export const CLASS_COLORS = [
  '#e5484d', '#f76b15', '#f5a524', '#8db600', '#30a46c', '#12a594',
  '#0090c8', '#3e63dd', '#6e56cf', '#ab4aba', '#d6409f', '#8d8d86',
] as const;
export const CLASS_COLOR_NAMES = ['red','orange','amber','lime','green','teal','sky','blue','violet','purple','pink','graphite'] as const; // i18n: classes.colours.<name>
export const classStyle = (hex: string): React.CSSProperties =>
  ({ '--c': hex, '--c-on': inkOn(hex, '#181d29', '#ffffff') } as React.CSSProperties);
/** The first colour (in palette order) used by no existing, non-archived class; else index (classCount % 12). */
export function suggestColour(used: readonly string[]): string;
```

Labels on the solid colour (`--c-on`) are ink for indexes 0–6 and 11, and white for indexes 7–10. Red, pink and graphite labels
measure below 4.5:1, so put only icons or bold text of 14 px or more on a filled tab. Small text uses
`--c-text` on `--c-soft`. In the demo, the showcased class MUST NOT be blue or violet, which are too close to the accent and AI hues. The law class is teal.

**Member colours** (avatar initials) reuse the palette:
- index = `parseInt(memberId.slice(0, 6), 32) % 12`, unless the member picked a colour in Settings → Profile (member file `colour`, folder spec §8.3; also kept in `identity.json`);
- rendered as initials in `--c-text` on `--c-soft`, inside a 24 px circle (28 px in member lists).

**Icons.** `app/src/ui/classIcons.ts` exports `CLASS_ICONS` (all verified to exist in lucide-static **1.60.0**) and
`suggestIcon(name: string): ClassIconName`:

```ts
export const CLASS_ICONS = ['scale','gavel','landmark','calculator','sigma','pi','chart-line','flask-conical','atom','dna',
  'microscope','stethoscope','heart-pulse','brain','code','cpu','palette','music','drafting-compass','pencil-ruler',
  'globe','earth','languages','book-open','library','book-marked','briefcase-business','building-2','leaf','utensils',
  'hammer','lightbulb','graduation-cap'] as const;
export type ClassIconName = typeof CLASS_ICONS[number];
```

`suggestIcon` takes the class name, folds it with `fold()` (lower case, no accents) and returns the icon of the first matching row
below. When nothing matches, it returns `book-open`.

| Keywords (folded; matched as word prefixes; PT/ES/EN) | Icon |
|---|---|
| direito, derecho, law, juridic, constitucional, civil, penal | `scale` |
| processo, procesal, tribunal, court | `gavel` |
| historia, history, politic, ciencia politica | `landmark` |
| estatistic, estadistic, statistic, probabilid | `sigma` |
| matematic, calculo, calculus, algebra, math | `calculator` |
| economi, financ, gestao, gestion, management, contabil | `chart-line` |
| quimic, chemistr | `flask-conical` |
| fisic, physic | `atom` |
| biolog, genetic, biochem, bioquim | `dna` |
| anatom, histolog, microbio, patolog | `microscope` |
| medicin, enfermag, enfermer, nursing, saude, salud, health | `stethoscope` |
| psicolog, psycholog, neuro | `brain` |
| program, informatic, computa, software, algoritm | `code` |
| arquitet, arquitect, architect, desenho, dibujo, drawing | `drafting-compass` |
| arte, art, design | `palette` |
| music | `music` |
| geograf, geograph | `earth` |
| ingles, english, frances, french, aleman, german, lingua, lengua, language, linguist | `languages` |
| literat, filosof, philosoph | `book-marked` |
| engenhar, ingenier, engineer | `hammer` |
| ambiente, ambient, ecolog, environment | `leaf` |

**Class mark anatomy** (`ClassTab`, used everywhere a class appears):
- `size: 'sm' | 'md' | 'lg'`, which is 18, 22 or 40 px. It is a rounded square with radius `--r-sm` (sm/md) or `--r-md` (lg).
- Fill `--c-soft`, the lucide icon in `--c-text` at stroke 1.75 (icon size 12, 14 or 22 px), and a 3 px inset `--c-bar` spine on the left edge.
- `filled` (the current class in the rail, and the header mark): fill `--c`, with the icon in `--c-on` and no spine.
- `aria-hidden` always: the class name is always next to it.

### 1.4 Fonts (self-hosted; never a CDN)

| Role | npm package (exact) | CSS family | Licence | Loaded |
|---|---|---|---|---|
| UI | `@fontsource-variable/figtree@5.3.0` | `'Figtree Variable'` | OFL-1.1 | always (`wght.css`, `wght-italic.css`) |
| Display (h1, class names, onboarding) | `@fontsource-variable/bricolage-grotesque@5.3.0` | `'Bricolage Grotesque Variable'` | OFL-1.1 | always (`index.css`) |
| Reading (transcripts, documents, AI answers, questions, notes) | `@fontsource-variable/source-serif-4@5.3.1` | `'Source Serif 4 Variable'` | OFL-1.1 | always (`opsz.css`, `opsz-italic.css`) |
| "Easier to read" option | `@fontsource-variable/atkinson-hyperlegible-next@5.3.0` | `'Atkinson Hyperlegible Next Variable'` | OFL-1.1 | lazily, when chosen |
| "OpenDyslexic" option | `@fontsource/opendyslexic@5.3.0` | `'OpenDyslexic'` | OFL-1.1 | lazily, when chosen |
| Mono (invite codes, IDs, logs) | system stack (`--font-mono`) | — | — | — |

All five are more than 2 weeks old today (newest: source-serif-4 5.3.1, published 2026-10-11).

`app/src/ui/fonts.css`:
```css
@import '@fontsource-variable/figtree/wght.css';
@import '@fontsource-variable/figtree/wght-italic.css';
@import '@fontsource-variable/bricolage-grotesque/index.css';
@import '@fontsource-variable/source-serif-4/opsz.css';
@import '@fontsource-variable/source-serif-4/opsz-italic.css';
```
`app/src/ui/fonts.ts` exports `loadFontPreference(pref: 'default' | 'atkinson' | 'opendyslexic'): Promise<void>`. It
dynamic-imports `@fontsource-variable/atkinson-hyperlegible-next/wght.css` or `@fontsource/opendyslexic/400.css`
plus `700.css`, then sets `html[data-font]`. The desktop e2e font check is Trama's, with the family names changed:
`document.fonts.load('16px "Figtree Variable"')`.

**Type scale.**

| Use | Family | Size token | Weight | Notes |
|---|---|---|---|---|
| Onboarding headline | display | `--fs-display` 44 | 700 | `opsz` 48, −0.02em, one `.hl-emph` phrase |
| Screen title (h1), class name in header | display | `--fs-2xl` 24 | 650 | `opsz` 32 |
| Section heading (h2) | UI | `--fs-lg` 16 | 620 | |
| Card title (h3) | UI | `--fs-md` 14 | 620 | |
| Body, controls | UI | `--fs-md` 14 | 400/500 | |
| Secondary, meta lines | UI | `--fs-sm` 13 | 400 | `--ink-3` |
| Eyebrow (QUESTION 2 · 4 MARKS) | UI | `--fs-xs` 12 | 650 | uppercase, letter-spacing .06em, `--c-text` |
| Reading text | text | `--fs-reading` 17 | 400 | `--lh-reading` 1.65, `--measure` 70ch |
| Exam question text | text | `--fs-xl` 19 | 450 | |
| Timestamps, counters, durations | UI | `--fs-sm` 13 | 500 | `.t-tabular` |
| Speaker label in transcripts | UI | `--fs-xs` 12 | 650 | `font-variant: small-caps`, letter-spacing .04em |

### 1.5 Icons

- `lucide-react@1.60.0`, pinned exactly (published 2026-10-20, so it is at least 2 weeks old at this date; D59). Re-export it through
  `app/src/ui/icons.ts` (`export * from 'lucide-react'`), as Trama does.
- Stroke 1.75 everywhere. Sizes are 14 (sm), 16 (md, the default) and 18 (lg) px; rail and tab icons are 17 px; empty-state icons are 40 px at stroke 1.5.
- Decorative icons get `aria-hidden`. Icon-only controls MUST be `IconButton`, whose `label` is both the accessible name and the tooltip.

Icon map (every name below was verified in lucide-static 1.60.0):

| Concept | Icon | Concept | Icon |
|---|---|---|---|
| Today | `sun` | Search / palette | `search` |
| Settings | `settings` | Help / shortcuts | `keyboard` |
| New class | `plus` | Join a class | `log-in` |
| Archive | `archive` | Invite | `user-plus` |
| Lectures tab | `audio-lines` | Documents tab | `files` |
| Notes tab | `notebook-pen` | Exams tab | `clipboard-check` |
| Chat tab | `messages-square` | Ask tab, any AI | `sparkles` |
| Members tab | `users` | Share (unshared class) | `folder-sync` |
| Record | (CSS dot `--rec`) | Microphone / off | `mic` / `mic-off` |
| Computer sound | `monitor-speaker` | Pause / Resume | `pause` / `play` |
| Stop | `square` | Back 10 s / forward 10 s | `rotate-ccw` / `rotate-cw` |
| Marker: Important | `star` | Marker: Didn't get it | `circle-question-mark` |
| Marker: Exam! | `target` | Marker: To do | `square-check` |
| Marker: Note | `sticky-note` | Exam radar (auto marker) | `radar` |
| Highlight | `highlighter` | Comment | `message-square` |
| Explain | `sparkles` | Copy with source | `quote` |
| Pin | `pin` | Reply | `reply` |
| Attach | `paperclip` | Send | `send-horizontal` |
| Mention | `at-sign` | Thank the transcriber | `hand-heart` |
| PDF / text file | `file-text` | Slides | `presentation` |
| Image | `file-image` | Audio file | `file-audio` |
| Other file | `file` | Scan (no text) | `scan-text` |
| Article list | `table-of-contents` | Zoom | `zoom-in` / `zoom-out` |
| Countdown | `calendar-clock` | Exam date | `calendar-days` |
| Right / Partly / Wrong / Not sure | `circle-check` / `contrast` / `circle-x` / `circle-question-mark` | Hint | `lightbulb` |
| Split / merge question | `split` / `merge` | Practise | `graduation-cap` |
| Synced | `circle-check` | Syncing | `refresh-cw` |
| Waiting for classmates | `users` | Offline | `wifi-off` |
| Sharing paused | `circle-pause` | Problem | `triangle-alert` |
| Only on this computer | `hard-drive` | Private ("Only you") | `lock` |
| Shared with the class | `users-round` | Device (laptop / desktop) | `laptop` / `monitor` |
| QR code | `qr-code` | Link | `link` |
| Copy | `copy` | Download / upload | `download` / `upload` |
| Delete | `trash-2` | Undo | `undo-2` |
| Leave class | `log-out` | Remove member | `user-minus` |
| Key | `key-round` | Privacy | `shield-check` |
| Storage | `hard-drive` | Notifications | `bell` |
| Profile | `user` | Appearance | `palette` |
| Speech model | `audio-waveform` | Processor | `cpu` |
| Battery / plugged in | `battery-low` / `plug` | Language | `languages` |
| Open folder | `folder-open` | External link | `external-link` |
| Info | `info` | More | `ellipsis` |

### 1.6 Space, shape, elevation, density

- **Space:** a 4 px grid, `--s-0`…`--s-9` = 2, 4, 8, 12, 16, 20, 24, 32, 48, 64 px.
  - Screen padding is `--s-6` horizontally and `--s-5` at the top.
  - Card padding is `--s-4`. The gap between cards is `--s-4`, and between sections `--s-7`.
  - Gaps inside a row are `--s-2`, and `--s-3` between a label and its control.
- **Radii:**
  - `--r-xs` 4: citation chips and highlight runs (2 px);
  - `--r-sm` 6: badges inside text and small class tabs;
  - `--r-md` 9: buttons, fields and menus;
  - `--r-lg` 14: cards, popovers and the dock;
  - `--r-xl` 20: dialogs and the command palette;
  - `--r-pill`: pills (sync, AI, countdown chips, filter chips, presence).
- **Elevation:** `--shadow-1` for cards and list hover; `--shadow-2` for menus, popovers, toasts and the citation popover; `--shadow-3` for dialogs
  and the palette. Rails and wells are `--paper-sunk` and have no shadow.
- **Controls:** 34 px (`--control-h`), 28 px for small and 42 px for large (onboarding primary actions).
  Hit targets are at least 24×24 px (WCAG 2.5.8). Icon buttons are 32×32 (28×28 for small).
- **Rows:** 36 px for a single-line list row, 56 px for two lines (lectures, documents, members); 34 px for menu items; 36 px for rail items.
- **Window:** default 1360×860, minimum 1000×660 (`tauri.conf.json`). Test at 100 % and 125 % scale.

### 1.7 Motion

| Thing | Animation | Duration / ease | Reduced motion |
|---|---|---|---|
| Hover, press, colour changes | background/colour transition | `--dur-1`, `--ease` | instant |
| Popover, menu, citation popover | `floating-in` (opacity + 4 px translate) | `--dur-2`, `--ease` | instant |
| Dialog, palette | `dialog-in` (translateY 6 px + scale .99) | `--dur-3`, `--ease` | instant |
| Toast | slide up 8 px + fade | `--dur-2` | instant |
| Recording dot | pulse: opacity 1→.45→1 and a halo `color-mix(in oklab, var(--rec) 22%, transparent)` | 1.6 s infinite | static dot with a 2 px `--rec` ring |
| Marker dropped (dock and timeline) | the marker icon pops (scale .6→1) | `--dur-3`, `--ease-spring` | none |
| Follow-along transcript | `scrollIntoView({block:'center', behavior})` | smooth | `behavior:'auto'` (jump) |
| Arriving at a cited passage | `mark.cite` background fades from `--mark-strong` to `--mark` | 1.2 s ease-out | stays `--mark`, no fade |
| Progress (indeterminate) | Trama's ProgressBar stripe | 1.2 s linear | pulsing opacity .7 |
| Spinner | rotate | 0.8 s linear | pulse at opacity .7 (Trama) |

The rule: motion confirms an action or shows a state change. Nothing animates on its own except the recording dot, spinners and indeterminate progress.
"Reduced motion" is on when the OS asks for it (`prefers-reduced-motion`) **or** when Settings → Reduce motion is "On" (`html[data-motion=reduce]`).
`ui/media.ts` `REDUCED_MOTION` MUST check both. `scrollBehavior()` returns `'auto'` when either applies.

### 1.8 Brand mark and wordmark

Use the `BrandMark` from `trama-ui §2.6` verbatim (a weave on an `--accent` ground, with the bottom weft thread in `#f5c518`) at 28 px in
the rail and 36 px on the welcome screen. The wordmark is "Tramado" in the display face, weight 700, −0.02em, with `translate="no"`.
The app icon comes from the same SVG, rendered for each platform by `tauri icon`.

---

## 2. App shell

### 2.1 Routes, phases and window title

The app phases (`shell/AppState.tsx`) are `{name:'loading'} | {name:'welcome'} | {name:'ready'; initialRoute?: Route}`.
`welcome` is onboarding (§3.1). It is shown while `identity.json` has no `name`.

The router is Trama's in-memory history stack (`shell/router.tsx`, MAX_STEPS 50, with focus restored on Back). `Route` is:

```ts
export type ClassTabId = 'lectures' | 'documents' | 'notes' | 'exams' | 'chat' | 'ask' | 'members' | 'share';
export type SettingsSection =
  | 'profile' | 'appearance' | 'ai' | 'transcription' | 'sharing' | 'notifications' | 'storage' | 'privacy' | 'about';
export type Route =
  | { name: 'today' }
  | { name: 'class'; classId: string; tab?: ClassTabId;          // default tab: 'lectures'
      folder?: string;                                           // documents tab: a sub-folder (relative path)
      threadId?: string; query?: string;                         // ask tab: open a thread / pre-fill a question
      messageId?: string }                                       // chat tab: scroll to and flash a message
  | { name: 'lecture'; classId: string; lectureId: string;
      at?: number;                                               // ms into the audio
      segmentId?: string; quote?: string;                        // highlight a cited passage
      play?: boolean }                                           // start playing from max(0, at − 10 000)
  | { name: 'document'; classId: string; relPath: string;        // class-relative path ("Legislação/Lei….pdf")
      sha256?: string;                                           // used to re-find a moved file (G13)
      page?: number; slide?: number; quote?: string; private?: boolean }
  | { name: 'note'; classId: string; relPath: string; private: boolean; quote?: string }
  | { name: 'exam'; classId: string; examId: string; questionId?: string;
      mode?: 'extracting' | 'review' | 'answers' | 'practice' }  // default chosen from exam state (§3.9)
  | { name: 'practice'; classId: string }                        // practise every paper of a class
  | { name: 'ask'; threadId?: string; query?: string }           // Ask across ALL classes (§3.11)
  | { name: 'settings'; section?: SettingsSection };             // default 'profile'
```

- `share` is the single tab shown instead of Chat and Members when a class is not shared.
- Joining, inviting, creating a class and recording are **dialogs**, not routes.
- The window title (`platform.setTitle`) is `"{screen} · {class short name} · Tramado"`. On Today it is `"Today · Tramado"`, and in Settings it is `"Settings · Tramado"`.
- `route.at` is clamped to the audio duration. `route.page` is clamped to the page count.
- A route whose class, lecture, exam or file no longer exists shows the **Missing** state (§3.15.10), never a crash.

### 2.2 Layout

```
┌───────────────────────┬──────────────────────────────────────────────────────────────────────────┐
│ RAIL (248 px, sunk)   │ TOP BAR (56 px): [←] breadcrumb › H1 title · subtitle      actions [⋯] [?]│
│                       ├──────────────────────────────────────────────────────────────────────────┤
│                       │ (class screens only) CLASS HEADER + TABS (§3.3)                           │
│                       ├──────────────────────────────────────────────────────────────────────────┤
│                       │                                                                          │
│                       │ SCREEN BODY (scrolls; split panes where the screen has them)             │
│                       │                                                                          │
│                       ├──────────────────────────────────────────────────────────────────────────┤
│                       │ DOCK (0, 1 or 2 rows × 56 px): recording · transcription · model download │
└───────────────────────┴──────────────────────────────────────────────────────────────────────────┘
          toasts: bottom-centre of main, 16 px above the dock · palette: centred overlay, 15 % from the top
```

- CSS grid: `.shell { display:grid; grid-template-columns: var(--rail-w) minmax(0,1fr); height:100% }`.
  `main` is `display:grid; grid-template-rows: auto auto minmax(0,1fr) auto`.
- When the **window is narrower than 900 px**, or the user collapsed the rail, the rail is 64 px and shows icons only. Each item is wrapped in
  `Tooltip side="right"` and has an `aria-label` (Trama's `NARROW_RAIL`).
- When the **main area is narrower than 1100 px**, side panels (the lecture side panel, the document side panel, the Ask thread list) become
  drawers that open over the content from the right. They get a toggle IconButton in the top bar.
- The demo/example ribbon (`role="note"`, `[example-ribbon]`) sits above the top bar: "You're looking at an example
  class library. Nothing here is real." with [Leave the example] `[example-leave]`.

### 2.3 Left rail

```
┌──────────────────────────────┐
│ ▣ Tramado                    │  brand (28 px mark + wordmark)
│ ┌──────────────────────────┐ │
│ │ ⌕ Search everything Ctrl+K│ │  button → palette   [rail-search]
│ └──────────────────────────┘ │
│ ☀ Today                      │  [nav-today]
│                              │
│ CLASSES                   ＋ │  group label + IconButton "New class"  [rail-new-class]
│ ▌⚖ Direito Constitucional I 3│  ClassTab + name + badge   [rail-class] data-class-id
│ ▌🧬 Biology 101            ● │  ● = recording now (rec dot, pulses)
│ ▌Σ Estadística I          ⌂ │  ⌂ = hard-drive icon: only on this computer
│ ＋ New class                  │  [rail-new-class-row]
│ ⇥ Join a class               │  [rail-join]
│ ▸ Archive (1)                │  disclosure, collapsed by default   [rail-archive]
│                              │
│ ─────────────────────────── │
│ ⚙ Settings                   │  [nav-settings]
│ ⟳ Up to date · 2 online      │  SyncPill   [sync-pill]
│ ✦ Gemma 4 31B · 38 left      │  AiPill     [ai-pill]
│ «                    0.1.0   │  collapse IconButton [rail-collapse] + version
└──────────────────────────────┘
```

**Class row** (`RailClassItem`, 36 px, `role` is a link-styled `<button>` inside `<nav aria-label="Classes">`):
- `ClassTab md` (filled when current) + the class **name** (ellipsis; the full name is in the tooltip) + a right slot. The right slot shows the first that applies:
  1. the rec dot (this class is being recorded on this computer, or `presence` says a member is recording it);
  2. a mentions badge (`Badge tone="info"` "@{n}");
  3. an unread count (`Badge tone="neutral"` "{n}", capped at "99+");
  4. a **syncing** ring (a 10 px `refresh-cw` in `--accent-text`) while this class has needed items;
  5. a problem triangle (`--warning-text`) when the class has sync errors or a conflict;
  6. the `hard-drive` icon (`--ink-3`) when not shared.
- `aria-current="page"` on the current class. Accessible name: `"{name}, {status}"`, where status is the slot's text
  ("recording now", "2 mentions", "3 unread messages", "syncing", "needs attention", "only on this computer").
- Context menu (right-click, the Menu key or Shift+F10), `[rail-class-menu]`:
  - Open
  - Record a lecture
  - Invite classmates… (shared only) / Share this class… (local only)
  - Move up / Move down (Alt+Shift+↑/↓ also works while the row is focused)
  - Mark all as read
  - Class settings…
  - Archive
- Order is the manual list in prefs `ui.classOrder` (a JSON array of class ids; architecture §13.3). New and joined classes are appended to the end.
- **Archive** holds classes with `archived: true`. It is collapsed and shows a count. Archived classes keep syncing, but have no badges and are excluded from Today and from Search unless the scope is "All classes, including archived" (palette filter).
- Ctrl/⌘+1…9 opens the n-th non-archived class.

**Footer**:
- `[nav-settings]`.
- The two pills (§2.4, §2.5).
- The collapse toggle `[rail-collapse]` (label "Collapse sidebar" / "Expand sidebar"; the state is kept in `localStorage` `tramado.rail.collapsed`, guarded with try/catch).
- The version, in `--ink-3`.

### 2.4 Sync pill (`shell/SyncPill.tsx`)

A pill button (radius pill, 28 px, `--paper-raised`, `--rule` border) showing an icon and a short label. Clicking it opens a popover, `[sync-popover]`.

| State id | When (first match wins) | Icon | Label (`sync.pill.*`) | Icon colour |
|---|---|---|---|---|
| `local` | no class is shared, so Syncthing was never started (C6) | `hard-drive` | "Only on this computer" | `--ink-3` |
| `starting` | the sidecar is starting | `refresh-cw` (spinning) | "Starting sharing…" | `--accent-text` |
| `error` | `SYNC_UNAVAILABLE`, `SYNC_LOCKED` or `SYNC_PORT` | `triangle-alert` | "Sharing isn't running" | `--danger-text` |
| `paused` | global pause is on | `circle-pause` | "Sharing paused" | `--ink-3` |
| `attention` | a mass-delete guard is waiting, a conflict is unresolved, or a folder has errors | `triangle-alert` | "{n} need attention" | `--warning-text` |
| `offline` | `navigator.onLine === false` and no LAN peer is connected | `wifi-off` | "Offline" | `--ink-3` |
| `syncing` | at least one shared class needs items | `refresh-cw` (spinning) | "Syncing {n} files" (or "Syncing…" when n is unknown) | `--accent-text` |
| `waiting` | shared classes exist but no member device is connected | `users` | "Waiting for classmates" | `--ink-3` |
| `upToDate` | otherwise | `circle-check` | "Up to date · {n} online" (n = distinct members online, me excluded) | `--success-text` |

Popover content, 360 px wide:
- A list of shared, non-archived classes, `[sync-popover-class]`: ClassTab sm + name + a status line. The status lines are:
  - "Up to date · 3 online"
  - "Syncing 12 files · 45 MB left"
  - "Waiting for classmates"
  - "Connected through a relay (slow)"
  - "Paused"
  - "1 file can't be saved on Windows computers"
  - "Can't find the folder"

  Clicking a row opens that class's Members tab.
- A `Switch` "Pause sharing" `[sync-pause]`. It pauses all folders (G16).
- Links: "Sharing settings" `[sync-open-settings]` and "Diagnostics" `[sync-open-diagnostics]` (Settings › Sharing, with diagnostics expanded).
- When `attention`: one row per problem, with its action (Restore / Compare / Rename) (§3.15).

The tooltip on the pill repeats its label and adds the explanation for `waiting`: "No one from your classes is online. Changes are saved here and will sync later."
**Sync never blocks anything** (P11): no screen waits for the pill.

### 2.5 AI pill (`shell/AiPill.tsx`)

The same shape. The label, `ai.pill.*`:
- "{modelShort} · {remaining} left" when an OpenRouter key works and the quota is known;
- "{modelShort}" when the quota is unknown;
- "Local AI" for a custom endpoint;
- "AI off" when there is no key or AI is turned off (`--ink-3`);
- "AI: check key" when the last check returned `AI_AUTH` (`--warning-text`).

The icon is `sparkles` in `--ai`. Click → Settings › AI. `[ai-pill]`.
`modelShort` is the model label (§8, OQ13) without the "(free)" suffix, truncated to 18 characters.

### 2.6 Top bar (`shell/ScreenHeader.tsx`, ported)

```
[←]  Direito Constitucional I › Lectures                                   [Ask about this lecture] [⋯] [?]
     Aula 6 — Restrições aos direitos fundamentais                       (actions wrap to a 2nd row < 1100 px)
     Tue 27 Oct · 1 h 32 min · recorded by Ana · Shared with the class
```

- **Back** IconButton `[header-back]`, only when `canGoBack`. Its label names the destination: "Back to Lectures".
- **Breadcrumb** (`nav aria-label="Breadcrumb"`): class short name › tab name. Each part is a link button. Only on screens below a class.
- **h1** (display face, `--fs-2xl`) and an optional subtitle line (`--fs-sm`, `--ink-3`). `[header-title]`.
- **Actions**: screen-specific buttons, then a `MenuButton` "More" `[header-more]`, then the "Keyboard shortcuts" IconButton `[header-help]`
  (opens §2.10's overlay; F1 or ? also opens it).
- Trama's Undo/Redo IconButtons are kept only on Notes and the exam Review screen, where the undo stack applies.

### 2.7 Dock: recording bar, transcription and download rows (`shell/Dock.tsx`)

The dock sits at the bottom of `main`, on every screen, and is **never hidden** while it has a row. Each row is 56 px, on `--paper-raised`
with a `--rule` top border and `z-index: var(--z-dock)`. At most 2 rows are shown, in this order:
1. Recording (if any).
2. One job row: transcription on this computer, or else a model download. When there are more jobs, the row ends with "+{n} more".

**Recording row** (`RecordDock`, `role="region"`, `aria-label` "Recording", `[record-dock]`):

```
● REC  ▌⚖ DC I · Lecture 8   00:41:12   Mic ▁▃▅▇▅   │ ★1 Important  ?2 Didn't get it  ◎3 Exam!  ☑4 To do  ✎N Note │  [⏸ Pause] [■ Stop]
```

- **Left**: the live dot (`--rec`, pulsing), the label "REC" (`--rec-text`, 12 px 750), ClassTab sm, class short name and lecture title,
  then the elapsed time (tabular, from audio frames rather than a JS timer). Clicking the title opens the class.
- **Meters**: `LevelMeter` (role `meter`, `aria-valuemin` −60, `aria-valuemax` 0, `aria-valuenow` = RMS dBFS rounded, `aria-label` "Microphone level").
  It is 64×16 px with 5 bars, fast rise and a ×0.85 decay (Trama), and a clipping tick in `--danger` when clipping. Online mode with the mic also shows a "Computer sound" meter.
- **Markers**: five `MarkerButton`s `[record-mark]`, each with `data-mk` = `important|confused|exam|todo|note`. Each shows the icon in `--mk`, the key hint and the label.
  - At main widths below 1280 px, the labels hide and the buttons become icon-only with tooltips.
  - Pressing one, or its key (1–4), drops a marker at `audio_ms − leadMs` (Settings default 3000 ms; audio-pipeline §4.5). The marker pops and the toast "Marked “Exam!” at 41:09" appears with Undo.
- **Note**: **N** or the Note button turns the marker strip into an inline `TextField` "Note at 41:12…" `[record-note-input]`. The note is stamped at the moment the field opened.
  Enter saves (toast "Note saved at 41:12"); Esc cancels. Typing digits in this field never drops markers.
- **Pause** `[record-pause]` toggles to **Resume** `[record-resume]`. The paused state shows "Paused" in place of REC and stops the dot from pulsing; time stays frozen.
- **Stop** `[record-stop]` (`variant="danger"`, the `square` icon, "Stop") opens the Save dialog (§3.6.4).
- Inline notices replace the marker strip for 10 s, or until dismissed, with a `Notice` look and `role="status"`:
  - **No sound**: mic RMS below −55 dBFS for 15 s within the first 2 min, or for 120 s at any time later. Text "We can't hear anything. Is the microphone muted?" plus [Check] `[record-check-mic]`, which opens the device picker popover.
  - **On battery**: when `on_battery` and below 15 %, or below 30 % at a recording start. Text "On battery: about {h} h left. Plug in if the lecture runs long."
  - **Low disk**: less than 200 MB free. Text "Your disk is almost full. Recording stops if it fills up."
  - **Track lost**: `micOff` / `systemOff` (Trama wording; §5 `record.dock.*`).
- States: `starting` ("Starting…"; markers disabled), `recording`, `paused`, `saving` ("Saving the recording…" with an indeterminate ProgressBar), and
  `failed` ("The recording stopped: {reason}. What was recorded is kept." with [Save what was recorded]).
- Announcements (`role="status"`, polite) only on state changes: "Recording started", "Paused", "Recording resumed", "Recording saved".
  The timer is never announced.

**Job row** (`JobDock`, `[job-dock]`):

```
◐ Transcribing “Aula 7” on this computer · 62 % · about 12 min left        [Stop]              ← transcription
↓ Downloading the speech model · 212 of 574 MB · about 2 min               [Pause]             ← model download
```

The row has a ProgressBar 160 px wide (`aria-label` = the row text). Its buttons are:
- transcription: `[job-stop]` ("Stop and let someone else do it": releases the claim, sync spec §14.8; there is no pause, because a paused job stops heartbeating and its claim goes stale);
- download: `[job-pause]` (a Pause keeps the `.part` file; `speech_model_cancel`).

A completed job leaves the dock. A toast follows: "The transcript of “Aula 7” is ready." [Open] `[toast-action]`.

### 2.8 Toasts and system notifications

**Toasts**: Trama's `ToastProvider`, kept as-is:
- one toast at a time, bottom-centre of `main`, 16 px above the dock;
- 6 s, or 10 s when it has an action; pauses on hover and focus;
- `role="status"` (polite); Esc closes it; tones `neutral | success | danger`.

They are used for confirmations with Undo (deleted, marked, moved, copied), job completions, and admission ("Bruno Costa joined DC I").
Errors that need a decision use dialogs or inline Notices, never toasts.
Test ids: `[toast]`, `[toast-action]`, `[toast-undo]`.

**System notifications** are raised by the app's `NotificationService` and shown by the OS through Rust (`notify_show`), so they also arrive while the window is hidden in the tray (the app keeps running, G12). Their texts are the `notify` namespace (§5.22). They are only for:
- @mentions of me or @everyone;
- a new pin (v1.1);
- an exam date added or changed;
- my transcript ready, and a lecture transcript ready in a class I follow;
- a person joined (or wants to join);
- a recording interrupted;
- a model download finished.

Each respects the class notify level (§3.3) and the Settings toggles (§3.14.6). The text is the same as the matching toast. Clicking one focuses the window and navigates.

### 2.9 Command palette (Ctrl/⌘+K), `shell/CommandPalette.tsx` (ported verbatim, extended)

Trama's palette is a combobox over a listbox with `aria-activedescendant`; Tab is trapped and `#root` is inert. Tramado adds **search result
groups** above the commands. §3.13 covers search in full; this section covers commands.

Command registry entries are `{id, label, run, keywords?, group?, shortcut?, icon?, disabled?, priority?}`. The required commands, ids prefixed with `command-` as test ids:

| id | Label (`app.commands.*`) | Shortcut | Available |
|---|---|---|---|
| `go-today` | Go to Today | Ctrl/⌘+Shift+H | always |
| `go-class-<classId>` | Go to {class} | Ctrl/⌘+1…9 | one per class |
| `go-tab-<tab>` | {Tab} in {class} | — | inside a class |
| `go-settings` | Open Settings | Ctrl/⌘+, | always |
| `go-settings-<section>` | Settings › {Section} | — | always |
| `class-new` | New class… | — | always |
| `class-join` | Join a class… | Ctrl/⌘+Shift+J | always |
| `class-invite` | Invite classmates to {class}… | — | shared class |
| `class-share` | Share {class}… | — | local class |
| `record-toggle` | Record a lecture… / Stop recording | Ctrl/⌘+Shift+R | always |
| `record-pause` | Pause recording / Resume recording | — | while recording |
| `record-mark-<kind>` | Mark “{kind}” | 1–4 | while recording |
| `lecture-import` | Add a recording… | — | inside a class |
| `doc-add` | Add documents… | — | inside a class |
| `exam-add-date` | Add an exam date… | — | inside a class |
| `exam-add-paper` | Add an exam paper… | — | inside a class |
| `practice-class` | Practise {class} | — | class has papers |
| `note-new` | New note in {class} | — | inside a class |
| `ask-class` | Ask AI about {class} | — | inside a class |
| `ask-all` | Ask AI about all classes | — | always |
| `theme-system` / `theme-light` / `theme-dark` | Theme: System / Light / Dark | — | always |
| `lang-en` / `lang-pt` / `lang-es` | Language: English / Português / Español (native names) | — | always |
| `sync-pause` | Pause sharing / Resume sharing | — | Syncthing started |
| `shortcuts` | Keyboard shortcuts | F1, ? | always |
| `diagnostics-copy` | Copy diagnostics | — | always |
| `example-leave` | Leave the example | — | example mode |

Scoring is Trama's (accent-folded; every query word must appear). Commands never show while the query matches content better than all
commands. In that case the "Commands" group is listed last with at most 3 rows.

### 2.10 Global keyboard map

All are registered through `watchShortcuts(map, overModals)` (capture phase). "Not in text" means the shortcut is ignored while focus is in an
`input`, `textarea`, `select` or `[contenteditable]` (`isTextEntry`), so typing "1" in a note never drops a marker (C32).

| Keys | Action | Scope |
|---|---|---|
| Ctrl/⌘+K | Open the palette | global, not over modals |
| Ctrl/⌘+Shift+R | Not recording: open the Record dialog (for the current class, or asks which class). Recording: open the Save dialog | global, not over modals |
| Ctrl/⌘+, | Settings | global |
| Ctrl/⌘+Shift+H | Today | global |
| Ctrl/⌘+1…9 | n-th class in the rail | global |
| Ctrl/⌘+Shift+J | Join a class | global |
| Alt+←, mouse back button | Back | not in text, not over modals, not when a screen claims Alt+arrows |
| Esc | Close the top layer only (`pushLayer`) | global |
| Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y | Undo / redo (Notes, Review, deletes with Undo) | not in text, not over modals |
| F1, or ? (Shift+/) | Keyboard shortcuts overlay | ? only when not in text |
| 1, 2, 3, 4, N | While recording: markers and note. In a lecture view (not recording): a marker or note at the playback time | not in text |
| Ctrl/⌘+F | Find in the current view (transcript, document, chat, list filter) | screen |
| Ctrl/⌘+Enter | Submit the current composer or dialog (Ask, chat, my answer → reveal) | text fields |
| Ctrl/⌘+Alt+1…4 | **OS-global** marker shortcut while recording (opt-in, Settings › Transcription; `tauri-plugin-global-shortcut`) | OS |

Screen-specific keys are listed with each screen. The **Keyboard shortcuts overlay** `[shortcuts-dialog]` is a `Dialog size="md"`. It lists every global key
plus the keys of the current screen, grouped under the headings in §5 `app.shortcuts.*`.

### 2.11 Components

**Ported from Trama** (`trama-ui §1.6`; keep the APIs, change only token values):
Button, IconButton, Checkbox, Switch, RadioGroup, ColorPicker (ADAPT: `CLASS_COLORS`, swatch names from `classes.colours.*`),
ConfirmDialog/useConfirm, Dialog, Spinner, ProgressBar, EmptyState (ADAPT: `.paper-grid` backdrop), Kbd, Badge (ADAPT: add the tones `ai`, `mark`, `rec`),
Notice, Card, Section, Toolbar, Field/TextField/TextArea/SearchField/Select, Menu/MenuButton/ContextMenu, Popover, SplitPane
(storage prefix `tramado.split.`), Table, Tabs (ADAPT: underline `background: var(--c-bar, var(--ink))`), Toast, Tooltip.

**New** (in `app/src/ui/tramado/`; each accepts `className` and `data-testid`):

| Component | Props (exact) | Notes |
|---|---|---|
| `ClassTab` | `{ color: string; icon: ClassIconName; size?: 'sm'\|'md'\|'lg'; filled?: boolean }` | §1.3 |
| `ClassChip` | `{ cls: {name; shortName; color; icon}; short?: boolean }` | ClassTab sm + name; used in Today, search and the palette |
| `CountdownChip` | `{ exam: ExamDateView; now: DateTime; onClick?() }` | §3.3; never red |
| `PresenceDot` | `{ state: 'online'\|'syncing'\|'offline'\|'recording'\|'transcribing'; label: string }` | shape + colour: filled ● `--success-text` / half ◐ `--accent-text` / ring ○ `--ink-3` / rec dot / spinner; `role="img"` with `aria-label` |
| `Avatar` | `{ name: string; memberId: string; colour?: string; size?: 24\|28\|40; presence?: PresenceDot['state'] }` | initials (first letters of the first and last word) |
| `LevelMeter` | `{ db: number; peak: number; clipping: boolean; label: string }` | §2.7 |
| `MarkerButton` | `{ kind: MarkerKind; shortcut?: string; iconOnly?: boolean; onMark(): void }` | |
| `MarkerIcon` | `{ kind: MarkerKind; auto?: boolean; size?: number }` | `span[data-mk]` + lucide icon; `auto` adds the `radar` badge |
| `Player` | `{ src: MediaSource; durationMs: number; onTime(ms): void; ref: PlayerHandle }` | `PlayerHandle = { play(); pause(); toggle(); seek(ms); skip(deltaMs); setRate(r); readonly ms: number; readonly playing: boolean }`; media from `tramado-media://`, with the Blob-URL fallback (C10); the demo uses `FakeMedia` (§7.2) |
| `Timeline` | `{ durationMs; peaks: number[]\|null; markers: TimelineMark[]; hits: number[]; citeAt?: number; ms: number; onSeek(ms) }` | §3.5.2; `peaks` = `platform.speech.peaks(source, 1200)` (0–255) |
| `TranscriptView` | `{ transcript: TranscriptVM; ms: number; follow: boolean; editing: boolean; highlights: HighlightVM[]; find: FindState\|null; onSeek(ms); onEdit(op) }` | §3.5.3 |
| `SelectionToolbar` | `{ anchor: Rect; actions: ('highlight'\|'comment'\|'explain'\|'ask'\|'copy')[]; onAction(a, kind?) }` | `role="toolbar"`, roving focus |
| `AiCard` | `{ title: ReactNode; model: ModelLabel; fallbackOf?: string; askedBy?: string; at?: string; children; grounded?: number; footer?: ReactNode; state?: 'streaming'\|'done'\|'cut'\|'error' }` | 4 px `--ai` left bar, `Badge tone="ai"` "AI", body in the reading font, `aria-label` "AI answer" |
| `CitationChip` | `{ citation: Citation; onOpen(c): void }` | §4 |
| `CitationPopover` | `{ citation: Citation; anchor; onClose; onOpen(play?: boolean) }` | §4 |
| `SourceRow` | `{ citation: Citation; onOpen }` | §4.4 |
| `QuotaMeter` | `{ quota: Quota\|null; compact?: boolean }` | §3.14.3 |
| `CostLine` | `{ requests: number; quota: Quota\|null; model: ModelLabel }` | "About {n} requests · {left} free left today" |
| `CheckWords` | `{ deviceId: string }` | two words, mono, with a copy button (§3.12.6) |
| `QrCode` | `{ value: string; size?: number; label: string }` | `qrcode@1.5.4` `toString(value,{type:'svg',errorCorrectionLevel:'M',margin:4})`, inserted as an `<img src="data:image/svg+xml;…">` with `alt=label`; `size` default 340; `modulePx` instead sizes it from the code's version, (modules + 8) × modulePx (the invite uses 4: ≥ 4 px per module, 356–452 px for version 16–22) |
| `DropOverlay` | `{ classId; target: 'documents'\|'exam'\|'lecture' }` | full-main overlay, dashed `--accent` border, `.paper-grid` |
| `ProgressSteps` | `{ steps: {label; state:'todo'\|'doing'\|'done'\|'failed'}[] }` | an ordered list with icons |
| `PinsStrip` | `{ pins: PinView[]; onOpen(messageId); onHide() }` | §3.3 (v1.1; not built in 0.1) |
| `Composer` | `{ placeholder; onSend(text, attachments, replyTo); mentions: MentionOption[]; disabled?: string }` | Enter sends, Shift+Enter newline (chat and Ask) |
| `MarkdownView` | `{ source: string; links: 'internal-only'\|'all' }` | Trama's renderer: **no raw HTML**, no `javascript:` or `data:` links; `tramado:` links become in-app buttons; external https links go through the Rust `open_external` with a host confirmation (G27) |

### 2.12 Data the screens consume (view models)

Services build these from the on-disk formats (critique §6) and the Rust/IPC layer. Screens never read files directly.
The field names below are part of this spec. The data-format spec owns the storage shapes.

```ts
export type MarkerKind = 'important' | 'confused' | 'exam' | 'todo' | 'note';
export interface DeviceRef { deviceId: string; deviceName: string; memberId: string; memberName: string; self: boolean }
export type ClassSync =
  | { kind: 'local' } | { kind: 'upToDate' } | { kind: 'syncing'; files: number | null; bytesLeft: number | null }
  | { kind: 'waiting' } | { kind: 'paused' } | { kind: 'relay' } | { kind: 'missingFolder' }
  | { kind: 'problems'; count: number };
export interface ClassView {
  id: string; name: string; shortName: string; color: string; icon: ClassIconName;
  lecturer: string | null; term: string | null; language: string /* BCP 47, e.g. 'pt-PT'; 'auto' = detect */;
  vocabulary: string;                  // transcription hint (whisper initial prompt)
  shared: boolean; archived: boolean; path: string;
  sync: ClassSync; onlineMembers: number; memberCount: number;
  unread: number; mentions: number; recordingBy: DeviceRef | null;
  nextExams: ExamDateView[];           // future dates, ascending, max 3
  pins: PinView[];                     // newest first; always [] in 0.1 (pins are v1.1)
  notify: 'important' | 'all' | 'none'; askBeforeJoin: boolean; skipAudio: boolean;
  organisers: string[];                // memberIds
  newerFormat: boolean;                // G14: some files need a newer Tramado
}
export interface ExamDateView { examId: string; classId: string; title: string; kind: ExamKind; at: string /* ISO, local wall time */;
  allDay: boolean; room: string | null; covers: string | null; weight: string | null; practiceCount: number }
export type ExamKind = 'quiz' | 'test' | 'midterm' | 'final' | 'resit' | 'special' | 'oral' | 'practice';
export interface PinView { messageId: string; text: string; by: string; at: string }
export type TranscriptionState =
  | { kind: 'none' }                                         // nobody has claimed it
  | { kind: 'waitingAudio'; have: number; size: number }     // lecture.json arrived; audio still syncing
  | { kind: 'claimed'; by: DeviceRef; percent: number; etaMin: number | null; quietMin: number; health: 'healthy' | 'slow' | 'stale' }
                                                             // healthy < 2 min, slow 2–10 min, stale ≥ 10 min (sync spec §14.1 SLOW_MS/STALE_MS)
  | { kind: 'arriving'; by: DeviceRef; holders: DeviceRef[] } // finished on another computer, transcript still syncing (sync spec §14.4)
  | { kind: 'local'; phase: 'model' | 'decoding' | 'transcribing'; percent: number; etaMin: number | null }
  | { kind: 'done'; by: DeviceRef; engine: 'local' | 'cloud'; model: string; at: string; revision: number; pendingEdits: number }   // pendingEdits: 0 in 0.1
  | { kind: 'failed'; by: DeviceRef; code: string }
  | { kind: 'unavailable'; reason: 'transcriptOnlyElsewhere' | 'audioDeleted' | 'notShared' };
export interface LectureView {
  id: string; classId: string; title: string; startedAt: string; durationMs: number;
  mode: 'room' | 'online' | 'import'; language: string; recordedBy: DeviceRef;   // 'import' shows the `file-audio` icon
  audio: { present: boolean; arriving: boolean; skipped: boolean } | null;   // null = no audio published (transcript only / deleted)
  transcription: TranscriptionState; myMarkers: Record<MarkerKind, number>; autoExamMarks: number;
  duplicateOf: string | null; probableDuplicateOf: string | null;   // overlap > 50 % with a transcribed lecture (sync spec §14.3)
  newerFormat: boolean; untrustedTranscript: boolean;               // a transcript exists but failed the authorship check
}
export interface Quota { remaining: number; limit: number; used: number; resetsAt: string /* local ISO of next 00:00 UTC */;
  isFreeTier: boolean; creditLeft: number | null }
export interface ModelLabel { id: string; label: string /* "Gemma 4 31B (free)" */; free: boolean }
```

Exam and question view models are in §3.9.1, citations in §4.1, and chat in §3.10.1.
---

## 3. Screens

Each screen lists: wireframe, components, behaviour, states (empty / loading / error / offline), keys and test ids.
Strings in quotes are the English microcopy; §5 has each one under its key.

### 3.1 Onboarding (phase `welcome`; `features/onboarding/`)

Four steps, about 60 seconds. Only the name is required. There is no network before the AI step, and none at all if AI is skipped.
Layout: two columns on a full-window background (Trama's `Frame`).
- The left column (max 560 px, vertically centred) holds the step.
- The right column is a `.paper-grid` panel with a decorative, `aria-hidden` specimen that shows three class cards, an AI card with two citation chips and the 12 swatches. It matches `…/lab/trama-ui/mock/welcome-light.png`.
- Below 1200 px window width, the right panel is hidden.
- A step indicator "Step {n} of 4" (4 dots + visually hidden text) sits above each title, except on step 1.
- [Back] (ghost) is on steps 2–4. Esc does nothing (not dismissible).

**Step 1 — Welcome** `[onboarding-welcome]` (ready marker; demo `?demo=empty`)
```
▣ Tramado
Your classes, ▀all in one place▀                       ← display 44, "all in one place" = .hl-emph
Record and transcribe lectures, keep every handout and law text together, share them with your
class, and practise for exams with an AI that shows where each answer comes from.
[ Get started ]  [ ✦ Try the example ]
──────────────────────────────────────────
👤✕ No account            🗀 Plain folders              ⚿ Your AI key, or none
Nothing to sign up for.   Your classes are ordinary    Bring a free OpenRouter key,
                          folders on your computer.    or skip AI.
Language  [ English | Português | Español ]            ← RadioGroup segmented, native names
No account. Nothing leaves this computer until you share a class or turn on AI.
```
- The language is pre-selected from `detectUiLocale(navigator.language)`. Changing it re-renders at once and is saved to prefs `ui.locale`.
- [Get started] `[onboarding-start]` goes to step 2.
- [Try the example] `[onboarding-example]` starts the in-memory example library (Trama's `startExample`) with the ribbon (§2.2).
  Leaving the example returns to step 1.

**Step 2 — You** `[onboarding-name]`
```
What should classmates call you?
Name  [ e.g. Ana Ribeiro                        ]       ← TextField, autofocus, required, ≤ 64 chars
      Shown next to your messages and recordings in classes you share. You can change it later.
This computer will appear as “Ana's laptop”. [Change]  ← inline edit → TextField "This computer's name"
Your classes are kept in  ~/Tramado  [Change…]        ← folder picker; warning Notice if under a cloud-sync folder (G15)
                                              [ Continue ]
```
- The computer name defaults to `"{first name}'s {kind}"`, where kind is "laptop" if the device has a battery, else "computer". It is localised (`onboarding.name.device*`).
- [Continue] `[onboarding-name-continue]` is disabled while the trimmed name is empty. On click it calls `platform.person.init()` (creates the person key; `memberId` is derived from it, folder spec §8.3.1) and `platform.sync.identity()` (creates this computer's sharing identity without starting anything or opening a port), then writes `identity.json` (`memberId`, `name`, `deviceName`, `personPub`) and prefs.
- If `sync.identity()` fails (`SYNC_UNAVAILABLE`: the sharing component is missing), the step shows a blocking danger Notice `[onboarding-identity-error]` "Tramado is incomplete (the sharing component is missing). Reinstall Tramado." with [Copy diagnostics]; classes cannot be created without an identity.
- Cloud folder warning (`[onboarding-cloud-warning]`): shown when the path contains `OneDrive`, `Dropbox`, `iCloud Drive`,
  `Mobile Documents` or `Google Drive`. The text is "This folder is synced by {service}. Two sync tools on the same files cause conflicts. Choose a folder outside it." [Choose another folder].

**Step 3 — AI help (optional)** `[onboarding-ai]`
```
AI help (optional)
Tramado can answer exam questions from your own classes, explain a passage, summarise a lecture and find
things in your documents. It uses OpenRouter with your own key, and free models work.
OpenRouter key  [ sk-or-…                     ] [Paste]   (password field with show/hide)
                Get a free key at openrouter.ai/keys ↗
ⓘ OpenRouter is for people aged 18 or over. If you are younger, skip this: everything else in Tramado
  works without AI. (You can also connect a local AI later in Settings.)
⛉ When you ask the AI something, your question and the passages it needs go to OpenRouter and the
  company running the model. Tramado asks only for providers that don't train on what you send.
[ Test and save ]   [ Skip for now ]
<result line>
```
- [Test and save] `[onboarding-ai-test]` calls `platform.secrets.set('openrouter', key)`, then `AiService.testKey()` (`ai_send` `GET key`). The result line `[onboarding-ai-result]` (`Notice`) is one of:
  - checking: Spinner + "Checking your key…";
  - OK: success, "Works. Gemma 4 31B (free) is your model, and you have {n} free requests left today.";
  - OK but default busy: info, "Your key works. The free model is busy right now (that's common). Tramado will try {fallback} when that happens.";
  - `AI_AUTH`: danger, "OpenRouter didn't accept this key. Check that you copied all of it (it starts with “sk-or-”)." The key is cleared from secrets;
  - `AI_OFFLINE`: warning, "You seem to be offline. The key is saved; Tramado will check it when you're online.".
- After OK, the button becomes [Continue] `[onboarding-ai-continue]`. [Skip for now] `[onboarding-ai-skip]` is always available.
- The opening of the external link goes through `open_external`, which opens `https://openrouter.ai/…` without a confirmation (architecture §6.5 allow-list).

**Step 4 — Ready** `[onboarding-ready]`
```
You're set, Ana.
┌ ＋ Create a class ───────────────────┐  ┌ ⇥ Join a class ──────────────────────┐
│ Start a class for a subject you're   │  │ Paste an invite a classmate sent you. │
│ taking.                              │  │                                      │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
The speech model for transcribing lectures (574 MB) downloads the first time you need it.
                                                              [ Go to Today ]   ← ghost
```
- The two big buttons are cards (`[onboarding-create]`, `[onboarding-join]`). Each enters `ready` and opens the New class dialog (§3.3.1) or the
  Join dialog (§3.12.3) over Today. [Go to Today] `[onboarding-finish]`.

### 3.2 Today (`route today`; `features/today/`; `[screen-today]`)

```
Good afternoon, Ana                                                        Tuesday, 3 November
┌ WELCOME CHECKLIST (first days only) ─────────────────────────────────────────────────────────────┐
│ ☑ Create or join a class   ☐ Record or add a lecture   ☐ Add a document   ☐ Add an exam date  [✕] │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ COMING UP ───────────────────────────────────────────────────┐ ┌ TRANSCRIPTIONS ──────────────────┐
│ ▌🧬 BIO 101 · Quiz 1          In 2 days · Thu 5 Nov, 14:00   │ │ This computer: idle              │
│                                          [Practise (3) ▸]   │ │ ◐ Bruno's laptop · Aula 8 · 40 %  │
│ ▌⚖ DC I · Frequência         In 9 days · Thu 12 Nov, 10:00  │ │ 1 waiting for a transcriber       │
│   Anfiteatro 1.02                         [Practise (5) ▸]   │ │            [Transcribe it here]  │
└──────────────────────────────────────────────────────────────┘ └──────────────────────────────────┘
┌ RECENT LECTURES ─────────────────────────────────────────────┐ ┌ UNREAD ──────────────────────────┐
│ ▌⚖ Aula 8 — Estado de exceção   Today 10:00 · 1 h 18 · ◐ 40 %│ │ ▌⚖ DC I   3 messages · 1 mention │
│ ▌🧬 Lecture 4 — Osmosis         Mon · 48 min · Waiting  ⏸    │ │   Bruno: “@Ana tens os apont…”   │
│ ▌⚖ Aula 7 — Proporcionalidade   Tue 27 Oct · ✓ Transcript    │ └──────────────────────────────────┘
└──────────────────────────────────────────────────────────────┘
```
- **Greeting**: "Good morning, {first}" (05:00–11:59), "Good afternoon, {first}" (12:00–18:59), or "Good evening, {first}" (otherwise). The date is
  `i18n.date(now,'long')` with the weekday.
- **Welcome checklist** `[today-checklist]`: shown until all four items are ticked or the card is dismissed (prefs `today.checklistDismissed`).
  Items tick themselves from data. Clicking an unticked item runs its action (New class / Record / Add documents / Add exam date) in the most recently opened class, or asks which class.
- **Coming up** `[today-exams]`: every exam date in the next 21 days across non-archived classes, ascending. Each row is `[today-exam]` with `data-exam-id`.
  - Within 3 days, the row has a 3 px `--c-bar` left border, a bold countdown, and the words "Today", "Tomorrow" or "In 2 days".
  - [Practise ({n})] `[today-practise]` appears when the class has questions in practice. Clicking the row opens the class Exams tab.
- **Transcriptions** `[today-transcriptions]`: this computer's job (state and percent), then other devices' active claims (`claimed`), then the
  count of lectures with `none`. [Transcribe it here] `[today-transcribe-here]` claims the oldest waiting lecture. The model prompt (§3.5.5) appears if needed.
  Hidden when there are no shared classes and no local job.
- **Recent lectures** `[today-lectures]`: lectures from the last 14 days, newest first, at most 6. Rows are `[today-lecture]` with `data-lecture-id` and open the lecture.
- **Unread** `[today-unread]`: classes with unread chat, mentions or new pins. Each shows the newest mention, or else the newest message, at most 60 characters.
  Rows are `[today-unread-class]` and open the Chat tab.
- **Layout**: two columns (60/40) when main is at least 1180 px wide, otherwise one column in the order Checklist, Coming up, Transcriptions, Recent, Unread.
  Each section is hidden when it is empty.
- **States**:
  - No classes: an EmptyState `[today-empty]` titled "Welcome, {first}." with [Create a class] [Join a class].
  - Classes, but every section empty: "All clear for today." with the body "No exams in the next 3 weeks and nothing waiting." `[today-clear]`.
  - Loading: skeleton cards (3 grey bars per card, `aria-busy`).
  - Offline or sync errors: no special state; the sync pill tells.

### 3.3 Class (`route class`; `features/class/`; `[screen-class]`)

#### 3.3.1 New class / Class settings dialog `[class-dialog]` (`Dialog size="md"`, `onSubmit`)

```
New class
Name              [ e.g. Teoria Geral do Direito Civil              ]  [class-name]
Short name        [ TGDC ]  Used in chat, notifications and tight spaces.  [class-short]
Colour            ● ● ● ● ● ● ● ● ● ● ● ●                                  [class-colour] (ColorPicker, custom=false)
Icon              [⚖][⚒][🏛][…33 icons in an 11×3 grid; the suggested one first, marked "Suggested"]  [class-icon]
Lecturer          [ optional ]          Term [ 2026/27 · Semester 1 ]      [class-lecturer] [class-term]
Language spoken in lectures  [ Português (Portugal) ▾ ]                   [class-language]
                  Used for transcripts and AI answers.
Share with classmates   (●━)                                               [class-share]  (Switch)
                  Classmates you invite get the lectures, documents, class notes and chat. Your own
                  notes, highlights and practice stay on your computer.
                                                    [Cancel]  [Create class]   [class-dialog-save]
```
- The short name is auto-suggested while the user has not edited it: the initials of words with 3 or more letters, upper-cased, at most 6 characters (for example "Teoria Geral do Direito Civil" → "TGDC").
  Otherwise the first word, truncated to 10 characters.
- The colour is pre-picked with `suggestColour`. The icon follows `suggestIcon(name)` until the user picks one. `IconPicker` is a radio grid
  (`role="radiogroup"`, arrow keys); each option is `${id}-${iconName}` with `aria-label` = the icon's localised name (`classes.icons.*`).
- Language options: Português (Portugal) `pt-PT`, Português (Brasil) `pt-BR`, Español `es-ES`, English `en`, Français `fr`, Deutsch `de`,
  Italiano `it`, "Detect automatically" `auto` (stored as meta `language`, folder spec §8.2; tags match by folder spec §2, so `es-ES`
  gets Spanish transcript labels). The default is the UI language.
- With sharing **on**, Create creates the folder (sanitised name, G15) and the class files, starts Syncthing if needed (C6), and
  shows the **first-share dialog** (§3.15.1) when it is the user's first shared class. Then the class opens with the "Invite classmates" card
  `[class-invite-card]` at the top of the Lectures tab.
- With sharing **off**, the hint changes to "Only on this computer. You can share it later."
- A name already used by another class shows the error "You already have a class called “{name}”."
- **Class settings** (the same dialog, title "Class settings", `[class-settings]`) adds these fields:
  - "Vocabulary for transcripts" (TextArea, ≤ 500 characters, `[class-vocabulary]`, hint "Names and terms the lecturer uses (for example: Gomes Canotilho, quid iuris). Tramado passes them to the speech model so it spells them right."; meta `vocabulary`, sent as `TranscribeRequest.initialPrompt`);
  - "Ask before letting people in" (Switch, shared only, `[class-ask-before-join]`, hint "Members' computers will wait for someone to click Let in. Off: anyone with the invite joins.");
  - "Skip audio files on this computer" (Switch, `[class-skip-audio]`, hint "You still get every transcript. Saves about 11 MB per lecture hour.");
  - Notifications: a RadioGroup `[class-notify]` with "Mentions and important" (default), "Every message" and "Nothing" (prefs `notify.class.<classId>`; default from `notify.default`);
  - a **Danger zone** Section: [Leave class…] `[class-leave]` (shared) or [Delete class…] `[class-delete]` (local).

  Edits are written as per-field LWW entries (G8). An organiser badge is not required to edit the name, colour or icon (roles are social, G6).

#### 3.3.2 Class header and tabs

```
┌──┐ Direito Constitucional I                               [👤+ Invite] [● Record lecture] [＋ Add ▾] [⋯]
│⚖ │ Prof.ª Marta Reis · 2026/27 · 1.º semestre · Ⓐ Ⓑ Ⓒ 3 members · ⟳ Up to date · 2 online
└──┘
[📅 Frequência · in 9 days] [📅 Exame — época normal · 14 Jan]                         ← CountdownChips
📌 Frequência mudou para 12 nov., anfiteatro 1.02 — Bruno · 1 more ▾                              [✕]
 🎙 Lectures 3 │ 🗎 Documents 6 │ ✎ Notes │ 📋 Exams 3 │ 💬 Chat 3 │ ✦ Ask │ 👥 Members 3
 ━━━━━━━━━━━━  ← 3 px underline in --c-bar on the selected tab
```
- The header is a `cls-scope` region with `style={classStyle(color)}`. It contains:
  - a 40 px filled ClassTab;
  - the h1 (display, `--fs-2xl`), which IS the screen title, so the top bar shows only Back and actions on the class screen;
  - a meta line: lecturer · term · an avatar stack of up to 4 + "{n} members" (shared only) · sync status text.
- **Actions**:
  - [Invite] `[class-invite]` (shared) or [Share] `[class-share-open]` (local);
  - [● Record lecture] `[record-class]` (disabled while recording; tooltip "Already recording {class}");
  - [＋ Add] MenuButton `[class-add]` with the items:
    - Add documents… `[class-add-documents]`
    - Add a recording… `[class-add-recording]`
    - Add an exam date… `[class-add-exam-date]`
    - Add an exam paper… `[class-add-exam-paper]`
    - New note `[class-add-note]`
    - New class note `[class-add-class-note]`
  - [⋯] `[class-more]` with the items:
    - Class settings…
    - Invite classmates… / Share this class…
    - Notifications ▸ (the three radios)
    - Recently deleted… `[class-recently-deleted]` (shared only)
    - Open folder `[class-open-folder]`
    - Archive / Unarchive `[class-archive]`
    - Leave class… / Delete class…
- **Countdown chips** `[class-countdown]`, `data-exam-id`: up to 3 future exam dates. Each is pill-shaped with `--c-soft` fill, the `calendar-clock` icon in `--c-text`, and the label
  "{title} · {relative}", where relative is "today, 10:00", "tomorrow, 10:00", "in {n} days" (fewer than 14) or "{date}" otherwise.
  Within 3 days the chip gets a 1.5 px `--c-bar` border and weight 650. Clicking opens the Exams tab with that date highlighted.
- **Pins strip** `[class-pins]`: the newest pin's text (one line, ellipsis), the author, and "{n} more ▾" (a popover listing all pins,
  `[class-pins-more]`). Clicking a pin opens Chat at the message. [✕] `[class-pins-hide]` hides the strip until the next new pin (per device).
  Hidden when there are no pins.
- **Tabs** `[class-tabs]` (`Tabs`, automatic activation, tab ids `class-tabs-<tab>`). Counts are shown as `Badge neutral`. Chat shows an
  unread badge (`info` when it includes a mention). Unshared classes show **Share** (`folder-sync`) in place of Chat and Members.
- **"Since you were away" card** `[class-digest]`: shown at the top of the Lectures tab when the class was last opened more than 3 days ago and
  something changed. It lists counts: "{n} new lectures · {n} new documents · {n} pins · exam date changed · {n} mentions", each a link. [✕] dismisses it.
- **Drag and drop**: dropping files anywhere on the class screen shows `DropOverlay` `[drop-overlay]` with the target chosen by tab and file type:
  - "Drop to add to {class} → Documents";
  - on the Exams tab: "Drop to add as an exam paper";
  - with audio or video files on the Lectures tab: "Drop to add as a recording".
- Keys: Ctrl/⌘+1…9 (other classes). There are no tab shortcuts; the tabs are reachable with arrow keys and through the palette.

#### 3.3.3 Share (unshared class) tab `[class-share-tab]`
EmptyState "This class is only on this computer." with the body "Share it to get a class chat, shared documents and transcripts. Your own notes and practice stay private."
[Share this class] `[class-share-start]`. This turns sharing on (same as the switch) and then opens the Invite dialog.

#### 3.3.4 Leave / delete / archive
- **Leave** (`useConfirm`, `[confirm-dialog]`):
  - Title "Leave {class}?"
  - Body "You stop getting updates. Your copy stays on this computer unless you delete it below. What you added stays with your classmates; remove it before leaving if you want it gone."
  - Checkbox "Also delete my copy from this computer" `[class-leave-delete]`: unticked → `afterwards: 'keepLocal'` (the copy becomes a local, unshared class with a new ID, sync spec §17); ticked → `'trash'` (moved to the OS trash once a classmate's computer has received that you left).
  - Checkbox "Also delete my private notes and practice for this class" `[class-leave-delete-notes]` (`deleteMyNotes`).
  - Buttons [Leave class] (danger) and Cancel (focused first).
  - The class leaves the rail at once. Until a classmate's computer has received the departure, Settings › Storage lists it as "Leaving — waiting for a classmate to receive it". (Unregistering a shared class without leaving is not offered in 0.1.)
- **Delete** (local class): type-to-confirm with the class name (`typeToConfirm`). Title "Delete {class}?", body "This deletes the folder and everything in it from this computer. This can't be undone."
- **Archive**: no dialog. Toast "{class} moved to Archive." [Undo].
- **Organiser gone** (G6): when no organiser has a members file, the Members tab shows a Notice "Nobody organises this class any more." [Become an organiser] `[members-become-organiser]`.

### 3.4 Lectures tab (`[class-lectures]`, ready marker `[lecture-list]`)

```
[● Record lecture] [Add a recording…]                                    [⌕ Filter lectures      ]
THIS WEEK
 🎙 Aula 8 — Estado de exceção          Today 10:00 · 1 h 18 min · Carla        ◐ Bruno's laptop 40 %
 ─────────────────────────────────────────────────────────────────────────────────────────────────
LAST WEEK
 🎙 Aula 7 — Princípio da proporcionalidade  Tue 27 Oct · 1 h 24 min · Carla   ✓ Transcript  ★2 ◎1
 🎙 Aula 6 — Restrições aos direitos…    Tue 20 Oct · 1 h 32 min · you         ✓ Transcript  ★1 ◎2 ?1 ☑1
```
- Rows `[lecture-item]` with `data-lecture-id` (56 px, two lines):
  - mode icon (`mic` for in the room, `monitor-speaker` for online);
  - title;
  - meta: date · duration · recorder ("you" for me);
  - a right-side **transcript chip** `[lecture-transcript-chip]` (§3.5.5 states, compact);
  - my marker counts (MarkerIcon + count, only non-zero; auto exam marks counted under ◎ with the radar badge);
  - flags: "Only on this computer" (`hard-drive`) when not shared, "Recording only on Ana's computer" when `audio === null` and the transcript is shared,
    "⟳ Arriving" while `audio.arriving`, and "Duplicate of {title}" when `duplicateOf`.
- Grouping: "This week" (Monday-based, locale-aware), "Last week", then "Week of {date}". Newest first.
- Row context menu `[lecture-menu]`:
  - Open
  - Rename… (recorder only; otherwise disabled with the tooltip "Only {name}'s computer can rename it")
  - Transcribe… (when not done)
  - Re-transcribe… (done; confirm "This replaces the transcript for everyone.")
  - Mark as duplicate of… (recorder)
  - Delete the recording, keep the transcript… (recorder)
  - Delete for everyone… / Remove from this computer only
  - Show in folder
- [Add a recording…] `[lecture-import]` opens the import flow (§3.6.6).
- **States**:
  - Empty: EmptyState `[lectures-empty]` "No lectures yet." with the body "Record the next one, or add a recording you already have (an audio or video file)." and the buttons [● Record lecture] [Add a recording].
  - Filter with no match: "No lectures match “{q}”."
  - Loading: 4 skeleton rows.
- Keys: ↑/↓ move between rows; Enter opens; Delete opens the delete confirm; Ctrl/⌘+F focuses the filter.

### 3.5 Lecture view (`route lecture`; `features/lecture/`; `[screen-lecture]`)

#### 3.5.1 Layout

```
[←] DC I › Lectures   Aula 6 — Restrições aos direitos fundamentais      [✦ Ask about this lecture] [⋯] [?]
                      Tue 20 Oct · 1 h 32 min · recorded by you · Shared with the class
┌ PLAYER ─────────────────────────────────────────────────────────────────────────────────────────────┐
│ [▶] [⟲10] [⟳10]  00:41:12 / 01:32:05   [1.0× ▾]  🔊━━━○  [⇣ Follow along ✓]   ✓ Transcribed by Bruno's laptop│
│ ▁▂▃▅▆▅▃▂▁▂▃▅▆▇▆▅▃▂▁▁▂▃▅▆▅▃▂▂▃▅▆▇▆▅▃▂▁▂▃▅▆▅▃▂▁▂▃▅▆▇▆▅▃▂▁▂▃▅▆▅▃▂▁▂▃▅▆▇▆▅▃▂▁▂▃▅▆▅▃▂▁            │  waveform 40 px
│      ★         ✎            ◎◎                   ?                             ☑                 │  markers 16 px
│ ──────────────────────────────|────────────────────────────────────────────────────────────────── │  playhead
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ TRANSCRIPT ───────────────────────────────────────────── [⌕ Find  Ctrl+F] [✎ Edit] ┐┌ [Notes|AI|Markers] ┐
│ 00:40:58  PROFESSORA  …e portanto a restrição tem de ser autorizada pela          ││ MY NOTES · Only you │
│           Lei Fundamental.                                                         ││ 33:40 comparar com  │
│ 00:41:12  ◎ Isto costuma sair no exame: a lei restritiva nunca pode atingir o      ││       art. 19.º     │
│ ▌         conteúdo essencial do direito. É o que diz o artigo 18.º, n.º 3.         ││ 52:30 rever exemplo │
│           ▀▀▀▀▀▀▀▀▀▀▀▀▀▀ (current: --accent-soft bg + 3 px --accent bar)          ││ [＋ Note at 41:12 N]│
│ 00:41:40  …                                                                        ││                     │
└────────────────────────────────────────────────────────────────────────────────────┘└─────────────────────┘
```
- The player and timeline are sticky at the top of the screen body. Below them is a `SplitPane` (transcript | side panel; `storageKey` `tramado.split.lecture`,
  side initial 360 px, min 280, max 520). Below 1100 px main width, the side panel is a drawer toggled by `[lecture-side-toggle]`.
- Header actions:
  - [✦ Ask about this lecture] `[lecture-ask]` opens the Ask tab with the scope chip "This lecture";
  - [⋯] `[lecture-more]`:
    - Copy link to this moment
    - Rename… (recorder)
    - Transcribe… / Re-transcribe…
    - Speakers… (v1.1: rename speaker labels with a `label_speaker` edit line, folder spec §8.9)
    - Export transcript ▸ (.md / .vtt / .txt; save dialog)
    - Delete the recording, keep the transcript… (recorder)
    - Delete for everyone…
    - Show in folder

#### 3.5.2 Player and timeline

- **Player** (`Player`, `[player]`):
  - Play/Pause `[player-toggle]` (Space);
  - ⟲10 / ⟳10 `[player-back]` / `[player-forward]` (←/→ move 5 s; Shift+←/→ move 30 s);
  - time "00:41:12 / 01:32:05" (tabular; click to type a time: an `input` with mask `h:mm:ss`, Enter seeks) `[player-time]`;
  - speed MenuButton `[player-speed]` with 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5 and 3× (`preservesPitch` on; `[` and `]` step it);
  - volume slider `[player-volume]`;
  - Follow along toggle `[player-follow]` (F).

  The rate is remembered per device (prefs `lecture.playbackRate`).
- **Media**: the `src` is `platform.media.url({kind:'file', classId, path})`, i.e. `<mediaBase>/c/<classId>/<encoded segments>` (architecture §8; Windows base `http://tramado-media.localhost`), or `/r/<recordingId>.webm` for a recording kept on this computer.
  On `MEDIA_ERR_SRC_NOT_SUPPORTED`, fall back to a Blob URL (C10) silently, and record it for the diagnostics.
- **No audio here**: the player is replaced by a Notice `[player-no-audio]` with the reason. Timestamps stay visible but don't seek. The reasons are:
  - "The recording stays on {name}'s computer (they shared the transcript only)."
  - "The recording was deleted on {date}; the transcript is kept."
  - "You chose to skip audio files in this class." [Get the recording] (removes the per-device ignore for this one file)
  - "The recording is still arriving ({percent})."
- **Timeline** (`Timeline`, `[timeline]`, `role="slider"`, `aria-valuetext` "41 minutes 12 seconds of 1 hour 32 minutes"): a canvas, full width, 64 px tall.
  - Waveform peaks: 1,200 buckets from `platform.speech.peaks(source, 1200)` (Rust `speech_peaks`, `number[]` 0–255, cached as `cache/peaks/<sha256>-1200.json`), drawn in `--ink-4`, played part in `--accent`. While the peaks load, or without peaks, it is a flat 2 px rule.
  - The **marker row** below draws MarkerIcons 14 px (`data-mk` colours) at their time. Auto exam-radar marks are drawn with the radar badge.
  - **Find hits** are 2 px `--mark-strong` ticks. A **cited moment** (when opened from a citation) is a `--mark-edge` triangle above the playhead.
  - The playhead is a 2 px `--ink` line.
  - Click or drag seeks. With the keyboard, the slider takes ←/→ (5 s), PageUp/PageDown (60 s) and Home/End.
  - Hovering shows a tooltip with the time and, over a marker, its label and note.
  - The timeline's markers are ALSO listed in the Markers tab, which is the accessible list (§6).
- Every Player key requires focus not in text and no modal open. `claimAltArrows()` is not used; Alt+← stays Back.

#### 3.5.3 Transcript

- `TranscriptView` `[lecture-transcript]` (ready marker), font `--font-text`, `.reading`; the `lang` attribute is the transcript language.
- **Paragraphs** group segments from the same speaker until a 2 s gap or 60 s of text. Each paragraph `[transcript-para]` has `data-segment-id` of its first segment and contains:
  - a timestamp button `[transcript-time]` ("00:41:12", seeks and plays), tabular, `--ink-3`;
  - the speaker label (small caps; only when the transcript has more than one speaker);
  - the segments as inline `<span data-segment-id>`.
- **Current segment** (while playing): background `--accent-soft`, 3 px `--accent` inline-start bar on its paragraph.
  - With **Follow along** on, it scrolls into view centred (smooth, or a jump with reduced motion).
  - A manual scroll (wheel, keys or drag) pauses following and shows a floating pill [↧ Back to {time}] `[transcript-follow-resume]`.
- **Click on a word or segment** (not editing): seeks to the segment start (or the word start when word times exist) and keeps the play state.
- **Markers inline**: a MarkerIcon at the start of the segment containing `marker.at`; the auto exam-radar ones (`LectureDetail.autoMarkers`) carry the `radar` badge.
- **Legal references** `[transcript-ref]`: article mentions found by `core/transcript/references.ts` ("artigo 18.º, n.º 3", "art. 1902 CC") are inline links (accent underline) that open the law text in the class's documents at that article (`LectureDetail.references[].target`); without a matching document they are plain text with the tooltip "No document in this class has this article."
- **AI annotations**: private annotations with `ai: {model}` (from "Annotate with AI") are drawn as a dotted `--ai` underline with a `sparkles` margin mark; hovering shows the note, "AI · {model}" and [Remove].
- **My highlights** (`.hl` with `data-mk`) and the **cited passage** (`mark.cite` + `.cite-block` on the paragraph, flashing on arrival).
- **Find** (Ctrl/⌘+F) opens a find bar `[transcript-find]` above the transcript:
  - the input `[transcript-find-input]`, a count "3 of 12" `[transcript-find-count]` and ↑/↓ buttons (Enter / Shift+Enter);
  - case- and accent-insensitive (`fold`); hits are drawn as `.cite-mark` and as timeline ticks;
  - Esc closes it.
- **Edit mode** (v1.1; in 0.1 the transcript is read-only and [✎ Edit] is not shown):
  - [✎ Edit] `[transcript-edit]` (E) toggles it; a Notice says "Your corrections are shared with the class.", or "…with this computer only" in a local class.
  - Clicking a segment turns it into a `textarea` (reading font) `[transcript-segment-input]`. Enter saves, which appends a `set_text` op with `base`. Esc cancels. Alt+↑/↓ saves and moves to the previous/next segment.
  - A segment menu `[transcript-segment-menu]` (the ⋯ that appears at the paragraph's left on hover or focus) has:
    - Change speaker ▸
    - Split here (at the caret)
    - Merge with next
    - Play from here
  - Segments edited by others but not yet folded show a dotted `--ink-4` underline and the tooltip "Corrected by {name}".
  - A `set_text` whose `base` did not match shows a small `triangle-alert` with "Two corrections met here; check this line." and [Keep this one].
- **Selection toolbar** `[selection-toolbar]` appears on a text selection that is not empty (and not in edit mode). It has 5 actions:
  - [Highlight ▾] `[selection-highlight]`: a menu of the five kinds (Important, Didn't get it, Exam, To do, Other = `other`, drawn with `--mk-note`). The default is the last kind used. Highlights are saved **privately** (`AnnotationLine.colour`, folder spec §8.17).
  - [Comment] `[selection-comment]`: a popover TextArea "Only you can see this comment." Saved privately.
  - [✦ Explain] `[selection-explain]`: opens the AI side tab with Explain (§3.5.5).
  - [✦ Ask…] `[selection-ask]`: opens the Ask tab pre-filled with `"“{selection}” — "` and the scope "This lecture".
  - [Copy with source] `[selection-copy]`: copies `“{text}” — {class short}, {lecture title}, {mm:ss}`. Toast "Copied with its source."
  - Keyboard: after selecting with Shift+arrows, the toolbar appears and **Alt+Down** moves focus into it. Esc dismisses it.

#### 3.5.4 Side panel tabs (`Tabs` `[lecture-side]`, tab ids `lecture-side-notes|ai|markers`)

- **Notes** `[lecture-notes]`: *My notes for this lecture* (private). Each item `[lecture-note]` shows a time button and text, editable inline, with a delete IconButton.
  Notes typed during recording appear here. [＋ Note at {time}] `[lecture-note-add]` (N, not in text) adds one at the playback time.
  The footer link "Open in Notes" `[lecture-notes-open]` opens the private Markdown note for this lecture. That note is created on demand
  with a heading and a timestamp link per note.
- **AI** `[lecture-ai]`: two tool cards and the Explain area.
  - **Summary** `[lecture-summary]`: [Summarise this lecture] `[lecture-summary-run]` → an AiCard with 5–10 bullets, each ending in a time chip (a citation with a `time` locator).
    It shows CostLine "About {n} requests", where n = ⌈transcript chars / 40 000⌉ + 1 (G11).
    It is saved privately per lecture, with the actions [Regenerate] and [Save as note].
  - **Key terms** `[lecture-terms]`: [Find key terms] `[lecture-terms-run]` → an AiCard with a glossary: term — "definition as the lecturer gave it" — time chip.
    The same cost model and actions as Summary. Summary and key terms are saved in `private/<classId>/lectures/<lectureId>.json`.
  - **Annotate with AI** `[lecture-annotate]`: [✦ Annotate the transcript] `[lecture-annotate-run]` (CostLine as Summary) turns the key terms and the
    lecturer's definitions into private AI annotations anchored to their segments (`AskService.annotate`); the toast says "Added {n} AI notes to the transcript." [Undo].
  - **Study notes** `[lecture-study-notes]`: [✦ Make study notes] `[lecture-study-notes-run]` (CostLine as Summary) writes a private note with headings,
    a `tramado:lecture` time link per point and links to the documents cited (`AskService.studyNotes`), then opens it.
  - **Explain** `[lecture-explain]`: shown after "Explain" from the selection. It holds the quoted selection (a `.cite-block`) and an AiCard with the explanation and citations.
    The follow-up chips `[explain-chip]` are [Simpler] [More detail] [Give an example] [Explain in {UI language}] (shown only when it differs from the transcript language)
    [How could this come up in an exam?]. The footer reads "Sent to {provider}: this passage and {n} related passages. [See what was sent]".
  - With AI off: EmptyState "AI isn't set up." with [Set up AI] → Settings › AI.
- **Markers** `[lecture-markers]`: my markers, sorted by time. Each item `[lecture-marker]` has MarkerIcon, label, time, note and a delete button.
  Auto exam-radar markers are listed under "Found in the transcript" with the radar badge and [Remove] (a removal is stored privately in `lectures/<lectureId>.json` `removedAutoMarks`).
  The filter chips are the five kinds. With keys 1–4 and N (not in text), markers and notes can be added at the playback time.

#### 3.5.5 Transcription status card (`TranscriptionCard`, `[transcription-card]`)

While the transcript does not exist, this card takes the transcript area's place. It also appears, compact, as the lecture-row chip, on Today, and in the
header subtitle once done. States (D41; claim staleness is judged on the local clock):

| State | Look | Text (`lectures.transcription.*`) | Actions |
|---|---|---|---|
| `waitingAudio` | `refresh-cw` | "The recording is still arriving ({percent}). Transcription can start when it's complete." | — |
| `none` (shared) | `users` | "**Waiting for a transcriber.** Anyone in the class can transcribe this lecture once, for everyone." | [Transcribe on this computer] `[transcribe-here]` · [With OpenRouter…] `[transcribe-cloud]` (only if cloud is enabled) |
| `none` (local) | `audio-waveform` | "This lecture has no transcript yet." | [Transcribe on this computer] · [With OpenRouter…] |
| `claimed`, `healthy` (claim changed less than 2 min ago) | ◐ ProgressBar | "**{device} is transcribing — {percent} %** · about {eta} left" | [Notify me when it's ready] `[transcribe-notify]` (a toggle) |
| `claimed`, `slow` (2–10 min) | ◐ grey | "{device} is transcribing — {percent} % · last update {n} min ago (it may be asleep or offline)" | — |
| `claimed`, `stale` (more than 10 min) | `triangle-alert` | "**{device} stopped** at {percent} %, {n} min ago." | [Take over on this computer] `[transcribe-takeover]` |
| `arriving` | `refresh-cw` | "Finished on **{device}** — waiting for the transcript to arrive." (+ " {name}'s computer has it." per holder) | — |
| `local` | ProgressBar | "Transcribing on this computer — {percent} % · about {eta} left. You can keep working. Plug in if you can." | [Stop and let someone else do it] `[transcribe-release]` |
| `local`, phase `model` | ProgressBar | "Downloading the speech model first — {done} of {total} MB" | [Pause] `[job-pause]` (keeps the `.part`) |
| `done` | `circle-check` | "Transcribed by **{device}** · {model label} · {date}" (+ " · on this computer" when self) | [👏 Thank {first name}] `[transcribe-thank]` (others only, once) · ⋯ [Re-transcribe…] |
| `failed` | `triangle-alert` | "Transcription failed on {device}: {reason}." | [Try on this computer] |
| `unavailable` | `info` | per reason: "The recording stays on {name}'s computer, so it can only be transcribed there." / "The recording was deleted before it was transcribed." | — |

- "Thank" posts a chat line of type `thanks`. It renders for everyone as "{a} thanked {b} for transcribing {lecture}." (§8, OQ4), and the button changes to "Thanked".
- **Probable duplicate** `[lecture-duplicate-hint]` (when `probableDuplicateOf` is set and the lecture is not transcribed): an info Notice "Probably the same lecture as “{title}”." with [Mark as duplicate] (recorder) and [Transcribe anyway]. Volunteers never pick such a lecture automatically.
- **Untrusted transcript** (`untrustedTranscript`): a warning Notice "This transcript was changed by a computer that isn't its owner. It isn't shown." with [Re-transcribe…] (a new round).
- `eta` is formatted with `lectures.transcription.left.*` (Trama's speech `left` pattern).
- The **speech model prompt** (`Dialog size="md"`, `[model-prompt]`) opens when transcribing locally without an installed model:
  ```
  Transcribing on this computer needs a speech model
  It downloads once (from Hugging Face), then works offline. It's saved in Tramado's own folder, not in your classes.
  ◉ Recommended — 574 MB · good accuracy · about {t} for this lecture       [model-choice-turbo]
  ○ Draft — 190 MB · faster, but rough on Portuguese and Spanish              [model-choice-small]
  ○ Most accurate — 1.08 GB · slower                                          [model-choice-large-v3]
  Free space: 41 GB
  [Download and transcribe] [Let a classmate do it] [Use OpenRouter instead]
  ```
  - [Download and transcribe] `[model-prompt-download]` enqueues the download, then the transcription (dock rows).
  - [Let a classmate do it] `[model-prompt-classmate]` (shared only) leaves the lecture unclaimed and toasts "Classmates who help with transcription will see it."
  - [Use OpenRouter instead] `[model-prompt-cloud]` is shown only if cloud is enabled; otherwise it reads "Use OpenRouter (turn on in Settings)" and opens Settings.
  - `SPEECH_UNSUPPORTED_CPU`: the radios are replaced by "This computer's processor can't run the speech model (it needs AVX2, found in processors since about 2013). A classmate's computer or OpenRouter can transcribe it instead."
  - `DISK_FULL`: "The speech model needs {size} free. You have {free}." [Use the Draft model (190 MB)] [Open Storage settings].
- Keys: none specific.

#### 3.5.6 States of the lecture view
- Loading: skeleton player and 8 skeleton paragraphs.
- Transcript newer than this app (`NEWER_FORMAT`): banner "Made with a newer Tramado — update to edit it." Read-only.
- Transcript stale (`audio_sha256` ≠ lecture audio): warning Notice "The recording changed after this transcript was made. Times may be off." [Re-transcribe…].
- Offline: no change. AI actions show `AI_OFFLINE` inline.

#### 3.5.7 Lecture view test ids (complete)
`screen-lecture, lecture-transcript, lecture-ask, lecture-more, lecture-side-toggle, player, player-toggle, player-back, player-forward,
player-time, player-speed, player-volume, player-follow, player-no-audio, timeline, transcript-para, transcript-time,
transcript-follow-resume, transcript-find, transcript-find-input, transcript-find-count, transcript-ref, selection-toolbar, selection-highlight,
selection-comment, selection-explain, selection-ask, selection-copy, lecture-side, lecture-side-notes, lecture-side-ai, lecture-side-markers,
lecture-notes, lecture-note, lecture-note-add, lecture-notes-open, lecture-ai, lecture-summary, lecture-summary-run, lecture-terms,
lecture-terms-run, lecture-annotate, lecture-annotate-run, lecture-study-notes, lecture-study-notes-run, lecture-explain, explain-chip,
lecture-markers, lecture-marker, lecture-duplicate-hint, transcription-card, transcribe-here, transcribe-cloud, transcribe-notify,
transcribe-takeover, transcribe-release, transcribe-thank, model-prompt, model-choice-turbo, model-choice-small, model-choice-large-v3,
model-prompt-download, model-prompt-classmate, model-prompt-cloud`. (0.1, scope change 2026-11-04: `transcript-edit`, `transcript-segment-input`, `transcript-segment-menu`.)

### 3.6 Recording flow (`features/record/`)

#### 3.6.1 Entry points
- [● Record lecture] in the class header `[record-class]` or on the Lectures tab.
- Ctrl/⌘+Shift+R. When no class is current, a small chooser dialog `[record-pick-class]` asks "Record a lecture in which class?" and lists the classes, with the most recently opened one first.
- The palette command `record-toggle`.
- Today's checklist item.

#### 3.6.2 Record dialog `[record-dialog]` (`Dialog size="lg"`, remembers its answers per class in prefs `record.<classId>`)

```
Record a lecture in ▌⚖ DC I
Where is the lecture?
 ◉ In the room      Uses this computer's microphone. Sit near the front, close to the lecturer or a loudspeaker.
 ○ Online           Records what your computer plays (Zoom, Teams, Meet, Colibri…).
                    [ ] Also record me (for my questions)      ← online only; default off
                    Wear headphones, so the lecture isn't recorded twice.
Language spoken   [ Português (Portugal) ▾ ]          Microphone [ Default — Built-in ▾ ] ▁▃▅ (live meter, RecordingService.startMeter)
── Permission ───────────────────────────────────────────────────────────────────────────────────────
 Lecturer's permission on record: recording and sharing — confirmed by Ana Ribeiro on 20 Oct 2026. [Change]
   — or, without a record —
 [ ] The lecturer agreed to this lecture being recorded.                             [record-consent]
 Share with the class:  ◉ Recording and transcript                                    [record-share-both]
                        ○ Transcript only (the recording stays on this computer)       [record-share-transcript]
                        ○ Nothing yet — I'll decide after                              [record-share-none]
 [ ] The lecturer agreed to sharing it with this class group.                        [record-consent-share]
 [ ] Remember for this class                                                         [record-remember]
 ⓘ In Portugal and Spain, recording someone without their consent, or using a recording for more than
   they agreed to, can be against the law. Ask at the start of the first lecture: most lecturers say
   yes for study. Your classmates are recorded too when they ask questions.  [Why this matters]
── (only when someone else is recording this class right now) ─────────────────────────────────────
 ⚠ Bruno is already recording this lecture (since 14:02, in the room). Only one recording is transcribed
   for the class.                                         [Record anyway, as a backup] [Don't record]
                                                               [Cancel]  [● Start recording]  [record-start]
```
- **Consent rules** (D54):
  - [Start recording] is disabled until the recording consent is ticked and, when the share choice is not "Nothing yet", the sharing consent is ticked. Its tooltip says what is missing.
  - The share radios and the sharing consent exist only in shared classes. "Nothing yet" (`share: 'none'`) keeps the recording on this computer
    (nothing is written to the class) until the user picks a share mode in the Save dialog or later from the lecture's [⋯] › Share… (architecture §9 `PublishRequest`).
  - Each start writes signed `ConsentLine`s to the class consent log (folder spec §8.5): a `record` line and, in a shared class with a share mode, a `share`
    line, with `scope: 'lecture'`; with "Remember for this class" ticked they are written with `scope: 'class'`. Each line stores `memberId`, `ms`,
    `textId` (= the catalog key: `record.dialog.consent.v1`, `record.dialog.consentShare.v1`), `textLang` and the exact `text` shown.
  - When a valid class record exists, the checkboxes are replaced by the one "on record" line, which carries [Change].
  - Online mode adds "Say at the start that you are recording." under the first checkbox.
- **Presence warning** `[record-presence-warning]` appears when `presence/<dev>.json` of another member says recording in this class.
  - [Record anyway, as a backup] dismisses the warning and enables Start.
  - [Don't record] closes the dialog.
- **Pre-flight checks**, shown inline as Notices with Start disabled when blocking:
  - free disk below 200 MB (blocking): "There isn't enough free space to record ({free} left).";
  - no input device (`SPEECH_NO_DEVICE`, blocking);
  - online mode on a system without loopback (`SPEECH_NO_SYSTEM_AUDIO`): "Tramado can't record your computer's sound on this system: {reason}." [Record mic only (in the room)];
  - battery below 15 % (warning only).
- On macOS the first Start triggers the OS microphone prompt. `SPEECH_PERMISSION` then shows "Tramado isn't allowed to use the microphone. Allow it in System Settings › Privacy & Security › Microphone, then try again." [Open settings].
- [Why this matters] `[record-why]` opens a Popover with the paragraph from §5 `record.why`.

#### 3.6.3 While recording
- The dock row (§2.7) appears on every screen. The rail shows the rec dot on the class, and `presence/<me>.json` says recording.
- The lecture does **not** appear in the Lectures list until it is saved. The Lectures tab shows a top row instead: "● Recording now — 00:41:12" `[lecture-recording-row]`.
- Keys 1–4 and N work anywhere in the app when focus is not in text. Ctrl/⌘+Shift+R opens the Save dialog.
- Quitting or closing the window while recording: `useConfirm` asks "Stop and save the recording first?" with the buttons [Stop and save] [Keep recording] (Cancel). With the tray enabled, closing the window keeps recording in the background, and a system notification says so.

#### 3.6.4 Save lecture dialog `[record-save]` (opens on Stop; not dismissible by Esc while saving)
```
Save lecture
Title        [ Aula 8 — ter., 3 nov.                 ]       [record-save-title]
Transcript   ◉ Transcribe on this computer  (about 30 min; downloads the speech model first: 574 MB)   [record-transcribe-local]
             ○ Let a classmate's computer do it                                                       [record-transcribe-classmate]
             ○ With OpenRouter — paid, about 2 cents; the audio is sent to OpenRouter                 [record-transcribe-cloud]
             ○ Not now                                                                                [record-transcribe-none]
Share        Recording and transcript ▾      (the choice made at Start; can be changed here; options: Recording and transcript /
             Transcript only / Keep on this computer for now)                                         [record-save-share]
                                         [Discard recording…]                 [Save]  [record-save-confirm]
```
- The default title is "Lecture {n} — {weekday short} {day} {month short}", localised (PT: "Aula {n} — ter., 3 nov."; ES: "Clase {n} — mar. 3 nov."),
  where n = 1 + the number of lectures in the class.
- Transcript default (sync spec §14.3, so that someone always transcribes):
  - "classmate", if the class is shared and some trusted member file shows `caps.volunteer` ≠ `off` with a local model ready;
  - else "Transcribe on this computer" if the CPU is supported (the model downloads on demand, §3.5.5 model prompt);
  - else "With OpenRouter" if cloud transcription is on;
  - else "Not now".

  A lecture still unclaimed 24 h after its audio is complete notifies the recorder: "Nobody has transcribed “{lecture}” yet." [Transcribe here] (`notify.transcriptNobody`).

  "With OpenRouter" is disabled unless cloud transcription is enabled (Settings), with the tooltip "Turn this on in Settings › Transcription".
- Save → the dock shows "Saving the recording…", the lecture appears in the list, and the toast "Saved “{title}”." [Open] appears.
- [Discard recording…] `[record-discard]` asks for confirmation ("Delete this recording? It hasn't been shared with anyone.").
- (v1.1) After the transcript exists, an AI title is suggested (when AI is on) as an info Notice on the lecture view: "Suggested title: “{title}”" [Use it] `[lecture-title-suggestion]` [Dismiss]. It costs 1 request and runs only if the user has AI and the cost is shown in its tooltip.

#### 3.6.5 Crash recovery `[record-recover]` (at start-up, for each journal still recording; `audio-pipeline §4.3`)
`Dialog size="sm"`, not dismissible:
- Title: "A recording was interrupted"
- Body: "A recording of {class} stopped unexpectedly at {time} ({date})."
- Buttons: [Keep what was recorded] `[record-recover-keep]` → the Save dialog; [Delete it] `[record-recover-delete]` (confirm).

#### 3.6.6 Add a recording (import) `[import-dialog]`
File picker filters: audio and video (`mp3, m4a, aac, wav, flac, ogg, oga, opus, webm, mp4, mov, mkv`) and subtitles (`vtt`).
```
Add a recording to ▌⚖ DC I
File          aula-zoom-14-out.m4a · 1 h 21 min
Title         [ Lecture 5 — Wed 14 Oct ]      Date [ 14/10/2026 ] [ 10:00 ]   (from the file's date)
Language      [ Português (Portugal) ▾ ]
[ ] Keep the video too (adds about {size} to the class)        ← video files only
[ ] This file already has subtitles: use “aula.vtt” as the transcript   ← when a .vtt was picked too
Permission    [ ] I'm allowed to share this recording with the class.  ← shared classes; required
Transcript    ◉ Transcribe on this computer ○ Let a classmate's computer do it ○ With OpenRouter ○ Not now
                                                                   [Cancel] [Add recording]
```
- The import transcodes to `audio.webm` in Rust, with progress in the dock: "Converting “{file}”… {percent} %".
- `SPEECH_UNSUPPORTED_AUDIO` shows "This file's audio format isn't supported. Convert it to MP3 or M4A (AAC-LC) and try again." (G23)

#### 3.6.7 Recording test ids (complete)
`record-class, record-pick-class, record-dialog, record-mode-room, record-mode-online, record-include-me, record-language, record-device,
record-device-meter, record-consent, record-share-both, record-share-transcript, record-share-none, record-consent-share, record-remember,
record-consent-change, record-why, record-presence-warning, record-presence-anyway, record-presence-cancel, record-start, record-dock,
record-mark (×5, data-mk), record-note-input, record-pause, record-resume, record-stop, record-check-mic, record-save, record-save-title,
record-transcribe-local, record-transcribe-classmate, record-transcribe-cloud, record-transcribe-none, record-save-share,
record-save-confirm, record-discard, record-recover, record-recover-keep, record-recover-delete, lecture-recording-row,
lecture-title-suggestion, import-dialog, import-title, import-date, import-time, import-language, import-keep-video, import-use-vtt,
import-permission, import-confirm`.
### 3.7 Documents

#### 3.7.1 Documents tab (`[class-documents]`, ready marker `[doc-list]`)

```
[＋ Add documents…] [New folder]       Documents › Legislação                [⌕ Filter documents] [Folders|Recent]
┌ Organise with folders? Slides · Readings · Legislation · Past exams · Other   [Create these] [No thanks] ┐  ← first add only
 Name                                              Pages   Added by   Date        Text for search & AI
 🗀 Legislação                                       —        —          —
 🗀 Slides                                           —        —          —
 🗎 Lei Fundamental de Exemplo (texto fictício).pdf   24      Ana        3 Oct       ✓ Searchable
 ▭ Aula 6 — Restrições (slides).pptx                 8 sl.   Bruno      20 Oct      ✓ Searchable
 🗎 Acórdão fictício n.º 12-2026.pdf                  2       Carla      22 Oct      ⚠ Scan — no text
 🗎 Resumo — DLG.docx                                —       Carla      25 Oct      ◐ Reading text… 40 %
 ⟳ Calendário de avaliações.pdf                      —       Carla      28 Oct      Arriving…
ONLY ON THIS COMPUTER
 🔒 Os meus esquemas.pdf                             3       you        29 Oct      ✓ Searchable
```
- A `Table` with a sticky header (sortable by Name, Date and Added by). Rows are `[doc-item]` with `data-doc-path`. Folders are `[doc-folder]`.
  The breadcrumb `[doc-breadcrumb]` reflects `route.folder`. Enter or double-click opens the item.
- "Added by" comes from Syncthing's `modifiedBy` → device → member (`—` if unknown); for private files it is "you". "Date" is the file's mtime.
- **Text state chip** `[doc-text-state]`. It follows the extraction cache (G9), which is per device:
  - "✓ Searchable" (`--success-text`);
  - "Reading text… {n} %" (ProgressBar xs);
  - "⚠ Scan — no text" (`--warning-text`; all pages are image pages);
  - "⚠ {n} pages without text" (some image pages);
  - "Can't read this file" (`--danger-text`, error code in the tooltip);
  - "—" for images and unsupported types.
- [Folders | Recent] is a segmented RadioGroup `[doc-view]`. Recent is a flat list of all files by date, newest first, without folders.
- **Adding** `[doc-add]`: the file picker accepts `pdf, docx, pptx, txt, md, png, jpg, jpeg, webp`; any other type is copied as-is and marked "—".
  - Files are copied into the current folder with sanitised names (G15).
  - Progress toast: "Adding {n} files… Reading text for search and AI ({i} of {n})"; when done, "Added {n} files to {class}." [Undo].
  - **Audio or video** picked here shows the dialog "“{file}” looks like a recording. Add it as a lecture?" [Add as a lecture] [Add as a document].
  - **Duplicates** (same SHA-256 already in the class): `[doc-duplicate]` "{name} already added “{file}” on {date}." [Open theirs] [Add anyway] [Skip].
- **Suggested folders card** `[doc-suggest-folders]`: shown after the first add in a class that has no folders. [Create these] creates
  the five folders, localised (§5 `documents.folders.*`); [No thanks] dismisses for good.
- **Row context menu** `[doc-menu]`:
  - Open
  - Open with the system app
  - Show in folder
  - Rename… (any member: ordinary files are multi-writer)
  - Move to ▸ (folders)
  - Keep private (only you)…
  - Read the text with AI… (scans of 20 pages or fewer, with AI on)
  - Remove from this computer only…
  - Delete for everyone…
- **Keep private**: confirm "Make “{file}” private?" with the body "It moves out of the class folder into Tramado's private storage on this computer, so it is removed for everyone else in {class}." [Make private].
- **Delete for everyone**: confirm "Delete “{file}” for everyone in {class}?" with the body "It's removed from every classmate's computer. You can restore it for 30 days from Recently deleted."
  The primary is [Delete for everyone] (danger); the secondary is [Remove from this computer only]. Afterwards a toast with [Undo], which restores through the versions API (G5).
- **States**:
  - Empty: an EmptyState with the grid backdrop, `[documents-empty]`, "Drop slides, readings and legislation here." with the body "PDF, Word, PowerPoint, text and images. Tramado reads them so you can search and ask about them." and [Add documents].
  - Empty folder: "This folder is empty."
  - Loading: skeleton rows.
- Keys: ↑/↓, Enter, Backspace (parent folder), Delete, F2 (rename), Ctrl/⌘+F (filter).

#### 3.7.2 Document view (`route document`; `features/document/`; `[screen-document]`)

```
[←] DC I › Documents › Legislação  Lei Fundamental de Exemplo (texto fictício).pdf     [✦ Ask about this document] [Open with…] [⋯]
                                   PDF · 24 pages · added by Ana · 3 Oct
┌ ARTICLES ──────┐┌ toolbar: [‹] 9 / 24 [›]   [−] 110 % [+] [Fit width]   [⌕ Find]   [▤ Side panel] ┐┌ [Highlights|Ask|Info] ┐
│ Artigo 13.º  p.5││                                                                              ││ MY HIGHLIGHTS         │
│ Artigo 18.º  p.9││   ┌──────────────────────────── page 9 ─────────────────────────────┐       ││ ★ p. 9 “…só pode      │
│ Artigo 19.º p.10││   │ Lei Fundamental de Exemplo — texto fictício      (running header)│       ││    restringir…”       │
│ Artigo 24.º p.12││   │ Artigo 18.º (Força jurídica dos direitos)                        │       ││                       │
│ Artigo 30.º p.15││   │ 1. …                                                             │       ││                       │
│ …              ││   │ ▌ 3. As leis restritivas devem ser gerais e abstratas, não podem  │       ││                       │
│                ││   │ ▌ ter efeito retroativo e nunca podem atingir o conteúdo          │       ││                       │
│                ││   │ ▌ essencial do direito restringido.                               │       ││                       │
└────────────────┘└──────────────────────────────────────────────────────────────────────────────┘└───────────────────────┘
```
- **PDF**: pdfjs-dist **6.3.289** (the version Trama uses; D59 permits it), with `web/pdf_viewer.mjs` `PDFViewer`, `EventBus`, `PDFLinkService` and `PDFFindController`, plus
  `pdfjs-dist/web/pdf_viewer.css`, a text layer for selection, and a bundled `cMapUrl` and `standardFontDataUrl`.
  - The bytes are loaded through `tramado-media` with Range requests (C10).
  - The page is `pdfViewer.currentPageNumber = route.page`.
  - **Cited quote**: `eventBus.dispatch('find', {type:'', query: firstWords(quote.exact, 8), phraseSearch:true, highlightAll:false, findPrevious:false})`,
    with the find-highlight CSS overridden to `--mark` + `--mark-strong`, plus a 4 px `--mark-edge` bar in the page margin aligned with the hit's top.
  - If the quote is not found on that page, try ±1 page, then the whole document. Otherwise show a Notice `[doc-quote-missing]` "The exact passage wasn't found on this page."
- **Article index** `[doc-articles]` (left, 200 px, collapsible): shown when the extractor found at least 2 article headings (`^(Artigo|Art\.|Artículo|Article) N`). Each item reads
  "Artigo 18.º · p. 9" and jumps there. Otherwise the PDF outline (`getOutline()`) is shown, if any; otherwise the panel is hidden.
- **Toolbar** `[doc-toolbar]`:
  - page field `[doc-page]` (Ctrl/⌘+G focuses it);
  - prev/next (PageUp/PageDown also work);
  - zoom out/in `[doc-zoom-out]`/`[doc-zoom-in]` (Ctrl/⌘+− / Ctrl/⌘+=) and Fit width `[doc-fit]` (Ctrl/⌘+0);
  - Find `[doc-find]` (Ctrl/⌘+F; the PDFFindController bar with count and ↑/↓);
  - side panel toggle `[doc-side-toggle]`.
- **Selection toolbar**: the same as the transcript's (Highlight, Comment, Explain, Ask, Copy with source). Copy with source gives
  `“{text}” — {file name}, p. {label}` (art. N.º added when inside an article unit). Highlights are private and anchored by
  `{docSha256, page, quote}`.
- **Side panel** `[doc-side]` with the tabs Highlights `[doc-side-highlights]`, Ask `[doc-side-ask]` and Info `[doc-side-info]`:
  - **Highlights** lists my highlights and comments for this file; clicking one jumps to it.
  - **Ask** is an Ask thread with the scope "This document" (the same component as §3.11).
  - **Info** shows type, pages/slides, size, location (relative path), SHA-256 (first 12 characters), "Text for search: {state}", "Added by" and
    [Show in folder]. With a scan: [Read the text with AI…].
- **Other formats** (`.reading` article, max 70ch, centred):
  - **DOCX**: mammoth 1.13.0 → HTML → sanitised (an allow-list of p, h1–h6, ul, ol, li, strong, em, table, tr, td, th, blockquote; no attributes except `colspan`/`rowspan`).
  - **PPTX**: one section per slide, `<h2>Slide {n}</h2>` + text; `route.slide` scrolls to it.
  - **MD**: `MarkdownView` (no raw HTML).
  - **TXT**: `white-space: pre-wrap`.
  - **Images**: centred `<img>` with zoom (fit / 100 %) and a "Describe with AI" button (1 request, vision model; result in an AiCard below).
  - **Unsupported**: a file card "Tramado can't show this file." [Open with the system app].
- **Scanned PDF** banner `[doc-scan-banner]` (warning Notice): "This PDF is a scanned image, so search and AI can't read it yet."
  - With 20 pages or fewer and AI on: [Read the text with AI ({n} requests)] `[doc-ocr]`. A cost confirm follows (CostLine), then per-page progress in the dock.
    The text goes to the extraction cache, never into the class folder.
  - More than 20 pages: "It's too long to read with AI (more than 20 pages). Reading scans on this computer is coming in a later version."
  - AI off: [Set up AI].
- **States**:
  - loading: a skeleton page;
  - still arriving: "This file is still arriving from {name}… {percent} %" `[doc-arriving]`;
  - error: "This PDF couldn't be opened: {reason}." [Open with the system app] `[doc-error]`;
  - moved: when opened by SHA-256 at another path, the Notice "This file was moved to {path}." is shown;
  - changed since cited: "This file changed after the answer that cites it was written. The passage was found again by its text." (or "…couldn't be found.").
- Test ids (complete):
  `screen-document, doc-articles, doc-article, doc-toolbar, doc-page, doc-prev, doc-next, doc-zoom-out, doc-zoom-in, doc-fit, doc-find,
  doc-find-input, doc-side-toggle, doc-side, doc-side-highlights, doc-side-ask, doc-side-info, doc-pdf-page (each page container, data-index),
  doc-quote-missing, doc-scan-banner, doc-ocr, doc-arriving, doc-error, doc-open-external, doc-ask, doc-more, doc-image-describe`.

### 3.8 Notes (`[class-notes]`, ready marker `[note-list]`; editor route `note`, `[screen-note]`)

```
[＋ New note] [＋ New class note]                                                      [⌕ Filter notes]
MY NOTES · 🔒 Only you
 ✎ Aula 6 — apontamentos                           edited today 11:02
 ✎ Esquema: restrições                             edited 28 Oct
CLASS NOTES · 👥 Shared with the class
 ✎ Resumo partilhado — Semana 8                    edited yesterday · Bruno is editing
```
- Two `Section`s. Rows are `[note-item]` with `data-doc-path` and `data-private="true|false"`.
  - My notes are `.md` files in `app_local_data/private/<classId>/notes/`.
  - Class notes are `.md` files in the class `<Notes dir>/`.
  - The title is the first `# ` heading, else the file name.
- **Editor** (`route note`):
  - top bar: h1 = title; the subtitle is "Only you" or "Shared with the class · {n} members", plus the save status ("Saving…" / "Saved" / "Couldn't save: {reason}") `[note-status]`;
  - a `Toolbar` `[note-toolbar]` (roving): Bold, Italic, Heading, Bulleted list, Checklist, Link, **Insert timestamp link** `[note-insert-time]`
    (a popover lists this class's lectures; it inserts `[41:12](tramado:lecture/<lectureId>?t=2472000)`, at the current playback time when a lecture of the class
    is playing, else 00:00), **Insert document link** `[note-insert-doc]` (`[Lei Fundamental, p. 9](tramado:doc/<urlencoded relPath>?page=9)`),
    and Preview `[note-preview]` (Ctrl/⌘+Shift+P);
  - the editing area is `TextArea` (`reading`, autoGrow off, fills the height) `[note-editor]`, autosaving with a 2 s debounce (`write_atomic`, then a scan; G25).
    The preview is `MarkdownView`, where `tramado:` links become buttons that navigate.
- **Moving** between sections (the ⋯ menu `[note-more]`):
  - "Move to class notes…" asks "Share this note with everyone in {class}? Classmates can read and edit it." [Share it].
  - "Make private…" asks "Move this note out of the class? It's removed for everyone else." [Make private].
  - Both are never silent.
- **Presence**: an info Notice `[note-presence]` "Bruno is editing this note. Changes you both make at the same time may conflict."
- **Conflict** (a `*.sync-conflict-*` sibling): a warning Notice `[note-conflict]` "Two versions of “{title}” were edited at the same time. Both are kept." [Compare] →
  `ConflictDialog` `[conflict-dialog]` (`size="xl"`): a side-by-side line diff (theirs / mine) with
  [Keep this one] `[conflict-keep-mine]`, [Keep the other] `[conflict-keep-theirs]` and [Keep both] `[conflict-keep-both]` (renames theirs to "{title} (Bruno's copy).md").
- **Empty**: EmptyState `[notes-empty]` "Your notes for {class}." with the body "My notes are only on this computer. Class notes are shared with everyone in the class." and [New note] [New class note] (the latter only in shared classes).
- Keys: Ctrl/⌘+B / I (bold / italic), Ctrl/⌘+K inside the editor = Link (overrides the palette while the editor has focus; the palette stays available from the rail button), Ctrl/⌘+Shift+P preview, Ctrl/⌘+S saves now.
- Test ids: `class-notes, note-list, note-item, note-new, note-new-class, screen-note, note-editor, note-toolbar, note-bold, note-italic,
  note-heading, note-list-bullets, note-checklist, note-link, note-insert-time, note-insert-doc, note-preview, note-status, note-more,
  note-presence, note-conflict, conflict-dialog, conflict-keep-mine, conflict-keep-theirs, conflict-keep-both`.

### 3.9 Exams

#### 3.9.1 View models

```ts
export type QuestionKind = 'case' | 'essay' | 'short' | 'multiple_choice' | 'true_false' | 'comment' | 'calculation' | 'other';
export type Mark = 'right' | 'partly' | 'wrong' | 'unsure';
export interface ExamPaperView {
  examId: string; classId: string; title: string; kind: ExamKind; year: number | null; date: string | null;
  sourceRelPath: string | null;                        // original file in <Exams dir>/<title>/
  state: 'extracting' | 'review' | 'ready';            // 'review' until the Review screen was confirmed once
  rules: string[]; durationMin: number | null; scale: 'pt20' | 'es10' | 'points'; extraPoints: { label: string; points: number }[];
  questions: QuestionView[]; importedBy: DeviceRef; newerFormat: boolean;
  answers: { by: DeviceRef; model: ModelLabel; at: string; count: number }[];   // shared answer sets that exist (G11)
}
// Mapping from exam.json (folder spec §8.12): kind = type ('assignment'/'other' show as 'practice'); year = the first year of
// academicYear ("2024/25" → 2024), else the year of date, else null; scale = 'pt20' when {max:20, unit:'valores'},
// 'es10' when {max:10, unit:'puntos'}, else 'points'; extraPoints = extraPoints ?? []. mine.* comes from the private
// exams/<examId>.json (architecture §13.2): draft = myAnswers, correct, mark = marks (incl. 'unsure'), revealed,
// inPractice, practice = {result, last, count}; hint = the private hint (never shared).
export interface QuestionView {
  id: string; number: string /* 'I', 'II.a' */; text: string; points: number | null; kind: QuestionKind;
  group: { id: string; choose: number; label: string /* 'II' */ } | null;      // "answer 2 of a, b, c"
  ai: AiAnswerView | null; hint: AiAnswerView | null;
  mine: { draft: string; correct: string; mark: Mark | null; inPractice: boolean; revealed: boolean;
          practice: { lastResult: 'again' | 'gotIt' | null; lastAt: string | null; count: number } };   // private (D44)
}
export interface AiAnswerView {
  text: string;                       // Markdown with [S#] refs, as the model wrote it (trimmed)
  citations: Citation[];              // §4.1, in order of first appearance
  unverified: string[];               // sentences with no valid citation, when "general knowledge" was allowed
  model: ModelLabel; requested: ModelLabel; fallback: boolean;              // fallback = model ≠ first of chain
  askedBy: DeviceRef; at: string; mode: 'quick' | 'deep' | 'hint';
  grounded: number;                   // 0..1, sentences with ≥ 1 valid citation / all sentences
  insufficient: boolean;              // the model said the sources don't contain the answer
  sent: { passages: number; chars: number };
}
```

#### 3.9.2 Exams tab (`[class-exams]`, ready marker `[exam-list]`)

```
[＋ Add ▾: An upcoming test or exam · An exam paper or practice questions]                    [Practise DC I (5)]
COMING UP
 📅 Frequência (midterm)          Thu 12 Nov, 10:00 · in 9 days · Anfiteatro 1.02                    [⋯]
    Covers: Aulas 1–8; Lei Fundamental arts. 1.º–24.º
EXAM PAPERS
 📋 Frequência 2025/26 (simulada)   Midterm · 2026 · 5 questions · AI answers 4/5 · Practised 3 · ✓1 ~1   [Practise ▸]
 📋 Exame época normal 2024/25       Final · 2025 · finding questions…                                    ◐
PAST DATES (collapsed)
```
- Coming-up rows `[exam-date-item]` with `data-exam-id`. The ⋯ menu has Edit…, Add the paper for this exam…, and Delete for everyone…. Past dates move to the collapsed "Past dates".
- Paper rows `[exam-paper-item]` open the exam route. Their meta line shows kind · year · question count · "AI answers {a}/{n}" · "Practised {p}" · mark counts.
- [Practise {class} ({n})] `[exam-practise-class]`: the route `practice` with every in-practice question of the class. Hidden when n = 0.
- The **integrity note** (an info Notice, dismissible per paper, `[exam-integrity]`): "For practice and past papers. Using AI during an actual test or exam is usually against the rules."
- **Empty**: EmptyState `[exams-empty]` "No exams yet." with the body "Add the date of your next test to get a countdown, or add a past exam and practise it, with AI answers that point to your lectures." and [Add an exam date] [Add an exam paper].

#### 3.9.3 Add an exam date `[exam-date-dialog]` (`Dialog size="sm"`)
The fields are:
- Kind `[exam-date-kind]` (a Select of the localised kinds, §5 `exams.kinds.*`) → `exam.json` `type`;
- Date `[exam-date-date]` and Time (optional) `[exam-date-time]` → `date` (local midnight and `allDay: true` when there is no time);
- Room `[exam-date-room]` → `room`;
- What it covers `[exam-date-covers]` (TextArea, ≤ 500 characters) → `coversText`;
- Weight `[exam-date-weight]` (free text ≤ 20 characters, for example "40 %") → `weightText` (and `weight` when it parses as a plain percentage).

The title is auto: the kind label, unless edited `[exam-date-title]`. The note reads "Tramado counts down on Today and in the class header."
In a shared class, the footer reads "Everyone in {class} sees this date." In 0.1 only the member who added it can edit it (others see Edit… disabled with the
tooltip "Only {name}'s computer can change this date"); v1.1 lets others append `set_exam` lines (folder spec §8.13, §8 OQ6). Everyone gets the
notification "Exam date changed: {title} is now {date}" (`notify.examChanged`).

#### 3.9.4 Add an exam paper `[exam-paper-dialog]` (`Dialog size="lg"`)
```
Add an exam paper or practice questions
┌──────────────────── drop zone (grid backdrop) ────────────────────┐
│  Drop a PDF, Word file or photo here — or [Choose a file…]        │   [exam-paper-file]
│                                    or  [Type or paste the questions] │   [exam-paper-type]
└───────────────────────────────────────────────────────────────────┘
Name   [ DC I — Frequência — 2025/26 (simulada) ]  Kind [ Midterm ▾ ]  Year [ 2026 ]
✦ Reading this uses about 3 AI requests (2 pages to read + 1 to find the questions). You have 38 free requests left today.
                                                                  [Cancel] [Find the questions]
```
- Accepted files are `pdf, docx, txt, md, jpg, jpeg, png, webp`. Several images are taken as pages, in the chosen order.
  The file is copied to `<Exams dir>/<name>/` (sanitised).
- The name is pre-filled from the file name or a detected header line.
- The CostLine:
  - a text PDF or DOCX is 1 request;
  - photos and scanned PDFs are pages + 1;
  - with AI off, the line reads "Finding the questions needs AI. You can type them in yourself instead." and the button becomes [Type the questions].
- [Type or paste the questions] goes straight to the Review screen with a single question holding the pasted text and the deterministic pre-split applied (G10).
- Images are prepared in the webview before sending: EXIF rotation, scaled to 1,400 px on the long side, JPEG quality 0.7 (G10).

#### 3.9.5 Extracting (`mode extracting`, `[exam-extracting]`)
```
Finding the questions in “Frequência 2025/26 (simulada)”
 ✓ Reading page 1 of 2 (with Dots 3 Note Preview)
 ◐ Reading page 2 of 2
 ○ Finding the questions
 ○ Ready to check
[Cancel]
```
- `ProgressSteps`. The model shown is the one that actually answered.
- Errors stop at the failing step with an inline Notice. It uses the AI error copy (§5 `ai.errors.*`) and [Try again] / [Type the questions instead].
- Leaving the screen does not cancel; the dock shows the job.

#### 3.9.6 Review screen (`mode review`, `[exam-review]`), mandatory before any answer
```
We found 6 questions. Check them before the AI answers. Fix any that were split or merged.
Rules found: [Permitted: unannotated legislation ✕] [Duration: 2 h ✕] [+2 points for writing ✕] [＋ Add]
┌ original (PDF/image preview) ───────────┐┌ QUESTIONS ─────────────────────────────────────────────────────┐
│                                         ││ [ I  ] [ 6 ] valores  [Case ▾]                    [↑][↓][⋯]   │
│   (page images, scroll-synced to the    ││ ┌───────────────────────────────────────────────────────────┐ │
│    selected question when possible)     ││ │ A Assembleia da República de Exemplo aprovou uma lei …    │ │
│                                         ││ └───────────────────────────────────────────────────────────┘ │
│                                         ││     [Split at cursor] [Merge with next] [Delete]               │
│                                         ││ ┌ Answer 2 of: II.a, II.b, II.c ─────────────── [Edit group] ┐ │
│                                         ││ │ [ II.a ] [ 3 ] [Short answer ▾] …                          │ │
│                                         ││ └────────────────────────────────────────────────────────────┘ │
│                                         ││ [＋ Add a question]                                            │
└─────────────────────────────────────────┘└────────────────────────────────────────────────────────────────┘
                                          [Save without answers]   [Looks right — answer them]
```
- A `SplitPane` (original | questions). The original is the PDF (pdf.js) or the image(s); it is hidden for typed questions.
- Each **question card** `[review-question]` (`data-question-id`) has:
  - a number field `[review-number]`;
  - a points field `[review-points]` with its unit (valores / puntos / points, from the class language's scale);
  - a kind Select `[review-kind]` (Case · Essay · Short answer · Multiple choice · Comment · Calculation · Other);
  - the text `[review-text]` (TextArea, reading font, autoGrow);
  - [Split at cursor] `[review-split]`: splits at the caret, keeps the number on the first part and suggests the next number (II.a → II.b; 3 → 4);
  - [Merge with next] `[review-merge]`;
  - [Delete] `[review-delete]`;
  - move ↑/↓.

  A kind the model was unsure of is pre-set to "Other" with the hint "Check the type".
- **Groups**: a bracketed container `[review-group]` "Answer {n} of: {numbers}" with [Edit group] (choose n, member questions) and [Ungroup].
- **Rules** chips `[review-rule]` are editable and removable; [＋ Add] `[review-rule-add]`. They are sent to the AI as context.
- Validation: numbers must be unique and texts not empty. The errors show inline and the primary button is disabled.
- Undo/Redo is in the top bar (Ctrl/⌘+Z).
- [Looks right — answer them] `[review-confirm]` saves `exam.json` (state `ready`) and opens **Answer settings**. [Save without answers] `[review-save]` saves only.
- An importer-only note for non-importers: "Your corrections are shared with the class." (via exam-edits).

#### 3.9.7 Answer settings `[answer-settings]` (`Dialog size="md"`)
```
Answer 6 questions with AI
Answer from   ◉ Your class materials only                                         [answer-from-materials]
              ○ Your materials, plus general knowledge (marked as unverified)     [answer-from-general]
[✓] Try each question yourself first (recommended)                               [answer-try-first]
    Answering before you look is what makes it stick.
Answers already exist: by Ana, Gemma 4 31B (free), 12 Oct.  [Use those]           [answer-use-existing]
✦ About 7 requests (1 to find search words + 6 answers) · 38 free left today · Gemma 4 31B (free)
                                                              [Cancel] [Answer 6 questions]   [answer-start]
```
- "Try first" is remembered per device (prefs `exam.tryFirst`, default **on**, D53).
- When requests > remaining, a warning reads "That's more than you have left today. Tramado will answer {left} now and the rest after {time}." and the buttons are [Answer {left} now] [Cancel].
- With existing shared answers, [Use those] closes the dialog and the primary becomes [Answer again].

#### 3.9.8 Answers view (`mode answers`, `[exam-answers]`, ready marker `[question-list]`)
```
┌ QUESTIONS ─────────────────┐┌──────────────────────────────────────────────────────────────────────────┐
│ ① I    A Assembleia…   ✓   ││ QUESTION II.b · 3 VALORES · SHORT ANSWER                         [Practise this paper] │
│ ② II.a Distinga…       ○   ││ Em que condições pode a lei restringir direitos, liberdades e garantias?   │
│ ③ II.b Em que cond…    ~   ││ ┌ Your answer · only you ──────────────────────────────────────────────┐   │
│ ④ II.c O que é o …     ✦⚠  ││ │ (write or think, then reveal)                                         │   │
│ ⑤ III  Comente: …      ✦   ││ └────────────────────────────────────────────────────────────────────────┘   │
│                            ││ [ Show the AI's answer ]  [ 💡 Give me a hint ]   ← before revealing           │
│ Answering… 4 of 5  [Cancel]││ ── after revealing (or with “try first” off): ──                             │
│                            ││ ▌ ✦ AI · Dots 3 Note Preview (free) — answered because Gemma 4 31B was busy │
└────────────────────────────┘│ ▌ from 2 of your sources · asked by Ana · 30 Oct                            │
                              │ ▌ Só nos casos expressamente previstos na Lei Fundamental [1], devendo as   │
                              │ ▌ restrições limitar-se ao necessário e revestir caráter geral e abstrato,   │
                              │ ▌ sem nunca atingir o conteúdo essencial [1 · n.º 3] [2].                    │
                              │ ▌ Grounded ▰▰▰▰▱ 80 %          [Deep answer] [Try again] [Copy to my answer]  │
                              │ SOURCES                                                                     │
                              │ [1] 🗎 Lei Fundamental de Exemplo · art. 18.º · p. 9                     ›   │
                              │ [2] 🎙 Aula 6 — Restrições… · ▶ 41:12                                    ›   │
                              │ Is this right?  [✓ Right] [~ Partly] [✗ Wrong] [? Not sure]  [Add the correct answer…] │
                              │ [✓] Add to practice                                                          │
                              └──────────────────────────────────────────────────────────────────────────────┘
```
- **Question list** `[question-list]`: rows `[question-item]` (`data-question-id`) with the number in a circle (`--c-soft`; filled `--c` when selected), a text excerpt,
  and a status icon: ○ unanswered · ✦ AI answered (`--ai`) · ⚠ has hallucinated or unverified parts · ✓ right · ~ partly · ✗ wrong · ? not sure.
  Groups show their label ("Answer 2 of 3").
  - The batch status is at the bottom `[answer-progress]`: "Answering… {i} of {n}" and [Cancel]. On a per-minute limit it reads "Too many requests in a minute. Continuing in {s} s…".
  - Keys: ↑/↓ change question when the list has focus; Alt+↑/↓ from anywhere on the screen.
- **Detail**:
  - the eyebrow (number · points · kind) and the question (`--fs-xl`, serif);
  - **Your answer** `[my-answer]`: TextArea, reading font, private, autosaved. The label says "only you";
  - with **try first** and not revealed: [Show the AI's answer] `[reveal-answer]` (Ctrl/⌘+Enter from the answer field) and [Give me a hint] `[hint]`. The AI card is not rendered (not merely hidden) until revealed;
  - **Hint**: an AiCard titled "Hint" (`mode hint`, 1 request) with a guiding question and source chips, never the answer. Its footer reads "Still stuck? [Show the AI's answer]";
  - **AI answer** `[ai-answer]`: an AiCard (§2.11) whose header says:
    - "AI · {model label}";
    - " — answered because {requested} was busy" when it is a fallback;
    - "from {k} of your sources · asked by {name} · {date}".

    The body is `MarkdownView` with `[S#]` replaced by CitationChips (§4).
    - **Unverified sentences** (general knowledge allowed) are wrapped in a `span.unverified`, with a dashed `--warning-text` underline and a trailing Badge "Not in your materials".
      They are also repeated in a warning Notice under the card: "{n} sentences aren't in your materials (general knowledge — check them)." `[ai-unverified]`.
    - **Insufficient**: an info Notice "Your materials don't seem to cover this." [Deep answer (4–8 requests)] `[ai-deep]`.
    - Footer:
      - the Grounded meter `[ai-grounded]` (a 5-segment meter, `role="meter"`, label "Grounded in your sources: {p} %");
      - [Deep answer] (shown when insufficient or grounded < 0.5, or when the key has a limit of at least 1000);
      - [Try again] `[ai-retry]`;
      - [Copy to my answer] `[ai-copy]`, which appends the text with the citations as "[1]" plus a source list, marked "(from AI)" at the top. Toast "Copied to your answer." [Undo].
    - Streaming state: the text appears as it streams, chips render when their `]` arrives, and the footer is hidden.
    - Cut state: the partial text is greyed with "The answer was cut off." [Continue] [Try again].
  - **Sources** `[ai-sources]`: SourceRows (§4.4), in chip order.
  - **Is this right?** `[mark]` (a RadioGroup with Right, Partly, Wrong and Not sure as `[mark-right]`, `[mark-partly]`, `[mark-wrong]`, `[mark-unsure]`), private. Plus:
    - [Add the correct answer…] `[mark-correct]`, which expands a TextArea "Correct answer (only you)";
    - [✓] Add to practice `[mark-practice]`, default on once marked.
  - **Case questions** (`kind case`): the prompt asks for the template "Problem → Applicable rules → Application to the facts → Conclusion" in the class language (PT: "Questão → Normas aplicáveis → Aplicação → Conclusão"; ES: "Cuestión → Normas aplicables → Aplicación → Conclusión"). The card renders these as h4 headings.
- Header action: [Practise this paper] `[exam-practise]`. The ⋯ menu `[exam-more]` has:
  - Edit questions… (back to Review)
  - Answer all again…
  - Open the original file
  - Copy all answers as Markdown
  - Keep private (only you)…
  - Delete for everyone…
- AI off: the AI buttons are replaced by "AI isn't set up. You can still write your answers and practise." [Set up AI].

#### 3.9.9 Practice (`mode practice`, or `route practice`, `[exam-practice]`)
```
Practising Frequência 2025/26 (simulada) · 3 of 5                                               [✕ End]
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ II.b · 3 valores                                                                                 │
│ Em que condições pode a lei restringir direitos, liberdades e garantias?                         │
│                                                                                                  │
│                              [ Show answer  (Space) ]                                            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
   after reveal:  Your answer (or your corrected answer, or the AI answer with its sources)
                  How did it go?   [ Again  1 ]   [ Got it  2 ]
```
- **Queue** (MVP; FSRS is v1.1): the in-practice questions of the paper (or of the class for `route practice`), ordered as:
  1. never practised;
  2. last result `again`;
  3. oldest `lastAt`.

  Questions marked `gotIt` within the last 20 hours are excluded. "Again" re-inserts the question 3 positions later in this session.
- The revealed answer is the first that exists of: my correct answer, my draft, the AI answer (an AiCard with sources).
- Keys: Space shows the answer; 1 = Again `[practice-again]`; 2 = Got it `[practice-got-it]`; ← previous; Esc ends.
- The end screen `[practice-done]` reads "Done for now. {n} to practise tomorrow." plus "{exam} in {days}" when a matching exam date exists. Buttons [Practise again] [Back to the exam].
- Empty queue: "Nothing to practise right now." with the body "Next: {n} questions tomorrow. You can still practise any paper." and [Practise all questions].
- Test ids: `exam-practice, practice-progress, practice-question, practice-reveal, practice-answer, practice-again, practice-got-it,
  practice-prev, practice-end, practice-done, practice-again-all`.

### 3.10 Chat (`[class-chat]`, ready marker `[chat-list]`)

#### 3.10.1 View model
```ts
export interface ChatMessageView {
  id: string; author: DeviceRef; at: string; text: string;               // Markdown-lite source
  kind: 'message' | 'ai' | 'thanks' | 'system';
  replyTo: { id: string; author: string; excerpt: string } | null;
  attachments: { relPath: string; name: string; size: number; arrived: boolean }[];
  mentions: { memberId: string | 'ai' | 'everyone'; name: string }[];
  ai?: AiAnswerView;                                                     // kind 'ai': answer, asker = author
  edited: boolean; deleted: boolean; hiddenBy: string | null; pinned: boolean;   // hiddenBy null and pinned false in 0.1 (v1.1)
  delivery: 'local' | 'sent';                                            // local = no other member device has it yet
  examDate?: { kind: ExamKind; at: string } | null;                      // detected "Add to Exams?" chip (v1.1; null in 0.1)
  unverified: boolean;                                                   // the line's memberId is not the writer's person (folder spec §6.2 rule 6)
}
// id = `${deviceId}:${lineId}`; author is always the person bound to the file's device, or "Unverified ({deviceName})".
// 0.1 has no reactions, pins or hides (v1.1): their menu items and the pins strip are not shown.
```

#### 3.10.2 Layout
```
📌 Frequência mudou para 12 nov., anfiteatro 1.02 — Bruno                                      [All pins ▾]
──────────────────────────────── Monday 2 November ────────────────────────────────
Ⓑ Bruno Costa  10:02
  Alguém tem os slides da aula 6?
Ⓒ Carla Mendes  10:05
  ┃ ↪ Bruno: Alguém tem os slides da aula 6?
  Estão nos documentos 👍
  ┌ 🗎 Calendário de avaliações.pdf · 84 KB · in Documents › From chat ┐
Ⓑ Bruno Costa  10:09
  @IA o que disse a professora sobre o conteúdo essencial?
  ▌✦ Tramado AI · asked by Bruno · Gemma 4 31B (free)
  ▌ A professora explicou que a lei restritiva nunca pode atingir o conteúdo essencial [1], o que
  ▌ corresponde ao art. 18.º, n.º 3 da Lei Fundamental [2].
  ▌ [1] Aula 6 · ▶ 41:12   [2] Lei Fundamental · art. 18.º · p. 9
       — Bruno thanked Ana for transcribing Aula 7. —
Ⓐ You  11:30  🕓 Saved — will send when a classmate is online
  Obrigada, Bruno!
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ↪ Replying to Bruno: “Alguém tem os slides…”                                     [✕] │
│ Message DC I…                                                       [📎] [➤ Send]    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
- **Message list** `[chat-list]` (`role="log"`, `aria-live="polite"` only for new messages from others, announcing "{author}: {text}").
  - Messages are grouped by author within 5 min, with day separators (`i18n.date(...,'weekday')`).
  - It is virtualised with a window of the last 200, loading older months lazily on scroll-up ("Loading earlier messages…").
  - Rows are `[chat-message]` with `data-message-id`.
- **Message**: Avatar 28, the author name in `--c-text` of their member colour (`cls-scope` per author), the time (tabular, `--ink-3`), the text (`MarkdownView` with bold, italic, code, lists and https links only), and then:
  - a reply quote `[chat-reply-quote]` (click → scroll to the original and flash it);
  - attachment cards `[chat-attachment]` (click → document route; "Arriving…" while the file is incomplete);
  - mentions as `--accent-soft` pills; mentions of me in `--accent` with `--accent-ink`, and the whole message gets a 3 px `--accent` left bar;
  - "(edited)" in `--ink-3`;
  - deleted: "Message deleted" in italic `--ink-3`;
  - hidden by an organiser: "Hidden by an organiser", plus [Show] for organisers;
  - the delivery state for my last messages: 🕓 "Saved — will send when a classmate is online" or ✓ "Sent" (tooltip "At least one classmate's computer has it").
- **AI message** (`kind ai`): an AiCard inline (max 640 px). Its header is "✦ Tramado AI · asked by {name} · {model label}", with CitationChips and a compact source list.
  The chips work for everyone, because they cite shared class files. A chip citing something missing on this device shows the `missing` state.
- **Thanks / system lines**: centred, `--ink-3`, 13 px. They come from `chat.system.*`: thanks, joined, left, pinned, exam date added.
- **Hover/focus actions** `[chat-actions]` (a Toolbar that appears on hover or focus of a message, and also through the context menu):
  - Reply `[chat-reply]`
  - Pin for the class / Unpin `[chat-pin]`
  - Copy text `[chat-copy]`
  - Edit `[chat-edit]` (own messages)
  - Delete `[chat-delete]` (own; confirm "Delete this message for everyone?")
  - Hide for everyone `[chat-hide]` (organisers)
- **Exam-date chip** `[chat-exam-chip]`: under a message whose text has a date and an exam keyword.
  - Detected locally with `/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b|\b(\d{1,2})\s+(?:de\s+)?(jan|fev|feb|ene|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec|dic)\w*\.?/iu`
    together with a keyword `/\b(frequ[eê]ncia|teste|exame|test|exam|quiz|midterm|final|examen|parcial|prueba)\b/iu`.
  - The chip reads "Add to Exams: {kind} on {date}?". Clicking opens the exam-date dialog pre-filled. It is dismissible per device.
- **Composer** `[chat-composer]`: `Composer` with the placeholder "Message {short}…" (autoGrow 1–8 lines).
  - Enter sends `[chat-send]`; Shift+Enter adds a newline; ↑ in an empty composer edits my last message.
  - **@** opens the mention popover `[chat-mention-popover]`. It lists the members (Avatar + name), **AI** ("Ask Tramado AI with your key") and **everyone** (organisers only).
    `@ai`, `@ia`, `@AI` and `@IA` are all accepted.
  - 📎 `[chat-attach]` opens the picker. Files are copied to `<Documents dir>/<From chat folder>/` and the message carries the attachment. The first time, an info Notice says
    "Files you send in chat are also kept in Documents, so they don't get lost." `[chat-attach-notice]`.
  - The reply bar `[chat-reply-bar]` has [✕].
- **@AI flow**:
  - On send, the message posts at once. The asker's device then shows a local placeholder AiCard "✦ Looking through {l} lectures and {d} documents…".
  - It runs Ask (1–2 requests) over **shared class materials only**: never private notes or chat. It then posts a `kind:'ai'` line to the asker's own chat log.
  - Errors stay local to the asker, as an inline Notice under their message: "The free model is busy right now." [Try again] [Use {fallback}].
  - Without AI set up, an inline local Notice reads "To ask @AI, set up AI in Settings. Classmates' keys are never shared." [Set up AI]. The message is still posted.
  - With AI off on this device, @AI does not autocomplete, and typing it shows the hint "AI is off on this computer."
- **Pins**: the strip at the top `[chat-pins]` mirrors the header strip. [All pins ▾] opens a popover list `[chat-pins-list]`.
- **States**:
  - shared but alone: EmptyState `[chat-empty]` "Just you so far." with the body "Invite classmates to chat, share documents and split the transcription work." and [Invite classmates];
  - no messages, but members exist: "No messages yet. Say hello to the class.";
  - loading: skeletons;
  - offline: the composer still works, and messages show 🕓.
- Keys: Ctrl/⌘+F opens a find bar over the loaded messages; Esc closes the reply bar; PageUp loads earlier messages.

### 3.11 Ask (`[class-ask]`, ready marker `[ask-thread]`; all classes: `route ask`, `[screen-ask]`)

```
┌ CONVERSATIONS ─────┐┌──────────────────────────────────────────────────────────────────────────────┐
│ [＋ New]           ││ Ask anything about Direito Constitucional I.                                 │
│ ● O que diz o art.…││ ┌ You ────────────────────────────────────────────────────────────────────┐  │
│   Resumo aula 6    ││ │ O que diz o art. 18.º sobre as leis restritivas?                         │  │
│                    ││ └──────────────────────────────────────────────────────────────────────────┘  │
│                    ││ ▌✦ AI · Gemma 4 31B (free) · from 3 of your sources                          │
│                    ││ ▌ …[1] …[2]                                                                   │
│                    ││ ▌ Sent: your question and 9 passages. [See what was sent]                     │
│                    ││ ▌ [Post to class chat] [Copy with sources] [Save as note] [Try again]         │
│                    ││                                                                              │
│                    ││ Sources: [All] [Lectures] [Documents] [Exams] [🔒 My notes]   ☐ Allow general knowledge │
│                    ││ ┌──────────────────────────────────────────────────────────────────────────┐ │
│                    ││ │ Ask about DC I…                                                    [➤]   │ │
│                    ││ └──────────────────────────────────────────────────────────────────────────┘ │
│                    ││ ✦ 1–2 requests · 37 free left today · Gemma 4 31B (free) ▾                   │
└────────────────────┘└──────────────────────────────────────────────────────────────────────────────┘
```
- **Threads** `[ask-threads]` are private (app data `private/<classId>/ask/<threadId>.jsonl`). Rows are `[ask-thread-item]` with `data-thread-id`. The title is the first question, truncated to 60 characters.
  [＋ New] `[ask-new]`. The ⋯ menu per thread has Rename and Delete.
- **Scope chips** `[ask-scope]`: All · Lectures · Documents · Exams · My notes. They are multi-select; "All" is exclusive.
  - "My notes" is off by default, with a `lock` icon and the tooltip "Includes your private notes in what is sent to the AI."
  - Extra chips appear when opened from a lecture or document: "This lecture: {title}" / "This document: {name}" (removable).
- [☐ Allow general knowledge] `[ask-general]`: off by default; the default comes from Settings. When on, unverified sentences are marked as in §3.9.8.
- **Composer** `[ask-input]`: Enter sends `[ask-send]`; Shift+Enter adds a newline. The placeholder is "Ask about {short}…", or "Ask about all your classes…".
- **CostLine** `[ask-cost]`: requests (1, or 2 with cross-language query expansion when the class language differs from the question's), the quota, and the model label as a MenuButton `[ask-model]` that changes the model for this thread only.
- **Answer**: an AiCard with chips, plus:
  - "Sent: your question and {n} passages." with [See what was sent] `[ask-sent]`, a disclosure listing each passage: source + locator + the first 200 characters;
  - actions:
    - [Post to class chat] `[ask-post]`: posts it as a `kind:'ai'` chat line from me carrying the question (`ChatAi.question`, no `replyTo`; folder spec §8.16), after the confirm "Post this answer to {class} chat? Classmates will see your question and the answer."
      It is disabled, with the tooltip "Answers that use your private notes can't be posted", when the answer cites a private source;
    - [Copy with sources] `[ask-copy]`: Markdown with footnotes;
    - [Save as note] `[ask-save-note]`: into My notes;
    - [Try again] `[ask-retry]`;
    - [Deep answer] `[ask-deep]` (as in §3.9.8).
- **Empty (AI on)** `[ask-empty]`: "Ask anything about {class}." plus 3 suggested prompts as buttons `[ask-suggestion]`:
  - "Summarise {latest lecture title}" (when a transcript exists);
  - "Quiz me on {latest exam paper}" (when one exists);
  - "What are the main topics so far?"
- **AI off** `[ask-off]`: "Ask your classes with AI." with the body "Set up OpenRouter with your own key (free models work), or a local AI service. Search works without AI." and [Set up AI] [Search instead] (opens the palette).
- **Errors** render inline in the answer slot with the copy from §5 `ai.errors.*` and their recovery buttons. When the whole chain is busy, the **busy chooser** (§3.15.6) appears.
- The global `route ask` is the same component with scope "All classes". Its scope chips add class chips (ClassChip) for narrowing.

### 3.12 Members, invite and join

#### 3.12.1 Members tab (`[class-members]`, ready marker `[member-list]`)
```
[👤+ Invite classmates]                                                     Ask before letting people in (○━)
WAITING TO JOIN (1)                                                         ← only with "Ask before…" on
 Ⓓ Diogo Santos · “Diogo's laptop” · check words: amber-otter        [Let in] [Not now] [Decline]
PEOPLE (3)
 Ⓐ Ana Ribeiro (you) · Organiser         ● Online · up to date
    └ 💻 Ana's laptop (this computer)    Up to date
 Ⓑ Bruno Costa                           ◐ Transcribing Aula 8 · 40 %
    └ 💻 Bruno's laptop                  Syncing · 45 MB left · connected through a relay (slow)
 Ⓒ Carla Mendes                          ○ Last seen today, 12:25
    ├ 💻 Carla's laptop                  Offline · last seen today, 12:25
    └ 🖥 Carla's desktop                 Offline · last seen 3 days ago
    ⚠ Unverified device claiming to be Carla: “Carla-PC”  [Remove device]     ← only with ?unverified=1
TRANSCRIPTION HELPERS
 Ana — when plugged in · Recommended model      Bruno — always · Recommended model
RECORDING PERMISSIONS
 Recording: allowed · Sharing in this group: allowed · confirmed by Ana Ribeiro on 20 Oct 2026   [Report a problem] [Withdraw]
```
- **People** rows `[member-item]` (`data-member-id`) show Avatar 28 + name (+ "(you)") + an "Organiser" Badge + a presence line. The presence line is the first that applies:
  - recording: "● Recording {class short}" with the rec dot;
  - transcribing: "◐ Transcribing {lecture} · {p} %";
  - editing: "✎ Editing {note title}";
  - online: "● Online · up to date" / "◐ Online · syncing {p} %";
  - offline: "○ Last seen {relative}".

  The device rows `[member-device]` (`data-device-id`) are disclosure children, expanded for me and collapsed for others ([▸ 2 computers]).
  Each shows an icon (laptop if the device reports a battery, otherwise monitor), the device name, and a status:
  - "Up to date" / "Syncing · {size} left";
  - "Connected through a relay (slow)";
  - "Offline · last seen {relative}";
  - "Never connected".

  The check words appear on focus or hover (`CheckWords`).
- **Unverified device** `[member-unverified]` (critique §7 binding rule): a warning row with [Remove device] (organisers).
- **Person menu** `[member-menu]`:
  - Copy check words
  - Make organiser / Stop being organiser (organisers only; self)
  - Remove from class… `[member-remove]` (organisers; not self)
- **Remove** dialog `[member-remove-dialog]`:
  - Title "Remove {name} from {class}?"
  - Body "Everyone's Tramado stops sharing the class with {name}'s computers. {name} keeps what was already on their computer. From now on, new computers must be let in by a member (this turns on “Ask before letting people in”)."
  - Buttons: [Remove] (danger). (v1.1: the secondary link [Start a fresh class without {name}…] `[member-fresh-class]` opens an explanation dialog:
    "This makes a new copy of {class} that {name} can't join, and invites everyone else again. {name} keeps the old copy." [Make a fresh class] (G7).)
- **Ask before letting people in** `[members-ask-before]`: a Switch (organisers; others see it read-only). Waiting rows `[member-waiting]` have:
  - [Let in] `[member-admit]`;
  - [Not now] `[member-later]` (nothing changes; the row stays);
  - [Decline] `[member-decline]`: organisers add a ban entry (`SyncService.decline` → `bans/<me>.json`); others ignore the device on this computer only (10 minutes, longer if it keeps knocking; sync spec §9.3).
- **Transcription helpers** `[members-helpers]`: one line per member whose `caps.volunteer` ≠ off, with the model state.
  When I am not a helper: a link "Help transcribe this class's lectures…" → Settings › Transcription.
- **Recording permissions** `[members-consent]`: the newest consent records (kind, scope, by, date). Buttons:
  - [Report a problem] opens Chat with the composer pre-filled "@everyone A problem with the recording permission: ";
  - [Withdraw permission] (organisers, or the person who gave it; confirm) appends a `revoke` consent line (`revokes: {deviceId, id}`, folder spec §8.5), stops new recordings from being shared, and asks "Also delete existing recordings for everyone?".
- **Large class advisory** (an info Notice): more than 30 members: "Large classes sync slowly. Consider smaller study groups." More than 50: the same text in warning tone (G18).
- **Alone**: EmptyState `[members-empty]` "Only you." with the body "Send an invite in your class group. It takes classmates a minute to join." and [Invite].

#### 3.12.2 Invite dialog `[invite-dialog]` (`Dialog size="md"`)
```
Invite classmates to ▌⚖ Direito Constitucional I
Send this invite wherever your class talks: your class group chat, Moodle or email.
Anyone who has it can join.
[ Copy invite ]                                                     [invite-copy]  (primary, large)
┌──────────┐  Scan with a phone to send the invite to your computer.
│ ▄▄ ▄ ▄▄ │  (opens a page that shows the invite; it never leaves your phone's browser)
│ QR (220) │                                                        [invite-qr]
└──────────┘
Invite code (it's long — copy and paste it, don't type it)
┌ tri1_eyJ2IjoxLCJmIjoidHJhbWFkby1nZXpua3l1andvZmVkd2luZmNtemwycmltIiwibCI6IkRpcmVp… ┐  [invite-code]
└───────────────────────────────────────────────────────────────────────────────────┘ [Copy code] [invite-copy-code]
[Save as a file…]                                                   [invite-save-file]
ⓘ People join through your computer, or any member's that is online. If nobody is online, they wait.
   To approve each person first, turn on “Ask before letting people in” in Members.
                                                                          [Done]
```
- The **code** is `tri1_` + base64url(InviteV1) as defined in sync spec §7.1–§7.2 (about 1,000 characters for three devices). It is generated by the sync service with fresh addresses each time the dialog opens.
  It is shown in a read-only `TextArea` (mono, 4 lines, `wrap: anywhere`), selected on focus.
- **[Copy invite]** copies a ready-to-paste message (`members.invite.message`):
  ```
  Join “{class}” on Tramado: {link}
  Or open Tramado → Join a class and paste this code:
  {code}
  ```
  `{link}` is `{JOIN_PAGE}#{code}`, i.e. `https://feiteira.github.io/Tramado/join/#{code}` (the build constant `JOIN_PAGE`, §8 OQ1; the page is live), or `tramado://join/{code}` in a build with `JOIN_PAGE = ''`.
  Toast "Invite copied. Paste it in your class group."
- **QR**: `QrCode` of the **reduced** invite (first device, ≤ 2 addresses; about 400–750 characters with the page address) as `{JOIN_PAGE}#{reduced code}`, or `tramado://join/{reduced code}` when there is no page (sync spec §7.2): error correction M, version 16–22, ≥ 4 px per module with a 4-module quiet zone (356–452 px). A phone that scans it opens the join page, which shows the class and [Copy code] (no [Open in Tramado] on phones) and links to the download section of the homepage (`https://feiteira.github.io/Tramado/#download`) to get Tramado.
- **[Save as a file…]** writes `{short}.tramado-invite` in the format of sync spec §7.2 (line 1 the link, line 2 the sentence "Open this file with Tramado to join {class}."). Opening such a file (drag onto the window, or the file association, architecture §18.3) opens the Join dialog.
- Generating the code requires Syncthing to be running. While it starts, the dialog shows a Spinner "Getting your computer ready to share…". On failure: the sync error (§3.15.2).

#### 3.12.3 Join dialog `[join-dialog]` (`Dialog size="md"`)
Entry points: rail [Join a class], onboarding, Ctrl/⌘+Shift+J, `tramado://join/…` deep links, opening a `.tramado-invite` file, and the palette.

**Step 1: paste** `[join-step-paste]`
```
Join a class
Paste the invite a classmate sent you (the whole message is fine).
┌───────────────────────────────────────────────────────────────┐
│                                                               │  [join-code]  (TextArea, mono)
└───────────────────────────────────────────────────────────────┘
[Paste]  [Open an invite file…]                              [Cancel] [Continue]  [join-continue]
```
- The parser finds the first `tri1_…` code (sync spec §7.2 regex) in any of these: the bare code, `tramado://join/<code>`, `…/join/#<code>`, a `.tramado-invite` file, or a full pasted message. A pairing code (`trp1_…`) shows "Adding another computer needs a newer Tramado." (v1.1).
  It validates each device ID with `/rest/svc/deviceid` (G17). Errors are shown inline under the field:
  - "This doesn't look like a Tramado invite. Copy the whole message and try again." (`SYNC_INVITE_INVALID`)
  - "This invite was made by a newer Tramado. Update Tramado to join." (`NEWER_FORMAT`)
  - "You're already in {class}." [Open it]

**Step 2: preview** `[join-step-preview]`
```
Ana Ribeiro invited you to
┌──┐ Direito Constitucional I                                   ← name, colour and icon from the invite
│⚖ │
└──┘
What you'll get: lectures and transcripts, documents, class notes and the class chat.
Your own notes, highlights and practice stay private.
Keep it in   ~/Tramado/Direito Constitucional I   [Change…]                 [join-folder]
[✓] Also download lecture recordings (about 11 MB per hour)                  [join-audio]
    You'll still get every transcript. Turn recordings on later in the class settings.   (hint when off)
[ ] Recordings in this class are for this class only. I won't share them outside it.  [join-rules] (required)
You'll appear as Ana Ribeiro. [Change]                                         [join-name]
                                                                     [Back] [Join class]  [join-submit]
```
- [Join class] is disabled until `join-rules` is ticked. The folder path is checked for cloud-sync roots (G15) and for an existing non-empty folder
  ("A folder with this name already exists. Choose another place.").

**Step 3: connecting** `[join-step-wait]`
- The default (auto-accept): "Connecting to {inviter}…" Spinner. Then "Your check words: **amber-otter**. You can close this window: Tramado will tell you when you're in."
- After 30 s with no member device connected: "No one from the class is online right now. You'll join as soon as someone opens Tramado." (dialog closable; the class appears in the rail with ⟳ and the sync state `waiting`).
- With "Ask before letting people in": "Waiting for a member to let you in… Your check words: **amber-otter**. Members see the same words."
- Not let in 90 s after a member's computer connected (and not in ask mode): "{inviter}'s computer didn't let you in yet. Try again in 10 minutes." [Try again] `[join-retry]` (sync spec §8).
- Declined: "{inviter}'s class didn't let this computer in. Ask them for a new invite."

**Step 4: in** `[join-step-done]`
- "You're in! Getting {class}… {have} of {total} files". The class opens at once. Items still syncing show ⟳ and open as soon as they arrive.
- When this is the user's first shared class, the first-share dialog (§3.15.1) follows.

#### 3.12.4 Admission notices (members' side)
- Auto-accept: a toast and an OS notification `[admission-toast]`: "**{name}** joined {class} · check words {words}" [Remove] (opens the remove dialog).
- Ask-before: a toast with the actions "**{name}** (“{device}”) wants to join {class}. Check words: **{words}**" [Let in] [Not now], plus the waiting row in Members.
  With several waiting: "{n} people want to join {class}" [Review] → Members.

#### 3.12.5 Your other computers (pairing, critique §7), Settings › Sharing `[pair-dialog]` (v1.1; not built in 0.1)
- **On the existing computer** [Add another computer…] `[pair-show]` shows a QR + code (the same code UI as the invite) with "On your other computer, open Tramado → Join a class and paste this code. Your classes will appear there too. Your private notes, highlights and practice are not copied: they stay on each computer."
- **On the new computer**, the Join dialog recognises a pairing code. Its preview reads "Add this computer to **Ana Ribeiro**'s computers?", lists the classes it will get, and has [Add this computer]. After pairing, the profile name is adopted.

#### 3.12.6 Check words
`checkWords(deviceId): string` = `ADJ[h[0]] + '-' + NOUN[h[1]]`, where `h = SHA-256(UTF-8("tramado-check-v1|" + canonical dashed deviceId))`
(sync spec §25 Q1) and `ADJ` and `NOUN` are the 256 adjectives and 256 animal names of `docs/spec/check-words-v1.txt`, imported by
`app/src/core/sync/checkWords.ts` (for example "amber", "otter").
They are **not translated**, so both people see the same words whatever their UI language. They are shown in `--font-mono` with a copy IconButton.

#### 3.12.7 Test ids (members, invite, join)
`class-members, member-list, member-item, member-device, member-unverified, member-menu, member-remove, member-remove-dialog,
member-fresh-class, members-ask-before, member-waiting, member-admit, member-later, member-decline, members-helpers, members-consent,
members-consent-report, members-consent-withdraw, members-empty, members-become-organiser, invite-dialog, invite-copy, invite-qr, invite-code,
invite-copy-code, invite-save-file, invite-done, join-dialog, join-step-paste, join-code, join-paste, join-open-file, join-continue,
join-step-preview, join-folder, join-audio, join-rules, join-name, join-submit, join-back, join-step-wait, join-check-words, join-step-done,
admission-toast, join-retry`. (v1.1: `member-fresh-class`, `pair-show`, `pair-dialog`.)
### 3.13 Search (Ctrl/⌘+K), the palette with results (`[palette]`)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ ⌕ conteúdo essencial                                  [In DC I ⇄ All classes]  [Esc]       │  [palette-input] [palette-scope]
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ LECTURES  3                                                                                │
│ ▸ ▌⚖ Aula 6 — Restrições aos direitos…  ▶ 41:12   “…nunca pode atingir o conteúdo ▀essencial▀…” │  [palette-result] data-kind="lecture"
│   ▌⚖ Aula 7 — Princípio da proporcionalidade  ▶ 12:03  “…o ▀conteúdo essencial▀ é o limite…”   │
│ DOCUMENTS  2                                                                               │
│   ▌⚖ Lei Fundamental de Exemplo · p. 9 · art. 18.º  “…nunca podem atingir o ▀conteúdo essencial▀…”│
│ NOTES 1 · EXAMS 1 · CHAT 2                                     (collapsed groups show counts)│
│ COMMANDS                                                                                   │
│   Ask AI about DC I                                                                        │
│ ✦ Ask AI: “conteúdo essencial” in DC I                                     Ctrl+Enter       │  [palette-ask]
└────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Opening**: Ctrl/⌘+K, or the rail search button. It is a 720 px wide `Dialog`-like overlay positioned 15 % from the top, with `--r-xl` and `--shadow-3`.
- **Scope**: when opened from inside a class, the scope is "In {short}", else "All classes". Tab (or the chip) toggles it. The filter menu ▾ on the chip adds "Include archived classes".
- **Results** come from the class `PassageIndex` worker (D16), are accent- and case-insensitive (`fold`), and appear as you type (debounce 80 ms). The groups, in order, are:
  - Lectures (snippet + ▶ time);
  - Documents (snippet + page/slide/article);
  - Notes (my notes and class notes; a lock icon on private ones);
  - Exams (question text + exam title);
  - Chat (message excerpt + author + date);
  - Commands (§2.9);
  - the **Ask AI** row, always last, `[palette-ask]` (hidden when AI is off: it then reads "Ask AI (set up AI first)" and goes to Settings).

  A group shows up to 5 results. "Show all {n}" `[palette-more]` expands it in place (up to 50).
- **Row layout**: ClassChip (only with scope All), title, locator, and the snippet in the reading font, with hits in `mark.cite`. Each row is `role="option"` with
  `aria-label` "{kind}: {title}, {locator}. {snippet without marks}".
- **Keys**: ↑/↓ move; Enter opens; on a lecture hit, Enter **opens and plays** from 3 s before the hit, and Shift+Enter opens without playing.
  Ctrl/⌘+Enter runs Ask AI with the query. Tab toggles the scope. Esc closes and returns focus.
- **Empty query**: "Recent" (the last 8 opened items) `[palette-recent]` and "Recent searches" (the last 5; private, prefs `search.recent`), then the commands.
- **No results**: "Nothing found for “{q}”." with the body "Try fewer words, or search all classes." and [Search all classes] [✦ Ask AI].
- **Indexing in progress** (first start, a new big PDF): a line under the input "Still reading {n} files; results may be incomplete." `[palette-indexing]`.
- Works offline and without AI.
- Test ids: `palette, palette-input, palette-scope, palette-group (data-kind), palette-result (data-kind, data-index), palette-more,
  palette-ask, palette-recent, palette-indexing, palette-empty, command-<id>`.

### 3.14 Settings (`route settings`; `features/settings/`; `[screen-settings]`)

The layout is a left section list (200 px, `nav aria-label="Settings sections"`, items `[settings-nav-<section>]`) and a content column
(max 760 px). Each section is a `Section` with `[settings-<section>]`. Changes apply at once (no Save button). Trama's `Group`/`Row` pattern is used.

#### 3.14.1 Profile `[settings-profile]`
- "Your name" `[profile-name]` (shown to classmates; saved on blur; written to every class's members file).
- "This computer's name" `[profile-device]`.
- "Your colour" `[profile-colour]` (ColorPicker; avatar initials preview; saved in `identity.json` and every class's member file `colour`).
- An info line: "Classmates see your name and your computers' names. Never a phone number or an email."

#### 3.14.2 Language and appearance `[settings-appearance]`
- Language `[appearance-language]` (RadioGroup list: English, Português, Español, in native names).
- Theme `[appearance-theme]` (segmented: System, Light, Dark).
- Text size `[appearance-text-size]` (Select: 87.5 %, 100 %, 112.5 %, 125 %, 150 %; prefs `ui.textSize` = `0.875|1|1.125|1.25|1.5`). It is applied through `platform.window.setZoom` (webview zoom; capability `core:webview:allow-set-webview-zoom`) on desktop and `html { zoom }` in the demo (§8 OQ9).
- Font `[appearance-font]` (RadioGroup: "Default", "Easier to read (Atkinson Hyperlegible Next)", "OpenDyslexic"; prefs `ui.readingFont`). Each option label is rendered in its own font.
- Reduce motion `[appearance-motion]` (segmented: "Follow the system", "On").

#### 3.14.3 AI `[settings-ai]`
```
AI service      ◉ OpenRouter   ○ Another OpenAI-compatible service (advanced)            [ai-service]
OpenRouter key  Key ending in …a1b2 · stored in the system keychain   [Test again] [Replace] [Remove]   [ai-key-status]
                (when none:) [ sk-or-…              ] [Paste] [Test and save]   Get a free key at openrouter.ai/keys ↗   [ai-key] [ai-check]
                ⓘ OpenRouter is for people aged 18 or over. If you are younger, use a local AI service instead (below), or skip AI.
                <result Notice>                                                                    [ai-check-result]
Free requests   ▰▰▰▰▰▰▰▱▱▱ 38 of 50 left today · resets at 00:00 (midnight UTC)   [Refresh]          [ai-quota]
                Accounts that have bought at least 10 credits get 1,000 free requests a day.     (when is_free_tier)
                Credit: $9.74 left                                                               (when the key has a limit)
What providers may do with what you send                                                          [ai-privacy]
 ○ Keep nothing      Only providers that keep nothing of what they're sent. Most free models are excluded, so you'll usually need a paid model.
 ◉ No training (recommended)   Providers may keep requests for a short time (for example, to check for abuse) but won't train AI on them. Works with the default free model.
 ○ Allow free models that may train   Some free models are free because the provider may use what you send to improve their AI. Don't use this for anything personal.
Model           [ Gemma 4 31B (free) — recommended ▾ ]                                            [ai-model]
If it's busy, try [ Gemma 4 26B A4B (free) ▾ ]  then [ Dots 3 Note Preview (free) ▾ ]             [ai-fallback-1] [ai-fallback-2]
                [Reset to recommended]   4 free models work at your privacy level · list updated today   [ai-reset-models]
When all free models are busy   ◉ Ask me   ○ Use NVIDIA free models (they may train on what you send)   [ai-busy-policy]
Answers         Language: ◉ Same as the question  ○ Always {UI language}                           [ai-answer-language]
                [ ] Allow general knowledge by default (marked as unverified)                     [ai-general-default]
Another service (advanced)  Address [ http://localhost:11434/v1 ]  Key [ optional ]  Model [ qwen3:8b ]  [Test]   [ai-custom-*]
                Use this for a local AI (Ollama, LM Studio) or your school's server. Plain http works only for this
                computer or your local network.
[Turn off AI on this computer]                                                                    [ai-off]
AI activity on this computer →                                                                     [ai-activity-link]
```
- **Key test**: `AiService.testKey()` (`ai_send` `GET key`) → the result Notice `[ai-check-result]`: OK ("Works. {n} free requests left today."), `AI_AUTH`, `AI_OFFLINE`, or
  `AI_NO_CREDIT` (paid model chosen). On success the field collapses into the status line. The key itself never reaches the webview after it is saved (D4).
  The status line uses `secrets.status → {set, last4}`.
- **Quota** (`QuotaMeter`): from `GET /key` `free_model_daily_requests`, cached 5 min, refreshed after each batch.
  "resets at {local time of the next 00:00 UTC}" (D10). It is hidden for custom services.
- **Privacy level** (`zdr` / `no-training` / `standard`, folder spec §8.14; radios `[ai-privacy-zdr]`, `[ai-privacy-no-training]`, `[ai-privacy-standard]`; a unit check maps them 1:1 to `PrivacyLevel`): choosing `standard` calls `platform.ai.setPrivacy('standard', …)`, whose **native** confirmation `[ai-privacy-confirm]` reads:
  - Title "Allow free models that may train?"
  - Body "Some providers may use what you send to improve their AI. Don't use this for anything personal: recordings of people, your own writing you want to keep private, or sensitive topics."
  - Buttons [Allow] / Cancel.

  Choosing `zdr` while a free model is selected shows a warning Notice: "Free models aren't available at this level. Choose a paid model, or answers will fail."
- **Model pickers** (`Select` with a type-ahead filter; options come from the cached `/models` catalog filtered by chat capability, tools, privacy-level availability and the hidden list (`AI_MODEL_GATED`, classifiers)):
  - each option shows the label, a "free" badge, the context length ("262k"), and vision ("reads images") when relevant;
  - the default chain comes from `ai-defaults.json` for the level (D7, D8);
  - a missing default model (catalog changed) shows "Gemma 4 31B is no longer on OpenRouter. Using {replacement}." (G21).
- **Busy policy**: "Ask me" (default) shows the busy chooser (§3.15.6); "Use NVIDIA…" calls `AiService.setBusyPolicy(true)`, which shows a native confirmation like the `standard` level's (stored as `busyRelax` in `config/ai.json`, architecture D-10).
- **Answers**: "Allow general knowledge by default" is prefs `ai.generalDefault`; the answer language is prefs `ai.answerLanguage`.
- **Custom service**: [Test] calls `/models` on the host. A new non-local host asks first: "Allow Tramado to send AI requests to {host}?" [Allow] (`service/hosts.rs`).
  `AI_HOST_NOT_ALLOWED` / `AI_BAD_ADDRESS` are shown inline. While a custom service is active, the privacy level control is hidden and replaced by "Privacy depends on {host}."
- **Turn off AI** (prefs `ai.enabled = 0`) hides every AI affordance (Ask tab content, Explain, @AI autocomplete, the AI buttons on exams) and shows "AI off" in the pill. The key is kept.
- **AI activity on this computer →** opens Settings › Privacy at the activity log.

#### 3.14.4 Transcription `[settings-transcription]`
```
Speech model (downloads once, works offline)                                                      [speech-models]
 ◉ Recommended   574 MB · good accuracy, about 2.7× faster than real time here   ✓ Installed  [Remove]       [speech-model-turbo]
 ○ Draft         190 MB · faster, but rough on Portuguese and Spanish            [Download]                  [speech-model-small]
 ○ Most accurate 1.08 GB · slower                                                 ◐ 412 of 1,081 MB · 2.4 MB/s · about 5 min  [Pause]  [speech-model-large-v3]
 [Import a model file…]   Saved in Tramado's own folder: ~/.local/share/eu.thehumanloop.tramado/models   [speech-import]
Help transcribe the class's lectures   ○ Off   ○ When this computer is plugged in   ○ Always              [speech-volunteer]
                When a lecture in a shared class has no transcriber, this computer takes it on.
Cloud transcription  (○━) With OpenRouter — paid, about 2 cents per lecture. The audio is sent to          [speech-cloud]
                OpenRouter in short pieces. Model [ openai/whisper-large-v3-turbo ]                        [speech-cloud-model]
Microphone      [ Default — Built-in Audio ▾ ]  [Test microphone] ▁▃▅                                     [speech-mic] [speech-mic-test]
                (prefs speech.inputDevice; the test meter uses RecordingService.startMeter, no recording is made)
Recording quality ◉ Standard (24 kbps, about 11 MB per hour)  ○ Storage saver (16 kbps, about 7 MB per hour)  [speech-quality]
                (prefs speech.bitrate)
Markers point back  [ 3 seconds ▾ ] (0, 3, 5, 10) — most people tap just after the important sentence     [speech-marker-lead]
[ ] Marker shortcuts that work in any app while recording: Ctrl+Alt+1 … 4                                 [speech-global-shortcut]
```
- Each model row is a `ModelRow`. Its states:
  - `absent`: [Download];
  - `partial`: "{done} of {total} MB (paused)" [Resume] [Delete];
  - `downloading`: ProgressBar, speed, ETA, [Pause];
  - `verifying`: "Checking the download…";
  - `ready`: "✓ Installed" [Remove];
  - `failed`: "The speech model didn't download correctly. Nothing was installed." [Try again].

  The radio selects the active model among the installed ones. Removing the active model asks for confirmation.
- `SPEECH_UNSUPPORTED_CPU`: the whole model area becomes a Notice "This computer's processor can't run the speech model (it needs AVX2, found in processors since about 2013). Classmates' computers or OpenRouter can transcribe your lectures." The volunteer setting is hidden.
- **Volunteer default: "When this computer is plugged in"** (prefs `speech.volunteer = plugged`, §8 OQ7), effective only once a speech model is installed (before that the member file says `off`). The first time a model is ready on a computer with a shared class, a toast says once: "This computer will help transcribe your classes' lectures when it's plugged in." [OK] [Turn off] (`speech.volunteerAsked`).
- The "Help transcribe" radios are `[speech-volunteer-off]`, `[speech-volunteer-plugged]`, `[speech-volunteer-always]`; cloud transcription is prefs `speech.cloud` / `speech.cloudModel` (`TranscriptionQueue.setCloud`).
- Marker shortcuts: prefs `speech.markerShortcuts`; on → `platform.system.setMarkerShortcuts({important:'CmdOrCtrl+Alt+1', confused:'CmdOrCtrl+Alt+2', exam:'CmdOrCtrl+Alt+3', todo:'CmdOrCtrl+Alt+4'})`; a taken accelerator shows "Another app uses {keys}." (`CONFLICT`).
- Turning on Cloud transcription asks for confirmation:
  - Title "Turn on cloud transcription?"
  - Body "Recordings you choose to transcribe this way are sent to OpenRouter and the speech model's provider, in pieces of up to 30 seconds. It costs about 2 cents per lecture from your OpenRouter credit."
  - Button [Turn on].

  It requires a key; free accounts with no credit get `AI_NO_CREDIT` at first use.

#### 3.14.5 Sharing `[settings-sharing]`
```
Status          ● Sharing is running · Syncthing 2.1.7 · this computer listens on port 22117   [Restart sharing] (sync_restart)   [sharing-status]
                (or) Sharing starts when you share or join a class.                 (or) the error card (§3.15.2)
[ ] Pause sharing                                                                                 [sharing-pause]
Your computers  💻 Ana's laptop (this computer) · check words amber-otter                          [sharing-devices]
                (v1.1: other computers of yours, [Remove], [Add another computer…] [pair-show])
When you close the window   [✓] Keep sharing in the background (in the tray)                       [sharing-tray]
                Your classmates get recordings and transcripts from you faster. Quit from the tray icon to stop.
[ ] Start Tramado when I log in (hidden in the tray)                                              [sharing-autostart]
[ ] Local network only — no relays or internet discovery. Often doesn't work on eduroam.           [sharing-lan-only]
Speed limits    Upload [ No limit ▾ ]  Download [ No limit ▾ ]   (No limit, 2 MB/s, 1 MB/s, 500 KB/s, 250 KB/s)   [sharing-limit-up] [sharing-limit-down]
ⓘ Your own Syncthing is running on this computer. Tramado uses a separate copy on port 22117; your folders are untouched.
   [Add my Syncthing as one of my computers]                                                       [sharing-own-syncthing]
▸ Sharing diagnostics                                                                              [sharing-diagnostics]
   Version 2.1.7 · device ID AB4Z76W-… · sync port 22117 · API: running
   Classmates' computers: Bruno's laptop — connected (relay, 4.2 Mbit/s) · Carla's desktop — last seen 3 days ago
   Recent problems: none
   Log (last 200 lines)  [Copy]                                                                    [sharing-log] [sharing-log-copy]
```
- The macOS wording of the tray option is "Keep sharing in the background (in the Dock)". Wherever the tray is unavailable, the window close keeps the app in the Dock, as macOS does.
- Device IDs in diagnostics are truncated to their first 7 characters. The full ID is behind [Copy].

#### 3.14.6 Notifications `[settings-notifications]`
- [✓] Show system notifications `[notify-system]` (prefs `notify.system`).
- Default for new classes `[notify-default]` (prefs `notify.default`): Mentions and important / Every message / Nothing.
- "Tell me when…" checkboxes `[notify-kinds]`:
  - "a transcript I'm waiting for is ready" (on);
  - "someone joins one of my classes" (on);
  - "an exam date is added or changed" (on);
  - "the speech model finishes downloading" (on).

  (prefs `notify.transcripts`, `notify.joins`, `notify.exams`, `notify.model`.)
- The per-class level is set in each class (⋯ › Notifications), with a link to it.

#### 3.14.7 Storage `[settings-storage]`
```
Classes are kept in  ~/Tramado   [Change…]   New classes go here; existing classes stay where they are.   [storage-root]
 ▌⚖ DC I      812 MB  (recordings 640 MB · deleted files kept for 30 days 42 MB)   [Empty class trash] [ ] Skip audio   [storage-class]
 ▌🧬 BIO 101  130 MB  …
Speech models   574 MB   [Manage]                                                                    [storage-models]
Cache (text for search, indexes)  48 MB   [Clear cache]   It rebuilds itself when needed.            [storage-cache]
Remove recordings I made, once transcribed   ○ Never  ○ After 30 days  ○ After 90 days               [storage-audio-retention]
   The transcript stays. In shared classes the recording is removed for everyone.
```
- Sizes come from `platform.storage.usage()` (`storage_usage`; "deleted files kept for 30 days" = the class's `.stversions`). [Empty class trash] (`platform.classes.emptyTrash`, `class_trash_empty`) confirms "Permanently delete {size} of deleted files in {class} on this computer? Classmates' copies of their own trash are not affected." [Clear cache] calls `platform.cache.clear()` (`cache_clear`).
- Classes that are being left are listed as "Leaving — waiting for a classmate to receive it" (sync spec §17) with no actions.
- Cloud-folder warning (G15) next to the root when needed.
- Disk almost full (less than 1 GB) shows a warning Notice at the top: "Your disk is almost full ({free} left). New recordings and classmates' files may not fit."

#### 3.14.8 Privacy `[settings-privacy]`
**What leaves this computer** (a table `[privacy-table]`, Trama's PRIVACY.md format):

| When | What is sent | To whom |
|---|---|---|
| Nothing set up | Nothing. Tramado makes no connection of its own. | — |
| You share or join a class | Class files, chat and your name and computer's name, encrypted between your classmates' computers. Your computer's ID and IP address go to Syncthing's discovery and relay servers so classmates can find you. | Your classmates' computers; Syncthing's public discovery and relay servers |
| You open an invite link in a browser (or scan an invite's QR code) | Your browser loads Tramado's invite page from GitHub Pages: GitHub sees your IP address and browser details, as for any web page. The invite code stays in the part of the link after "#", which your browser never sends; the page reads it on your device. | GitHub (USA), which hosts the invite page |
| You ask the AI (Ask, @AI, Explain, exam answers, summaries) | Your question and the passages it needs (with their file names and timestamps). Never whole folders, private notes (unless you include My notes), chat history or other classes. | OpenRouter (USA) and the company running the model |
| You read a scanned exam or document with AI | The page images | OpenRouter and the model's provider |
| You transcribe with OpenRouter | The recording, in pieces of up to 30 seconds | OpenRouter and the speech model's provider |
| You download a speech model | A download request | Hugging Face |
| Never | No account, no telemetry, no analytics, no crash reports. Syncthing's usage reporting is off. | — |

Then:
- **AI activity on this computer** `[privacy-ai-log]`: a Table (Time · Class · Action · Model · Passages sent · Requests) from `platform.ai.activity(500)`; each entry is one request, so consecutive entries of the same action and class within 60 s are grouped into one row whose "Requests" is their count. [Clear the log] `[privacy-ai-log-clear]` (`ai_activity_clear`).
- **Where your data is**: links that open the classes folder, the private data folder, the models folder and the cache folder (`[privacy-open-*]`; `platform.storage.reveal('classesRoot' | 'private' | 'models' | 'cache')`).

#### 3.14.9 About `[settings-about]`
- The brand mark, "Tramado {version}", and "Free and open source (MPL-2.0). Built on Trama." with a link to the source code (`https://github.com/feiteira/Tramado`).
- (Update checks are not in 0.1; architecture Q3.)
- **Keyboard shortcuts** [Show] → §2.10 overlay.
- **Diagnostics**:
  - [Copy diagnostics] `[about-copy-diagnostics]` (G20). Toast "Diagnostics copied. Nothing was sent."
  - [Test audio playback] `[about-media-test]` (R3). It plays a bundled 5-minute WebM through `tramado-media`, seeks to 4:12, checks `currentTime ± 0.25 s`, and reports "Playback works." or "Playback doesn't work in this window: {detail}. Tramado will use a slower fallback."
- **Licences** `[about-licences]`: a Table of component, version and licence:
  - Syncthing 2.1.7 (MPL-2.0)
  - whisper.cpp (MIT)
  - Whisper models (MIT)
  - Silero VAD (MIT)
  - libopus (BSD-3)
  - pdf.js (Apache-2.0)
  - mammoth (BSD-2)
  - lucide (ISC)
  - Figtree, Bricolage Grotesque, Source Serif 4, Atkinson Hyperlegible Next, OpenDyslexic (OFL-1.1)
  - qrcode (MIT)
  - React (MIT)
  - Tauri (MIT/Apache-2.0)
  - Trama (MPL-2.0)

### 3.15 Shared dialogs and notices

#### 3.15.1 First share (G12) `[first-share-dialog]`
Shown once, after the first class is shared or joined:
- Title "Keep sharing when you close the window?"
- Body "Your classmates get recordings and transcripts from you faster when Tramado keeps running in the background. It uses very little power."
- [✓] Keep sharing in the background (default on); [ ] Start Tramado when I log in (default off).
- Button [Done].

#### 3.15.2 Sharing failed to start `[sync-error-card]` (`SYNC_UNAVAILABLE` / `SYNC_PORT` / `SYNC_LOCKED`)
A Notice (danger) in the sync popover and in Settings › Sharing:
- "Sharing isn't running, so your classes aren't syncing. Everything still works on this computer."
- `SYNC_LOCKED` adds "Another copy of Tramado is using the sharing data. Close it and try again."

Buttons: [Try again] `[sync-retry]` and [Details] (opens the diagnostics).

#### 3.15.3 Mass deletion guard (G5.5) `[mass-delete-dialog]`
Not dismissible. Shown when more than 20 deletions (or modifications of existing files) in 10 s were not made by the app, including while the app was closed (the folder is paused first; sync spec §22.2):
- Title "Did you mean to delete {n} files from {class} for everyone?"
- Body "Files were deleted in the {class} folder outside Tramado. Sharing for this class is paused. If a classmate already received the deletion, their Tramado can restore it."
- Buttons: [Restore the files] `[mass-delete-restore]` (primary; `SyncService.resolveMassDelete('restore')`: the files come back from classmates' computers) and [Yes, delete them for everyone] `[mass-delete-confirm]` (danger).

**Received mass deletion** `[mass-delete-remote]` (a warning Notice on the class screen and an OS notification, `notify.massDelete`): "{name}'s computer deleted {n} files from {class}." [Restore for everyone] `[mass-delete-remote-restore]` (restores from this computer's trash) [Keep deleted] `[mass-delete-remote-keep]`.

#### 3.15.4 Folder missing `[folder-missing]`
Shown on the class screen in place of the tabs:
- "Tramado can't find the folder for {class}. Was it moved or deleted? Put it back at {path}, or remove the class from this computer."
- Buttons: [Remove from Tramado]. (v1.1: [Find it…] (folder picker; relocate) and [Get a fresh copy from classmates].)

#### 3.15.5 Recently deleted `[recently-deleted]` (`Dialog size="lg"`)
- A Table (File · Deleted · Size) built from Syncthing versions of paths that are deleted now (the last 30 days; machine files, `transcript.md`/`.vtt` and conflict copies excluded; sync spec §22.1); rows are `[recently-deleted-row]`.
- [Restore] per row (`POST /rest/folder/versions`). The toast says "Restored “{file}” for everyone."
- Empty: "Nothing deleted in the last 30 days."

#### 3.15.6 Free models busy, the chooser (C14, D9) `[ai-busy-chooser]`
An inline card in the place of the answer, not a modal:
- "The free models are busy right now. This happens often, and it's not your fault."
- Shows "Tried: Gemma 4 31B, Gemma 4 26B, Dots 3 Note Preview."
- Buttons:
  - [Try again in {s} s] (countdown when `retry-after` is known; else [Try again]);
  - [Use NVIDIA free models for this request] `[ai-busy-nvidia-once]`;
  - [Always use them when busy] `[ai-busy-nvidia-always]` (`AiService.setBusyPolicy(true)`: the native confirmation of §3.14.3; later busy requests use them without asking);
  - [Change model].
- A footnote: "NVIDIA's free models may use what you send to train their AI."

#### 3.15.7 Cost confirm (G11)
Every batch of more than 3 requests shows a CostLine in its own dialog (Answer settings, Read with AI, Summarise). Single requests show the CostLine under the button only.
When the free quota is `0`, the button is disabled and the line reads "You've used today's {limit} free AI requests. They reset at {time}."

#### 3.15.8 Newer format (G14)
Wherever an item has `newerFormat`, show the info Notice "Made with a newer Tramado — update to edit it." and make the item read-only.

#### 3.15.9 Windows file-name problem (G15)
In the sync popover and the class's Documents tab, a warning Notice: "{n} file can't be saved on Windows computers: {name}. Rename it." [Rename…].

#### 3.15.10 Missing item
When a route target is gone, the body is an EmptyState `[missing-item]`: `app.missing.<kind>` ("This lecture isn’t here any more.") with the body "It may have been deleted or moved by a classmate." [Recently deleted…] (shared classes) [Back].

#### 3.15.12 Copied identity `[identity-copied]` (`SYNC_IDENTITY_COPIED`, sync spec §2.5)
A danger card in the sync popover and Settings › Sharing: "This looks like a copy of another computer's Tramado. Two computers can't share one identity." [Set up as a new computer] `[identity-copied-new]` (`SyncService.resolveCopiedIdentity('new')`; your person and classes stay, classmates see a new computer of yours) [This is the same computer] `[identity-copied-same]`.

#### 3.15.11 Crash screen
Trama's ErrorBoundary (`crash-reload`, `crash-copy`, `crash-details`), with Tramado wording (§5 `app.crash.*`).

---

## 4. Citation chip specification

### 4.1 Data

```ts
export type Locator =
  | { kind: 'page'; page: number; label?: string }                 // PDF physical page; label = printed page label
  | { kind: 'article'; label: string; page: number; pageEnd?: number } // "art. 18.º" (law texts)
  | { kind: 'slide'; slide: number }
  | { kind: 'time'; ms: number; endMs?: number; segmentId?: string }  // lecture transcript
  | { kind: 'question'; questionId: string; number: string }        // a question of another exam paper
  | { kind: 'heading'; path: string[] }                              // DOCX / Markdown heading path
  | { kind: 'none' };
export interface SourceRef {
  type: 'document' | 'lecture' | 'exam' | 'note';
  classId: string; title: string;              // file name without extension, lecture title, exam title, note title
  relPath?: string; sha256?: string;           // documents, exam originals, notes
  lectureId?: string; examId?: string; private?: boolean;   // private = My notes (never shared; chip shows a lock)
  locator: Locator;
  quote: { exact: string; prefix: string; suffix: string }; // ≤ 300 / 32 / 32 chars
}
export interface Citation {
  n: number;                   // 1..k, numbered by first appearance in the answer
  ref: string;                 // "S3" as used in the prompt
  pin: string | null;          // pin-point text after the ref: "[S4, n.º 3]" → "n.º 3"
  source: SourceRef | null;    // null when hallucinated
  status: 'ok' | 'moved' | 'changed' | 'missing' | 'hallucinated';
}
```

- **Parsing** (D12): the answer is scanned with `/\[(S\d+(?:\s*,\s*S\d+)*)(?:\s*,\s*([^\]]{1,40}))?\]/g`. Each ref in group 1 becomes one chip, and group 2 becomes the `pin` of the
  **last** ref. A ref absent from the passages sent (or from the tool results) gets `status: 'hallucinated'`.
- **Resolving** (G13): try `relPath` + `sha256` (`ok`), then the same `sha256` at another path (`moved`), then the same path with a new hash, re-anchored by the quote
  (`changed`). Otherwise `missing`. Lectures and exams resolve by id.

### 4.2 Rendering

- **Inline chip** (`CitationChip`, a `<button type="button">`, `[cite-chip]`, `data-index={n}`):
  - `display:inline-flex; align-items:center; height:18px; min-width:18px; padding:0 5px; margin:0 1px; border-radius:var(--r-xs);`
    `background:var(--mark); color:var(--mark-ink); box-shadow: inset 0 -1.5px 0 var(--mark-strong); font: 750 11px/1 var(--font-ui);`
    `font-variant-numeric: tabular-nums; vertical-align: 0.1em;`
  - Content: `{n}`, plus ` · {pin}` when present (weight 600), plus a 10 px `lock` icon for private sources.
  - Hover: background `color-mix(in oklab, var(--mark) 75%, var(--mark-strong))`. Focus-visible: the global ring. Open (popover shown): 2 px `--mark-edge` outline.
  - `hallucinated`: background transparent, a 1 px dashed `--ink-4` border, the number in `--ink-3`, `text-decoration: line-through`.
  - `missing`: the same as `ok`, with opacity .6 and a `--ink-4` underline.
  - Consecutive refs (`[S1, S4]`) render as two chips separated by a thin space.
- **Accessible name** (`ai.cite.label`): "Source {n}: {title}, {where}". Extra statuses append " (moved)", " (changed since the answer)", " (missing)" or " (not a real source)".
  `where` is the locator label in words (§4.3), for example "article 18, number 3, page 9" or "at 41 minutes 12 seconds".
- In **plain-text copies** ("Copy with sources", "Copy to my answer"), a chip becomes `[n]` and a footnote list follows: `[n] {title}, {locator label}`.

### 4.3 Locator labels (`ai.cite.where.*`)

| Locator | Visible label | Spoken label (aria) |
|---|---|---|
| `page` | "p. {label ?? page}" | "page {label ?? page}" |
| `article` | "art. {label} · p. {page}" or "art. {label} · pp. {page}–{pageEnd}" | "article {label}, page {page}" |
| `slide` | "slide {n}" | "slide {n}" |
| `time` | "▶ {m:ss}" or "▶ {h:mm:ss}" | "at {h} hours {m} minutes {s} seconds" (zero parts omitted) |
| `question` | "Question {number}" | "question {number}" |
| `heading` | "§ {last heading}" | "section {last heading}" |
| `none` | "" | "" |

### 4.4 Source row (`SourceRow`, `[source-row]`, `data-index`)
A 52 px row: the chip (not interactive here), the type icon (`file-text` / `presentation` / `audio-lines` / `clipboard-check` / `notebook-pen`), the title (one line),
the second line "{locator label}" + " · transcribed by {name}" for lectures, and a chevron. Clicking or Enter does **Open** directly (§4.5).
Statuses show a trailing Badge: "Moved", "Changed", "Missing" or "Not a real source".

### 4.5 What clicking does

- **Chip click / Enter / Space** opens a `CitationPopover` `[cite-popover]` (`Popover side="bottom"`, `role="dialog"`, labelled by its title, focus on the primary button).
  The popover is 420 px wide:
  ```
  🗎 Lei Fundamental de Exemplo (texto fictício)                     art. 18.º · p. 9
  ┃ …devem ser gerais e abstratas, não podem ter efeito retroativo e ▀nunca podem
  ┃ atingir o conteúdo essencial do direito restringido▀.
  [Open at p. 9]                                                       (status note, if any)
  ```
  The quote shows `prefix` … **`exact`** … `suffix`, with `exact` in `mark.cite` and the block in the reading font at 15 px with `.cite-block`.
- **Ctrl/⌘+click** (or the middle button) skips the popover and opens at once.
- Primary action per locator, with the route it opens:

| Source / locator | Primary button | Route | On arrival |
|---|---|---|---|
| document · `page` | "Open at p. {label}" `[cite-open]` | `{name:'document', classId, relPath, sha256, page, quote: exact}` | jump to the page, find `exact` (first 8 words, phrase search), draw `mark.cite` + the margin bar, flash once |
| document · `article` | "Open art. {label}" | same, with `page` = article page | as above; the article index selects the article |
| document · `slide` | "Open slide {n}" | `{…, slide, quote}` | scroll to the slide section, mark the quote |
| document · `heading` / `none` | "Open" | `{…, quote}` | find the first occurrence of `exact` |
| lecture · `time` | "Open at {m:ss}" + secondary **"▶ Play from {m:ss}"** `[cite-play]` | `{name:'lecture', classId, lectureId, at: ms, segmentId, quote, play}` | scroll the transcript to the segment, `mark.cite` the quote, put the playhead at `ms` and a timeline triangle; with Play, start at `max(0, ms − 10 000)` (the 10 s lead-in from `product-ux §4.8`) |
| exam · `question` | "Open question {number}" | `{name:'exam', classId, examId, questionId}` | select the question |
| note (class) | "Open note" | `{name:'note', classId, relPath, private:false, quote}` | preview mode, mark the quote |
| note (private) | "Open my note" | `{…, private:true}` | as above |
| `hallucinated` | none | — | the popover says "This source isn't among the passages Tramado sent. The model may have made it up." |
| `missing` | "Search for the passage" | opens the palette with `exact` as the query | — |
| `moved` | as for the type | the route uses the new path | a Notice: "This file was moved to {path}." |
| `changed` | as for the type | — | a Notice: "This file changed after the answer was written. The passage was found again by its text." (or "…couldn't be found again.") |

- **Back** (Alt+←, the back button) returns to the answer with focus on the same chip (router focus restore; the chip's `selectorFor` uses `data-index` inside its `[ai-answer]`).
- In **chat**, the chips of an `ai` message behave the same for every member. If the cited file has not arrived on this device yet, the popover says "This file is still arriving." with no Open.
- The popover is never auto-opened on hover; the hover tooltip only says "Source {n}: {title}, {where}".
---

## 5. Microcopy (English source catalogs)

These are the files `app/src/core/i18n/locales/en/<namespace>.ts`, ready to paste.

**Conventions** (Trama's):
- plain words, second person, sentence case;
- typographic quotes and apostrophes (’ “ ”);
- no exclamation marks except "You’re in!";
- at most one warm touch per screen;
- `{placeholders}` in braces, `{ one, other }` objects for plurals (`tp`);
- the inline marks of `marks.ts`: `[b]…[/b]` for bold and `[m]…[/m]` for highlighter emphasis, inside one translatable sentence.

Dates and times are never written into strings; they come from `i18n.date/time/relative`.

**Translation notes for PT-PT and ES** (to be done later, following `trama-ui §1.8` and critique C27):
- PT-PT: Class = **Disciplina** (search keywords also "cadeira", "UC"); Lecture = **Aula**; Exam = **Exame** (kinds below); class group = **Turma**;
  notes = apontamentos; file = ficheiro; **"você" register** (Trama's).
- ES: Asignatura / Clase / Examen; class group = grupo de clase; notes = apuntes; file = archivo; Trama's **"usted" register**.
- Never translate the check words, model names, "Tramado", "OpenRouter" or "Syncthing".
- `catalogs.test.ts` fails if more than 5 % of the strings are identical to English, or if a `{placeholder}` is lost.

### 5.1 `common`
```ts
export const common = {
  appName: 'Tramado',
  ok: 'OK', cancel: 'Cancel', save: 'Save', close: 'Close', delete: 'Delete', remove: 'Remove', rename: 'Rename',
  edit: 'Edit', add: 'Add', create: 'Create', back: 'Back', next: 'Next', continue: 'Continue', done: 'Done',
  skip: 'Skip', change: 'Change', undo: 'Undo', redo: 'Redo', search: 'Search', filter: 'Filter', clear: 'Clear',
  copy: 'Copy', copied: 'Copied', open: 'Open', more: 'More', none: 'None', all: 'All', yes: 'Yes', no: 'No',
  tryAgain: 'Try again', retrying: 'Retrying…', loading: 'Loading…', working: 'Working…', saving: 'Saving…', saved: 'Saved',
  untitled: 'Untitled', optional: 'optional', you: 'you', youSuffix: '{name} (you)', show: 'Show', hide: 'Hide',
  dismiss: 'Dismiss', showInFolder: 'Show in folder', openWithSystem: 'Open with the system app', paste: 'Paste',
  chooseFile: 'Choose a file…', chooseFolder: 'Choose a folder…', learnMore: 'Why this matters',
  onlyYou: 'Only you', sharedWithClass: 'Shared with the class', onlyThisComputer: 'Only on this computer',
  arriving: 'Arriving…', arrivingPercent: 'Arriving… {percent} %',
  unknownError: 'Something went wrong: {message}',
  size: { b: '{n} B', kb: '{n} KB', mb: '{n} MB', gb: '{n} GB' },
  duration: { hm: '{h} h {m} min', m: '{m} min', s: '{s} s' },
  count: {
    files: { one: '{n} file', other: '{n} files' },
    pages: { one: '{n} page', other: '{n} pages' },
    slides: { one: '{n} slide', other: '{n} slides' },
    members: { one: '{n} member', other: '{n} members' },
    requests: { one: '{n} request', other: '{n} requests' },
    questions: { one: '{n} question', other: '{n} questions' },
    lectures: { one: '{n} lecture', other: '{n} lectures' },
    documents: { one: '{n} document', other: '{n} documents' },
  },
  relative: {
    today: 'today', tomorrow: 'tomorrow', yesterday: 'yesterday',
    inDays: { one: 'in {n} day', other: 'in {n} days' },
    daysAgo: { one: '{n} day ago', other: '{n} days ago' },
    minAgo: { one: '{n} min ago', other: '{n} min ago' },
  },
};
```

### 5.2 `app` (shell, rail, top bar, dock wording, palette commands, shortcuts, crash)
```ts
export const app = {
  windowTitle: '{screen} · {class} · Tramado',
  windowTitleShort: '{screen} · Tramado',
  rail: {
    label: 'Main navigation',
    search: 'Search everything',
    today: 'Today',
    classes: 'Classes',
    classesLabel: 'Classes',
    newClass: 'New class',
    join: 'Join a class',
    archive: 'Archive ({n})',
    settings: 'Settings',
    collapse: 'Collapse sidebar',
    expand: 'Expand sidebar',
    version: 'Version {version}',
    classStatus: {
      recording: 'recording now',
      mentions: { one: '{n} mention', other: '{n} mentions' },
      unread: { one: '{n} unread message', other: '{n} unread messages' },
      syncing: 'syncing',
      problem: 'needs attention',
      local: 'only on this computer',
    },
    classMenu: {
      open: 'Open', record: 'Record a lecture', invite: 'Invite classmates…', share: 'Share this class…',
      moveUp: 'Move up', moveDown: 'Move down', markRead: 'Mark all as read', settings: 'Class settings…', archive: 'Archive', unarchive: 'Unarchive',
    },
  },
  example: {
    ribbon: 'You’re looking at an example class library. Nothing here is real.',
    leave: 'Leave the example',
  },
  header: {
    back: 'Back',
    backTo: 'Back to {place}',
    breadcrumb: 'Breadcrumb',
    more: 'More',
    shortcuts: 'Keyboard shortcuts',
    sidePanel: 'Side panel',
  },
  dock: {
    label: 'Recording and background work',
    moreJobs: { one: '+{n} more', other: '+{n} more' },
  },
  drop: {
    documents: 'Drop to add to {class} → Documents',
    exam: 'Drop to add as an exam paper',
    lecture: 'Drop to add as a recording',
  },
  commands: {
    group: { navigate: 'Go to', create: 'Create', record: 'Recording', ai: 'AI', view: 'View', app: 'Tramado' },
    goToday: 'Go to Today',
    goClass: 'Go to {class}',
    goTab: '{tab} in {class}',
    goSettings: 'Open Settings',
    goSettingsSection: 'Settings › {section}',
    classNew: 'New class…',
    classJoin: 'Join a class…',
    classInvite: 'Invite classmates to {class}…',
    classShare: 'Share {class}…',
    recordStart: 'Record a lecture…',
    recordStop: 'Stop recording',
    recordPause: 'Pause recording',
    recordResume: 'Resume recording',
    recordMark: 'Mark “{kind}”',
    lectureImport: 'Add a recording…',
    docAdd: 'Add documents…',
    examAddDate: 'Add an exam date…',
    examAddPaper: 'Add an exam paper…',
    practiceClass: 'Practise {class}',
    noteNew: 'New note in {class}',
    askClass: 'Ask AI about {class}',
    askAll: 'Ask AI about all classes',
    themeSystem: 'Theme: System', themeLight: 'Theme: Light', themeDark: 'Theme: Dark',
    syncPause: 'Pause sharing', syncResume: 'Resume sharing',
    shortcuts: 'Keyboard shortcuts',
    diagnosticsCopy: 'Copy diagnostics',
    exampleLeave: 'Leave the example',
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    groups: { everywhere: 'Everywhere', recording: 'While recording', lecture: 'Lecture', document: 'Document', exam: 'Exam and practice', chat: 'Chat and Ask', lists: 'Lists' },
    palette: 'Search and commands',
    record: 'Start or stop recording',
    settings: 'Settings',
    today: 'Today',
    classN: 'Go to class 1–9',
    join: 'Join a class',
    back: 'Back',
    closeLayer: 'Close',
    undo: 'Undo', redo: 'Redo',
    help: 'This list',
    markers: 'Mark Important, Didn’t get it, Exam!, To do',
    note: 'Quick note',
    find: 'Find in this view',
    submit: 'Send or ask',
    globalMarkers: 'Markers from any app (if turned on)',
    playPause: 'Play or pause',
    skip5: 'Back or forward 5 seconds',
    skip30: 'Back or forward 30 seconds',
    speed: 'Slower or faster',
    follow: 'Follow along on or off',
    editTranscript: 'Edit the transcript',
    goToPage: 'Go to page',
    zoom: 'Zoom in or out',
    fitWidth: 'Fit width',
    reveal: 'Show answer',
    again: 'Again',
    gotIt: 'Got it',
    nextQuestion: 'Next or previous question',
    newline: 'New line',
    notInText: 'These keys work when you’re not typing in a field.',
  },
  crash: {
    title: 'Something went wrong',
    body: 'Tramado hit a problem it couldn’t recover from. Your classes are safe: they are ordinary files. Reload to continue. If it happens again, copy the details and report it.',
    reload: 'Reload',
    copy: 'Copy details',
    copied: 'Details copied.',
  },
  missing: {
    lecture: 'This lecture isn’t here any more.',
    document: 'This document isn’t here any more.',
    exam: 'This exam isn’t here any more.',
    note: 'This note isn’t here any more.',
    class: 'This class isn’t on this computer any more.',
    body: 'It may have been deleted or moved by a classmate.',
    recentlyDeleted: 'Recently deleted…',
  },
  close: {
    recordingTitle: 'Stop and save the recording first?',
    recordingBody: 'Tramado is recording {class}. If you quit now, the recording is kept and you can save it next time.',
    stopAndSave: 'Stop and save',
    keepRecording: 'Keep recording',
    trayNotice: 'Tramado is still running in the background, sharing your classes. Quit from the tray icon.',
    trayNoticeRecording: 'Still recording {class} in the background.',
  },
  // notification texts are in the `notify` namespace (§5.22)
};
```

### 5.3 `sync`
```ts
export const sync = {
  pill: {
    local: 'Only on this computer',
    starting: 'Starting sharing…',
    error: 'Sharing isn’t running',
    paused: 'Sharing paused',
    attention: { one: '{n} needs attention', other: '{n} need attention' },
    offline: 'Offline',
    syncing: { one: 'Syncing {n} file', other: 'Syncing {n} files' },
    syncingUnknown: 'Syncing…',
    waiting: 'Waiting for classmates',
    upToDate: 'Up to date · {n} online',
    upToDateNone: 'Up to date',
    waitingTooltip: 'No one from your classes is online. Changes are saved here and will sync later.',
  },
  popover: {
    title: 'Sharing',
    pause: 'Pause sharing',
    pauseHint: 'Nothing is sent or received until you resume.',
    settings: 'Sharing settings',
    diagnostics: 'Diagnostics',
    classUpToDate: 'Up to date · {n} online',
    classSyncing: 'Syncing {files} · {size} left',
    classWaiting: 'Waiting for classmates',
    classRelay: 'Connected through a relay (slow)',
    classPaused: 'Paused',
    classMissing: 'Can’t find the folder',
    windowsName: { one: '{n} file can’t be saved on Windows computers', other: '{n} files can’t be saved on Windows computers' },
  },
  error: {
    notRunning: 'Sharing isn’t running, so your classes aren’t syncing. Everything still works on this computer.',
    locked: 'Another copy of Tramado is using the sharing data. Close it and try again.',
    port: 'Another program is using the port Tramado needs. Tramado will try a different one.',
    retry: 'Try again',
    details: 'Details',
  },
  firstShare: {
    title: 'Keep sharing when you close the window?',
    body: 'Your classmates get recordings and transcripts from you faster when Tramado keeps running in the background. It uses very little power.',
    tray: 'Keep sharing in the background',
    trayMac: 'Keep sharing in the background (in the Dock)',
    autostart: 'Start Tramado when I log in',
  },
  massDelete: {
    title: 'Did you mean to delete {n} files from {class} for everyone?',
    body: 'Files were deleted in the {class} folder outside Tramado. Sharing for this class is paused, so nothing has been sent yet.',
    restore: 'Restore the files',
    confirm: 'Yes, delete them for everyone',
    restored: 'Files restored. Sharing resumed.',
  },
  folderMissing: {
    title: 'Tramado can’t find the folder for {class}.',
    body: 'Was it moved or deleted?',
    find: 'Find it…',
    freshCopy: 'Get a fresh copy from classmates',
    remove: 'Remove from Tramado',
  },
  recentlyDeleted: {
    title: 'Recently deleted in {class}',
    intro: 'Files deleted in the last 30 days. Restoring a file brings it back for everyone.',
    file: 'File', deleted: 'Deleted', size: 'Size',
    restore: 'Restore',
    restored: 'Restored “{file}” for everyone.',
    empty: 'Nothing deleted in the last 30 days.',
  },
  windowsName: {
    notice: '“{name}” can’t be saved on Windows computers. Rename it.',
    rename: 'Rename…',
  },
  deleteForEveryone: {
    undoToast: 'Deleted “{name}” for everyone.',
    undone: 'Restored “{name}”.',
  },
};
```

### 5.4 `onboarding`
```ts
export const onboarding = {
  step: 'Step {n} of 4',
  welcome: {
    headline: 'Your classes, [m]all in one place[/m]',
    lead: 'Record and transcribe lectures, keep every handout and law text together, share them with your class, and practise for exams with an AI that shows where each answer comes from.',
    start: 'Get started',
    example: 'Try the example',
    promise: {
      accountTitle: 'No account', account: 'Nothing to sign up for.',
      foldersTitle: 'Plain folders', folders: 'Your classes are ordinary folders on your computer.',
      aiTitle: 'Your AI key, or none', ai: 'Bring a free OpenRouter key, or skip AI.',
    },
    language: 'Language',
    footnote: 'No account. Nothing leaves this computer until you share a class or turn on AI.',
  },
  name: {
    title: 'What should classmates call you?',
    label: 'Name',
    placeholder: 'e.g. Ana Ribeiro',
    hint: 'Shown next to your messages and recordings in classes you share. You can change it later.',
    device: 'This computer will appear as “{device}”.',
    deviceLabel: 'This computer’s name',
    deviceLaptop: '{name}’s laptop',
    deviceComputer: '{name}’s computer',
    folder: 'Your classes are kept in {path}',
    folderChange: 'Change…',
    cloudWarning: 'This folder is synced by {service}. Two sync tools on the same files cause conflicts. Choose a folder outside it.',
    cloudChoose: 'Choose another folder',
    required: 'Enter a name classmates will recognise.',
  },
  ai: {
    title: 'AI help (optional)',
    body: 'Tramado can answer exam questions from your own classes, explain a passage, summarise a lecture and find things in your documents. It uses OpenRouter with your own key, and free models work.',
    keyLabel: 'OpenRouter key',
    getKey: 'Get a free key at openrouter.ai/keys',
    age: 'OpenRouter is for people aged 18 or over. If you are younger, skip this: everything else in Tramado works without AI. You can also connect a local AI later in Settings.',
    privacy: 'When you ask the AI something, your question and the passages it needs go to OpenRouter and the company running the model. Tramado asks only for providers that don’t train on what you send.',
    test: 'Test and save',
    skip: 'Skip for now',
    checking: 'Checking your key…',
    ok: 'Works. {model} is your model, and you have {n} free requests left today.',
    okBusy: 'Your key works. The free model is busy right now (that’s common). Tramado will try {fallback} when that happens.',
    bad: 'OpenRouter didn’t accept this key. Check that you copied all of it (it starts with “sk-or-”).',
    offline: 'You seem to be offline. The key is saved; Tramado will check it when you’re online.',
  },
  ready: {
    title: 'You’re set, {name}.',
    createTitle: 'Create a class',
    create: 'Start a class for a subject you’re taking.',
    joinTitle: 'Join a class',
    join: 'Paste an invite a classmate sent you.',
    model: 'The speech model for transcribing lectures ({size}) downloads the first time you need it.',
    finish: 'Go to Today',
  },
};
```

### 5.5 `today`
```ts
export const today = {
  title: 'Today',
  greeting: { morning: 'Good morning, {name}', afternoon: 'Good afternoon, {name}', evening: 'Good evening, {name}' },
  checklist: {
    title: 'Getting started',
    classes: 'Create or join a class',
    lecture: 'Record or add a lecture',
    document: 'Add a document',
    exam: 'Add an exam date',
    dismiss: 'Hide the checklist',
    whichClass: 'In which class?',
  },
  exams: {
    title: 'Coming up',
    today: 'Today, {time}',
    tomorrow: 'Tomorrow, {time}',
    inDays: { one: 'In {n} day · {date}', other: 'In {n} days · {date}' },
    practise: 'Practise ({n})',
  },
  transcriptions: {
    title: 'Transcriptions',
    idle: 'This computer: idle',
    local: 'This computer: {lecture} · {percent} %',
    other: '{device} · {lecture} · {percent} %',
    waiting: { one: '{n} waiting for a transcriber', other: '{n} waiting for a transcriber' },
    here: 'Transcribe it here',
  },
  lectures: { title: 'Recent lectures' },
  unread: {
    title: 'Unread',
    summary: { one: '{n} message', other: '{n} messages' },
    pins: { one: '{n} new pin', other: '{n} new pins' },
    mentions: { one: '{n} mention', other: '{n} mentions' },
  },
  empty: {
    title: 'Welcome, {name}.',
    body: 'A class holds one subject’s lectures, documents, exams and notes, and can be shared with classmates.',
    create: 'Create a class',
    join: 'Join a class',
  },
  clear: { title: 'All clear for today.', body: 'No exams in the next 3 weeks and nothing waiting.' },
};
```

### 5.6 `classes`
```ts
export const classes = {
  dialog: {
    newTitle: 'New class',
    settingsTitle: 'Class settings',
    name: 'Name', namePlaceholder: 'e.g. Teoria Geral do Direito Civil',
    nameTaken: 'You already have a class called “{name}”.',
    short: 'Short name', shortHint: 'Used in chat, notifications and tight spaces.',
    colour: 'Colour',
    icon: 'Icon', iconSuggested: 'Suggested',
    lecturer: 'Lecturer', term: 'Term', termPlaceholder: '2026/27 · Semester 1',
    language: 'Language spoken in lectures', languageHint: 'Used for transcripts and AI answers.',
    languageAuto: 'Detect automatically',
    share: 'Share with classmates',
    shareOn: 'Classmates you invite get the lectures, documents, class notes and chat. Your own notes, highlights and practice stay on your computer.',
    shareOff: 'Only on this computer. You can share it later.',
    vocabulary: 'Vocabulary for transcripts',
    vocabularyHint: 'Names and terms the lecturer uses (for example: Gomes Canotilho, quid iuris). Tramado passes them to the speech model so it spells them right.',
    askBeforeJoin: 'Ask before letting people in',
    askBeforeJoinHint: 'Members’ computers will wait for someone to click Let in. Off: anyone with the invite joins.',
    skipAudio: 'Skip audio files on this computer',
    skipAudioHint: 'You still get every transcript. Saves about 11 MB per lecture hour.',
    notify: 'Notifications',
    danger: 'Leave or delete',
    create: 'Create class',
  },
  colours: { red: 'Red', orange: 'Orange', amber: 'Amber', lime: 'Lime', green: 'Green', teal: 'Teal', sky: 'Sky blue', blue: 'Blue', violet: 'Violet', purple: 'Purple', pink: 'Pink', graphite: 'Graphite' },
  icons: {
    scale: 'Scales (law)', gavel: 'Gavel', landmark: 'Building with columns', calculator: 'Calculator', sigma: 'Sigma (statistics)', pi: 'Pi',
    'chart-line': 'Line chart', 'flask-conical': 'Flask', atom: 'Atom', dna: 'DNA', microscope: 'Microscope', stethoscope: 'Stethoscope',
    'heart-pulse': 'Heartbeat', brain: 'Brain', code: 'Code', cpu: 'Processor', palette: 'Palette', music: 'Music',
    'drafting-compass': 'Compass', 'pencil-ruler': 'Pencil and ruler', globe: 'Globe', earth: 'Earth', languages: 'Languages',
    'book-open': 'Open book', library: 'Library', 'book-marked': 'Bookmarked book', 'briefcase-business': 'Briefcase',
    'building-2': 'Building', leaf: 'Leaf', utensils: 'Cutlery', hammer: 'Hammer', lightbulb: 'Light bulb', 'graduation-cap': 'Graduation cap',
  },
  tabs: {
    label: 'Class sections',
    lectures: 'Lectures', documents: 'Documents', notes: 'Notes', exams: 'Exams', chat: 'Chat', ask: 'Ask', members: 'Members', share: 'Share',
  },
  header: {
    members: { one: '{n} member', other: '{n} members' },
    invite: 'Invite',
    share: 'Share',
    record: 'Record lecture',
    recordBusy: 'Already recording {class}',
    add: 'Add',
    addDocuments: 'Add documents…',
    addRecording: 'Add a recording…',
    addExamDate: 'Add an exam date…',
    addExamPaper: 'Add an exam paper…',
    addNote: 'New note',
    addClassNote: 'New class note',
    more: {
      settings: 'Class settings…', invite: 'Invite classmates…', share: 'Share this class…', notifications: 'Notifications',
      recentlyDeleted: 'Recently deleted…', openFolder: 'Open folder', archive: 'Archive', unarchive: 'Unarchive',
      leave: 'Leave class…', delete: 'Delete class…',
    },
    notify: { important: 'Mentions and important', all: 'Every message', none: 'Nothing' },
  },
  countdown: {
    today: '{title} · today, {time}',
    tomorrow: '{title} · tomorrow, {time}',
    inDays: { one: '{title} · in {n} day', other: '{title} · in {n} days' },
    onDate: '{title} · {date}',
  },
  pins: {
    label: 'Pinned messages',
    by: '— {name}',
    more: { one: '{n} more', other: '{n} more' },
    hide: 'Hide pins until there’s a new one',
  },
  digest: {
    title: 'Since you were last here',
    lectures: { one: '{n} new lecture', other: '{n} new lectures' },
    documents: { one: '{n} new document', other: '{n} new documents' },
    pins: { one: '{n} pin', other: '{n} pins' },
    examChanged: 'exam date changed',
    mentions: { one: '{n} mention', other: '{n} mentions' },
  },
  inviteCard: {
    title: 'Invite your classmates',
    body: 'Send one invite to your class group. Everyone who joins gets the lectures, transcripts, documents and chat.',
    action: 'Invite classmates',
  },
  shareTab: {
    title: 'This class is only on this computer.',
    body: 'Share it to get a class chat, shared documents and transcripts. Your own notes and practice stay private.',
    action: 'Share this class',
  },
  leave: {
    title: 'Leave {class}?',
    body: 'You stop getting updates. Your copy stays on this computer unless you delete it below. What you added stays with your classmates; remove it before leaving if you want it gone.',
    deleteCopy: 'Also delete my copy from this computer',
    confirm: 'Leave class',
    done: 'You left {class}.',
  },
  delete: {
    title: 'Delete {class}?',
    body: 'This deletes the folder and everything in it from this computer. This can’t be undone.',
    typePrompt: 'Type the class name to confirm',
    confirm: 'Delete class',
  },
  archived: '{class} moved to Archive.',
  unarchived: '{class} is back in your classes.',
  organiserGone: {
    notice: 'Nobody organises this class any more.',
    action: 'Become an organiser',
  },
  pickClass: { recordTitle: 'Record a lecture in which class?', title: 'Which class?' },
};
```

### 5.7 `lectures`
```ts
export const lectures = {
  list: {
    record: 'Record lecture',
    import: 'Add a recording…',
    filter: 'Filter lectures',
    thisWeek: 'This week', lastWeek: 'Last week', weekOf: 'Week of {date}',
    meta: '{date} · {duration} · {who}',
    modeRoom: 'In the room', modeOnline: 'Online',
    recordingNow: 'Recording now — {time}',
    transcriptOnly: 'Recording only on {name}’s computer',
    duplicateOf: 'Duplicate of {title}',
    noMatch: 'No lectures match “{q}”.',
    empty: {
      title: 'No lectures yet.',
      body: 'Record the next one, or add a recording you already have (an audio or video file).',
      record: 'Record lecture',
      import: 'Add a recording',
    },
    menu: {
      open: 'Open', rename: 'Rename…', renameOnlyRecorder: 'Only {name}’s computer can rename it',
      transcribe: 'Transcribe…', retranscribe: 'Re-transcribe…', duplicate: 'Mark as duplicate of…',
      deleteAudio: 'Delete the recording, keep the transcript…', deleteAll: 'Delete for everyone…',
      removeLocal: 'Remove from this computer only…', showInFolder: 'Show in folder',
    },
    retranscribeConfirm: { title: 'Transcribe “{title}” again?', body: 'This replaces the transcript for everyone in {class}. Corrections made to the current one are lost.', confirm: 'Transcribe again' },
    deleteAudioConfirm: { title: 'Delete the recording of “{title}”?', body: 'The recording is removed for everyone in {class}. The transcript stays.', confirm: 'Delete the recording' },
    deleteConfirm: { title: 'Delete “{title}” for everyone in {class}?', body: 'The recording, its transcript and corrections are removed from every classmate’s computer. You can restore them for 30 days from Recently deleted.', confirm: 'Delete for everyone', local: 'Remove from this computer only' },
  },
  view: {
    subtitle: '{date} · {duration} · recorded by {who}',
    ask: 'Ask about this lecture',
    more: {
      copyLink: 'Copy link to this moment', linkCopied: 'Link copied.',
      speakers: 'Speakers…', export: 'Export transcript', exportMd: 'Markdown (.md)', exportVtt: 'Subtitles (.vtt)', exportTxt: 'Plain text (.txt)',
    },
    newer: 'Made with a newer Tramado — update to edit it.',
    stale: 'The recording changed after this transcript was made. Times may be off.',
    titleSuggestion: 'Suggested title: “{title}”',
    useTitle: 'Use it',
  },
  player: {
    label: 'Player',
    play: 'Play', pause: 'Pause',
    back10: 'Back 10 seconds', forward10: 'Forward 10 seconds',
    time: '{current} of {total}',
    timeEdit: 'Go to time',
    speed: 'Speed: {rate}×',
    volume: 'Volume',
    follow: 'Follow along',
    noAudio: {
      transcriptOnly: 'The recording stays on {name}’s computer (they shared the transcript only).',
      deleted: 'The recording was deleted on {date}; the transcript is kept.',
      skipped: 'You chose to skip audio files in this class.',
      getIt: 'Get the recording',
      arriving: 'The recording is still arriving ({percent} %).',
    },
    fallback: 'Playing through a slower fallback.',
  },
  timeline: {
    label: 'Timeline',
    value: '{current} of {total}',
    citedHere: 'Cited moment',
  },
  transcript: {
    label: 'Transcript',
    playFrom: 'Play from {time}',
    backTo: 'Back to {time}',
    find: 'Find in transcript',
    findCount: '{i} of {n}',
    findNone: 'No matches',
    edit: 'Edit',
    editDone: 'Done editing',
    editNotice: 'Your corrections are shared with the class.',
    editNoticeLocal: 'Your corrections are saved on this computer.',
    segmentMenu: 'Line options',
    changeSpeaker: 'Change speaker',
    splitHere: 'Split here',
    mergeNext: 'Merge with next',
    correctedBy: 'Corrected by {name}',
    clash: 'Two corrections met here; check this line.',
    keepThis: 'Keep this one',
    speakerLecture: 'Lecturer', speakerMe: 'Me', speakerClass: 'Class',
  },
  selection: {
    label: 'Selected text',
    highlight: 'Highlight',
    comment: 'Comment',
    commentHint: 'Only you can see this comment.',
    explain: 'Explain',
    ask: 'Ask…',
    copy: 'Copy with source',
    copied: 'Copied with its source.',
    highlightKinds: { important: 'Important', confused: 'Didn’t get it', exam: 'Exam', todo: 'To do', other: 'Other' },
  },
  side: {
    label: 'Lecture side panel',
    notes: 'Notes', ai: 'AI', markers: 'Markers',
    myNotes: 'My notes · only you',
    addNote: 'Note at {time}',
    openNotes: 'Open in Notes',
    noNotes: 'No notes for this lecture yet. Press N to add one at the current time.',
    markersEmpty: 'No markers yet. Press 1–4 while it plays to mark a moment.',
    found: 'Found in the transcript',
    foundHint: 'Moments where the lecturer said something like “this will be on the exam”.',
    removeAuto: 'Remove',
  },
  ai: {
    summary: 'Summary',
    summaryRun: 'Summarise this lecture',
    terms: 'Key terms',
    termsRun: 'Find key terms',
    regenerate: 'Regenerate',
    saveAsNote: 'Save as note',
    savedAsNote: 'Saved to your notes.',
    explainTitle: 'Explain',
    explainChips: { simpler: 'Simpler', detail: 'More detail', example: 'Give an example', inLanguage: 'Explain in {language}', exam: 'How could this come up in an exam?' },
    off: 'AI isn’t set up.',
    setUp: 'Set up AI',
  },
  transcription: {
    waitingAudio: 'The recording is still arriving ({percent} %). Transcription can start when it’s complete.',
    none: '[b]Waiting for a transcriber.[/b] Anyone in the class can transcribe this lecture once, for everyone.',
    noneLocal: 'This lecture has no transcript yet.',
    claimed: '[b]{device} is transcribing — {percent} %[/b] · {left}',
    slow: '{device} is transcribing — {percent} % · last update {n} min ago (it may be asleep or offline)',
    arriving: 'Finished on [b]{device}[/b] — waiting for the transcript to arrive.',
    arrivingHolder: '{name}’s computer has it.',
    duplicate: 'Probably the same lecture as “{title}”.',
    markDuplicate: 'Mark as duplicate',
    transcribeAnyway: 'Transcribe anyway',
    untrusted: 'This transcript was changed by a computer that isn’t its owner. It isn’t shown.',
    stale: '[b]{device} stopped[/b] at {percent} %, {n} min ago.',
    local: 'Transcribing on this computer — {percent} % · {left}. You can keep working. Plug in if you can.',
    localModel: 'Downloading the speech model first — {done} of {total}',
    done: 'Transcribed by [b]{device}[/b] · {model} · {date}',
    doneSelf: 'Transcribed on this computer · {model} · {date}',
    failed: 'Transcription failed on {device}: {reason}.',
    unavailableTranscriptOnly: 'The recording stays on {name}’s computer, so it can only be transcribed there.',
    unavailableDeleted: 'The recording was deleted before it was transcribed.',
    here: 'Transcribe on this computer',
    cloud: 'With OpenRouter…',
    notify: 'Notify me when it’s ready',
    notifyOn: 'You’ll be notified',
    takeover: 'Take over on this computer',
    pause: 'Pause', resume: 'Resume',
    release: 'Stop and let someone else do it',
    thank: 'Thank {name}',
    thanked: 'Thanked',
    tryHere: 'Try on this computer',
    ready: 'The transcript of “{lecture}” is ready.',
    chip: { none: 'Waiting', waitingAudio: 'Arriving', claimed: '{percent} %', local: '{percent} % here', done: 'Transcript', failed: 'Failed', stale: 'Stopped' },
    left: {
      underMinute: 'less than a minute left',
      minutes: { one: 'about {n} minute left', other: 'about {n} minutes left' },
      hours: 'about {h} h {m} min left',
    },
    dockLocal: 'Transcribing “{lecture}” on this computer · {percent} % · {left}',
    dockConverting: 'Converting “{file}”… {percent} %',
  },
};
```
### 5.8 `record`
```ts
export const record = {
  pickClass: 'Record a lecture in which class?',
  dialog: {
    title: 'Record a lecture in {class}',
    where: 'Where is the lecture?',
    room: 'In the room',
    roomHint: 'Uses this computer’s microphone. Sit near the front, close to the lecturer or a loudspeaker.',
    online: 'Online',
    onlineHint: 'Records what your computer plays (Zoom, Teams, Meet, Colibri…).',
    includeMe: 'Also record me (for my questions)',
    headphones: 'Wear headphones, so the lecture isn’t recorded twice.',
    language: 'Language spoken',
    device: 'Microphone',
    deviceDefault: 'Default — {name}',
    permission: 'Permission',
    onRecord: 'Lecturer’s permission on record: {scope} — confirmed by {name} on {date}.',
    onRecordScopeBoth: 'recording and sharing',
    onRecordScopeRecord: 'recording',
    consent: { v1: 'The lecturer agreed to this lecture being recorded.' },   // key = ConsentLine.textId (versioned)
    consentOnline: 'Say at the start that you are recording.',
    shareTitle: 'Share with the class',
    shareBoth: 'Recording and transcript',
    shareTranscript: 'Transcript only (the recording stays on this computer)',
    shareNone: 'Nothing yet — I’ll decide after',
    shareKeepLocal: 'Keep on this computer for now',
    consentShare: { v1: 'The lecturer agreed to sharing it with this class group.' },
    remember: 'Remember for this class',
    rememberHint: 'Saves a note that the lecturer agreed, visible to everyone in Members.',
    lawHint: 'In Portugal and Spain, recording someone without their consent, or using a recording for more than they agreed to, can be against the law. Ask at the start of the first lecture: most lecturers say yes for study. Your classmates are recorded too when they ask questions.',
    start: 'Start recording',
    startNeedsConsent: 'Tick the lecturer’s permission first.',
    startNeedsShareConsent: 'Tick the permission to share, or choose “Nothing yet”.',
    presence: '[b]{name} is already recording this lecture[/b] (since {time}, {mode}). Only one recording is transcribed for the class.',
    presenceRoom: 'in the room', presenceOnline: 'online',
    presenceAnyway: 'Record anyway, as a backup',
    presenceCancel: 'Don’t record',
    noDisk: 'There isn’t enough free space to record ({free} left).',
    noSystemAudio: 'Tramado can’t record your computer’s sound on this system: {reason}.',
    micOnly: 'Record mic only (in the room)',
    lowBattery: 'On battery, {percent} % left. Plug in if you can.',
    permissionDenied: 'Tramado isn’t allowed to use the microphone. Allow it in {place}, then try again.',
    permissionPlaceMac: 'System Settings › Privacy & Security › Microphone',
    permissionPlaceWindows: 'Settings › Privacy & security › Microphone',
    openSettings: 'Open settings',
  },
  why: 'Portuguese law (Código Penal, art. 199.º) makes it a crime to record words not meant for the public without consent, and also to use a lawful recording beyond what was agreed. Spain protects people’s voice and lectures in a similar way, and lectures are protected works in both countries. So Tramado asks for two separate permissions: to record, and to share with your class group. This is not legal advice; your university may have its own rules.',
  dock: {
    region: 'Recording',
    rec: 'REC',
    paused: 'Paused',
    starting: 'Starting…',
    saving: 'Saving the recording…',
    mic: 'Mic', computer: 'Computer',
    micLevel: 'Microphone level',
    computerLevel: 'Computer sound level',
    pause: 'Pause', resume: 'Resume', stop: 'Stop',
    noteLabel: 'Note at {time}…',
    noteSaved: 'Note saved at {time}.',
    marked: 'Marked “{kind}” at {time}.',
    silence: 'We can’t hear anything. Is the microphone muted?',
    check: 'Check',
    battery: 'On battery: about {h} h left. Plug in if the lecture runs long.',
    lowDisk: 'Your disk is almost full. Recording stops if it fills up.',
    micOff: 'Your microphone is not being recorded: {reason}',
    systemOff: 'The computer’s sound is not being recorded: {reason}',
    failed: 'The recording stopped: {reason}. What was recorded is kept.',
    saveWhatWasRecorded: 'Save what was recorded',
    announce: { started: 'Recording started', paused: 'Recording paused', resumed: 'Recording resumed', saved: 'Recording saved' },
  },
  markers: {
    important: 'Important',
    confused: 'Didn’t get it',
    exam: 'Exam!',
    todo: 'To do',
    note: 'Note',
    auto: 'Found automatically',
  },
  save: {
    title: 'Save lecture',
    name: 'Title',
    defaultTitle: 'Lecture {n} — {date}',
    transcript: 'Transcript',
    local: 'Transcribe on this computer',
    localHint: 'About {time}.',
    localHintModel: 'About {time}; downloads the speech model first ({size}).',
    classmate: 'Let a classmate’s computer do it',
    cloud: 'With OpenRouter',
    cloudHint: 'Paid, about 2 cents; the audio is sent to OpenRouter.',
    cloudOff: 'Turn this on in Settings › Transcription.',
    none: 'Not now',
    share: 'Share',
    save: 'Save',
    discard: 'Discard recording…',
    discardConfirm: { title: 'Delete this recording?', body: 'It hasn’t been shared with anyone.', confirm: 'Delete it' },
    saved: 'Saved “{title}”.',
  },
  recover: {
    title: 'A recording was interrupted',
    body: 'A recording of {class} stopped unexpectedly at {time} ({date}).',
    keep: 'Keep what was recorded',
    delete: 'Delete it',
    deleteConfirm: 'Delete the interrupted recording? This can’t be undone.',
  },
  import: {
    title: 'Add a recording to {class}',
    file: 'File',
    name: 'Title',
    date: 'Date', time: 'Time',
    language: 'Language',
    keepVideo: 'Keep the video too (adds about {size} to the class)',
    useVtt: 'This file already has subtitles: use “{file}” as the transcript',
    permission: 'I’m allowed to share this recording with the class.',
    confirm: 'Add recording',
    looksLikeRecording: '“{file}” looks like a recording. Add it as a lecture?',
    asLecture: 'Add as a lecture',
    asDocument: 'Add as a document',
  },
};
```

### 5.9 `documents`
```ts
export const documents = {
  tab: {
    add: 'Add documents…',
    newFolder: 'New folder',
    newFolderName: 'Folder name',
    filter: 'Filter documents',
    view: { folders: 'Folders', recent: 'Recent' },
    columns: { name: 'Name', pages: 'Pages', addedBy: 'Added by', date: 'Date', text: 'Text for search & AI' },
    privateSection: 'Only on this computer',
    emptyFolder: 'This folder is empty.',
    empty: {
      title: 'Drop slides, readings and legislation here.',
      body: 'PDF, Word, PowerPoint, text and images. Tramado reads them so you can search and ask about them.',
      action: 'Add documents',
    },
  },
  text: {
    searchable: 'Searchable',
    reading: 'Reading text… {percent} %',
    scan: 'Scan — no text',
    somePages: { one: '{n} page without text', other: '{n} pages without text' },
    failed: 'Can’t read this file',
  },
  adding: {
    progress: { one: 'Adding {n} file… Reading text for search and AI ({i} of {n})', other: 'Adding {n} files… Reading text for search and AI ({i} of {n})' },
    done: { one: 'Added {n} file to {class}.', other: 'Added {n} files to {class}.' },
    duplicate: '{name} already added “{file}” on {date}.',
    duplicateSelf: 'You already added “{file}” on {date}.',
    openTheirs: 'Open theirs',
    addAnyway: 'Add anyway',
  },
  folders: {
    suggest: 'Organise with folders?',
    create: 'Create these',
    noThanks: 'No thanks',
    slides: 'Slides', readings: 'Readings', legislation: 'Legislation', pastExams: 'Past exams', other: 'Other',
    fromChat: 'From chat',
    lectures: 'Lectures', documents: 'Documents', exams: 'Exams', notes: 'Notes',
  },
  menu: {
    open: 'Open', openSystem: 'Open with the system app', showInFolder: 'Show in folder', rename: 'Rename…', moveTo: 'Move to',
    makePrivate: 'Keep private (only you)…', ocr: 'Read the text with AI…', removeLocal: 'Remove from this computer only…',
    delete: 'Delete for everyone…',
  },
  makePrivate: {
    title: 'Make “{file}” private?',
    body: 'It moves out of the class folder into Tramado’s private storage on this computer, so it is removed for everyone else in {class}.',
    confirm: 'Make private',
    done: '“{file}” is now only on this computer.',
  },
  deleteConfirm: {
    title: 'Delete “{file}” for everyone in {class}?',
    body: 'It’s removed from every classmate’s computer. You can restore it for 30 days from Recently deleted.',
    confirm: 'Delete for everyone',
    local: 'Remove from this computer only',
  },
  removeLocal: {
    title: 'Remove “{file}” from this computer only?',
    body: 'Classmates keep it. It won’t come back to this computer unless you undo this in the class settings.',
    confirm: 'Remove from this computer',
  },
  view: {
    subtitle: '{type} · {count} · added by {name} · {date}',
    ask: 'Ask about this document',
    openWith: 'Open with…',
    articles: 'Articles',
    outline: 'Contents',
    page: 'Page',
    pageOf: '{n} / {total}',
    prev: 'Previous page', next: 'Next page',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit width',
    find: 'Find in document',
    side: { highlights: 'Highlights', ask: 'Ask', info: 'Info' },
    highlightsEmpty: 'Select text to highlight it. Highlights are only on this computer.',
    info: { type: 'Type', size: 'Size', location: 'Location', hash: 'Fingerprint', text: 'Text for search', addedBy: 'Added by' },
    quoteMissing: 'The exact passage wasn’t found on this page.',
    moved: 'This file was moved to {path}.',
    changed: 'This file changed after the answer that cites it was written. The passage was found again by its text.',
    changedLost: 'This file changed after the answer that cites it was written, and the passage couldn’t be found again.',
    arriving: 'This file is still arriving from {name}… {percent} %',
    error: 'This PDF couldn’t be opened: {reason}.',
    unsupported: 'Tramado can’t show this file.',
    slide: 'Slide {n}',
    describe: 'Describe with AI',
    scan: 'This PDF is a scanned image, so search and AI can’t read it yet.',
    ocr: { one: 'Read the text with AI ({n} request)', other: 'Read the text with AI ({n} requests)' },
    ocrTooLong: 'It’s too long to read with AI (more than 20 pages). Reading scans on this computer is coming in a later version.',
    ocrProgress: 'Reading page {i} of {n} with AI…',
    ocrDone: 'The text of “{file}” can now be searched.',
    copySource: '“{text}” — {file}, p. {page}',
    copySourceArticle: '“{text}” — {file}, art. {article}, p. {page}',
  },
};
```

### 5.10 `notes`
```ts
export const notes = {
  new: 'New note',
  newClass: 'New class note',
  filter: 'Filter notes',
  mine: 'My notes · only you',
  class: 'Class notes · shared with the class',
  edited: 'edited {when}',
  editing: '{name} is editing',
  status: { saving: 'Saving…', saved: 'Saved', failed: 'Couldn’t save: {reason}' },
  subtitleMine: 'Only you',
  subtitleClass: { one: 'Shared with the class · {n} member', other: 'Shared with the class · {n} members' },
  toolbar: {
    label: 'Formatting',
    bold: 'Bold', italic: 'Italic', heading: 'Heading', bullets: 'Bulleted list', checklist: 'Checklist', link: 'Link',
    insertTime: 'Insert a link to a lecture moment', insertDoc: 'Insert a link to a document page', preview: 'Preview',
  },
  insertTime: { title: 'Link to a lecture moment', lecture: 'Lecture', time: 'Time' },
  insertDoc: { title: 'Link to a document', document: 'Document', page: 'Page' },
  more: { toClass: 'Move to class notes…', toMine: 'Make private…', delete: 'Delete…', showInFolder: 'Show in folder' },
  toClass: { title: 'Share this note with everyone in {class}?', body: 'Classmates can read and edit it.', confirm: 'Share it' },
  toMine: { title: 'Move this note out of the class?', body: 'It’s removed for everyone else in {class}.', confirm: 'Make private' },
  deleteConfirm: { title: 'Delete “{title}”?', bodyMine: 'This can’t be undone.', bodyClass: 'It’s deleted for everyone in {class}. You can restore it for 30 days from Recently deleted.' },
  presence: '{name} is editing this note. Changes you both make at the same time may conflict.',
  conflict: {
    notice: 'Two versions of “{title}” were edited at the same time. Both are kept.',
    compare: 'Compare',
    title: 'Two versions of “{title}”',
    mine: 'This computer’s version',
    theirs: '{name}’s version',
    theirsUnknown: 'The other version',
    keepMine: 'Keep this one',
    keepTheirs: 'Keep the other',
    keepBoth: 'Keep both',
    copyName: '{title} ({name}’s copy)',
  },
  empty: {
    title: 'Your notes for {class}.',
    body: 'My notes are only on this computer. Class notes are shared with everyone in the class.',
  },
  lectureNoteTitle: 'Notes — {lecture}',
};
```

### 5.11 `exams`
```ts
export const exams = {
  kinds: { quiz: 'Quiz', test: 'Test', midterm: 'Midterm', final: 'Final exam', resit: 'Resit exam', special: 'Special sitting', oral: 'Oral exam', practice: 'Practice sheet' },
  questionKinds: { case: 'Case', essay: 'Essay', short: 'Short answer', multiple_choice: 'Multiple choice', true_false: 'True or false', comment: 'Comment', calculation: 'Calculation', other: 'Other' },
  points: { pt20: { one: '{n} valor', other: '{n} valores' }, es10: { one: '{n} punto', other: '{n} puntos' }, points: { one: '{n} point', other: '{n} points' } },
  tab: {
    add: 'Add',
    addDate: 'An upcoming test or exam',
    addPaper: 'An exam paper or practice questions',
    practiseClass: 'Practise {class} ({n})',
    comingUp: 'Coming up',
    papers: 'Exam papers',
    pastDates: 'Past dates',
    covers: 'Covers: {text}',
    paperMeta: '{kind} · {year} · {questions} · AI answers {a}/{n} · Practised {p}',
    finding: 'finding questions…',
    practise: 'Practise',
    dateMenu: { edit: 'Edit…', addPaper: 'Add the paper for this exam…', delete: 'Delete for everyone…' },
    integrity: 'For practice and past papers. Using AI during an actual test or exam is usually against the rules.',
    empty: {
      title: 'No exams yet.',
      body: 'Add the date of your next test to get a countdown, or add a past exam and practise it, with AI answers that point to your lectures.',
      addDate: 'Add an exam date',
      addPaper: 'Add an exam paper',
    },
  },
  date: {
    titleNew: 'Add an exam date',
    titleEdit: 'Edit exam date',
    kind: 'Kind', name: 'Name', date: 'Date', time: 'Time', room: 'Room', covers: 'What it covers', weight: 'Weight',
    weightPlaceholder: 'e.g. 40 %',
    note: 'Tramado counts down on Today and in the class header.',
    shared: 'Everyone in {class} sees this date.',
    saved: 'Added {title} on {date}.',
  },
  paper: {
    title: 'Add an exam paper or practice questions',
    drop: 'Drop a PDF, Word file or photo here',
    choose: 'Choose a file…',
    or: 'or',
    type: 'Type or paste the questions',
    name: 'Name', kind: 'Kind', year: 'Year',
    find: 'Find the questions',
    typeInstead: 'Type the questions',
    cost: 'Reading this uses about {n} AI requests ({pages} to read + 1 to find the questions). You have {left} free requests left today.',
    costText: 'Finding the questions uses 1 AI request. You have {left} free requests left today.',
    noAi: 'Finding the questions needs AI. You can type them in yourself instead.',
  },
  extracting: {
    title: 'Finding the questions in “{title}”',
    readingPage: 'Reading page {i} of {n} (with {model})',
    finding: 'Finding the questions',
    ready: 'Ready to check',
    typeInstead: 'Type the questions instead',
  },
  review: {
    title: { one: 'We found {n} question.', other: 'We found {n} questions.' },
    intro: 'Check them before the AI answers. Fix any that were split or merged.',
    rules: 'Rules found',
    addRule: 'Add',
    original: 'Original',
    number: 'Number', points: 'Points', kind: 'Type', text: 'Question',
    checkKind: 'Check the type',
    split: 'Split at cursor', merge: 'Merge with next', delete: 'Delete', up: 'Move up', down: 'Move down',
    group: 'Answer {n} of: {list}',
    editGroup: 'Edit group', ungroup: 'Ungroup', makeGroup: 'Make a “choose some” group',
    add: 'Add a question',
    dupNumber: 'Another question already has number {n}.',
    emptyText: 'Write the question’s text.',
    shared: 'Your corrections are shared with the class.',
    confirm: 'Looks right — answer them',
    save: 'Save without answers',
  },
  settings: {
    title: { one: 'Answer {n} question with AI', other: 'Answer {n} questions with AI' },
    from: 'Answer from',
    fromMaterials: 'Your class materials only',
    fromGeneral: 'Your materials, plus general knowledge (marked as unverified)',
    tryFirst: 'Try each question yourself first (recommended)',
    tryFirstHint: 'Answering before you look is what makes it stick.',
    existing: 'Answers already exist: by {name}, {model}, {date}.',
    useExisting: 'Use those',
    answerAgain: 'Answer again',
    cost: 'About {n} requests (1 to find search words + {q} answers) · {left} free left today · {model}',
    overQuota: 'That’s more than you have left today. Tramado will answer {left} now and the rest after {time}.',
    answerSome: 'Answer {n} now',
    start: { one: 'Answer {n} question', other: 'Answer {n} questions' },
  },
  answers: {
    eyebrow: 'Question {number} · {points} · {kind}',
    list: 'Questions',
    status: { none: 'Not answered', ai: 'AI answered', warn: 'Check the AI answer', right: 'Right', partly: 'Partly right', wrong: 'Wrong', unsure: 'Not sure' },
    progress: 'Answering… {i} of {n}',
    perMinute: 'Too many requests in a minute. Continuing in {s} s…',
    mine: 'Your answer · only you',
    minePlaceholder: '(write or think, then reveal)',
    reveal: 'Show the AI’s answer',
    hint: 'Give me a hint',
    hintTitle: 'Hint',
    stillStuck: 'Still stuck?',
    caseTemplate: { problem: 'Problem', rules: 'Applicable rules', application: 'Application to the facts', conclusion: 'Conclusion' },
    unverified: { one: '{n} sentence isn’t in your materials (general knowledge — check it).', other: '{n} sentences aren’t in your materials (general knowledge — check them).' },
    notInMaterials: 'Not in your materials',
    insufficient: 'Your materials don’t seem to cover this.',
    sources: 'Sources',
    copyToMine: 'Copy to my answer',
    copiedToMine: 'Copied to your answer.',
    fromAi: '(from AI)',
    mark: 'Is this right?',
    marks: { right: 'Right', partly: 'Partly', wrong: 'Wrong', unsure: 'Not sure' },
    correct: 'Add the correct answer…',
    correctLabel: 'Correct answer (only you)',
    addToPractice: 'Add to practice',
    practisePaper: 'Practise this paper',
    more: { edit: 'Edit questions…', again: 'Answer all again…', original: 'Open the original file', copyAll: 'Copy all answers as Markdown', private: 'Keep private (only you)…', delete: 'Delete for everyone…' },
    aiOff: 'AI isn’t set up. You can still write your answers and practise.',
  },
  practice: {
    title: 'Practising {title} · {i} of {n}',
    titleClass: 'Practising {class} · {i} of {n}',
    reveal: 'Show answer',
    yourAnswer: 'Your answer',
    yourCorrect: 'Your corrected answer',
    how: 'How did it go?',
    again: 'Again',
    gotIt: 'Got it',
    end: 'End',
    done: { one: 'Done for now. {n} to practise tomorrow.', other: 'Done for now. {n} to practise tomorrow.' },
    doneExam: '{exam} {when}.',
    practiseAgain: 'Practise again',
    backToExam: 'Back to the exam',
    nothing: 'Nothing to practise right now.',
    nothingBody: { one: 'Next: {n} question tomorrow. You can still practise any paper.', other: 'Next: {n} questions tomorrow. You can still practise any paper.' },
    all: 'Practise all questions',
  },
};
```

### 5.12 `chat`
```ts
export const chat = {
  label: 'Class chat',
  placeholder: 'Message {class}…',
  send: 'Send',
  attach: 'Attach a file',
  attachNotice: 'Files you send in chat are also kept in Documents, so they don’t get lost.',
  replyingTo: 'Replying to {name}: “{excerpt}”',
  cancelReply: 'Cancel reply',
  loadingEarlier: 'Loading earlier messages…',
  edited: '(edited)',
  deleted: 'Message deleted',
  hidden: 'Hidden by an organiser',
  showHidden: 'Show',
  pending: 'Saved — will send when a classmate is online',
  sent: 'Sent',
  sentTooltip: 'At least one classmate’s computer has it.',
  actions: { label: 'Message actions', reply: 'Reply', pin: 'Pin for the class', unpin: 'Unpin', copy: 'Copy text', edit: 'Edit', delete: 'Delete', hide: 'Hide for everyone', unhide: 'Show for everyone' },
  deleteConfirm: { title: 'Delete this message for everyone?', confirm: 'Delete' },
  hideConfirm: { title: 'Hide this message for everyone?', body: 'Organisers can still see it.', confirm: 'Hide' },
  pins: { all: 'All pins', none: 'No pinned messages.' },
  mention: { label: 'Mention', ai: 'AI', aiHint: 'Ask Tramado AI with your key', everyone: 'everyone', everyoneHint: 'Notify everyone in the class' },
  ai: {
    author: 'Tramado AI',
    header: 'asked by {name} · {model}',
    working: 'Looking through {lectures} and {documents}…',
    noKey: 'To ask @AI, set up AI in Settings. Classmates’ keys are never shared.',
    off: 'AI is off on this computer.',
    setUp: 'Set up AI',
  },
  examChip: 'Add to Exams: {kind} on {date}?',
  system: {
    thanks: '{a} thanked {b} for transcribing {lecture}.',
    joined: '{name} joined the class.',
    left: '{name} left the class.',
    pinned: '{name} pinned a message.',
    examAdded: '{name} added {title} on {date}.',
  },
  empty: {
    aloneTitle: 'Just you so far.',
    aloneBody: 'Invite classmates to chat, share documents and split the transcription work.',
    invite: 'Invite classmates',
    quiet: 'No messages yet. Say hello to the class.',
  },
  find: 'Find in chat',
  newMessage: '{name}: {text}',
};
```

### 5.13 `ask`
```ts
export const ask = {
  threads: 'Conversations',
  new: 'New',
  renameThread: 'Rename', deleteThread: 'Delete',
  deleteThreadConfirm: 'Delete this conversation? It’s only on this computer.',
  scope: { label: 'Sources', all: 'All', lectures: 'Lectures', documents: 'Documents', exams: 'Exams', mine: 'My notes', mineHint: 'Includes your private notes in what is sent to the AI.', lecture: 'This lecture: {title}', document: 'This document: {name}', allClasses: 'All classes' },
  general: 'Allow general knowledge',
  generalHint: 'Sentences not found in your materials are marked as unverified.',
  placeholder: 'Ask about {class}…',
  placeholderAll: 'Ask about all your classes…',
  you: 'You',
  sent: { one: 'Sent: your question and {n} passage.', other: 'Sent: your question and {n} passages.' },
  seeSent: 'See what was sent',
  post: 'Post to class chat',
  postConfirm: { title: 'Post this answer to {class} chat?', body: 'Classmates will see your question and the answer.', confirm: 'Post' },
  posted: 'Posted to {class} chat.',
  copy: 'Copy with sources',
  saveNote: 'Save as note',
  saved: 'Saved to your notes.',
  empty: {
    title: 'Ask anything about {class}.',
    titleAll: 'Ask anything about your classes.',
    summarise: 'Summarise {lecture}',
    quiz: 'Quiz me on {exam}',
    topics: 'What are the main topics so far?',
  },
  off: {
    title: 'Ask your classes with AI.',
    body: 'Set up OpenRouter with your own key (free models work), or a local AI service. Search works without AI.',
    setUp: 'Set up AI',
    search: 'Search instead',
  },
};
```

### 5.14 `ai` (shared by every AI surface)
```ts
export const ai = {
  pill: { model: '{model} · {n} left', modelOnly: '{model}', local: 'Local AI', off: 'AI off', checkKey: 'AI: check key', label: 'AI settings' },
  badge: 'AI',
  card: {
    label: 'AI answer',
    header: 'AI · {model}',
    fallback: '— answered because {requested} was busy',
    from: { one: 'from {n} of your sources', other: 'from {n} of your sources' },
    askedBy: 'asked by {name} · {date}',
    grounded: 'Grounded',
    groundedLabel: 'Grounded in your sources: {p} %',
    deep: 'Deep answer',
    deepCost: 'Deep answer ({min}–{max} requests)',
    retry: 'Try again',
    cut: 'The answer was cut off.',
    continue: 'Continue',
    streaming: 'Writing…',
  },
  cite: {
    label: 'Source {n}: {title}, {where}',
    moved: ' (moved)', changed: ' (changed since the answer)', missing: ' (missing)', hallucinated: ' (not a real source)',
    where: {
      page: 'p. {page}', pageSpoken: 'page {page}',
      article: 'art. {article} · p. {page}', articleRange: 'art. {article} · pp. {page}–{end}', articleSpoken: 'article {article}, page {page}',
      slide: 'slide {n}', slideSpoken: 'slide {n}',
      time: '▶ {time}', timeSpoken: 'at {time}',
      question: 'Question {number}', questionSpoken: 'question {number}',
      heading: '§ {heading}', headingSpoken: 'section {heading}',
    },
    open: 'Open',
    openPage: 'Open at p. {page}',
    openArticle: 'Open art. {article}',
    openSlide: 'Open slide {n}',
    openTime: 'Open at {time}',
    playFrom: 'Play from {time}',
    openQuestion: 'Open question {number}',
    openNote: 'Open note',
    openMyNote: 'Open my note',
    searchPassage: 'Search for the passage',
    hallucinated: 'This source isn’t among the passages Tramado sent. The model may have made it up.',
    missing: 'This file isn’t in the class any more.',
    arriving: 'This file is still arriving.',
    transcribedBy: 'transcribed by {name}',
    badges: { moved: 'Moved', changed: 'Changed', missing: 'Missing', hallucinated: 'Not a real source' },
  },
  cost: {
    line: { one: 'About {n} request · {left} free left today', other: 'About {n} requests · {left} free left today' },
    lineRange: '{min}–{max} requests · {left} free left today',
    noQuota: { one: 'About {n} request', other: 'About {n} requests' },
    exhausted: 'You’ve used today’s {limit} free AI requests. They reset at {time}.',
  },
  quota: {
    left: '{remaining} of {limit} left today',
    resets: 'resets at {time} (midnight UTC)',
    freeTier: 'Accounts that have bought at least 10 credits get 1,000 free requests a day.',
    credit: 'Credit: {amount} left',
    refresh: 'Refresh',
    unknown: 'Free requests left: unknown',
  },
  privacy: {
    title: 'What providers may do with what you send',
    zdr: 'Keep nothing',
    zdrHint: 'Only providers that keep nothing of what they’re sent. Most free models are excluded, so you’ll usually need a paid model.',
    noTraining: 'No training (recommended)',
    noTrainingHint: 'Providers may keep requests for a short time (for example, to check for abuse) but won’t train AI on them. Works with the default free model.',
    standard: 'Allow free models that may train',
    standardHint: 'Some free models are free because the provider may use what you send to improve their AI. Don’t use this for anything personal.',
    standardConfirmTitle: 'Allow free models that may train?',
    standardConfirmBody: 'Some providers may use what you send to improve their AI. Don’t use this for anything personal: recordings of people, your own writing you want to keep private, or sensitive topics.',
    standardConfirm: 'Allow',
    zdrFree: 'Free models aren’t available at this level. Choose a paid model, or answers will fail.',
    sttZdr: 'Cloud transcription isn’t available at the Keep nothing level.',
    custom: 'Privacy depends on {host}.',
  },
  busy: {
    title: 'The free models are busy right now. This happens often, and it’s not your fault.',
    tried: 'Tried: {models}.',
    retryIn: 'Try again in {s} s',
    once: 'Use NVIDIA free models for this request',
    always: 'Always use them when busy',
    alwaysConfirm: 'Always use NVIDIA’s free models when the others are busy? They may use what you send to train their AI.',
    change: 'Change model',
    footnote: 'NVIDIA’s free models may use what you send to train their AI.',
  },
  sentDisclosure: {
    title: 'What was sent',
    passage: '{source} · {where}',
    to: 'Sent to {provider} through OpenRouter.',
  },
  explainFooter: { one: 'Sent to {provider}: this passage and {n} related passage.', other: 'Sent to {provider}: this passage and {n} related passages.' },
  models: { recommended: 'recommended', free: 'free', context: '{n}k context', vision: 'reads images', updated: 'list updated {when}', available: { one: '{n} free model works at your privacy level', other: '{n} free models work at your privacy level' }, gone: '{model} is no longer on OpenRouter. Using {replacement}.' },
  errors: {
    AI_NO_KEY: 'AI isn’t set up yet.',
    AI_AUTH: 'OpenRouter didn’t accept your key. It may have been deleted or mistyped.',
    AI_NO_CREDIT: 'Your OpenRouter account has no credit left for {model}. Free models still work.',
    AI_MODEL_GATED: '{model} can’t be used from Tramado. Choose another model.',
    AI_FLAGGED: 'The provider refused this content.',
    AI_PRIVACY_BLOCKS: '{model} isn’t available at your privacy level (“{level}”).',
    AI_UNSUPPORTED: 'This model can’t do that. Tramado tried a simpler request.',
    AI_MODEL_UNKNOWN: 'The model “{model}” no longer exists on OpenRouter. Choose another in Settings.',
    AI_TOO_LONG: 'That’s more text than {model} can read at once. Tramado will use fewer passages.',
    AI_BAD_REQUEST: 'Something went wrong preparing the request. Please report it.',
    AI_BUSY: 'The free model is busy right now. This happens often with free models, and it’s not your fault.',
    AI_FREE_LIMIT: 'You’ve used today’s {limit} free AI requests. They reset at {time}.',
    AI_UPSTREAM: 'The model’s provider is having problems.',
    AI_UNAVAILABLE: 'No provider is available for this model right now.',
    AI_TIMEOUT: 'The model took too long to answer.',
    AI_OFFLINE: 'You’re offline. AI needs the internet. Search and everything else still work.',
    AI_LENGTH: 'The model didn’t produce an answer. Try again or choose another model.',
    AI_HOST_NOT_ALLOWED: 'Tramado isn’t allowed to send requests to {host} yet.',
    AI_BAD_ADDRESS: 'That address doesn’t look right. It should look like http://localhost:11434/v1.',
  },
  recovery: {
    setUp: 'Set up AI', updateKey: 'Update key', useFree: 'Use the free model', addCredit: 'Add credit', changeModel: 'Choose another model',
    changePrivacy: 'Change privacy level…', tryAgain: 'Try again', tryAgainIn: 'Try again in {s} s', useFallback: 'Use {model}', usePaid: 'Use a paid model', allowHost: 'Allow {host}',
  },
  hostConfirm: { title: 'Allow Tramado to send AI requests to {host}?', body: 'Your questions and the passages they need will go to this address.', confirm: 'Allow' },
};
```

### 5.15 `members`
```ts
export const members = {
  invite: {
    button: 'Invite classmates',
    title: 'Invite classmates to {class}',
    body: 'Send this invite wherever your class talks: your class group chat, Moodle or email. Anyone who has it can join.',
    copy: 'Copy invite',
    copied: 'Invite copied. Paste it in your class group.',
    qr: 'Scan with a phone to send the invite to your computer.',
    qrHint: 'It opens a page that shows the invite; it never leaves your phone’s browser.',
    qrLabel: 'QR code with the invite to {class}',
    code: 'Invite code (it’s long — copy and paste it, don’t type it)',
    copyCode: 'Copy code',
    codeCopied: 'Code copied.',
    saveFile: 'Save as a file…',
    preparing: 'Getting your computer ready to share…',
    footer: 'People join through your computer, or any member’s that is online. If nobody is online, they wait.',
    footerAsk: 'To approve each person first, turn on “Ask before letting people in” in Members.',
    message: 'Join “{class}” on Tramado: {link}\nOr open Tramado → Join a class and paste this code:\n{code}',
  },
  join: {
    title: 'Join a class',
    paste: 'Paste the invite a classmate sent you (the whole message is fine).',
    pasteButton: 'Paste',
    openFile: 'Open an invite file…',
    continue: 'Continue',
    invalid: 'This doesn’t look like a Tramado invite. Copy the whole message and try again.',
    newer: 'This invite was made by a newer Tramado. Update Tramado to join.',
    already: 'You’re already in {class}.',
    openIt: 'Open it',
    invitedBy: '{name} invited you to',
    whatYouGet: 'What you’ll get: lectures and transcripts, documents, class notes and the class chat. Your own notes, highlights and practice stay private.',
    folder: 'Keep it in',
    folderExists: 'A folder with this name already exists. Choose another place.',
    audio: 'Also download lecture recordings (about 11 MB per hour)',
    audioOff: 'You’ll still get every transcript. Turn recordings on later in the class settings.',
    rules: 'Recordings in this class are for this class only. I won’t share them outside it.',
    asName: 'You’ll appear as {name}.',
    submit: 'Join class',
    connecting: 'Connecting to {name}…',
    checkWords: 'Your check words: [b]{words}[/b].',
    canClose: 'You can close this window: Tramado will tell you when you’re in.',
    nobody: 'No one from the class is online right now. You’ll join as soon as someone opens Tramado.',
    waitingAsk: 'Waiting for a member to let you in…',
    sameWords: 'Members see the same words.',
    declined: '{name}’s class didn’t let this computer in. Ask them for a new invite.',
    stalled: '{name}’s computer didn’t let you in yet. Try again in 10 minutes.',
    retry: 'Try again',
    pairNeedsNewer: 'Adding another computer needs a newer Tramado.',
    in: 'You’re in! Getting {class}… {have} of {total} files',
    pairTitle: 'Add this computer to [b]{name}[/b]’s computers?',
    pairBody: 'This computer gets all of {name}’s classes. Private notes, highlights and practice are not copied.',
    pairSubmit: 'Add this computer',
  },
  list: {
    people: 'People ({n})',
    waiting: 'Waiting to join ({n})',
    helpers: 'Transcription helpers',
    helperLine: '{name} — {when} · {model}',
    helperWhen: { plugged: 'when plugged in', always: 'always' },
    helperNoModel: 'no speech model yet',
    becomeHelper: 'Help transcribe this class’s lectures…',
    consent: 'Recording permissions',
    consentLine: 'Recording: {record} · Sharing in this group: {share} · confirmed by {name} on {date}',
    allowed: 'allowed', notAllowed: 'not allowed', withdrawn: 'withdrawn',
    consentNone: 'No permission is on record yet. It’s added when someone ticks “Remember for this class” before recording.',
    report: 'Report a problem',
    reportDraft: '@everyone A problem with the recording permission: ',
    withdraw: 'Withdraw permission',
    withdrawConfirm: { title: 'Withdraw the recording permission?', body: 'New recordings in {class} won’t be shared until someone confirms the lecturer’s permission again.', confirm: 'Withdraw', alsoDelete: 'Also delete existing recordings for everyone' },
    you: '(you)',
    organiser: 'Organiser',
    computers: { one: '{n} computer', other: '{n} computers' },
    thisComputer: '(this computer)',
    presence: {
      recording: 'Recording {class}',
      transcribing: 'Transcribing {lecture} · {p} %',
      editing: 'Editing {note}',
      online: 'Online · up to date',
      onlineSyncing: 'Online · syncing {p} %',
      lastSeen: 'Last seen {when}',
      never: 'Never connected',
    },
    device: {
      upToDate: 'Up to date',
      syncing: 'Syncing · {size} left',
      relay: 'Connected through a relay (slow)',
      offline: 'Offline · last seen {when}',
      never: 'Never connected',
    },
    unverified: 'Unverified device claiming to be {name}: “{device}”',
    removeDevice: 'Remove device',
    menu: { copyWords: 'Copy check words', makeOrganiser: 'Make organiser', stopOrganiser: 'Stop being organiser', remove: 'Remove from class…' },
    askBefore: 'Ask before letting people in',
    admit: 'Let in', later: 'Not now', decline: 'Decline',
    large: 'Large classes sync slowly. Consider smaller study groups.',
    empty: { title: 'Only you.', body: 'Send an invite in your class group. It takes classmates a minute to join.', action: 'Invite' },
  },
  remove: {
    title: 'Remove {name} from {class}?',
    body: 'Everyone’s Tramado stops sharing the class with {name}’s computers. {name} keeps what was already on their computer. From now on, new computers must be let in by a member (this turns on “Ask before letting people in”).',
    confirm: 'Remove',
    fresh: 'Start a fresh class without {name}…',
    freshTitle: 'Start a fresh class without {name}?',
    freshBody: 'This makes a new copy of {class} that {name} can’t join, and invites everyone else again. {name} keeps the old copy.',
    freshConfirm: 'Make a fresh class',
    done: '{name} was removed from {class}.',
  },
  admission: {
    joined: '[b]{name}[/b] joined {class} · check words {words}',
    wants: '[b]{name}[/b] (“{device}”) wants to join {class}. Check words: [b]{words}[/b]',
    several: { one: '{n} person wants to join {class}', other: '{n} people want to join {class}' },
    review: 'Review',
  },
  pair: {
    title: 'Add another computer',
    body: 'On your other computer, open Tramado → Join a class and paste this code. Your classes will appear there too. Your private notes, highlights and practice are not copied: they stay on each computer.',
  },
  checkWords: { label: 'Check words', copy: 'Copy check words', copied: 'Check words copied.' },
};
```

### 5.16 `search`
```ts
export const search = {
  placeholder: 'Search your classes, or type a command…',
  label: 'Search and commands',
  scopeClass: 'In {class}',
  scopeAll: 'All classes',
  includeArchived: 'Include archived classes',
  groups: { lectures: 'Lectures', documents: 'Documents', notes: 'Notes', exams: 'Exams', chat: 'Chat', commands: 'Commands', recent: 'Recent', recentSearches: 'Recent searches' },
  showAll: 'Show all {n}',
  askAi: 'Ask AI: “{q}” in {scope}',
  askAiOff: 'Ask AI (set up AI first)',
  indexing: { one: 'Still reading {n} file; results may be incomplete.', other: 'Still reading {n} files; results may be incomplete.' },
  none: { title: 'Nothing found for “{q}”.', body: 'Try fewer words, or search all classes.', all: 'Search all classes', ask: 'Ask AI' },
  result: '{kind}: {title}, {where}. {snippet}',
  kinds: { lecture: 'Lecture', document: 'Document', note: 'Note', exam: 'Exam question', chat: 'Message', command: 'Command' },
  chatWhere: '{name}, {date}',
};
```

### 5.17 `settings`
```ts
export const settings = {
  title: 'Settings',
  nav: 'Settings sections',
  sections: { profile: 'Profile', appearance: 'Language and appearance', ai: 'AI', transcription: 'Transcription', sharing: 'Sharing', notifications: 'Notifications', storage: 'Storage', privacy: 'Privacy', about: 'About' },
  profile: {
    name: 'Your name', nameHint: 'Shown to classmates in every class you share.',
    device: 'This computer’s name',
    colour: 'Your colour',
    info: 'Classmates see your name and your computers’ names. Never a phone number or an email.',
  },
  appearance: {
    language: 'Language',
    theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    textSize: 'Text size',
    font: 'Font', fontDefault: 'Default', fontAtkinson: 'Easier to read (Atkinson Hyperlegible Next)', fontDyslexic: 'OpenDyslexic',
    motion: 'Reduce motion', motionSystem: 'Follow the system', motionOn: 'On',
  },
  ai: {
    service: 'AI service', openrouter: 'OpenRouter', custom: 'Another OpenAI-compatible service (advanced)',
    key: 'OpenRouter key',
    keySet: 'Key ending in …{last4} · stored in {store}',
    storeKeychain: 'the system keychain', storeFile: 'a private file on this computer (no keychain was found)',
    testAgain: 'Test again', replace: 'Replace', removeKey: 'Remove',
    removeConfirm: { title: 'Remove your OpenRouter key from this computer?', body: 'AI features stop working until you add a key again.', confirm: 'Remove key' },
    paste: 'Paste', test: 'Test and save', getKey: 'Get a free key at openrouter.ai/keys',
    age: 'OpenRouter is for people aged 18 or over. If you are younger, use a local AI service instead (below), or skip AI.',
    checkOk: { one: 'Works. {n} free request left today.', other: 'Works. {n} free requests left today.' },
    quota: 'Free requests',
    model: 'Model',
    fallback: 'If it’s busy, try',
    then: 'then',
    reset: 'Reset to recommended',
    busyPolicy: 'When all free models are busy', busyAsk: 'Ask me', busyNvidia: 'Use NVIDIA free models (they may train on what you send)',
    answers: 'Answers',
    answerLanguage: 'Language', answerSame: 'Same as the question', answerMine: 'Always {language}',
    generalDefault: 'Allow general knowledge by default (marked as unverified)',
    customTitle: 'Another service (advanced)',
    customAddress: 'Address', customKey: 'Key', customModel: 'Model', customTest: 'Test',
    customHint: 'Use this for a local AI (Ollama, LM Studio) or your school’s server. Plain http works only for this computer or your local network.',
    customOk: { one: 'Works. {n} model found.', other: 'Works. {n} models found.' },
    off: 'Turn off AI on this computer',
    on: 'Turn on AI',
    offHint: 'AI buttons are hidden. Your key stays saved.',
    activity: 'AI activity on this computer',
  },
  transcription: {
    models: 'Speech model (downloads once, works offline)',
    import: 'Import a model file…',
    importHint: 'For offline classrooms: a model file copied from a classmate is checked before use.',
    savedIn: 'Saved in Tramado’s own folder: {path}',
    volunteer: 'Help transcribe the class’s lectures',
    volunteerOff: 'Off', volunteerPlugged: 'When this computer is plugged in', volunteerAlways: 'Always',
    volunteerHint: 'When a lecture in a shared class has no transcriber, this computer takes it on.',
    volunteerOffer: 'Help transcribe {class}’s lectures when this computer is plugged in?',
    cloud: 'Cloud transcription',
    cloudHint: 'With OpenRouter — paid, about 2 cents per lecture. The audio is sent to OpenRouter in short pieces.',
    cloudModel: 'Model',
    cloudConfirm: { title: 'Turn on cloud transcription?', body: 'Recordings you choose to transcribe this way are sent to OpenRouter and the speech model’s provider, in pieces of up to 30 seconds. It costs about 2 cents per lecture from your OpenRouter credit.', confirm: 'Turn on' },
    mic: 'Microphone', micTest: 'Test microphone', micTesting: 'Speak now…', micOk: 'We can hear you.', micSilent: 'We can’t hear anything. Check the microphone.',
    quality: 'Recording quality', qualityStandard: 'Standard (24 kbps, about 11 MB per hour)', qualitySaver: 'Storage saver (16 kbps, about 7 MB per hour)',
    markerLead: 'Markers point back',
    markerLeadHint: 'Most people tap just after the important sentence.',
    markerLeadValue: { one: '{n} second', other: '{n} seconds' },
    globalShortcut: 'Marker shortcuts that work in any app while recording: {keys}',
    cpu: 'This computer’s processor can’t run the speech model (it needs AVX2, found in processors since about 2013). Classmates’ computers or OpenRouter can transcribe your lectures.',
  },
  sharing: {
    status: 'Status',
    running: 'Sharing is running · Syncthing {version} · this computer listens on port {port}',
    notStarted: 'Sharing starts when you share or join a class.',
    restart: 'Restart sharing',
    pause: 'Pause sharing',
    devices: 'Your computers',
    thisDevice: '{name} (this computer)',
    lastSeen: 'last seen {when}',
    addDevice: 'Add another computer…',
    removeDevice: 'Remove',
    removeDeviceConfirm: { title: 'Remove {device} from your computers?', body: 'It stops getting your classes. Files already on it stay there.', confirm: 'Remove' },
    closeTitle: 'When you close the window',
    tray: 'Keep sharing in the background (in the tray)',
    trayMac: 'Keep sharing in the background (in the Dock)',
    trayHint: 'Your classmates get recordings and transcripts from you faster. Quit from the tray icon to stop.',
    autostart: 'Start Tramado when I log in (hidden in the tray)',
    lanOnly: 'Local network only',
    lanOnlyHint: 'No relays or internet discovery. Often doesn’t work on eduroam.',
    limits: 'Speed limits', upload: 'Upload', download: 'Download', noLimit: 'No limit',
    ownSyncthing: 'Your own Syncthing is running on this computer. Tramado uses a separate copy on port {port}; your folders are untouched.',
    ownSyncthingAdd: 'Add my Syncthing as one of my computers',
    diagnostics: 'Sharing diagnostics',
    diagVersion: 'Version {version} · device ID {id} · sync port {port} · API: {api}',   // {api} = 'running' | 'stopped' (from SyncDiagnostics.ports.guiOpen)
    diagPeers: 'Classmates’ computers',
    diagPeerConnected: '{name} — connected ({how})', diagPeerSeen: '{name} — last seen {when}',
    diagHowDirect: 'direct', diagHowRelay: 'relay',
    diagProblems: 'Recent problems', diagNoProblems: 'none',
    diagLog: 'Log (last 200 lines)', copyLog: 'Copy',
  },
  notifications: {
    system: 'Show system notifications',
    default: 'Default for new classes',
    kinds: 'Tell me when…',
    transcript: 'a transcript I’m waiting for is ready',
    joins: 'someone joins one of my classes',
    exams: 'an exam date is added or changed',
    model: 'the speech model finishes downloading',
    perClass: 'Each class can change this in its ⋯ menu › Notifications.',
  },
  storage: {
    root: 'Classes are kept in',
    rootHint: 'New classes go here; existing classes stay where they are.',
    classSize: '{size} (recordings {audio} · deleted files kept for 30 days {trash})',
    emptyTrash: 'Empty class trash',
    emptyTrashConfirm: { title: 'Permanently delete {size} of deleted files in {class} on this computer?', body: 'Classmates’ copies of their own trash are not affected.', confirm: 'Delete permanently' },
    skipAudio: 'Skip audio',
    models: 'Speech models', manage: 'Manage',
    cache: 'Cache (text for search, indexes)', clearCache: 'Clear cache', cacheHint: 'It rebuilds itself when needed.',
    retention: 'Remove recordings I made, once transcribed',
    retentionNever: 'Never', retention30: 'After 30 days', retention90: 'After 90 days',
    retentionHint: 'The transcript stays. In shared classes the recording is removed for everyone.',
    diskLow: 'Your disk is almost full ({free} left). New recordings and classmates’ files may not fit.',
  },
  about: {
    version: 'Tramado {version}',
    tagline: 'Free and open source (MPL-2.0). Built on Trama.',
    source: 'Source code',
    shortcuts: 'Keyboard shortcuts', show: 'Show',
    diagnostics: 'Diagnostics',
    copyDiagnostics: 'Copy diagnostics',
    diagnosticsCopied: 'Diagnostics copied. Nothing was sent.',
    mediaTest: 'Test audio playback',
    mediaOk: 'Playback works.',
    mediaFail: 'Playback doesn’t work in this window: {detail}. Tramado will use a slower fallback.',
    licences: 'Licences',
    component: 'Component', licence: 'Licence',
  },
};
```

### 5.18 `privacy`
```ts
export const privacy = {
  title: 'What leaves this computer',
  intro: 'Tramado has no server and no account. This is everything that ever leaves your computer, and when.',
  columns: { when: 'When', what: 'What is sent', to: 'To whom' },
  rows: {
    nothing: { when: 'Nothing set up', what: 'Nothing. Tramado makes no connection of its own.', to: '—' },
    sharing: { when: 'You share or join a class', what: 'Class files, chat and your name and computer’s name, encrypted between your classmates’ computers. Your computer’s ID and IP address go to Syncthing’s discovery and relay servers so classmates can find you.', to: 'Your classmates’ computers; Syncthing’s public discovery and relay servers' },
    joinPage: { when: 'You open an invite link in a browser (or scan an invite’s QR code)', what: 'Your browser loads Tramado’s invite page from GitHub Pages: GitHub sees your IP address and browser details, as for any web page. The invite code stays in the part of the link after “#”, which your browser never sends; the page reads it on your device.', to: 'GitHub (USA), which hosts the invite page' },
    ai: { when: 'You ask the AI (Ask, @AI, Explain, exam answers, summaries)', what: 'Your question and the passages it needs (with their file names and timestamps). Never whole folders, private notes (unless you include My notes), chat history or other classes.', to: 'OpenRouter (USA) and the company running the model' },
    ocr: { when: 'You read a scanned exam or document with AI', what: 'The page images', to: 'OpenRouter and the model’s provider' },
    cloudSpeech: { when: 'You transcribe with OpenRouter', what: 'The recording, in pieces of up to 30 seconds', to: 'OpenRouter and the speech model’s provider' },
    model: { when: 'You download a speech model', what: 'A download request', to: 'Hugging Face' },
    never: { when: 'Never', what: 'No account, no telemetry, no analytics, no crash reports. Syncthing’s usage reporting is off.', to: '—' },
  },
  log: {
    title: 'AI activity on this computer',
    intro: 'A private list of AI requests made from this computer. It is never sent anywhere.',
    columns: { time: 'Time', class: 'Class', action: 'Action', model: 'Model', passages: 'Passages sent', requests: 'Requests' },
    actions: { ask: 'Ask', chat: '@AI in chat', explain: 'Explain', summary: 'Summary', terms: 'Key terms', annotate: 'Annotate transcript', studyNotes: 'Study notes', examExtract: 'Exam: find questions', examOcr: 'Exam: read pages', examAnswer: 'Exam: answer', hint: 'Hint', deep: 'Deep answer', title: 'Lecture title', describe: 'Describe image', docOcr: 'Read a scan', cloudSpeech: 'Cloud transcription', keyCheck: 'Key check', catalog: 'Model list' },
    clear: 'Clear the log',
    empty: 'No AI requests yet.',
  },
  where: { title: 'Where your data is', classes: 'Open the classes folder', private: 'Open the private data folder', models: 'Open the models folder', cache: 'Open the cache folder' },
};
```

### 5.19 `speech`
```ts
export const speech = {
  models: {
    turbo: 'Recommended', turboHint: '{size} · good accuracy, about {speed}× faster than real time here',
    turboHintUnknown: '{size} · good accuracy',
    small: 'Draft', smallHint: '{size} · faster, but rough on Portuguese and Spanish',
    'large-v3': 'Most accurate', 'large-v3Hint': '{size} · slower',
  },
  state: {
    absent: 'Not downloaded',
    partial: '{done} of {total} (paused)',
    downloading: '{done} of {total} · {speed}/s · {left}',
    verifying: 'Checking the download…',
    ready: 'Installed',
    failed: 'The speech model didn’t download correctly. Nothing was installed.',
  },
  actions: { download: 'Download', pause: 'Pause', resume: 'Resume', delete: 'Delete', remove: 'Remove', tryAgain: 'Try again', use: 'Use this one' },
  removeConfirm: { title: 'Remove the {model} speech model?', body: 'It frees {size}. You can download it again later.', confirm: 'Remove' },
  dock: 'Downloading the speech model · {done} of {total} · {left}',
  ready: 'The speech model is ready.',
  prompt: {
    title: 'Transcribing on this computer needs a speech model',
    body: 'It downloads once (from Hugging Face), then works offline. It’s saved in Tramado’s own folder, not in your classes.',
    estimate: 'about {time} for this lecture',
    free: 'Free space: {size}',
    download: 'Download and transcribe',
    classmate: 'Let a classmate do it',
    classmateDone: 'Classmates who help with transcription will see it.',
    cloud: 'Use OpenRouter instead',
    cloudOff: 'Use OpenRouter (turn on in Settings)',
    noDisk: 'The speech model needs {size} free. You have {free}.',
    useDraft: 'Use the Draft model ({size})',
    openStorage: 'Open Storage settings',
  },
  left: {
    underMinute: 'less than a minute left',
    minutes: { one: 'about {n} minute left', other: 'about {n} minutes left' },
    hours: 'about {h} h {m} min left',
  },
};
```

### 5.20 `errors` (one sentence per code of critique §8; the UI translates codes, never raw messages)
```ts
export const errors = {
  INVALID: 'That isn’t valid.',
  NOT_IMPLEMENTED: 'This isn’t built yet.',
  NOT_FOUND: 'Tramado couldn’t find that. It may have been moved or deleted.',
  PERMISSION_DENIED: 'Tramado isn’t allowed to open or change that file. Check its permissions.',
  IO_ERROR: 'The file couldn’t be read or written.',
  DISK_FULL: 'Your disk is full. Free some space and try again.',
  CANCELLED: 'Cancelled.',
  JOB_BUSY: 'Tramado is already doing that. Wait for it to finish.',
  PATH_OUTSIDE_CLASS: 'That file is outside the class folder.',
  SYMLINK_REFUSED: 'Tramado doesn’t follow shortcuts (links) inside class folders.',
  CONFLICT: 'Someone else changed this at the same time. Both versions are kept.',
  NEWER_FORMAT: 'This was made with a newer Tramado. Update to edit it.',
  UNSUPPORTED_FILE: 'Tramado can’t read this kind of file.',
  AI_NO_KEY: 'AI isn’t set up yet.',
  AI_AUTH: 'OpenRouter didn’t accept your key.',
  AI_NO_CREDIT: 'Your OpenRouter account has no credit for this model.',
  AI_MODEL_GATED: 'This model can’t be used from Tramado.',
  AI_FLAGGED: 'The provider refused this content.',
  AI_PRIVACY_BLOCKS: 'This model isn’t available at your privacy level.',
  AI_UNSUPPORTED: 'This model can’t do that.',
  AI_MODEL_UNKNOWN: 'This model no longer exists on OpenRouter.',
  AI_TOO_LONG: 'That’s more text than the model can read at once.',
  AI_BAD_REQUEST: 'Something went wrong preparing the request.',
  AI_BUSY: 'The free model is busy right now.',
  AI_FREE_LIMIT: 'You’ve used today’s free AI requests.',
  AI_UPSTREAM: 'The model’s provider is having problems.',
  AI_UNAVAILABLE: 'No provider is available for this model right now.',
  AI_TIMEOUT: 'The model took too long to answer.',
  AI_OFFLINE: 'You’re offline.',
  AI_LENGTH: 'The model didn’t produce an answer.',
  AI_HOST_NOT_ALLOWED: 'Tramado isn’t allowed to send requests to that address.',
  AI_BAD_ADDRESS: 'That address doesn’t look right.',
  SPEECH_NO_DEVICE: 'No microphone or sound device could be opened. Check that one is connected and that Tramado is allowed to use it.',
  SPEECH_PERMISSION: 'Tramado isn’t allowed to use the microphone.',
  SPEECH_NO_SYSTEM_AUDIO: 'Tramado can’t record your computer’s sound on this system.',
  SPEECH_UNSUPPORTED_AUDIO: 'This file’s audio format isn’t supported. Convert it to MP3 or M4A (AAC-LC) and try again.',
  SPEECH_NO_SPEECH: 'No speech was found in this recording.',
  SPEECH_UNSUPPORTED_CPU: 'This computer’s processor can’t run the speech model (it needs AVX2).',
  MODEL_NOT_DOWNLOADED: 'The speech model isn’t downloaded yet.',
  MODEL_UNREADABLE: 'The speech model file is damaged. Download it again.',
  MODEL_DOWNLOAD_FAILED: 'The speech model couldn’t be downloaded. Check your connection and try again.',
  MODEL_INTEGRITY: 'The speech model didn’t download correctly. Nothing was installed.',
  SYNC_UNAVAILABLE: 'Sharing isn’t running.',
  SYNC_LOCKED: 'Another copy of Tramado is using the sharing data.',
  SYNC_PORT: 'Another program is using the port Tramado needs.',
  SYNC_FOLDER_MARKER_MISSING: 'Tramado can’t find the class folder’s marker. Was the folder moved or emptied?',
  SYNC_INVITE_INVALID: 'This doesn’t look like a Tramado invite.',
  SYNC_FOREIGN_WRITE: 'A classmate’s computer changed a file that belongs to {name}. It was ignored.',
  SYNC_IDENTITY_COPIED: 'This looks like a copy of another computer’s Tramado.',
  withReason: '{message} ({code})',
};
```

### 5.21 `a11y` (screen-reader-only text and announcements)
```ts
export const a11y = {
  skipToContent: 'Skip to content',
  screenChanged: '{title}',
  loading: 'Loading {what}',
  progress: '{what}: {percent} %',
  transcriptionProgress: 'Transcription {percent} %',
  newMessage: 'New message from {name}',
  markerList: 'Markers in this lecture',
  markerItem: '{kind} at {time}{note}',
  meter: '{label}: {db} decibels',
  presence: { online: 'online', syncing: 'syncing', offline: 'offline', recording: 'recording', transcribing: 'transcribing' },
  classTab: '{name} class colour',
  currentSegment: 'Now playing',
  highlighted: 'Highlighted as {kind}',
  cited: 'Cited passage',
  hit: 'Search match',
  dialogClose: 'Close',
  required: 'required',
};
```

### 5.22 `notify` (notification titles and bodies raised by services; `NotificationService`, architecture §11.2)
```ts
export const notify = {
  mention: '{name} mentioned you in {class}',
  everyone: '{name} to everyone in {class}',
  pin: '{name} pinned a message in {class}',                       // v1.1
  examAdded: 'New exam date in {class}: {title}, {date}',
  examChanged: 'Exam date changed: {title} is now {date}',
  examSoon: '{title} in {class} is {when}',
  transcriptReady: 'The transcript of “{lecture}” is ready',
  transcriptFailed: 'Transcribing “{lecture}” failed on {device}',
  transcriptNobody: 'Nobody has transcribed “{lecture}” yet.',
  joined: '{name} joined {class}',
  wantsToJoin: '{name} wants to join {class}',
  recordingInterrupted: 'A recording of {class} was interrupted',
  modelReady: 'The speech model is ready',
  volunteerOn: 'This computer will help transcribe your classes’ lectures when it’s plugged in.',
  massDelete: '{name}’s computer deleted {n} files from {class}',
  folderMissing: 'Tramado can’t find the folder for {class}',
  backgroundRecording: 'Still recording {class} in the background.',
};
```
---

## 6. Accessibility checklist (target WCAG 2.2 AA)

Each item is testable. "axe" means `tools/peek.mjs --axe` (`trama-ui §4.4`) must report no serious or critical violations on that screen, in both themes and at 125 % scale.

**Keyboard**
- [ ] Every action in §3 can be done with the keyboard alone. The 1000×660 window at 125 % has no horizontal overflow (`overflowTour`).
- [ ] Tab order follows the visual order: rail → top bar → class header → tabs → body → side panel → dock.
- [ ] The rail is a single tab stop per item, and Ctrl/⌘+1…9 work. The tabs use arrow keys (roving) with automatic activation.
- [ ] Focus is always visible (`:focus-visible` 2 px `--focus`, offset 2 px) and never hidden under the sticky player or the dock (`scroll-padding-bottom: calc(var(--dock-h) * 2 + 16px)` on scroll containers).
- [ ] On every route change, focus goes to the new screen's h1 (`arriveFocus`). Back restores focus to the element that opened the screen (rows via `data-*-id`, chips via `data-index`).
- [ ] Dialogs trap focus, make `#root` inert, close on Esc (layered), and return focus to the opener. Destructive confirms focus Cancel first.
- [ ] Shortcut keys 1–4, N, Space, E, F, [, ], ←/→ never fire while focus is in a text field (`isTextEntry`) or a modal is open.
- [ ] The selection toolbar is reachable with Alt+Down after a keyboard selection. The citation popover opens with Enter/Space and closes with Esc.
- [ ] The Shortcuts overlay (F1 or ?) lists every key on the current screen.

**Screen readers**
- [ ] Landmarks: `nav` (rail, "Main navigation"), `nav` (breadcrumb), `main`, `region` (dock: "Recording", job row: "Background work"), `complementary` (side panels, labelled).
- [ ] Every icon-only control is an `IconButton` whose label is its accessible name. Decorative icons and ClassTabs are `aria-hidden`.
- [ ] Rail class items announce "{name}, {status}". Tabs announce counts ("Chat, 3 unread").
- [ ] Recording state changes are announced once (`record.dock.announce.*`); the timer is never announced.
  Transcription and download progress are announced politely at most every 10 % (`a11y.progress`).
- [ ] New chat messages from others are announced politely ("New message from Bruno"), at most one announcement per 3 s (batched).
- [ ] Citation chips carry full labels ("Source 2: Lei Fundamental de Exemplo, article 18.º, page 9"). Hallucinated ones add " (not a real source)".
- [ ] AI cards are `role="article"` with `aria-label` "AI answer" and the model in the visible header. "Not in your materials" sentences are also listed in plain text below the card.
- [ ] Timeline markers are mirrored in the Markers tab (`a11y.markerList`). The timeline is a `slider` with `aria-valuetext` in words.
- [ ] The current transcript segment has `aria-current="true"`. Find hits and cited passages use `<mark>` with visually hidden text ("Search match" / "Cited passage") at the start of each run.
- [ ] Level meters are `role="meter"` with min, max, now and a label. ProgressBars have labels. Busy buttons keep focus and set `aria-busy`.
- [ ] Toasts are a polite live region. Errors needing action are `Notice tone="danger"` (`role="alert"`).
- [ ] `lang` is set on `<html>` (UI language) and on transcript, document and AI-answer containers when their language differs (`transcript.language`, class language), so voices switch.

**Visual**
- [ ] Text contrast ≥ 4.5:1 and non-text ≥ 3:1, enforced by `ui/tokens.test.ts` (§1.2) for every token pair, every class-colour derivation and every `.hl` tint.
- [ ] Meaning never rests on colour alone: class = colour + icon + name; AI = violet + Sparkles + "AI" + model; citation = yellow + number; marker = colour + icon + name; presence = shape (●/◐/○) + text; rec = dot + "REC".
- [ ] Target size ≥ 24×24 px (citation chips are 18 px tall, so each chip gets an invisible 24 px hit area: `::before { content:''; position:absolute; inset:-3px }`).
- [ ] Text resize: the app works at the 150 % text-size setting and at 200 % OS zoom without loss of content (reflow; side panels become drawers).
- [ ] Forced colours: class tabs, marker dots and avatars keep their colour with a CanvasText outline (§1.2). Highlights and citations get a Highlight outline.
- [ ] Reduced motion: the OS setting and Settings → Reduce motion both disable animation (§1.7). Follow-along jumps instead of scrolling smoothly.
- [ ] Fonts: "Easier to read" (Atkinson Hyperlegible Next) and OpenDyslexic apply to the UI, reading text and display (§1.4).

**Content and cognition**
- [ ] One primary action per screen and per dialog. Advanced options are collapsed (`<details>` or a disclosure).
- [ ] Same tabs in the same order in every class (P1). Unshared classes replace Chat + Members with one Share tab.
- [ ] Every error message says what happened and what to do (§5 `errors`, `ai.errors`), with a recovery button.
- [ ] Time limits: none, except the 6–10 s toasts, which pause on hover/focus and whose actions are also available elsewhere (Undo via Ctrl/⌘+Z; restore via Recently deleted).
- [ ] The transcript is the text alternative for every recording. Recordings without a transcript say so and offer to transcribe.
- [ ] Playback 0.5–3× with pitch preserved.

**Automated checks**
- [ ] `tools/peek.mjs --axe` runs for every shot in §7.4 in light, dark and pt, in CI.
- [ ] Desktop e2e `overflowTour` visits every `nav-*`, `class-tabs-*` and `settings-nav-*`.

---

## 7. Demo fixtures (browser demo, screenshots, tests)

Everything in this section is **fictional**. The ribbon says so (`app.example.ribbon`). People, laws, exams and lectures are invented. The "Lei Fundamental de Exemplo" is a made-up constitution of the made-up "República de Exemplo"; its wording must not copy any real constitution.

### 7.1 Files

```
app/src/demo/boot.ts                         memory platform, fakes, URL params, hooks
app/src/demo/freeze.ts                       freeze(clock) (Trama's, verbatim)
app/src/demo/fakeMedia.ts                    createFakeMedia(durationMs): PlayerHandle (performance.now()-driven; 4 Hz time updates)
app/src/demo/example/types.ts                DemoClass, DemoMember, DemoLecture, DemoSegment, DemoDoc, DemoExam, DemoMessage, DemoNote
app/src/demo/example/people.ts               members and devices (§7.3)
app/src/demo/example/law.ts                  "Direito Constitucional I" (pt-PT)
app/src/demo/example/bio.ts                  "Biology 101" (en)
app/src/demo/example/stats.ts                "Estadística I" (es-ES, local only)
app/src/demo/example/hist.ts                 "História do Direito Português" (archived, empty)
app/src/demo/example/content/*.ts            the exact texts (articles, slides, docx paragraphs, transcript key segments)
app/src/demo/example/fill.ts                 fillTranscript(seed, fromMs, toMs, sentences): deterministic filler segments
app/src/demo/example/example.test.ts         every citation quote resolves; markers within duration; all §7.4 routes load
app/src/demo/assets/*.{pdf,pptx,docx,png}    binaries, committed; generated by tools/fixtures/build-demo-assets.mjs
tools/fixtures/build-demo-assets.mjs         run by hand; pdf-lib@1.17.1 (PDFs), jszip (from mammoth's dependency tree; PPTX/DOCX),
                                             ImageMagick `convert` (the scanned PDF page images and the PNG); prints SHA-256 of each output
```

- `content/*.ts` is the **single source** of every fixture text. The asset builder renders the PDFs, PPTX and DOCX from it, and the
  fixtures cite it. `example.test.ts` runs `resolveQuote(sourceText, quote)` (ported from Trama) for every citation and fails on a missing or ambiguous quote.
- **Filler transcript**: between the key segments, `fillTranscript` emits segments from a pool of 40 neutral, fictional sentences per language,
  at about 160 words per minute, with pauses of `(i*7919) % 1100` ms (Trama's pattern; never random).
- **Peaks** for `speech.peaks` in the demo: `p[i] = clamp(60 + 50·sin(i/7) + 40·sin(i/23) + (i·7919 mod 37), 0, 255)`, 1,200 buckets.

### 7.2 URL parameters and hooks

| Param | Values (default first) | Effect |
|---|---|---|
| `demo` | (absent) / `empty` | `empty` = first run: onboarding step 1 |
| `lang` | `en` / `pt` / `es` | UI language (fixture content keeps its own language) |
| `theme` | `light` / `dark` | |
| `clock` | `2026-11-03T15:30` | frozen time, zone `Europe/Lisbon` (a Tuesday) |
| `name` | `Ana Ribeiro` | the profile name |
| `route` | `today` / `class` / `lecture` / `document` / `note` / `exam` / `practice` / `ask` / `settings` | initial route |
| `class` | `law` / `bio` / `stats` / `hist` | with `tab=` (a `ClassTabId`) |
| `lecture` | `l6` `l7` `l8` `b3` `b4` | with optional `at=<ms>`, `cite=1` (opens as from the citation at 41:12) |
| `doc` | `lf` `slides6` `resumo` `acordao` `calendario` `esquemas` `primer` `slides3` `lab2` `cell` `apuntes` | with optional `page=`, `quote=` |
| `note` | `mine6` `class8` | |
| `exam` | `freq` `final` `mock` `quiz1` `pquiz` `parcial` | with `q=` (`I`, `IIa`, `IIb`, `IIc`, `III`, `1`…`4`) and `mode=` |
| `section` | a `SettingsSection` | |
| `ai` | `fake` / `off` / `busy` / `quota` / `badkey` | fake: scripted answers (fixtures, then the `aiNext` queue); busy: every chain → `AI_BUSY` (shows the busy chooser); quota: `AI_FREE_LIMIT`, remaining 0; badkey: `AI_AUTH` |
| `speech` | `fake` | the recorder and transcriber are simulated (`fakeSpeech`) |
| `model` | `ready` / `missing` / `downloading` | speech model state (downloading = 212 of 574 MB, 2.4 MB/s) |
| `sync` | `fake` / `offline` / `error` / `local` | fake: Bruno and Jamie online, Bruno transcribing l8; offline: no peers, my last message pending; error: `SYNC_UNAVAILABLE`; local: the pill shows "Only on this computer" |
| `recording` | `1` | the dock shows a recording of `law` at 00:41:12 |
| `join` | `ask` | `law` has "Ask before letting people in" on and Diogo Santos waiting |
| `unverified` | `1` | adds the unverified device "Carla-PC" |
| `conflict` | `1` | adds a sync-conflict sibling of the class note `class8` |
| `dialog` | any `DialogId` of architecture §11.4 (`new-class` `class-settings` `leave` `invite` `join` `record` `save` `recover` `import` `model` `exam-date` `exam-paper` `answer-settings` `shortcuts` `first-share` `mass-delete`) | opens that dialog on load |
| `code` | an invite code | pre-fills the Join dialog |

Hooks for screenshot steps and e2e: `window.__tramadoDemo = {`
- `addFile(classKey, relPath, base64)`, `queueAnswer(dialogAnswer)`;
- `peerSays(classKey, memberKey, text)`, `peerAdds(classKey, memberKey, relPath, base64)`, `peerJoins(classKey, name, deviceName)`;
- `claimTranscription(lectureKey, memberKey, percent)`, `finishTranscription(lectureKey)`;
- `aiNext(textOrFn)`, `aiFail(code)`;
- `setOnline(memberKey, online)`;
- `tick(ms)` (advances FakeMedia and the fake jobs).

`}`.

### 7.3 Content

**People** (`people.ts`; member keys in brackets):

| Member | Devices | State with `sync=fake` |
|---|---|---|
| [ana] Ana Ribeiro (me; organiser of `law`, `bio`) | "Ana's laptop" (this computer; battery) | — |
| [bruno] Bruno Costa | "Bruno's laptop" | online; syncing `law` (45 MB left) through a relay; transcribing `l8` at 40 %, heartbeat 1 min ago; volunteer: always |
| [carla] Carla Mendes | "Carla's laptop" (last seen today 12:25), "Carla's desktop" (last seen 31 Oct) | offline |
| [jamie] Jamie Lee (`bio` only) | "Jamie's laptop" | online, up to date |
| [diogo] Diogo Santos | "Diogo's laptop" | only with `join=ask`: waiting to join `law`, check words from his device ID |

Check words are computed from fixed fictional device IDs (`AAAAAAA-…`-style, valid base32 with valid Luhn check characters, generated once and committed).

**Class `law`: "Direito Constitucional I"** (short "DC I", teal `#12a594`, icon `scale`, lecturer "Prof.ª Marta Reis", term "2026/27 · 1.º semestre", language `pt-PT`,
shared, members ana, bruno, carla, organisers [ana]). Its consent record: record + share, confirmed by Ana on 20 Oct 2026.
- Folders (PT names, as created by Tramado for a pt class): `Aulas/`, `Documentos/`, `Exames/`, `Notas/`.
- **Documents** (`Documentos/…`):
  - `lf` → `Legislação/Lei Fundamental de Exemplo (texto fictício).pdf`: 24 pages, added by ana on 3 Oct.
    - Every page has the running header "Lei Fundamental de Exemplo — texto fictício para demonstração" (exercises header stripping).
    - Articles 1.º–40.º, with filler wording for the others. The key articles verbatim:
      - p. 5 **Artigo 13.º (Igualdade)** "1. Todas as pessoas têm a mesma dignidade e são iguais perante a lei."
      - p. 9 **Artigo 18.º (Força jurídica dos direitos)**:
        - "1. As normas sobre direitos, liberdades e garantias aplicam-se diretamente e obrigam entidades públicas e privadas."
        - "2. A lei só pode restringir direitos, liberdades e garantias nos casos expressamente previstos nesta Lei Fundamental, e apenas na medida necessária para proteger outros direitos ou interesses nela protegidos."
        - "3. As leis restritivas devem ser gerais e abstratas, não podem ter efeito retroativo e nunca podem atingir o conteúdo essencial do direito restringido."
      - p. 10 **Artigo 19.º (Estado de exceção)**:
        - "1. O exercício de direitos só pode ser suspenso em estado de exceção declarado nos termos desta Lei Fundamental."
        - "2. A declaração do estado de exceção nunca pode afetar o direito à vida, a integridade pessoal, a identidade pessoal, a não retroatividade da lei penal e a liberdade de consciência."
      - p. 12 **Artigo 24.º (Direito à vida)**:
        - "1. A vida humana é inviolável e nenhuma lei pode autorizar a sua privação."
        - "2. A República de Exemplo não admite a pena de morte."
      - p. 15 **Artigo 30.º (Liberdade de reunião)**:
        - "1. Todas as pessoas têm o direito de se reunir pacificamente e sem armas, mesmo em lugares públicos, sem necessidade de autorização."
        - "2. A lei pode exigir aviso prévio às autoridades, nos termos e prazos que fixar."
  - `slides6` → `Slides/Aula 6 — Restrições (slides).pptx`: 8 slides, added by bruno on 20 Oct. The titles are:
    1. "Restrições aos direitos fundamentais"
    2. "Previsão expressa"
    3. "Generalidade e abstração"
    4. "Não retroatividade"
    5. "Proporcionalidade (ver aula 7)"
    6. "Conteúdo essencial — o limite dos limites"
    7. "Exemplo: proibição geral de manifestações"
    8. "Leituras: arts. 18.º e 19.º"

    Each slide has 2–3 bullet lines.
  - `resumo` → `Leituras/Resumo — Direitos, liberdades e garantias.docx`: by carla on 25 Oct. Headings "1. Conceito", "2. Regime", "3. Restrições", about 600 words.
  - `acordao` → `Leituras/Acórdão fictício n.º 12-2026.pdf`: by carla on 22 Oct. 2 **image-only** pages, so it shows "Scan — no text" and the AI reading offer (2 requests).
  - `calendario` → `Do chat/Calendário de avaliações.pdf`: 1 page, attached in chat by carla on 2 Nov.
  - `esquemas` → private `Os meus esquemas.pdf`: 3 pages, "Only on this computer".
- **Lectures** (`Aulas/…`; speaker label "Professora"):
  - `l6` "Aula 6 — Restrições aos direitos fundamentais": Tue 20 Oct 2026 10:00, 5 520 000 ms, room mode, recorded by ana.
    Transcript done by Bruno's laptop (turbo), revision 1. (v1.1 demo: one pending edit by carla, "Corrected by Carla" on s_l6e00.)
    - Key segments (id · time · text):
      - `s_l6a00` 00:00:05 "Bom dia. Hoje vamos falar das restrições aos direitos, liberdades e garantias."
      - `s_l6b00` 00:12:05 "O primeiro requisito é que a restrição esteja expressamente prevista na Lei Fundamental."
      - `s_l6c00` 00:33:40 "O segundo requisito é a generalidade: uma lei restritiva não pode dirigir-se a uma pessoa ou a um caso concreto."
      - `s_l6d00` 00:41:12 "Isto costuma sair no exame: a lei restritiva nunca pode atingir o conteúdo essencial do direito."
      - `s_l6e00` 00:41:25 "É o que diz o artigo 18.º, n.º 3."
      - `s_l6f00` 00:52:30 "Pensem no exemplo de uma lei que proibisse todas as manifestações num distrito inteiro."
      - `s_l6g00` 01:05:00 "Tomem nota: a restrição tem de ser autorizada pela própria Lei Fundamental."
      - `s_l6h00` 01:20:10 "Para a próxima aula, leiam o artigo 19.º sobre o estado de exceção."
      - `s_l6i00` 01:31:40 "Bom trabalho e até terça."
    - My markers: important 00:12:05, exam 00:41:12, confused 00:52:30 (note "rever exemplo"), todo 01:20:10, note 00:33:40 "comparar com art. 19.º".
      Auto exam-radar marks are at 00:41:12 (hidden: within 30 s of a manual exam marker) and 01:05:00 (shown).
    - My highlight: s_l6d00 "nunca pode atingir o conteúdo essencial do direito" (exam). My private summary exists (AiCard, 6 bullets with time chips).
  - `l7` "Aula 7 — Princípio da proporcionalidade": Tue 27 Oct 2026 10:00, 5 040 000 ms, room, recorded by carla, transcribed **on this computer** (turbo).
    - Key segments:
      - `s_l7a00` 00:08:30 "A proporcionalidade divide-se em três testes: adequação, necessidade e proporcionalidade em sentido estrito."
      - `s_l7b00` 00:12:03 "Mesmo uma restrição proporcional tem um limite: o conteúdo essencial é o limite dos limites."
      - `s_l7c00` 00:30:10 "Necessidade quer dizer que não havia meio menos restritivo para atingir o mesmo fim."
    - My markers: important 00:08:30 and 00:30:10, exam 00:12:03.
  - `l8` "Aula 8 — Estado de exceção": Tue 3 Nov 2026 10:00 (today), 4 680 000 ms, room, recorded by carla. Claimed by Bruno's laptop, working, 40 %, eta 25 min. No transcript.
- **Exams** (`Exames/…`):
  - `freq` date: "Frequência" (midterm), Thu 12 Nov 2026 10:00, room "Anfiteatro 1.02", covers "Aulas 1–8; Lei Fundamental, arts. 1.º–24.º", weight "40 %".
  - `final` date: "Exame — época normal" (final), Thu 14 Jan 2027 09:30.
  - `mock` paper: "Frequência 2025/26 (simulada)" (midterm, 2026), source `Exames/Frequência 2025-26 (simulada)/enunciado.pdf` (2 text pages), state ready, imported by ana.
    - Scale pt20. Rules "Permitida a consulta de legislação não anotada", "Duração: 2 h". extraPoints "Redação e organização" 2.
    - Questions:
      - **I** (6, case): "A Assembleia da República de Exemplo aprovou a Lei n.º 7/2026, que proíbe, durante um ano, todas as reuniões e manifestações na cidade de Vila Nova, para «garantir a tranquilidade dos moradores». A lei aplica-se também às manifestações anunciadas antes da sua entrada em vigor. Pronuncie-se sobre a conformidade desta lei com a Lei Fundamental de Exemplo."
      - **II** group "Responda a duas de três" (choose 2):
        - **II.a** (3, short) "Distinga direitos, liberdades e garantias de direitos económicos, sociais e culturais."
        - **II.b** (3, short) "Em que condições pode a lei restringir direitos, liberdades e garantias?"
        - **II.c** (3, short) "O que se entende por «conteúdo essencial» de um direito?"
      - **III** (6, comment): "Comente: «O estado de exceção não suspende o direito à vida.»"
    - AI answers:

      | Q | Model (requested → answered) | Citations (ref → source · locator · quote.exact) | Mine |
      |---|---|---|---|
      | I | Gemma 4 31B → same; quick; asked by ana, 30 Oct | S1 → lf · art. 30.º p. 15 · "sem necessidade de autorização"; S2 → lf · art. 18.º p. 9 · "apenas na medida necessária para proteger outros direitos"; S3 → lf · art. 18.º p. 9 · "nunca podem atingir o conteúdo essencial do direito restringido"; S4 → l6 · 00:52:30 · "uma lei que proibisse todas as manifestações" | mark right; draft (2 lines); in practice; practised 2× |
      | II.a | — (unanswered) | — | draft only; in practice (added manually) |
      | II.b | Gemma 4 31B → **Dots 3 Note Preview** (fallback); asked by ana, 30 Oct | S1 → lf · art. 18.º p. 9 · "nos casos expressamente previstos nesta Lei Fundamental"; S2 → l6 · 00:41:12 · "nunca pode atingir o conteúdo essencial do direito" | mark partly; correct answer written; in practice; practised 1× |
      | II.c | Gemma 4 31B, general knowledge allowed; asked by bruno, 1 Nov | S1 → l7 · 00:12:03 · "o conteúdo essencial é o limite dos limites"; S2 → lf · art. 18.º p. 9 · "nunca podem atingir o conteúdo essencial"; **S9 → hallucinated**; unverified: "Na doutrina alemã fala-se, a este propósito, de «Wesensgehalt»." | no mark; in practice; practised 1× |
      | III | Gemma 4 31B; asked by ana, 30 Oct | S1 → lf · art. 19.º p. 10 · "nunca pode afetar o direito à vida"; S2 → lf · art. 24.º p. 12 · "A vida humana é inviolável" | no mark; in practice |

      Answer texts (Markdown with `[S#]`):
      - **I** uses the case template ("**Questão.** … **Normas aplicáveis.** … **Aplicação.** … **Conclusão.** A lei é desconforme com a Lei Fundamental de Exemplo, por violar os arts. 18.º e 30.º.") and cites S1–S4, including "a professora usou um exemplo semelhante na aula [S4]" and "[S3, n.º 3]".
      - **II.b** is "Só nos casos expressamente previstos na Lei Fundamental [S1], devendo as restrições limitar-se ao necessário e revestir caráter geral e abstrato, sem nunca atingir o conteúdo essencial [S1, n.º 3] [S2]."
      - **II.c** is "É o núcleo do direito que nenhuma restrição pode atingir: o «limite dos limites» [S1] [S2]. Na doutrina alemã fala-se, a este propósito, de «Wesensgehalt». Por isso a jurisprudência exige que reste sempre um espaço útil de exercício do direito [S9]."
      - **III** is "A frase é correta: mesmo em estado de exceção, a declaração nunca pode afetar o direito à vida [S1], que a Lei Fundamental declara inviolável [S2]."
- **Chat** (`.tramado/chat/…`; times are Europe/Lisbon):
  1. Thu 29 Oct 18:40, carla: "Alguém sabe se a frequência continua no dia 10?"
  2. Thu 29 Oct 19:05, bruno: "Mudou! Frequência a 12 nov., anfiteatro 1.02. Vou afixar." (pinned by bruno; system line "Bruno pinned a message."; no exam chip, because an exam date on that day exists)
  3. Mon 2 Nov 10:02, bruno: "Alguém tem os slides da aula 6?"
  4. Mon 2 Nov 10:05, carla, reply to 3: "Estão nos documentos 👍"
  5. Mon 2 Nov 10:06, carla: "E deixo aqui o calendário de avaliações." + attachment `Do chat/Calendário de avaliações.pdf`
  6. Mon 2 Nov 10:09, bruno: "@IA o que disse a professora sobre o conteúdo essencial?"
  7. Mon 2 Nov 10:09, bruno (kind ai; Gemma 4 31B): "A professora explicou que a lei restritiva nunca pode atingir o conteúdo essencial [S1], o que corresponde ao art. 18.º, n.º 3 da Lei Fundamental [S2]." S1 → l6 00:41:12, S2 → lf art. 18.º p. 9
  8. Mon 2 Nov 10:30, bruno (kind thanks, lecture l7, to ana) → "Bruno thanked Ana for transcribing Aula 7."
  9. Tue 3 Nov 11:30, ana: "Obrigada, Bruno!" (my read marker is here)
  10. Tue 3 Nov 11:40, carla: "A aula de hoje já está a ser transcrita pelo Bruno 🙌"
  11. Tue 3 Nov 12:15, bruno: "@Ana tens os apontamentos da aula 7? Faltei à segunda parte." (mentions me)
  12. Tue 3 Nov 12:20, carla: "Eu também agradecia!"

  Unread: 3 (10–12), with 1 mention.
- **Notes**:
  - `mine6` (private) "Notas — Aula 6", with timestamp links at 12:05, 33:40 and 41:12, and a document link to lf p. 9.
  - `class8` (class) `Notas/Resumo partilhado — Semana 8.md`, about 200 words. Bruno is editing it (presence) with `sync=fake`.
- **Ask**: thread `t1` "O que diz o art. 18.º sobre as leis restritivas?", one answer by Gemma 4 31B citing lf art. 18.º p. 9 (S1) and l6 00:41:12 (S2), with "Sent: your question and 9 passages."

**Class `bio`: "Biology 101"** (short "BIO 101", green `#30a46c`, icon `dna`, lecturer "Dr. Sam Okafor", term "Fall 2026", language `en`, shared, members ana and jamie, organisers [ana]).
- Folders: `Lectures/`, `Documents/`, `Exams/`, `Notes/`.
- **Documents**:
  - `primer` → `Readings/Cell Biology Primer (fictional).pdf`: 12 pages.
    - p. 4: "Small non-polar molecules such as oxygen and carbon dioxide diffuse directly across the lipid bilayer."
    - p. 7: "In a hypotonic solution, water moves into the cell by osmosis and the cell swells."
  - `slides3` → `Slides/Lecture 3 — Membranes.pptx` (6 slides).
  - `lab2` → `Lab/Lab 2 — Osmosis worksheet.docx`.
  - `cell` → `Images/Plant cell diagram.png` (a simple labelled drawing).
- **Lectures**:
  - `b3` "Lecture 3 — Cell membranes": Thu 29 Oct 2026 14:00, 3 120 000 ms, **online, stereo** (speakers "Me" / "Class"), recorded by ana, transcribed on this computer.
    - Key segments:
      - `s_b3a00` 00:07:15 (class) "The membrane is a fluid mosaic: lipids and proteins move sideways within the layer."
      - `s_b3b00` 00:18:40 (class) "This will come up on the exam: explain why small non-polar molecules cross the bilayer easily."
      - `s_b3c00` 00:31:05 (me) "Does cholesterol make the membrane more or less fluid?"
      - `s_b3d00` 00:31:20 (class) "It depends on the temperature: cholesterol buffers fluidity in both directions."
    - My markers: important 00:07:15, exam 00:18:40.
  - `b4` "Lecture 4 — Osmosis and diffusion": Mon 2 Nov 2026 14:00, 2 880 000 ms, room, recorded by jamie. **No claim**, so it shows "Waiting for a transcriber".
- **Exams**:
  - `quiz1` date: "Quiz 1" (quiz), Thu 5 Nov 2026 14:00, room "Lab B", covers "Lectures 1–4".
  - `pquiz` paper: "Practice quiz — Membranes" (practice, 2026), typed questions, scale points:
    1. (1, multiple choice) "Which molecules cross the lipid bilayer most easily? (a) glucose (b) oxygen (c) sodium ions (d) proteins"
    2. (2, short) "What does “fluid mosaic” mean?"
    3. (2, short) "What happens to a red blood cell placed in a hypotonic solution?"
    4. (5, essay) "Compare passive and active transport across the membrane."

    AI answers:
    - 1: "(b) oxygen: small non-polar molecules diffuse directly across the bilayer [S1] [S2]." S1 → primer p. 4, S2 → b3 00:18:40.
    - 3: "Water moves into the cell by osmosis, so it swells and may burst [S1]." S1 → primer p. 7.

    In practice: 1, 2, 3.
- **Chat**: jamie "Is the quiz open book?" (Mon 2 Nov 16:00); ana "No, closed book." (16:05); jamie "Thanks!" (16:06). No unread.

**Class `stats`: "Estadística I"** (short "EST I", amber `#f5a524`, icon `sigma`, language `es-ES`, **not shared**).
- Document `apuntes` → `Documentos/Apuntes — Tema 2.pdf` (3 pages; p. 2: "La media muestral es un estimador insesgado de la media poblacional.").
- Exam date "Parcial" (midterm), Tue 24 Nov 2026 09:00.
- No lectures: the Lectures empty state. The Share tab replaces Chat and Members.

**Class `hist`: "História do Direito Português"** (graphite `#8d8d86`, icon `landmark`, archived, local, empty).

### 7.4 Screenshot shots (`tools/screenshots/shots.mjs`; every shot in en, pt and es unless noted)

| name | query | ready | steps |
|---|---|---|---|
| `welcome` | `demo=empty` | `onboarding-welcome` | — |
| `onboarding-ai` | `demo=empty&ai=fake` | `onboarding-welcome` | start → type name → continue → `onboarding-ai` |
| `today` | `route=today&sync=fake&ai=fake` | `screen-today` | — |
| `class-lectures` | `route=class&class=law&tab=lectures&sync=fake` | `lecture-list` | — |
| `lecture` | `route=lecture&class=law&lecture=l6&cite=1&ai=fake` | `lecture-transcript` | — |
| `lecture-dark` | same | `lecture-transcript` | theme dark, en only |
| `lecture-ai` | `route=lecture&class=law&lecture=l6&ai=fake` | `lecture-transcript` | click `lecture-side-ai` |
| `record-dialog` | `route=class&class=law&speech=fake&dialog=record` | `record-dialog` | — |
| `recording` | `route=lecture&class=law&lecture=l7&speech=fake&recording=1` | `record-dock` | — |
| `model-prompt` | `route=lecture&class=bio&lecture=b4&model=missing&dialog=model` | `model-prompt` | — |
| `documents` | `route=class&class=law&tab=documents` | `doc-list` | — |
| `document-pdf` | `route=document&class=law&doc=lf&page=9&quote=nunca%20podem%20atingir` | `doc-pdf-page` | wait for `mark.cite` |
| `exam-review` | `route=exam&class=law&exam=mock&mode=review` | `exam-review` | — |
| `exam-answers` | `route=exam&class=law&exam=mock&q=IIb&ai=fake` | `question-list` | click `reveal-answer` |
| `exam-practice` | `route=exam&class=law&exam=mock&mode=practice` | `exam-practice` | press Space |
| `chat` | `route=class&class=law&tab=chat&sync=fake` | `chat-list` | — |
| `ask` | `route=class&class=law&tab=ask&ai=fake` | `ask-thread` | — |
| `members` | `route=class&class=law&tab=members&sync=fake&join=ask` | `member-list` | — |
| `invite` | `route=class&class=law&tab=members&sync=fake&dialog=invite` | `invite-dialog` | — |
| `join` | `route=today&sync=fake&dialog=join&code=<fixture code>` | `join-dialog` | click `join-continue` |
| `palette` | `route=class&class=law` | `screen-class` | Ctrl+K, type "conteúdo essencial" |
| `settings-ai` | `route=settings&section=ai&ai=fake` | `settings-ai` | — |
| `settings-transcription` | `route=settings&section=transcription&model=downloading` | `settings-transcription` | — |
| `settings-sharing` | `route=settings&section=sharing&sync=fake` | `settings-sharing` | expand `sharing-diagnostics` |
| `settings-privacy` | `route=settings&section=privacy&ai=fake` | `settings-privacy` | — |
| `empty-class` | `route=class&class=stats&tab=lectures` | `lectures-empty` | — |
| `ai-busy` | `route=class&class=law&tab=ask&ai=busy` | `ask-thread` | ask "teste" → `ai-busy-chooser`, en only |

---

## 8. Open questions (each with the default to build)

| # | Question | Default to build | Owner of the final call |
|---|---|---|---|
| OQ1 | Is there a static join page, and where? | Yes, live: `https://feiteira.github.io/Tramado/join/`, built from `site/join/index.html` in the repo (GitHub Pages, `.github/workflows/pages.yml`). It reads `location.hash` and shows the code with [Copy code], [Open in Tramado] (`tramado://join/<code>`; hidden on phones) and a [Get Tramado] link to the homepage's downloads (`../#download`, `site/index.html`, which links each system's file of the newest release). No scripts from other origins, no analytics, no request of its own (CSP `default-src 'none'`). The build constant `JOIN_PAGE` holds the URL; when it is empty, links use `tramado://`. Opening it is a row of Settings › Privacy (`joinPage`). | maintainer |
| OQ2 | Can members other than the recorder rename a lecture? (`lecture.json` has one writer) | No, in 0.1. The menu item is disabled with the tooltip "Only {name}’s computer can rename it". v1.1: a `mod/<dev>.jsonl` "rename" entry honoured from organisers. | data-format spec |
| OQ3 | Shared comments and highlights on transcripts and documents | v1.1, in the format of folder spec §8.17 (`.tramado/annotations/<deviceId>/<YYYY-MM>.jsonl`), anchored as in `audio-pipeline §5.5`, shown read-only with the author's name (`[annotation-shared]`). 0.1 keeps them private (X3). | closed |
| OQ4 | How the "Thank" reaction is stored | A chat line `{type:'thanks', lectureId, to: memberId}` in the thanker's own chat log. Older apps that don't know the type show nothing. If the chat schema cannot take it, post the plain message "Thanks for transcribing {lecture}, {name}!" instead. | data-format spec |
| OQ5 | Waveform peaks for the timeline | `platform.speech.peaks(source, 1200)` (Rust `speech_peaks`, `number[]` 0–255, cached `cache/peaks/<sha256>-<buckets>.json`). Until it returns, the timeline draws a flat rule (markers still work). | closed |
| OQ6 | Exam date edits by members who didn't create it | v1.1: non-creators append `set_exam` lines (folder spec §8.13) for `title`, `date`, `allDay`, `room`, `coversText`, `weightText`; readers apply them over `exam.json`. 0.1: only the creator edits. | closed |
| OQ7 | Default for "Help transcribe the class's lectures" | **"When plugged in"**, effective only once a speech model is installed, with a one-time opt-out notice (sync spec §14.3); the Save dialog defaults to transcribing here unless a classmate volunteers, and an unclaimed lecture nudges its recorder after 24 h. (So "only one person transcribes" never becomes "nobody transcribes".) | product (confirm) |
| OQ8 | Exam-date chip in chat when the date already exists | Suppress the chip when the class already has an exam date on the same day. | — |
| OQ9 | Text size implementation | `platform.window.setZoom(factor)` (webview zoom, capability `core:webview:allow-set-webview-zoom`, architecture §18.4). The demo uses CSS `zoom`. Layout is already tested at 125 %. | closed |
| OQ10 | Marker lead time | 3 s (`audio-pipeline §4.5`), configurable 0/3/5/10 s. | — |
| OQ11 | Who may change "Ask before letting people in" and "Make organiser" | The UI shows these controls only to organisers. Every member's app honours the LWW value in `meta/<dev>.json` from any organiser device (roles are social, G6). Values written by non-organisers are ignored. | data-format spec |
| OQ12 | Check-word lists | 256 adjectives + 256 animal names, ASCII, 3–7 letters, reviewed for offensive combinations, committed once in `docs/spec/check-words-v1.txt` (M0) and imported by `core/sync/checkWords.ts`. Never translated. | closed |
| OQ13 | Model display names | The catalog `name` with the leading "Vendor: " removed ("Google: Gemma 4 31B (free)" → "Gemma 4 31B (free)"). Without a catalog: the id after `/`, with `:free` → " (free)". | — |
| OQ14 | When is "Deep answer" offered by default | When the quick answer is insufficient or grounded < 0.5, or always when `GET /key` reports a daily free limit of at least 1000 (C17). It is always reachable from the AiCard's ⋯ menu. | — |
| OQ15 | Speaker relabelling ("Speakers…") | **0.1** (scope change 2026-11-04) with transcript corrections: a `label_speaker` line (`speakerId`, `label` ≤ 40 chars; folder spec §8.9). Hidden in 0.1. | closed |
