# Tramado implementation plan: work packages for parallel agents

| | |
|---|---|
| Date | 2026-11-03 |
| Repository | `/home/feiteira/Tramado` (git, `main`, no commits yet; remote `origin` = `https://github.com/feiteira/Tramado.git`, public) |
| Contracts | `/home/feiteira/Tramado/docs/dev/architecture.md` ("arch §n"), `/home/feiteira/Tramado/docs/spec/class-folder-v1.md` ("folder spec"), `/home/feiteira/Tramado/docs/spec/sync-protocol-v1.md` ("sync spec") |
| Research | `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/research/*.md` (critique.md §5–§8 is the baseline); lab code under `…/scratchpad/lab/`. **/tmp is cleared at boot**: M0-TS's first step copies this plan to `docs/dev/plan.md`, the reports to `docs/dev/research/` and the lab **sources** (not outputs that contain OpenRouter `user_id`s) to `tools/lab/`; from then on every brief uses the repository copies. |
| Source to borrow from | `/home/feiteira/Trama` (read only; `$TRAMA` below) |
| Machine | 8 CPUs, 11 GB RAM, ~42 GB free disk. Rule: **at most two heavy Rust builds at once** (whisper.cpp / libopus via cmake, or the tauri crate graph). |

`$LAB` = `tools/lab` in the repository after M0 (before M0: `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab`).
Scope: architecture §1.1 lists what 0.1 does **not** build (v1.1); no work package builds those items.

**Scope change, 2026-11-04 (user decision): transcript corrections are in 0.1** — edit mode, fold, fold claims/hand-over (sync spec §14.8), speaker relabelling, and anchors (highlights, comments, markers, citations) that survive a correction. T-LECTURES owns the core + `LectureService.edit`, T-SYNC the fold claims, UI-LECTURES the edit mode (UX §3.5.1 "Edit"). See arch §1.1.

---

## 0. Overview

```
Pre-flight (user action, once): sudo apt install pulseaudio pulseaudio-utils gstreamer1.0-pulseaudio; cargo install cargo-deny --locked
            │
Wave 0 ──┬─ M0-RUST  Cargo.toml/lock, crates/**, desktop/**, tools/fetch-*, test-contract, icons           ── Gate G0  tag m0
         └─ M0-TS    app/**, tools/peek*, screenshots, test-vectors/*, docs copies, check-words list
            │
Wave 1 ──┬─ R-SHELL   (Rust, medium-heavy: tauri)  base extras, tramado-net, desktop shell commands, media scheme
         ├─ R-SYNC    (Rust, light)                tramado-sync (+ signatures) + contract/two-instance tests
         ├─ R-SPEECH  (Rust, HEAVY: whisper/opus)  tramado-speech — continues through wave 2, merges at G2
         ├─ T-SYNC    (TS)  core/sync, library/class/sync/chat/presence/trust/claims services, memory mesh
         ├─ T-AI      (TS)  core/ai, core/exam, ai/exams/ask services, fake AI, live OpenRouter test
         ├─ T-DOCS    (TS)  import/search/text/notes core, workers, documents/extraction/search/notes/annotations
         ├─ T-LECTURES(TS)  core/transcript, lectures/recording/transcription/models services, fake speech
         └─ T-DEMO    (TS)  the fictional demo of UX §7: example content, assets, seed (files only)       ── Gate G1  tag wave1
            │
Wave 2 ──┬─ UI-SHELL    shell, rail, pills, dock frame, palette frame, onboarding, Today, class frame, settings (minus AI/transcription/sharing)
         ├─ UI-GROUP    chat, members, invite/join dialogs, admission notices, sync dialogs, settings › sharing, join page
         ├─ UI-LECTURES lectures tab, lecture view, recording flow, dock rows
         ├─ UI-DOCS     documents tab, document view, notes, search results in the palette
         └─ UI-EXAMS    exam paper flow (extract → review → answers → practice), Ask               ── Gate G2  tag wave2
            │
Wave 3 ──┬─ INT    desktop integration, desktop e2e (smoke, sync-two, sync-three, media), packaging (heavy)
         ├─ DOCS   README, AGENTS.md, PRIVACY.md, manual, CI workflows, cargo-deny, version check, spec erratum
         └─ L10N   PT-PT / ES review of every namespace, consent wording, installer strings   ── Gate G3  tag v0.1.0-rc.1
```

| WP | Wave | Kind | Heavy build? | Size | Depends on |
|---|---|---|---|---|---|
| M0-RUST | 0 | scaffold (Rust) | yes, once (`cargo check --workspace`) | L | — |
| M0-TS | 0 | scaffold (TS) | none | L | — (in parallel with M0-RUST; command names from arch §6 tables, checked by `commands.test.ts` at G0) |
| R-SHELL | 1 | Rust + TS bindings | medium (tauri, `--no-default-features`) | L | G0 |
| R-SYNC | 1 | Rust + TS binding | light, but `cargo check -p tramado-desktop` builds the tauri graph: `CARGO_BUILD_JOBS=2` | L | G0 |
| R-SPEECH | 1–2 | Rust + TS binding | **heavy** | XL | G0; merges at G2 |
| T-SYNC | 1 | TS | none | XL | G0 |
| T-AI | 1 | TS | none | L | M0 |
| T-DOCS | 1 | TS | none | L | M0 |
| T-LECTURES | 1 | TS | none | M | M0 |
| T-DEMO | 1 | TS (content) | none | M | M0 |
| UI-SHELL, UI-GROUP, UI-LECTURES, UI-DOCS, UI-EXAMS | 2 | TS/React | none | L each | G1 |
| INT | 3 | integration | **heavy** (release builds) | L | G2 |
| DOCS | 3 | docs/CI | none | M | G2 |
| L10N | 3 | translations | none | M | G2 |

Concurrency (11 GB RAM + 3 GB swap, 8 CPUs): **at most 6 agents at once**. Wave 1 starts R-SPEECH first (its
whisper.cpp and libopus cmake builds peak at ≈ 2–3 GB), then R-SHELL ten minutes later, then R-SYNC, T-SYNC, T-AI and
T-DOCS; T-LECTURES starts when the first TS package finishes, T-DEMO after the next one. Heavy cargo commands run under
`systemd-run --user --scope -p MemoryMax=4G -- …`, so an OOM kills the build, not an agent. Wave 2 has no Rust builds
except R-SPEECH finishing. In wave 3 only INT builds Rust.

**Pre-flight (user action, before wave 1; needs sudo).** `sudo apt install pulseaudio pulseaudio-utils
gstreamer1.0-pulseaudio` (the media self-test needs a PulseAudio null sink; this machine has no pulseaudio/pactl/pipewire)
and `cargo install cargo-deny --locked`. The versions are recorded in `AGENTS.md`. Gates G1–G3 fail with a clear message
when these tools are missing. A funded `OPENROUTER_API_KEY` (a few cents) is needed for the live STT check; the
free-model checks need any key.

---

## 1. How the orchestrator runs the plan

### 1.1 Worktrees, branches, environment

```bash
cd /home/feiteira/Tramado
git worktree add /home/feiteira/Tramado-wt/<wp> -b wp/<wp> main     # after G0 (main has the M0 commit)
cd /home/feiteira/Tramado-wt/<wp> && npm ci
```
Each worktree has its own `node_modules/` (≈ 0.6 GB) and its own `target/` (with `debug = "line-tables-only"`, arch §3.2:
R-SHELL ≈ 2.5 GB, R-SPEECH ≈ 2 GB, R-SYNC ≈ 1 GB; TS packages build no Rust). Rust worktrees are seeded after G0 with
`cp -a --reflink=auto /home/feiteira/Tramado/target <wt>/target` so tauri, libopus and whisper.cpp are not rebuilt from
scratch. Environment for every agent:
```
CARGO_BUILD_JOBS=3  CMAKE_BUILD_PARALLEL_LEVEL=3  VITEST_MAX_WORKERS=2  NODE_OPTIONS=--max-old-space-size=3072
TRAMADO_SYNCTHING_FROM=/home/feiteira/Tramado/tools/.cache  TRAMADO_SPEECH_FROM=/home/feiteira/Tramado/.tramado-dev/models
# R-SYNC: CARGO_BUILD_JOBS=2. R-SPEECH's ignored release test: CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
```
Run cargo **from the worktree root** (so `.cargo/config.toml` applies). After a WP is merged, remove its worktree and
`target/` (`git worktree remove --force …`).

### 1.2 What each agent receives and returns

Brief = its section of this plan + arch (all of it; agents read the sections their WP cites) + the two specs + the
research reports named in its section. Return (≤ 300 words, then lists):
1. Summary of what was built.
2. Files created/changed (paths).
3. Acceptance commands run, with pass/fail.
4. Peek PNG paths (UI and demo-visible work), with what each shows.
5. **Contract changes requested** (arch §19.2): each with the exact old/new signature and the reason.
6. Known gaps and follow-ups (none may be silently skipped).

### 1.3 Merging and gates

- Merge order inside a wave is fixed (§5, §7, §9). For each WP: `git -C <wt> rebase main`; re-run its acceptance;
  reject the branch if `git diff main...wp/<wp> -- Cargo.lock` is non-empty without a listed contract change (the
  integrator regenerates the lock at the gate, arch §3.2); `git checkout main && git merge --no-ff wp/<wp> -m "Merge <WP>"`;
  run the **quick check** (`npm run typecheck && npm test && npm run build && npm run test:rust && npm run check:leaks`).
- After the last merge of a wave: apply requested contract changes (integrator commit), run the full gate, commit,
  tag, push: `git push origin main --tags`.
- Commit messages: `<WP>: <summary>` + body + trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Never commit secrets (`.env*`, keys) — the repository is public. `npm run check:leaks` (arch §17) must pass before
  every merge and every push; a push to `feiteira/Tramado` cannot be taken back.

### 1.4 Rules every WP follows (arch §19, repeated because they are the contract)

1. Edit only owned paths (listed per WP). Frozen files (arch §19.1) are never edited by a WP.
2. Additive changes only to the owned `platform/types/<domain>.ts` (+ the Rust twin + the binding).
3. All new user-facing strings in EN, PT-PT and ES in the WP's own namespaces. Wave 1 adds no UI strings; a new
   `notify.*` key is a contract change.
4. `data-testid` on everything tests or peek touch; ready ids exactly as arch §11.5.
5. No StrictMode; no DOM in `core/`/`services/`; fictional fixtures only; no network in tests (loopback and the
   opt-in live AI test excepted).
6. Rust: no `unwrap`/`expect` outside tests; named threads; `blocking` for I/O; clippy clean with `-D warnings`.
7. When something in the specs or arch seems wrong, do not deviate silently: implement the spec, and report it.

---

## 2. M0 — Scaffold (wave 0, two agents in parallel, must finish first)

**Goal.** A repository where every contract of arch §5–§11 exists as code, every shared registration point is
pre-populated, all reusable Trama code is ported, and the browser demo shell renders — so that every later WP
only fills in files it owns.

**Split.** M0-RUST owns `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `.cargo/**`, `crates/**`, `desktop/**`,
`tools/{fetch-syncthing,fetch-speech-assets,test-contract}.mjs`, `tools/keys/**`, icons, and the Rust readers of
`test-vectors/*`. M0-TS owns everything else of §2.2 (root `package.json`/lock, `app/**`, `tools/peek*`,
`tools/screenshots/**`, `tools/{redact-fixtures,check-leaks}.mjs`, `test-vectors/*.json`, `docs/spec/check-words-v1.txt`,
`docs/dev/{plan.md,research/**}`, `tools/lab/**`, `site/join/index.html` placeholder). Both derive command names and
types from arch §6 and §9; `platform/commands.test.ts` compares them at G0. **M0-TS's first step** is the copy of the
plan, reports and lab sources into the repository (header of this plan).

**Research to read**: arch (all), folder spec, sync spec, `research/trama-ui.md` §1, §3, §4, §6;
`research/trama-ts.md` §1, §2, §8–§10; `research/trama-rust.md` §2–§5, §7.4, §9.

### 2.1 Copy map (sources → destinations)

| From | To | How |
|---|---|---|
| `$TRAMA/LICENSE` | `LICENSE` | verbatim |
| `$TRAMA/rust-toolchain.toml`, `$TRAMA/.cargo/config.toml` | same paths | verbatim (keep comments; replace "Trama" by "Tramado" in comments) |
| `$TRAMA/app/tsconfig.json`, `$TRAMA/app/vite.config.ts`, `$TRAMA/app/index.html` | `app/` | adapt (arch §3.4, §18.3: CSP meta + `https://openrouter.ai`; pre-paint `#…` from the new tokens; `maxWorkers` env) |
| `$TRAMA/app/src/ui/**` | `app/src/ui/**` | verbatim, then: `tokens.css` = UX §1.2 verbatim, `classColor.ts`/`classIcons.ts` (UX §1.3), `fonts.css`/`fonts.ts` (UX §1.4), `ColorPicker` → `CLASS_COLORS`, `problems.ts` → Tramado codes, `trama.` → `tramado.` storage prefixes, `tokens.test.ts` + pairs of `$LAB/trama-ui/scripts/contrast.mjs` and `classmix.mjs` |
| `$TRAMA/app/src/shell/{router.tsx,commands.ts,useCommands.ts,CommandPalette.tsx,palette.css,ErrorBoundary.tsx,errorboundary.css,arrival.ts,activity.web.ts,keys.ts,savers.ts,reloadGate.ts,useLive.ts,undo.tsx,undoFeedback.ts,ScreenHeader.tsx,Placeholder.tsx,initial.ts,helpTopic.ts,shell.css}` + their tests | `app/src/shell/` | verbatim, then adapt imports; `arrival.ts` keys per arch §11.4; drop lock/keyring/auto-lock code |
| `$TRAMA/app/src/core/i18n/{translate,languages,catalogs}.ts`, `catalogs.test.ts`, `$TRAMA/app/src/ui/i18n.tsx` | same | verbatim |
| `$TRAMA/app/src/core/{bytes.ts,bytes.test.ts,hlc.ts,hlc.test.ts}` | `app/src/core/` | verbatim + HLC guard (arch §11.1) |
| `$TRAMA/app/src/core/import/**` (minus `csv.ts`, `xlsx.ts`, `survey.ts`, `tables.test.ts`; edit `index.ts`/`detect.ts` accordingly) + `$TRAMA/app/test-fixtures/import/**` + `$TRAMA/app/src/core/export/forgeZip.testutil.ts` | `app/src/core/import/`, `app/test-fixtures/import/`, `app/src/core/export/` | verbatim; `core/model/types` imports replaced by `core/model/legacy.ts` (`SyncPoint`, `LIMITS` shim, trama-ts §9) |
| `$TRAMA/app/src/core/qda/{rank,text,util,search}.ts` + tests + `stopwords/` | `app/src/core/search/` | verbatim (fix the false cross-language comment in `rank.ts`) |
| `$TRAMA/app/src/core/text/{markdown,normalize}.ts` + tests | `app/src/core/text/` | verbatim |
| `$TRAMA/app/src/core/speech/{types,transcript,timing}.ts` + tests | `app/src/core/speech/` | verbatim |
| `$TRAMA/app/src/platform/tauri.ts` (helpers) | `app/src/platform/tauri/index.ts` | adapt (`call`, `toPlatformError`, `toBytes`, `body`, header encoding, `isTauri`) |
| `$TRAMA/app/src/demo/boot.ts` (`freeze()`) | `app/src/demo/freeze.ts` | verbatim `freeze()`; new `boot.ts` |
| `$TRAMA/tools/screenshots/capture.mjs` | `tools/screenshots/capture.mjs` | adapt (warm-up ready id `screen-today`, hook name `__tramadoDemo`, output `docs/manual/img/<lang>/`) |
| `$LAB/trama-ui/scripts/peek.mjs` | `tools/peek.mjs` | verbatim, defaults adapted (`--route` → `?route=`; `--query` appended) |
| `$LAB/syncthing/release-key.txt` | `tools/keys/syncthing-release.asc` | verbatim |
| `$TRAMA/desktop/src-tauri/src/{main.rs, error.rs, files.rs, lib.rs helpers}` | `desktop/src-tauri/src/main.rs`, `crates/tramado-base/src/{error.rs,files.rs}`, `desktop/src-tauri/src/util.rs` | adapt per arch §5.1, §5.5, §15 |
| `$TRAMA/desktop/src-tauri/src/service/mod.rs` `#[cfg(test)] mod mock` | `crates/tramado-net/src/testutil.rs` | adapt into `pub struct MockServer` (canned responses, records request line/headers/body, supports chunked SSE bodies with delays) |

### 2.2 Files M0 creates (complete list)

Legend: **impl** = fully implemented and tested in M0; **stub** = signatures/types exact, bodies return
`NOT_IMPLEMENTED` (Rust) or throw `PlatformError('NOT_IMPLEMENTED')` / return empty stores (TS); **ph** = placeholder
UI. "→ X" = owner from wave 1/2 on.

```
/ (repository root)
  .gitignore              impl  keep existing lines; add arch §2 additions
  .gitattributes          impl  "* text=auto eol=lf"; binary: *.webm *.pdf *.png *.jpg *.ico *.icns *.bin *.docx *.pptx
  .editorconfig           impl
  LICENSE NOTICE          impl  NOTICE credits Trama (MPL-2.0, same author), Syncthing (MPL-2.0), whisper.cpp (MIT), libopus (BSD-3), fonts (OFL-1.1)
  README.md               impl  minimal (what, status "pre-alpha", dev commands)                       → DOCS
  AGENTS.md CLAUDE.md     impl  commands (arch §3.4), layout pointer, arch §19 rules, languages         → DOCS
  package.json            impl  arch §3.4 (exact)
  package-lock.json       impl  generated by `npm install`
  rust-toolchain.toml  .cargo/config.toml   impl (copy)
  Cargo.toml              impl  arch §3.2 (exact; every dependency of every crate declared)
  Cargo.lock              impl  generated
  test-vectors/
    admission.json        impl  cases of §2.4 below                                                     (frozen; both R-SYNC and T-SYNC test against it)
    class-paths.json      impl  ≥ 30 cases of §2.4 below                                                (frozen)
    hlc.json              impl  format/compare/tick/observe/override cases from folder spec §3 (TS only)
    error-codes.json      impl  arch §15 list
    ids.json              impl  derived classId / itemId / memberId cases (folder spec §2.1), canonical device ID of a cert DER
    time.json             impl  instant(ms) / parseRfc3339 cases incl. ns fractions and offsets (arch §5.1 time)
    check-words.json      impl  ≥ 20 deviceId → words cases (sync spec §25 Q1)
    ipc-samples.json      impl  one JSON sample per tagged IPC type of arch §5 (serde round trip in Rust and TS)
docs/
  spec/check-words-v1.txt impl  256 adjectives + 256 animal names (ASCII, 3–7 letters, reviewed), "ADJ <word>" / "NOUN <word>" lines (frozen)
  dev/plan.md, dev/research/*.md   copies (first step)
tools/lab/**              copies of the lab sources (no outputs with user ids)
site/join/index.html      ph   placeholder (UI-GROUP builds it)
app/
  package.json tsconfig.json vite.config.ts index.html     impl
  public/favicon.svg public/brand.svg                    impl  brand mark of research/trama-ui.md §2.6
  public/demo/lecture.webm                               impl  `ffmpeg -f lavfi -i "sine=frequency=220:duration=300" -ac 1 -ar 16000 -c:a libopus -b:a 24k -f webm` (≈ 0.9 MB)  → T-LECTURES may replace
  scripts/env-run.mjs                                    impl
  scripts/gen-privacy.ts                                 stub (prints "not generated yet")                → UI-SHELL
  test-fixtures/import/**                                impl (copy)
  test-fixtures/tramado/README.md                        impl  (how fixtures are generated; fictional only)
  src/main.tsx App.tsx env.d.ts                          impl
  src/layers.test.ts                                     impl  import rules of arch §11
  src/core/errors.ts  errors.test.ts                     impl  (test compares with test-vectors/error-codes.json)
  src/core/model/ids.ts files.ts formats.ts parse.ts paths.ts sanitize.ts dirs.ts limits.ts legacy.ts   impl
  src/core/model/derive.ts jcs.ts sig.ts time.ts (+ tests over ids.json, time.json, RFC 8785 examples)   impl (frozen)
  src/core/model/{ids,parse,paths,sanitize,formats}.test.ts                                              impl
  src/core/hlc.ts hlc.test.ts ids.ts ids.test.ts json.ts json.test.ts bytes.ts bytes.test.ts           impl
  src/core/util/prng.ts result.ts debounce.ts                                                            impl
  src/core/sync/checkWords.ts checkWords.test.ts                                                         impl (frozen)
  src/core/search/resolve.ts (resolveQuote ported from $LAB/trama-ts/cite.ts)                            impl → T-DOCS completes
  src/core/transcript/units.ts units.test.ts                                                             impl → T-LECTURES
  src/core/i18n/translate.ts languages.ts catalogs.ts catalogs.test.ts                                   impl (copy)
  src/core/i18n/locales/{en,pt,es}/index.ts                                                              impl (frozen)
  src/core/i18n/locales/{en,pt,es}/<ns>.ts for all 22 namespaces of arch §14                             impl: EN = UX §5 verbatim for every namespace; PT/ES complete for `common`, `errors`, `a11y`, `notify`; others = EN copy + `export const pending = true`  → namespace owners (PT/ES)
  src/core/text/** import/** search/** speech/** export/forgeZip.testutil.ts                             impl (copy)  → T-DOCS (text, import, search), T-LECTURES (speech)
  src/platform/types/{common,app,classes,ai,sync,speech,index}.ts                                        impl (arch §9 verbatim; `SyncEvent` in sync.ts, `AiWireEvent` in ai.ts, `ModelEvent`/`RecorderEvent`/`TranscribeEvent`/`ImportEvent` in speech.ts, `ClassChangedEvent` in classes.ts)
  src/platform/tauri/index.ts app.ts classes.ts dialogs.ts ai.ts system.ts events.ts media.ts           impl (bindings)  → R-SHELL
  src/platform/tauri/sync.ts                                                                             impl (bindings)  → R-SYNC
  src/platform/tauri/speech.ts                                                                           impl (bindings)  → R-SPEECH
  src/platform/tauri/tauri.test.ts                                                                       impl  (vi.mock invoke; one assertion per binding group, Trama pattern)
  src/platform/commands.test.ts                                                                          impl  (command names in platform/tauri/*.ts == generate_handler! list in lib.rs)
  src/platform/memory/index.ts app.ts files.ts classes.ts dialogs.ts secrets.ts media.ts window.ts system.ts events.ts memory.test.ts   impl (frozen in wave 1; every `MemoryPlatform.mem` hook of arch §10, incl. a WebCrypto Ed25519 device signer and person key)
  src/platform/memory/ai.ts                                                                              stub (every send → `fail{AI_NO_KEY}`)  → T-AI
  src/platform/memory/speech.ts                                                                          stub (`createFakeSpeech()` returns an object whose methods throw NOT_IMPLEMENTED)  → T-LECTURES
  src/platform/memory/sync.ts                                                                            stub (identity → fixed demo device; folder ops succeed locally; others NOT_IMPLEMENTED)  → T-SYNC
  src/platform/memory/mesh.ts                                                                            stub (`createMemoryMesh` signature of arch §10; throws)  → T-SYNC
  src/services/index.ts store.ts context.ts                                                              impl (frozen)
  src/services/prefs.ts identity.ts hlcClock.ts classStore.ts  (+ tests)                                 impl (no owner after M0: frozen; bugs are reported and fixed by the integrator at a gate)
  src/services/types/{common,library,class,sync,chat,lectures,recording,transcription,documents,notes,search,exams,ai,ask,index}.ts   impl (arch §11.2 verbatim; ClaimEngine, ClaimView, PresenceService, TrustService in types/sync.ts)
  src/services/testing/fakeSearch.ts fakeClaims.ts                                                      stub → T-AI, T-LECTURES
  src/services/library.ts                 impl-min (lists registry entries + class.json initialName, default colour/icon; create/adopt/archive/forget work without meta fold)  → T-SYNC
  src/services/{class,sync,presence,trust,claims,chat,notifications}.ts                                  stub  → T-SYNC
  src/services/{ai,exams,ask}.ts                                                                         stub  → T-AI
  src/services/{documents,extraction,search,notes,annotations}.ts                                        stub  → T-DOCS (ExtractionService of arch §11.2)
  src/workers/hosts.ts (createWorkerHost, createInlineHost, createWorkerExtractHost, createInlineExtractHost)   impl (inline hosts) → T-DOCS
  src/services/{lectures,recording,transcription,models}.ts                                              stub  → T-LECTURES
  src/workers/rpc.ts                                                                                      impl  → T-DOCS
  src/workers/search.worker.ts extract.worker.ts image.worker.ts                                          stub  → T-DOCS
  src/ui/** incl. ui/tramado/<the 20 M0 components of arch §11.3>                                         impl (port + UX §1, §2.11)  → UI-SHELL (MarkdownView → T-DOCS in wave 1)
  src/shell/** (copies + AppState Layout Rail SyncPill AiPill Dock routes useStore useDialogs)            impl  → UI-SHELL (routes.ts frozen)
  src/services/types/viewModels.ts                                                                        impl (UX §2.12, §3.9.1, §3.10.1, §4.1 verbatim; frozen)
  src/features/registry.tsx                                                                               impl (arch §11.4; frozen)
  src/features/<every folder of arch §11.5>/<every file the registry imports>                             ph (§2.3)  → wave-2 owners
  src/demo/boot.ts freeze.ts hooks.ts controls.ts keys.ts                                                impl (frozen; UX §7.2 params parsed into DemoFlags; freeze.ts is in arch §11.6 and §19.1)
  src/demo/seed.ts                                                                                         impl-min (writes `class.json` + creator meta + my member file for law/bio/stats/hist, with the UX names, colours, icons)  → T-DEMO
  src/demo/example/README.md                                                                               impl (points to UX §7)  → T-DEMO
desktop/
  package.json                                                                                            impl
  src-tauri/Cargo.toml build.rs tauri.conf.json tauri.sidecar.conf.json capabilities/default.json         impl (arch §3.3, §18)
  src-tauri/Info.plist macos/Entitlements.plist macos/{en,pt,es}.lproj/InfoPlist.strings                  impl (texts per trama-rust §2.8, rewritten for lectures)  → R-SHELL
  src-tauri/icons/source.svg + generated icons (`npm run tauri --workspace desktop -- icon src-tauri/icons/source.svg`; if SVG input fails, rasterise with `convert -background none -size 1024x1024 source.svg source.png` first)   impl
  src-tauri/resources/media/selftest.webm   impl (copy of app/public/demo/lecture.webm)  → R-SPEECH regenerates with its own muxer
  src-tauri/src/main.rs lib.rs state.rs util.rs                                                           impl (frozen)
  src-tauri/src/commands/mod.rs                                                                           impl (frozen)
  src-tauri/src/commands/{app,classes,dialogs,ai,system}.rs media.rs tray.rs window.rs deeplink.rs         stub (+ the M0-implemented parts listed in §2.3)  → R-SHELL
  src-tauri/src/commands/sync.rs                                                                          stub  → R-SYNC
  src-tauri/src/commands/speech.rs                                                                        stub  → R-SPEECH
crates/
  tramado-base/Cargo.toml src/{lib,error,ids,paths,registry,confine,files,classfs,picks,appfiles,time}.rs (+ unit tests)   impl  → R-SHELL (bug fixes only for these modules)
  tramado-base/src/{watch,media,power,applog}.rs                                                          stub  → R-SHELL
  tramado-net/Cargo.toml src/lib.rs src/testutil.rs src/http.rs                                            impl (http: the four agents of arch §5.2)
  tramado-net/src/secrets.rs                                                                               impl-min (file backend, 0600, file_only) → R-SHELL adds the keychain
  tramado-net/src/{hosts,privacy,ai,activity,person}.rs                                                    stub (types exact)  → R-SHELL
  tramado-sync/Cargo.toml src/lib.rs src/types.rs                                                          impl (SyncEngine methods stubbed; every IPC type of arch §9 sync.ts as serde structs)  → R-SYNC
  tramado-sync/src/{init,supervisor,client,config_writer,events,managed,folders,invite,admission,reconcile,bans,discovery,selfheal,guard,scan,policy,appdata,diag,existing,sign}.rs   empty modules with a `//! sync spec §n` header  → R-SYNC
  tramado-speech/Cargo.toml src/lib.rs src/types.rs src/registry.rs                                        impl (registry data per arch §5.4; Speech methods stubbed)  → R-SPEECH
  tramado-speech/src/{download,cpu,awake,capture,mixer,encode,journal,webm,publish,decode,resample,import,vad,whisper,remote,jobs,heartbeat,peaks}.rs   empty modules  → R-SPEECH
tools/
  fetch-syncthing.mjs fetch-speech-assets.mjs test-contract.mjs                                           impl (arch §18.1, §18.2; test-contract: fetch host binary, then `cargo test -p tramado-sync --test contract --test two_instances -- --ignored --test-threads=1` with TRAMADO_SYNCTHING_BIN; if those test targets do not exist yet, print "no contract tests yet" and exit 0)
  peek.mjs peek-matrix.mjs peek-routes/m0.json                                                             impl (peek-matrix runs every entry of every `tools/peek-routes/*.json`, writes PNGs to `tools/peek/out/<file>/<name>.png`, exits 1 on any failure; step and assertion verbs of §2.3 item 10)
  redact-fixtures.mjs check-leaks.mjs                                                                       impl (arch §17)
  screenshots/capture.mjs screenshots/shots.mjs                                                            impl (2 shots: welcome, today)  → UI-SHELL (shots.mjs), INT (capture.mjs)
  keys/syncthing-release.asc                                                                               impl (copy)
docs/dev/architecture.md                                                                                   exists (do not edit; report problems)
(§10 matrix: services/types/common.ts → integrator after M0)
```

### 2.3 Behaviour M0 must implement (beyond copying)

1. **`core/model/*`** per arch §11.1 (spec transcription; `files.ts` field-for-field from folder spec §8 and sync spec
   §7.1/§19). `paths.test.ts` and the Rust `confine` tests both read `test-vectors/class-paths.json`.
2. **`services/classStore.ts`** fully per arch §11.2 and §12 (discovery, ingest with ReloadGate, per-kind counters,
   `readJson`/`readJsonl` incremental reads, own-write echo suppression, default trust gate). Tests over the memory
   platform: discovery finds lectures/exams by manifest in renamed folders (folder spec §5.3), skips §4.5 names,
   detects duplicate manifest ids and conflict copies; incremental JSONL read; rescan.
3. **`services/index.ts`**: `createServices(ctx)` wiring all factories (arch §11.2); app-level router of
   `platform.events` to `ClassStore.ingest` and to `services.sync` (stub tolerates events).
4. **Memory platform**: path rules identical to Rust (shared vectors), atomic semantics, `onClassChanged` after every
   write with `selfWrite: true`, `addFile` hook for the demo, dialogs answered from a queue.
5. **Rust `tramado-base`** impl modules with unit tests: confine (vectors + a planted symlink → `SYMLINK_REFUSED`),
   `write_atomic` temp naming and cleanup, `append_line` limits, registry round trip keeping unknown fields,
   `ClassFs` own-write mirroring and observer calls, picks, appfiles key regex, `Code` list == `test-vectors/error-codes.json`.
6. **Desktop crate**: `lib.rs` exactly as arch §5.5 with **every** command of arch §6 in `generate_handler!`;
   `state::setup` builds `Shared` and calls every `commands::<domain>::init`; in the stubs `init` only manages an empty
   state, every command returns `Err(util::not_implemented("<name>"))`, **except** these, which M0 implements because
   the demo-less desktop app must at least boot: `app_info`, `app_file_read`, `app_file_write`, `app_log`,
   `classes_list`, `app_take_pending_links` (returns `[]`).
7. **Placeholders** (`ph`): every file `features/registry.tsx` imports exists. A placeholder screen/tab/section renders
   its root test id of arch §11.5 (e.g. `screen-today`, `class-lectures` containing `lecture-list`), an `h1` from its
   namespace, and `<pre data-testid="placeholder-data">` with a JSON summary of the store(s) it will show (today: class
   names; class: `ClassView`; lectures: `lectures.list` ids/titles/`transcription.kind`; documents, notes, exams, chat,
   members, ask: counts and the first three titles; lecture: segment count; exam: question count; settings: its prefs).
   A placeholder dialog renders a `Dialog` with its UX root id (`record-dialog`, `invite-dialog`, `join-dialog`, …).
   Stubs that throw are caught and shown as `"NOT_IMPLEMENTED"`.
8. **Layout**: rail (classes from `library.classes`, Archive group, `RAIL_BADGES`), sync and AI pills (placeholder
   states), top bar (`ScreenHeader`), dock frame (`DOCK_ROWS`), overlay host (`OVERLAYS`), palette (`PALETTE_PROVIDERS`),
   screen host (`SCREENS`), class tab host (`CLASS_TABS`), settings host (`SETTINGS_SECTIONS`), dialog host (`DIALOGS`,
   `useDialogs`).
9. **Demo** (`boot.ts`): every parameter of UX §7.2 is parsed into `DemoFlags` and passed to the fakes; `route=` plus the
   key parameters (`class`, `lecture`, `doc`, `note`, `exam`, `q`, `mode`, `section`, `tab`, `at`, `page`, `quote`, `cite`)
   resolve through `DemoKeys` (filled by `demo/seed.ts`); unknown keys show the Missing state; `dialog=<DialogId>` opens
   that dialog after the first render; `hooks.ts` exposes `window.__tramadoDemo` (UX §7.2) delegating to `DemoControls`.
10. **Tools**: `fetch-syncthing.mjs` downloads and verifies the Linux binary on this machine (run it once);
    `peek.mjs` works on the demo and supports, besides the lab options, step options executed in order after the ready
    id: `--click=<testid>[,…]`, `--press=<key>[,…]` (Playwright key names, e.g. `Control+K`, `Space`),
    `--type=<testid>=<text>`, and assertions `--expect=<testid>[:<count>]`, `--expect-not=<testid>`,
    `--expect-text=<testid>=<substring>`, `--expect-attr=<testid>:<attr>=<value|null>` (each step exits 1 on a mismatch);
    `peek-matrix.mjs` reads `steps` arrays with the same verbs.
11. **Boot marker**: `App.tsx` calls `platform.log('info', 'webview ready')` once after the first render of any phase
    (used by `tools/desktop-smoke.mjs` and the desktop e2e).

### 2.4 Shared test vectors (content M0 writes)

`test-vectors/admission.json`:
```json
{ "format": "tramado.test-vectors.admission", "version": 1,
  "decide": "decide(policies, global, offer, nowMs) -> share | queue | ban | skip | unknown",
  "cases": [
    {"name": "proof shares", "offer": {"folderId": "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa", "deviceId": "D1", "inFolder": false}, "expect": "share"},
    {"name": "already in folder", "offer": {"inFolder": true}, "expect": "skip"},
    {"name": "banned device", "policy": {"bannedDevices": ["D1"]}, "expect": "ban"},
    {"name": "banned beats known", "policy": {"bannedDevices": ["D1"], "knownDevices": ["D1"]}, "expect": "ban"},
    {"name": "ask, unknown device", "policy": {"askBeforeAdmit": true}, "expect": "queue"},
    {"name": "ask, known member", "policy": {"askBeforeAdmit": true, "knownDevices": ["D1"]}, "expect": "share"},
    {"name": "ask, pairing open", "policy": {"askBeforeAdmit": true}, "global": {"pairingOpenUntil": 2000}, "now": 1000, "expect": "share"},
    {"name": "ask, pairing expired", "policy": {"askBeforeAdmit": true}, "global": {"pairingOpenUntil": 500}, "now": 1000, "expect": "queue"},
    {"name": "ask, own device", "policy": {"askBeforeAdmit": true}, "global": {"ownDevices": ["D1"]}, "expect": "share"},
    {"name": "unknown class", "offer": {"folderId": "tramado-bbbbbbbbbbbbbbbbbbbbbbbbbb"}, "expect": "unknown"},
    {"name": "not a tramado folder", "offer": {"folderId": "photos"}, "expect": "unknown"}
  ] }
```
(Defaults for omitted fields: the class `tramado-aaaa…` exists with `askBeforeAdmit: false`, empty lists; global
`{ownDevices: [], pairingOpenUntil: null}`; `now` 0; device IDs `D1` stand for a canonical ID generated by the test
helper.)

`test-vectors/class-paths.json`: `{"valid": [...], "invalid": [{"path": "...", "why": "..."}], "tsOnly": [...]}` with at
least: valid `Aulas/2026-10-14 1015 Aula 6/lecture.json`, `.tramado/chat/AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2/2026-11.jsonl`,
`Documentos/Código Civil.pdf`, `.tramado/tmp/x1y2.part`, `Notas/a b.md`; invalid `""`, `/abs`, `a//b`, `a/./b`, `../x`,
`a/../b`, `a\\b`, `a\u0000b`, `.stfolder/x`, `x/.stignore`, `.stversions/a`, `Docs/a.tmp`, `Docs/a.part`, a 201-unit
path, `a/` (trailing slash), `a\u0007b`; `tsOnly` NFD `Documentos/Código.pdf` → normalised to NFC by TS.

### 2.5 Order of work (recommended)

1. Root files, npm workspaces, `npm install`. 2. TS core model + errors + vectors. 3. Copy UI/shell/i18n/import/
search/text/speech; get `npm run typecheck && npm test` green. 4. Platform types, memory platform, tauri bindings,
services skeleton + ClassStore. 5. Registries, placeholders, Layout, demo boot; peek. 6. Rust workspace: base (impl),
net/sync/speech (stubs), desktop (stubs); start `cargo check --workspace --all-targets` in the background early (the
first whisper.cpp + libopus build takes 5–10 min); `npm run test:rust`, `npm run lint:rust:lite`. 7. Tools. 8. Icons.

### 2.6 Acceptance (all from the repository root; all must pass)

```bash
npm install
npm run typecheck && npm test && npm run build
npm run check:rust                       # cargo check --workspace --all-targets (builds whisper.cpp/libopus once)
npm run check:rust:lite                  # --no-default-features (the lock covers both, arch §3.2)
npm run test:rust                        # tramado-base (incl. time), tramado-net (http, secrets file backend), tramado-sync unit tests
npm run lint:rust:lite
cargo clippy --workspace --all-targets --no-default-features -- -D warnings   # stubs: `_`-prefixed params; empty modules hold only `//!`
cargo clippy -p tramado-speech --all-targets -- -D warnings
npm run check:leaks
npm run fetch:syncthing && ls -l desktop/src-tauri/binaries/tramado-syncthing-x86_64-unknown-linux-gnu
npm run test:contract                    # prints "no contract tests yet", exit 0
OUT=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/peek/m0
node tools/peek.mjs --app=app --route=today --ready=screen-today --axe --out=$OUT/today.png
node tools/peek.mjs --app=app --query=demo=empty --ready=onboarding-welcome --axe --out=$OUT/welcome.png
node tools/peek.mjs --app=app --route=class --query='class=law&tab=lectures' --ready=class-lectures --lang=pt --theme=dark --axe --out=$OUT/class-pt-dark.png
node tools/peek.mjs --app=app --route=settings --query='section=ai' --ready=settings-ai --lang=es --scale=1.25 --axe --out=$OUT/settings-es.png
node tools/peek.mjs --app=app --route=class --query='class=law&dialog=record' --ready=record-dialog --out=$OUT/record-dialog.png
node tools/peek-matrix.mjs               # every route of tools/peek-routes/m0.json renders its ready id
```
Visual check (agent opens the PNGs): the rail lists `law`, `bio`, `stats` (and `hist` under Archive) with their UX colours
and lucide icons; placeholders show `placeholder-data`; UX fonts load; dark theme applied; the record dialog placeholder
opens from `dialog=record`.

### 2.7 Commit and gate G0

```bash
git add -A && git commit -m "M0: scaffold, contracts, stubs and Trama ports" -m "<body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag m0 && git push -u origin main --tags
```
G0 = §2.6 passes on `main` after the commit (run it again in a fresh clone: `git clone . /tmp/…/g0 && cd … && npm ci && …`).

---

## 3. Wave 1 — Rust work packages

### 3.1 R-SHELL — desktop shell, files, media, AI pipe, secrets (Rust, medium-heavy)

**Goal.** Every command of arch §6.1–§6.5, the media scheme (§8), the global events `class:changed`, `app:*` (§7.1),
`tramado-net` (§5.2) and the base extras (§5.1 watch/media/power/applog) work in the real desktop app.

**Read**: arch §4, §5.1, §5.2, §5.5, §6.0–§6.6, §7.1, §8, §16, §18.3–§18.5; critique C1, C10, C34, C35, G17, G27, G29,
R13, R17; `research/trama-rust.md` §2–§5, §7.1, §8; openrouter-lab §2, §8, §9.

**Owns**
- `crates/tramado-base/**` (watch.rs, media.rs, power.rs, applog.rs new; other modules: bug fixes only, no signature change)
- `crates/tramado-net/**`
- `desktop/src-tauri/src/{commands/app.rs,commands/classes.rs,commands/dialogs.rs,commands/ai.rs,commands/system.rs,media.rs,tray.rs,window.rs,deeplink.rs}`
- `desktop/src-tauri/{Info.plist,macos/**,icons/**}`
- `app/src/platform/types/{common,app,classes,ai}.ts` (additive only), `app/src/platform/tauri/{index,app,classes,dialogs,ai,system,events,media}.ts`, `app/src/platform/tauri/tauri.test.ts`
- `tools/desktop-smoke.mjs` (new)

**Consumes**: M0's `tramado-base` impl modules, `Shared`, `util.rs`. **Provides**: commands §6.1–§6.5, `ClassFs`
used by R-SYNC/R-SPEECH (unchanged API), `AiPipe` + `Secrets` used by R-SPEECH (`speech::remote`), events.

**Tasks**
1. `tramado-base::watch` (notify-debouncer-full 300 ms; registry `subscribe` → watch/unwatch; `self_write` and
   `rescan` flags) and its desktop wiring in `commands/classes.rs::init` → `app.emit("class:changed", …)`.
2. `tramado-base::media` (`serve`, Range parsing, MIME table, CORS rules of arch §8) + `media.rs` scheme handler
   (`/c/…`, `/r/…`, `/res/selftest.webm`; Windows URL form from `AppInfo.mediaBase`).
3. `tramado-base::power`, `applog` (rotation 2 × 5 MiB, device IDs truncated in `diag_collect` output).
4. `tramado-net`: `hosts.rs` (port Trama `service/hosts.rs` with its tests), `secrets.rs` (keyring 4.2.0 native
   store on top of M0's file backend; `file_only` when `TRAMADO_DATA_DIR`; refuses `person` over IPC), `person.rs`
   (arch §5.2), `privacy.rs` (+ `busyRelax`), `activity.rs` (+ class/action/passages, clear), `ai.rs` (all seven rules
   of arch §5.2, `request_blocking` with the 2-slot reserve, multipart bodies, internal paths, busy relaxation).
   (`http.rs` is M0's.)
5. Commands: `app.rs` (`app_info` with `webview` = Tauri `webview_version()`, `diag_collect` gathering sync/speech
   via their managed states' existing methods, `person_init`, `person_prove`, `storage_usage`, `cache_clear`,
   `app_reveal`), `classes.rs` (§6.2 incl. `class_fork`, `class_trash_empty`, `ClassEntryView`; `class_create` detects
   cloud folders: path contains `OneDrive`, `Dropbox`, `iCloud Drive`, `Mobile Documents`, `Google Drive`), `dialogs.rs`
   (`PickRegistry`, e2e dialog queue of arch §6.3), `ai.rs` (native confirmations with `tauri-plugin-dialog`
   `blocking_show` inside `blocking`, `{host}` filled by Rust; `ai_activity_clear`, `ai_busy_policy_get/set`),
   `system.rs` (`open_external` allow-list, `shortcut_set_markers` with four accelerators).
6. `window.rs`: show the main window unless `--hidden`; `DragDrop` → pick tokens → `app:drop`. `tray.rs` (arch §5.5).
   `deeplink.rs`: plugin `on_open_url` + single-instance argv → `app:deep-link`; `.tramado-invite` paths read in Rust
   and delivered as text (arch §5.5); queue for `app_take_pending_links`.
7. TS bindings: verify every binding against the Rust signatures; extend `tauri.test.ts` (one test per command:
   exact command name, camelCase args, raw-body headers percent-encoded).
8. `tools/desktop-smoke.mjs`: `npm run build` (frontend), then
   `cargo build -p tramado-desktop --no-default-features --features tauri/custom-protocol` (a plain debug build would
   load `devUrl`; if Cargo rejects the feature path, use `npx tauri build --debug --no-bundle -- --no-default-features`
   from `desktop/`), then `xvfb-run -a dbus-run-session -- target/debug/tramado-desktop` with
   `TRAMADO_SYNCTHING_BIN=desktop/src-tauri/binaries/tramado-syncthing-x86_64-unknown-linux-gnu`, `TRAMADO_DATA_DIR=.tramado-dev/smoke`
   and `TRAMADO_E2E=1`, wait ≤ 30 s for `.tramado-dev/smoke/data/logs/app.log` to contain `webview ready`, screenshot the root window with
   `import -window root <png>`, kill, exit 0/1. (The webview's App logs `webview ready` through `app_log` — it is
   already in M0's `App.tsx`.) Needs `npm run build` first (frontendDist).

**Tests to add (must exist and pass)**: media `range_200/206/416`, `cors_origin_echo`, `mime_by_extension`,
`symlink_refused`; watch `emits_on_create_within_1s`, `ignores_tmp_and_part`; net `sse_lines_passthrough`
(heartbeats + data + `[DONE]` from MockServer), `injects_auth_and_attribution`, `provider_overwrite_no_training`,
`provider_overwrite_zdr`, `provider_removed_standard`, `custom_host_strips_provider_and_user`,
`error_body_strips_user_id`, `path_not_allowed`, `audio_path_internal_only`, `host_not_allowed`, `cancel_mid_stream`,
`activity_has_no_content`, `blocking_waits_for_slot_and_keeps_two_free`, `busy_relax_skips_dialog_only_with_flag`,
`stt_404_maps_privacy_blocks`; secrets `file_fallback_0600`, `status_last4`, `person_not_settable_over_ipc`; person
`member_id_from_pub`, `prove_signs_only_own_device`; serde `types_roundtrip` over `test-vectors/ipc-samples.json`;
hosts (Trama's tests); picks `token_expected_kind`; open_external `allow_list_skips_confirm`.

**Acceptance**
```bash
cargo test -p tramado-base -p tramado-net
cargo clippy -p tramado-base -p tramado-net --all-targets -- -D warnings
cargo clippy -p tramado-desktop --no-default-features --all-targets -- -D warnings
npm run typecheck && npm test           # tauri.test.ts, commands.test.ts
npm run build && node tools/desktop-smoke.mjs --out=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/peek/r-shell/smoke.png
pulseaudio --start --exit-idle-time=-1 && pactl load-module module-null-sink && node tools/desktop-smoke.mjs --media-selftest
                                          # WebKitGTK seek over tramado-media: duration ≈ 300, |currentTime − 252| ≤ 0.25 (critique R3),
                                          # else decide the Blob fallback now, in wave 1
OPENROUTER_API_KEY=<from the orchestrator's env> cargo test -p tramado-net --test live -- --ignored   # live_openrouter_pipe (arch §5.2)
```
The smoke PNG shows the onboarding screen inside the real window (inline styles and fonts visible).

### 3.2 R-SYNC — `tramado-sync` (Rust, light)

**Goal.** Sync spec §2–§12, §17–§22 behaviour in Rust as split by arch D-1, exposed as §6.7 commands and the
`sync:event` stream; contract and two-instance tests green against the pinned Syncthing v2.1.7.

**Read**: sync spec (all), folder spec §6, §11, §12; arch §1 (D-1), §5.3, §6.7, §7.1, §9 (sync types), §10 (mesh
semantics, to keep both sides equal); critique C2, C3, C5–C8, C25, C30, C31, G1, G3, G5, G7, G16, G18, R5, R7, R18;
`research/syncthing-lab.md` (all; scripts in `$LAB/syncthing/*.sh` are the verified REST sequences);
`$LAB/trama-rust/supervisor-proto/src/main.rs`.

**Owns**: `crates/tramado-sync/**` (incl. `tests/contract.rs`, `tests/two_instances.rs`),
`desktop/src-tauri/src/commands/sync.rs`, `app/src/platform/types/sync.ts` (additive), `app/src/platform/tauri/sync.ts`,
`app/src/platform/tauri/sync.test.ts`, `tools/test-contract.mjs`.

**Consumes**: `ClassFs`, `ClassRegistry` (+ `subscribe`), `Paths`, `tramado_base::time`, M0's
`tramado_net::http::{loopback_agent,lookup_agent}` (implemented, not stubbed), `tramado_net::testutil::MockServer`. **Provides**: §6.7 commands, `sync:event`, the `WriteObserver` (scans,
own-deletion log), self-heal, admission/reconciliation from the policy.

**Tasks** (module → spec section; each with unit tests on a fake `Client` trait so no binary is needed):
`init.rs` §2.3–§2.5 (identity without ports: API key `random_alnum(32)`, bcrypt cost 10 `$2a$`, exact `config.xml`
template, `generate`, `device-id`, `tramado-instance.json` with `installId`/`machine`; before every spawn: copied-identity
check, port probe 22100–22199 TCP+UDP, GUI port, every class folder paused; `TRAMADO_DATA_DIR` loopback variant;
lost-identity path) · `sign.rs` §12.4 · `invite.rs` (decode/validate codes, §7.2–§7.3) ·
`supervisor.rs` §2.4–§2.8 (log rotation, PDEATHSIG thread, Windows Job Object, orphan clean-up via `runtime.json`,
exit-code table, backoff, stop deadline) · `client.rs` §3–§4 (typed endpoints, timeouts §3.2, 403 → restart) ·
`config_writer.rs` §3.3 · `events.rs` §5 (priming, two loops, gap detection, dispatch to modules and the sink) ·
`managed.rs` §2.7, §6.2, folder spec §11 (+ per-device lines from the registry: `skipAudio`, `localIgnores` as class
paths, user lines preserved; own device name "Tramado" except while joining) · `client.rs` path conversion §3.6 ·
`folders.rs` §6.1, §8 (paused devices, rollback on failure), §17 (leaving state, `finish_leaving`, fork hand-off) ·
`admission.rs` §9 (constants, strikes, early eviction, batching, start-up rule, §9.5 checks) with `decide()` tested
against `test-vectors/admission.json` · `reconcile.rs` §10 (`stuck_joiner`, §9.5 roster check) · `bans.rs` §18.1
declarative `apply_bans` (+ `ignoredFolders` PATCH; contract test decides the fallback, §25 Q7) · `discovery.rs` §11 ·
`selfheal.rs` §12.3 (SHA check, no transcripts, audio via versions) · `guard.rs` §22.2 (local + receiving, reset
restore) · `scan.rs` §3.4 · `policy.rs` · `appdata.rs` · `diag.rs` · `existing.rs` (critique G1). Rotation and pairing
are v1.1 (not built). `commands/sync.rs`: `init` builds `SyncEngine` with a
`SyncSink` that emits `sync:event`, registers the `WriteObserver`, calls `ClassFs::set_device` after `identity()`,
starts Syncthing in the background when a shared class exists; `on_exit` → `stop(5 s)` off the main thread.

**Contract tests** (`tests/contract.rs`, all `#[ignore]`, need `TRAMADO_SYNCTHING_BIN`): `preseed_and_generate`,
`folder_create_paused_ignores_resume`, `post_replaces_folder_and_device`, `pending_device_provisional_then_folder_share`,
`outsider_rejected_and_ignored`, `event_names_accepted`, `modified_by_after_foreign_write`,
`modified_by_after_foreign_delete`, `blocks_hash_27b_and_1mib`, `disk_event_shapes_and_availability`,
`ignored_folders_patch_shape`, `reset_restores_local_mass_delete`, `paused_in_config_sends_nothing`,
`sign_with_key_pem_verifies_with_cert`, `shutdown_one_then_other_within_budget`.
**Two-instance tests** (`tests/two_instances.rs`, `#[ignore]`): `invite_join_admitted_within_10s`,
`join_devices_unpaused_after_folder`, `file_and_chat_line_cross_with_modified_by`, `self_heal_restores_forged_member_file`,
`foreign_delete_is_restored`, `leave_waits_until_a_peer_has_the_deletion`, `ban_stops_sync_with_banned_device`,
`ask_mode_queues_then_admit`, `admit_refused_without_pending_offer`.
**Unit tests** (fake client): §9.2 strikes and source buckets, early eviction, `sweep` retries skipped devices, the
start-up rule, `apply_bans` idempotence and removal, `stuck_joiner` (untrusted member file for 3 cycles → no PATCH),
§3.6 path conversion.

**Acceptance**
```bash
cargo test -p tramado-sync
cargo clippy -p tramado-sync --all-targets -- -D warnings
npm run test:contract          # every contract and two-instance test passes; no syncthing process left (pgrep -f tramado-syncthing → empty)
cargo check -p tramado-desktop --no-default-features      # once, at the end
npm run typecheck && npm test   # binding tests still pass
```

### 3.3 R-SPEECH — `tramado-speech` (Rust, HEAVY)

**Goal.** Recording (room/online, pause, markers, crash recovery), publishing WebM Opus into a class, importing
audio/video, decoding (Opus via libopus), local whisper transcription (windowed, resumable, DTW per model), cloud
STT, model registry + download, jobs with channels and claim heartbeats, waveform peaks — arch §5.4, §6.8, §7.2.

**Read**: `research/audio-pipeline.md` (all), `research/trama-rust.md` §3.7–§3.13, §5, §6; folder spec §8.6–§8.10;
sync spec §14.5; arch §5.4, §6.8, §7.2, §9 (speech types); critique C9, C11–C13, C21, C36, C37, G22, G23, R8–R10;
code: `$TRAMA/desktop/src-tauri/src/speech/*.rs`, `$LAB/audio/proj/opuslab/src/main.rs`,
`$LAB/audio/proj/modeldl/src/main.rs`.

**Owns**: `crates/tramado-speech/**` (incl. `examples/gen_selftest.rs`, `tests/*.rs`),
`desktop/src-tauri/src/commands/speech.rs`, `desktop/src-tauri/resources/media/selftest.webm`,
`app/src/platform/types/speech.ts` (additive), `app/src/platform/tauri/speech.ts`, `app/src/platform/tauri/speech.test.ts`,
`tools/fetch-speech-assets.mjs`,
`app/test-fixtures/tramado/audio/**` (speech samples: convert `$LAB/openrouter/audio/speech_pt.wav` and
`speech_en.wav` (synthetic TTS of fictional text) to WebM with the crate's own import path).

**Consumes**: `ClassFs` (`stage_and_place`, own writes for heartbeats), `Paths`, `tramado_base::time`; cloud STT is
written against `trait SttTransport` (arch §5.4) with a test double, so R-SPEECH does not wait for R-SHELL's `AiPipe`
(the desktop crate wires `AiPipe::request_blocking` at G2). **Provides**: §6.8 commands and channels.

**Timing.** R-SPEECH runs through wave 1 **and wave 2** and merges at G2 (no wave-2 package needs real speech:
UI-LECTURES uses `createFakeSpeech`).

**Tasks**: port Trama `capture.rs` (modes, device picker; open only the devices the mode needs), mixer with
pause-aware clock, `awake.rs`, `resample.rs`, `decode.rs` (+ Opus special case with manual pre-skip), `transcribe.rs`
→ `whisper.rs` (raw abort callback, DTW preset per model, `flash_attn false`, windows of ≈ 10 min, partial file
`data/transcribe/<lectureId>.partial.json`), `remote.rs` (key and routing via `tramado-net`; never sends `provider`
except through the pipe rules), `encode.rs`/`journal.rs`/`webm.rs` from the opuslab prototype (gotchas 1–3 of
audio-pipeline §2.3/§2.7), `publish.rs`, `import.rs` (HE-AAC detection → `SPEECH_UNSUPPORTED_AUDIO`), `download.rs`
from modeldl (32 MiB chunks, re-resolve per chunk, resume re-hash, `DISK_FULL`, `MODEL_INTEGRITY`), `jobs.rs` +
`heartbeat.rs` (claim hand-over rule of arch §5.4, `lastHeartbeatWallMs`), `peaks.rs`, `cpu.rs`, the input meter
(`speech_meter_start/stop`), `speech_import_attach`, `initialPrompt` passed to whisper and as `prompt` to cloud STT,
the share modes of `PublishRequest` (`none` keeps the recording pending). `commands/speech.rs`: `Sink` impls over
`tauri::ipc::Channel`, `init` (models dir, VAD path, recover journals lazily on `speech_recordings_pending`),
`on_exit` (finalise journal, cancel job keeping partial). Regenerate `selftest.webm` with
`cargo run -p tramado-speech --example gen_selftest` (300 s, our muxer).

**Tests to add**: `resample_*` (Trama), `encode_preskip_312`, `journal_recovers_torn_file` (tear at an arbitrary
byte, EOS set, CRCs valid), `webm_roundtrip_symphonia` (duration 300.000 s ± 1 ms, CodecDelay honoured, Cues present),
`decode_opus_length_exact`, `download_resume_and_verify` / `download_wrong_hash_rejected` / `download_200_restart`
(MockServer), `registry_matches_fetch_script` (parses `tools/fetch-speech-assets.mjs` table), `peaks_bucket_count`,
`claim_heartbeat_preserves_unknown_fields`, `import_mp3_to_webm`, `he_aac_refused` (fixture made with ffmpeg
`-c:a aac -profile:a aac_he` if the local ffmpeg supports it; else a recorded header fixture). Ignored:
`transcribes_a_sample`, `transcribes_through_cloud_mock` (test double of `SttTransport`), `wer_report`,
`long_lecture_memory`, `record_from_devices`, `transcribes_through_openrouter_live` (`tests/live.rs`, 10 s clip; run at
G2 when the key has credit, else reported "not run: no credit").

**Acceptance**
```bash
cargo test -p tramado-speech
cargo clippy -p tramado-speech --all-targets -- -D warnings
node tools/fetch-speech-assets.mjs && node tools/fetch-speech-assets.mjs --model=small
TRAMADO_SPEECH_DIR=.tramado-dev/models TRAMADO_SPEECH_MODEL=small TRAMADO_SPEECH_SAMPLE=app/test-fixtures/tramado/audio/speech-pt.webm \
  CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
  cargo test -p tramado-speech --release transcribes_a_sample -- --ignored --nocapture      # non-empty PT text, sensible timings
cargo test -p tramado-speech transcribes_through_cloud_mock -- --ignored
cargo run -p tramado-speech --example gen_selftest && ffprobe -v error -show_entries format=duration desktop/src-tauri/resources/media/selftest.webm   # 300.0
cargo check -p tramado-desktop            # default features (whisper) compile with the desktop crate
```
Resource note: never run this WP's release build at the same time as R-SHELL's desktop build (orchestrator staggers).

---

## 4. Wave 1 — TypeScript work packages

All five are pure TS (no Rust builds). T-SYNC, T-AI, T-DOCS and T-LECTURES are verified by unit, property and
service tests on the memory platform and mesh (the demo content arrives with T-DEMO; their screens are peeked at G1).
They implement the demo modes of their fakes (UX §7.2) and their part of `DemoControls`. In every command below
`PEEK=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/peek/<wp>`.

### 4.1 T-SYNC — class semantics, group services, memory mesh

**Goal.** Folder spec §3, §6, §7, §8.1–§8.5, §8.10–§8.11, §8.16–§8.19 and sync spec §7, §9.2 (`decide`), §10
(roster → policy), §12 (trust judgement), §13, §14, §15, §17–§18.1 in TS (folder spec §2.1 derived IDs, §6.6 signatures, §8.3.1 person keys included); the memory mesh (arch §10); the library and
class services; the demo modes of the fake sync platform.

**Read**: both specs; arch §1 (D-1), §10, §11.1 (core/sync), §11.2 (library, class, sync, presence, trust, claims,
chat, notifications), §12; critique C8, C33, G2–G8, G24, G26, R6, R7, §7; sync spec §24.

**Owns**: `app/src/core/sync/**` (except M0's frozen `checkWords.ts`); `app/src/services/{library,class,sync,presence,trust,claims,chat,notifications}.ts`
and `app/src/services/types/{library,class,sync,chat}.ts`; `app/src/services/mesh/**` (tests);
`app/src/platform/memory/{sync,mesh}.ts`. (Size XL: if it slips, the orchestrator splits off `services/mesh/**` and
`platform/memory/mesh.ts` into a second agent on the same branch.)

**Consumes**: `ClassStore`, platform types, `core/model/*`, `core/hlc.ts`, `test-vectors/admission.json`.
**Provides**: `ClassLibrary`, `ClassService`, `SyncService`, `PresenceService`, `TrustService` (installed as the
`TrustGate` of shared classes), `ClaimEngine` (used by T-LECTURES in wave 2 integration), `ChatService` (incl. `@AI`
hand-off to `AskService.askInChat` through `app().forClass(id).ask`), `NotificationService`, `createMemoryMesh()`.

**Tasks**
1. `core/sync/*` per arch §11.1 with unit tests: meta LWW + override stamps + validation + authority at HLC +
   organiser replay with monotonic vacancy (folder spec §8.2 pseudo-code verbatim), person-key binding and former
   bindings (§8.3.1), effective bans at HLC with claimant expansion, trust `judge()` (blocksHash binding, same-content,
   prefix, derived IDs, signatures, transcript writer change, deletion rule, no-rollback), attribution to the writer's
   person (§6.2 rule 6), claims ranking incl. `in_cluster` and R_max from the transcript (§14.4), delays incl. the
   overlap rule and `reevaluateAt` (§14.3, seeded jitter), chat fold (`(deviceId, id)` identity, reply display keys,
   edit/delete rules, redaction, unknown types counted), mod honouring table (§8.18), invite encode/decode/validate/
   reduction and the reduced QR invite (sync spec §7; the §7.2 example must encode to a 1,021-character code), presence
   staleness seeding, `computePolicy`, `decide()` (vectors), consent (revokes by `{deviceId, id}`), signing helper.
2. Services: `ClassLibrary` (create = derived classId + `class_create` + signed `class.json` + own signed `meta` +
   own signed `members` file with a person proof + optional share; adopt with fork; suggestion table name → lucide icon/colour/short name, from product-ux §4.2 ported to lucide names per
   critique C26), `ClassService` (view, setMeta, organisers, own member file refresh incl. `caps` from
   `platform.speech.info()` and `formats`, consent log), `SyncService` (boot sequence of arch §4.4, event routing of
   arch §12.5, policy push, invite/join/leave/ban/offers/mass-delete flows; no rotation, pairing or relocate: v1.1), `PresenceService`
   (writes on change, 60 s heartbeat while active), `TrustService` (cache in `private/<classId>/trust.json`, start-up
   pass, `remoteChange` memory), `ClaimEngine` (§14.5 round with the availability settle, heartbeats are Rust's while a job
   runs — the engine only writes `claimed`, the first `working`, `released`, deletes, resumes per §14.5 after
   `waitCaughtUp`, re-evaluates stale winners, applies the loser and owner rules),
   `ChatService` (send/append, tail reads, delivery ticks via `fileInfo` availability, unread via `chat-state.json`,
   attachments copied into `<documents>/<fromChat>/`, notifications for mentions/`@everyone` from organisers),
   `NotificationService` (prefs `notify.*`, the `notify` namespace of UX §5.22). `SyncService.leave` runs the §17
   leaving state and fork; `ban` also sets `askBeforeAdmit`; mass-deletion resolutions (local and remote).
3. Memory mesh (arch §10) + `memory/sync.ts` (single-device demo variant).
4. Demo modes in `memory/sync.ts` (UX §7.2): `sync=fake` (Bruno and Jamie online, Bruno transcribing `l8`),
   `offline` (no peers; my last message pending), `error` (`SYNC_UNAVAILABLE`), `local`; `join=ask` (Diogo Santos
   waiting); `unverified=1`; `DemoControls.sync` (`peerSays`, `peerAdds`, `peerJoins`, `setOnline`) writing real chat
   lines and files as the member's device, so the real services pick them up.

**Tests that must exist**: `core/sync/*.test.ts` for every module; `core/sync/claims.property.test.ts` (random
partitions, ±10 min skew, crashes, heals: at most one `working` per connected component; eventually exactly one
`done` and one transcript writer); `core/sync/chat.property.test.ts` (fold independent of arrival order);
`core/sync/meta.property.test.ts` (convergence); `services/mesh/chat.test.ts` (3 devices, partition, heal, delivery
ticks), `services/mesh/roster.test.ts` (member file → policy pushed with the device; ban → bannedDevices; left
device), `services/mesh/trust.test.ts` (forged member and chat files ignored, `foreignWrites` counted, owner heals),
`services/mesh/invite-join.test.ts`, `services/mesh/forgery.test.ts` (forged `memberId` shown under the writer's
person; duplicate id in another device's file is a second message; a member deletes an organiser's member and bans
files → organisers, bans and folder devices unchanged; event for version N delivered after the bytes of N+1;
unsigned or rolled-back member file ignored), `services/mesh/leave.test.ts` (leave while others are offline; keepLocal
fork then share changes nothing on the others), `core/sync/meta.property.test.ts` also covers a +10 years writer,
`services/library.test.ts`. (Pairing and rotation tests are v1.1.)

**Acceptance**
```bash
npm run typecheck && npm test && npm run test:property && npm run build
```

### 4.2 T-AI — AI client, exam pipeline, AI services

**Goal.** One OpenRouter client shared by desktop, demo and tests (critique C1): request builder with chains per
privacy level, line-based SSE parser, error classifier, retries/fallback, throttle, tool loop, prompts, citations; the
exam pipeline (OCR → pre-split → extraction → review → quick/deep answers); `AiService`, `ExamService`, `AskService`;
the fake AI; a **live test of the default free model** `google/gemma-4-31b-it:free` (the user's requirement).

**Read**: `research/openrouter-lab.md` (all), critique C1, C13, C14, C16–C18, G10, G11, G19, G21, R1, R2, R14, R15,
D5–D18; folder spec §8.12–§8.15, §8.16 (`ai` lines); arch §5.2 (pipe rules), §6.4, §9 (ai types), §11.1 (core/ai,
core/exam, ai-defaults.json), §11.2 (ai, exams, ask); `research/trama-ts.md` §5.

**Owns**: `app/src/core/ai/**` (incl. `ai-defaults.json`, `prompts/**`), `app/src/core/exam/**`,
`app/src/services/{ai,exams,ask}.ts`, `app/src/services/types/{ai,exams,ask}.ts`, `app/src/services/testing/fakeSearch.ts`,
`app/src/platform/memory/ai.ts`, `app/test-fixtures/ai/**` (copy `$LAB/openrouter/out/*.json`,
`$LAB/critique/ocr/out/*.json`, `$LAB/trama-ts/out/stream.txt`, every file passed through `tools/redact-fixtures.mjs`;
`npm run check:leaks` must pass), `app/src/core/ai/live.test.ts`. `memory/ai.ts` also
implements the demo modes `ai=fake|off|busy|quota|badkey` and `DemoControls.ai` (UX §7.2).

**Consumes**: `platform.ai` (pipe), `SearchService` interface (use `fakeSearch` in tests; the real one arrives from
T-DOCS at G1), `ClassStore`, `ChatService.send` contract (for `askInChat`, write the `ai` line directly through
`ClassStore.appendLine` with the chat line format). **Provides**: `AiClient`, `AiService`, `ExamService`, `AskService`,
`createFakeAi()`.

**Tasks**: every module of `core/ai` and `core/exam` in arch §11.1 (prompts in EN/PT-PT/ES; the system prompts ask for
`[S#]` citations and the answer language rule `ai.answerLanguage`); `AiClient.run` = throttle → build → pipe → SSE
parse → classify → retry/fallback (openrouter-lab §11.5) → result with the model that answered; quota from `GET /key`
(`free_model_daily_requests`); catalog cache (24 h) and default validation (critique G21); the explicit "use models
that may train" path (`privacyOverride: "standard"`, D-10); Quick answer = 1 expansion request for all questions +
local BM25 per question + 1 answer request per question (critique C17), Deep answer = tool loop; shared answers file
`answers/<examId>/<me>.json` (one per question, latest wins), "answers already exist" detection; exam drafts (OCR
through `ctx.imagePrep`/`ctx.pdfRender` + cache `ocr/<sha>.json`), review save writes `exam.json` (importer = me);
exam-edits for non-importers + fold (debounced 5 min) by the importer; private answers/correct/marks (incl. `unsure`)/revealed/hints/practice (`again`/`gotIt`, count) in
`private/<classId>/exams/<examId>.json`; Ask threads in `private/<classId>/ask/<threadId>.jsonl` (arch §13.2);
`askInChat` writes a chat `ai` line replying to the question, `postToChat` one with `question` (refused for private
sources); `annotate` and `studyNotes` (arch §11.2, UX §3.5.4); activity tags on every request; busy policy and AI-off
settings; exam-edits by non-importers are v1.1 (not built). Fake AI emits the same wire events as Rust (real SSE chunk JSON, heartbeats, the real 429/404/400 bodies of
openrouter-lab §8).

**Tests that must exist**: `sse.test.ts` (stream.txt fixture, heartbeats, tool-call fragments, mid-stream error,
no `[DONE]`), `classify.test.ts` (one case per row of openrouter-lab §8 / critique §8 AI codes), `build.test.ts`
(chain per level, capability filter tools/vision, `models` ≤ 3, reasoning mandatory, provider per level),
`retry.test.ts` + `throttle.test.ts` (fake clock: 18/min, ≤ 3 in flight, priorities), `toolLoop.test.ts` (fake AI:
parallel calls, dedupe, final nudge), `citations.test.ts` (lists, pin-points, hallucinated refs, chip numbering),
`tolerantJson.test.ts`, `presplit.golden.test.ts` and `extract.golden.test.ts` (saved outputs; II.a–c split),
`services/exams.test.ts` (import → review → quick answers with fakeSearch → answers file → shared answers visible to a
second device via mesh is wave-2 integration), `services/ask.test.ts`, `live.test.ts` (skipped unless
`TRAMADO_AI_LIVE=1` and `OPENROUTER_API_KEY` are set: one chat request with the default chain under "No training",
MUST receive at least one HTTP 200 streamed completion from the default no-training chain or fail; separately tries
`google/gemma-4-31b-it:free` pinned, up to 6 attempts over 10 minutes with backoff, and reports the outcome; asserts
`GET /models` lists the default id with price 0 and `tools`; logs which model answered).

**Acceptance**
```bash
npm run typecheck && npm test && npm run build
TRAMADO_AI_LIVE=1 OPENROUTER_API_KEY=<provided by the orchestrator via env, never written to disk> npx vitest run --root app src/core/ai/live.test.ts   # report the answering model and latency
```

### 4.3 T-DOCS — documents, extraction, search, notes, annotations, safe Markdown

**Goal.** Import any supported document, extract text with page/slide/article locators in a worker, strip running
headers, build `PassageIndex` per class in a worker, answer passage queries and boolean searches, resolve citations
(folder spec §8.15), class and private notes with conflict handling (sync spec §16), annotations, safe Markdown.

**Read**: `research/trama-ts.md` §3–§5, §12; critique C19, G9, G13, G25, G27, R11; folder spec §5, §8.15, §8.17,
§8.21; sync spec §16; arch §11.1 (core/import, search, text, notes), §11.2 (documents, notes, annotations, search),
§11.7, §12.7, §13.1; lab `$LAB/trama-ts/subset/src/core/qda/passageIndex.ts` (+test), `$LAB/trama-ts/pptx.ts`,
`$LAB/trama-ts/cite.ts`, `$LAB/trama-ts/make-law-pdf.mjs`, `$LAB/critique/scripts/{bigpdf.mjs,pdfperf.ts}`.

**Owns**: `app/src/core/{import,search,text,notes}/**`, `app/src/workers/**`,
`app/src/services/{documents,extraction,search,notes,annotations}.ts`, `app/src/services/types/{documents,notes,search}.ts`,
`app/src/ui/tramado/MarkdownView.tsx`, `app/test-fixtures/tramado/{docs,make-fixtures.mjs}`,
(no demo files; T-DEMO writes the demo documents).

**Consumes**: `ClassStore`, `platform.fs/cache/privateFiles/dialogs`, `ctx.indexHost`/`extractHost` (M0's inline hosts;
T-DOCS writes the worker hosts), `ctx.imagePrep`/`pdfRender` (not needed beyond interfaces), M0's `resolveQuote` and
`transcriptUnits`. **Provides**: `DocumentService`, `ExtractionService` (arch §11.2), `SearchService` (+ worker hosts),
`NotesService`, `AnnotationService`, hardened `core/text/markdown.ts` + `MarkdownView`.

**Tasks**: `pptx.ts` (slide order via `presentation.xml`, notes), `pdfPages.ts` (keep `pageStarts`, `pageLabels`,
`imagePages`), `headers.ts` (≥ 50 % rule), `articles.ts` (PT/ES/EN article headings; label `art. N.º (pp. a–b)`),
`units.ts`; `passageIndex.ts` (lab) + `locators.ts`, `labels.ts`, `resolve.ts`; extraction worker (pdf.js
`isEvalSupported: false`, one file at a time, progress, cancel); search worker; `DocumentService` (import via
`fs.importFile` with sanitised unique names, duplicate detection by SHA-256, remove "for everyone" vs "this computer
only" through `classes.update(localIgnores)` then delete, rename/move); `NotesService` (class notes in `<notes dir>`,
private notes in `private/<classId>/notes/`, conflicts + resolve per sync spec §16, `editing` → presence);
`AnnotationService` (private in `private/<classId>/annotations.jsonl`, shared in `.tramado/annotations/<me>/<YYYY-MM>.jsonl`,
re-anchoring of audio-pipeline §5.5 for transcripts and quote search for documents); Markdown hardening + XSS corpus.

**Tests that must exist**: `pptx.test.ts`, `pdfPages.test.ts` (fixture with page labels and a scanned page),
`headers.test.ts`, `articles.test.ts` (PT `Artigo 483.º`, ES `Artículo 1902`, EN `Article 6`), `passageIndex.test.ts`
(identical ranking to `rankPassages`, lab), `resolve.test.ts` (moved file by SHA, changed file by quote, missing),
`markdown.xss.test.ts` (≥ 40 payloads: raw HTML, `javascript:`/`data:` links, event attributes, SVG, nested
encodings), `perf.test.ts` (800-page synthetic law PDF via `bigpdf.mjs` logic: extract < 10 s and index < 1 s in
Node, query < 50 ms; skipped when `CI_SLOW=0`), `services/documents.test.ts`, `services/notes.test.ts` (conflict copy
→ keep/merge/keep both), `services/search.test.ts` (inline host).

**Acceptance**
```bash
npm run typecheck && npm test && npm run build
```

### 4.4 T-LECTURES — transcript format, lectures, recording, transcription queue, models

**Goal.** Folder spec §8.6–§8.11 in TS: `fromResult`, effective transcript replay, fold, byte-exact Markdown/VTT;
`LectureService`, `RecordingService` (consents, publish, import, recovery), `TranscriptionQueue` (eligibility §14.2,
volunteering §14.3, claim rounds through `ClaimEngine`, job control through `platform.speech`, re-transcription, fold
claims §14.8), `ModelsService`; the fake speech platform and its demo modes.

**Read**: folder spec §8.5–§8.11; sync spec §13, §14; `research/audio-pipeline.md` §4, §5; `research/product-ux.md`
§4.5, §4.6, §6.1; arch §5.4 (claim hand-over), §6.8, §7.2, §9 (speech types), §11.1 (core/transcript), §11.2
(lectures, recording, transcription, models, ClaimEngine).

**Owns**: `app/src/core/transcript/**`, `app/src/core/speech/**`, `app/src/services/{lectures,recording,transcription,models}.ts`,
`app/src/services/types/{lectures,recording,transcription}.ts`, `app/src/services/testing/fakeClaims.ts`,
`app/public/demo/lecture.webm`,
`app/src/platform/memory/speech.ts` (incl. the demo modes `speech=fake`, `model=ready|missing|downloading`,
`recording=1` and `DemoControls.speech`: `claimTranscription`, `finishTranscription`, `tick`),
`app/test-fixtures/tramado/transcripts/**`.

**Consumes**: `ClassStore`, `ClassService.consent` and `PresenceService` interfaces (use simple fakes in tests),
`ClaimEngine` interface (`fakeClaims` in tests; the real one arrives from T-SYNC at G1), `platform.speech`.
**Provides**: `LectureService`, `RecordingService`, `TranscriptionQueue`, `ModelsService`, `createFakeSpeech()`,
`core/transcript/*`.

**Tasks**: `fromResult` (segment ids `s_` + base62, split tracks interleaved with `dropEcho`, speakers per
`channels`), `effective` (every op of §8.9 incl. merged redirects and concurrent-edit flag; read-only use in 0.1),
`radar.ts` and `references.ts` (product-ux §9.3 regexes; `LectureDetail.autoMarkers/references`), `renderMarkdown`
(paragraph rule: same speaker, gap < 2 s, ≤ 60 s; header line format; labels per language), `renderVtt` (cue id =
segment id, escaping), `RecordingService` (start → consent lines (`record`, then `share`) → presence `recording` →
stop → publish: lecture dir name by `lectureDirName`, `speech.recorder.publish`, then `lecture.json` with `audio.size/
sha256`, `channels`, `pauses`, `consent` refs; private markers to `private/<classId>/markers/<id>.json`; "transcript
only" keeps audio private (`audio.shared:false`)), import audio, recovery of pending journals at boot,
`TranscriptionQueue` (eligibility incl. SHA check of the local audio via `fs.hash`, duplicates and the "no transcript
at all" rule for automatic claims; volunteering default `plugged`, effective only with a local model, the one-time
notice; volunteer timers from member `caps` and `system.power()`; the 24 h unclaimed nudge; the `arriving` state; on win → `speech.transcribe.start` with the claim template; `onLost` → cancel and delete
claim; on `done` → `take` → write `transcript.json` (`round`, `revision 1`, `writer` = me) → `.md` → `.vtt` → claim
`done`; resume at boot (`jobs()` + `attach`, after `waitCaughtUp`); re-transcribe = new round; owner and loser rules after
`done` (sync spec §14.5); no edit folding in 0.1), `RecordingService` share modes incl. `none` and the input meter,
`ModelsService` (download/attach/cancel/delete/import/setActive). Fake speech: scripted
`TranscriptionResult`s per demo lecture, progress steps, recorder levels.

**Tests that must exist**: `fromResult.test.ts`, `effective.test.ts` (one case per op + concurrent `base` mismatch +
round filter + merged redirect), `render.test.ts` (byte-exact fixtures in `test-fixtures/tramado/transcripts/`),
`services/recording.test.ts` (publish writes lecture.json with matching size/sha; transcript-only), 
`services/transcription.test.ts` (with `fakeClaims`: ineligible on SHA mismatch; duplicate overlap skipped by
volunteers; untrusted transcript blocks automatic claims; win → transcript files written in the §8.8 order → claim
`done`; lost → cancel; done-but-not-winner never writes; resume after restart), `services/lectures.test.ts` (readers
apply edit lines written by newer apps; radar and references), `radar.test.ts`, `references.test.ts`.

**Acceptance**
```bash
npm run typecheck && npm test && npm run build
```

### 4.5 T-DEMO — the browser demo content (UX §7)

**Goal.** The fictional demo of UX §7, complete: example objects, exact content texts, filler transcripts, peaks,
assets, and `demo/seed.ts`, which writes everything as **spec-conformant files** (class folders with `class.json`, meta,
members, presence, consent, chat, claims, lectures with `lecture.json` + `transcript.json` (the integrator adds the
`.md`/`.vtt` rendering call at G1, after T-LECTURES merges), documents, notes, exams with `exam.json`, shared answers;
all signed with the memory platform's demo keys and with derived IDs; private data: my notes,
highlights, markers, marks, Ask threads; app files: identity, prefs) into the memory platform. Every UX §7.2 key and
mode resolves.

**Read**: UX §7 (all), §2.12, §3.9.1, §3.10.1, §4.1; folder spec §8 (every format); arch §11.6, §13.2.

**Owns**: `app/src/demo/example/**`, `app/src/demo/seed.ts`, `app/src/demo/fakeMedia.ts`, `app/src/demo/assets/**`,
`tools/fixtures/build-demo-assets.mjs`, `tools/peek-routes/t-demo.json`.

**Consumes**: `core/model/*` (types, ids, sanitize, json), `core/hlc.ts`, the memory platform, `DemoKeys`.
**Provides**: the demo state every UI WP screenshots; `example.test.ts` (every citation quote resolves with M0's
`resolveQuote`, markers within duration, every UX §7.4 route resolves its keys, every segment id matches
`^s_[0-9A-Za-z]{5,8}$`).

**Rules**: content is fictional (the "Lei Fundamental de Exemplo" must not copy any real constitution); filler is
deterministic (`(i*7919) % 1100` pauses); peaks per UX §7.1 formula; binary assets are generated by
`build-demo-assets.mjs` (pdf-lib 1.17.1, jszip 3.10.1, ImageMagick `convert`) and committed, the script printing each
SHA-256; nothing depends on services (the seed writes files).

**Acceptance**
```bash
npm run typecheck && npm test && npm run build                 # incl. src/demo/example/example.test.ts
node tools/fixtures/build-demo-assets.mjs --check              # regenerates into a temp dir and compares SHA-256 with the committed assets
node tools/peek.mjs --app=app --route=today --ready=screen-today --out=$PEEK/t-demo-today.png      # rail: law, bio, stats (+ hist under Archive)
node tools/peek.mjs --app=app --route=class --query='class=law&tab=lectures' --ready=class-lectures --lang=pt --out=$PEEK/t-demo-law-pt.png
node tools/peek-matrix.mjs --only=t-demo                        # every UX §7.4 query loads its route (placeholder ready ids)
```

---

## 5. Gate G1 (after wave 1)

Merge order: R-SHELL → R-SYNC → T-SYNC → T-DOCS → T-LECTURES → T-AI → T-DEMO (the demo needs the fakes' modes).
R-SPEECH keeps working and merges at G2. Then the integrator:
1. Applies requested contract changes (one commit `G1: contract updates`), wires the real `ClaimEngine` into
   `TranscriptionQueue` integration tests (`services/mesh/transcription.test.ts`: two devices, one lecture, exactly one
   transcript), the real `SearchService` into `ExamService` tests, and the `.md`/`.vtt` rendering into `demo/seed.ts`
   (`example.test.ts` then asserts byte equality with T-LECTURES' renderer).
2. Runs:
```bash
npm ci && npm run typecheck && npm test && npm run test:property && npm run build
npm run check:rust:lite && npm run test:rust && npm run lint:rust:lite && npm run test:contract && npm run check:leaks
npm run build && node tools/desktop-smoke.mjs --out=$PEEK/g1/smoke.png
node tools/desktop-smoke.mjs --flow=g1 --out=$PEEK/g1/flow.png   # real app: onboarding → create local class → import PDF → palette search hit
node tools/peek-matrix.mjs            # every tools/peek-routes/*.json entry
TRAMADO_AI_LIVE=1 OPENROUTER_API_KEY=… npx vitest run --root app src/core/ai/live.test.ts && cargo test -p tramado-net --test live -- --ignored
```
3. **Freezes the service APIs** consumed across packages (arch §11.2 "API freeze at G1").
4. Commit `G1: wave 1 integrated`, tag `wave1`, `git push origin main --tags`.

---

## 6. Wave 2 — UI work packages (TS/React only)

Common to every UI WP:
- **Read**: `docs/design/ux-mvp.md` ("UX") — it is authoritative for layouts, behaviour, states, microcopy (§5), test ids
  and view models; `research/trama-ui.md` §1.6, §3, §5; arch §11.3–§11.6, §12, §14.
- **Ownership transfer at G1**: each UI WP also owns the wave-1 services, `services/types/<domain>.ts` and memory fakes
  of its domain (listed per WP) and may **add** members to them (with tests); members other packages consume are
  signature-frozen since G1 (arch §11.2). `core/*` of its domain: bug fixes only. The view models of
  `services/types/viewModels.ts` are frozen (UX shapes); add extra fields only through the integrator.
- **Shared components** of `ui/tramado/` belong to the package whose domain they serve (arch §11.3); props stay frozen.
- **Strings**: EN strings are already in place from UX §5 (M0). The WP translates its namespaces to PT-PT and ES,
  removes `pending`, and adds new keys (all three languages) only in its own namespaces.
- **Peek**: the WP writes `tools/peek-routes/<wp>.json` covering, for every screen and dialog it owns: the UX §7.4 shots
  that belong to it, every empty/loading/error/offline state listed in its UX section, EN light, PT-PT dark, ES at scale
  1.25, and the 1000×660 minimum window for its main screen. `node tools/peek-matrix.mjs --only=<wp> --axe` must pass.
- **Acceptance (all UI WPs)**: `npm run typecheck && npm test && npm run build && node tools/peek-matrix.mjs --only=<wp> --axe`,
  the WP's service tests, its **must-pass behaviour scenarios** (peek steps with assertions, listed per WP), and a
  visual review of every produced PNG by the agent (layout, truncation, contrast, class colours, fonts), reported with
  the PNG paths. (No component tests: Vitest runs without a DOM, arch §17.)

### 6.1 UI-SHELL — shell, onboarding, Today, class frame, settings

**Owns**: `app/src/shell/**` (except frozen `routes.ts`), `app/src/ui/**` (except the `ui/tramado/` components arch
§11.3 gives to other packages), `app/src/features/{onboarding,today,class,settings}/**` (except
`settings/{AiSection,TranscriptionSection,SharingSection}.tsx`), `app/src/core/privacy/**`,
`app/scripts/gen-privacy.ts`, namespaces `app, onboarding, today, classes, settings, privacy` (PT/ES), services
`library.ts`, `class.ts`, `notifications.ts` + `services/types/{library,class}.ts`, `tools/screenshots/shots.mjs`
(UX §7.4 table), `tools/peek-routes/ui-shell.json`.

**Build** (UX sections): §2.2–§2.10 layout, rail, sync pill, AI pill, top bar, dock frame (rows from `DOCK_ROWS`), toasts
and system notifications, command palette frame (results from `PALETTE_PROVIDERS`), global keyboard map and the
shortcuts dialog; §3.1 onboarding (writes `identity.json`, calls `platform.sync.identity()` without starting the daemon,
AI key test through `AiService`; the identity-failure notice); §3.2 Today (no digest: v1.1); §3.3 class (header, tabs
from `CLASS_TABS`, share tab for unshared classes, folder-missing card from `CLASS_STATES`, new class / class settings
dialog with the lucide icon suggestion table, the 12 colours, vocabulary and per-class notifications, leave/delete/
archive entry points opening `leave` from UI-GROUP); §3.14 settings sections profile, appearance (text size via
`platform.window.setZoom`, three fonts), notifications, storage (`storage.usage`, empty trash, clear cache, leaving
classes; recently deleted → `recently-deleted` dialog), privacy ("What leaves this computer" from
`core/privacy/flows.ts`, the grouped AI activity log with Clear; `gen-privacy.ts` writes `PRIVACY.md` in EN/PT/ES),
about (no update checks); §3.15.8, §3.15.10, §3.15.11 (newer format banner, missing
item, crash screen); first close with a shared class: "Keep sharing when you close the window?" (D48) via the
`first-share` flow owned by UI-GROUP (open it through `DIALOGS`).

**Must-pass scenarios**: `dialog=shortcuts --press=Escape --expect-not=shortcuts-dialog`; `route=settings&section=appearance
--click=appearance-text-size --expect-attr=screen-settings:data-zoom=1.25` (after choosing 125 %); `demo=empty
--type=onboarding-name-input=Ana --click=onboarding-name-continue --expect=onboarding-ai`.

**Peek (minimum)**: UX shots `welcome`, `onboarding-ai`, `today`, `palette` (frame only), `settings-privacy`; plus `class-law` (`route=class&class=law`),
`class-share-tab` (`class=stats`), `class-dialog` (`dialog=new-class`), `shortcuts` (`dialog=shortcuts`),
`settings-<each other section>`, `today` at 1000×660, `sync=error` (sync error card host in the rail), `ai=badkey`
(AI pill state).

### 6.2 UI-GROUP — chat, members, invite, join, sync dialogs, sharing settings, join page

**Owns**: `app/src/features/{chat,members,sync}/**`, `app/src/features/settings/SharingSection.tsx`, `ui/tramado/{Composer,QrCode,CheckWords,Avatar,PresenceDot}.tsx`,
`site/join/index.html` (static, no third-party scripts: reads `location.hash`, [Copy code], [Open in Tramado]),
namespaces `sync, chat, members` (PT/ES), services `sync.ts`, `chat.ts`, `presence.ts`, `trust.ts`, `claims.ts` +
`services/types/{sync,chat}.ts`, `app/src/core/sync/**` (fixes), `app/src/platform/memory/{sync,mesh}.ts`,
`tools/peek-routes/ui-group.json`.

**Build**: UX §3.10 chat (view model §3.10.1, composer, mentions incl. `@AI` → `AskService.askInChat`, replies,
edit/delete with redaction, attachments into `<documents>/<fromChat>/`, delivery "local"/"sent", `ai` lines with
`AiCard` + `CitationChip`, unverified authors, newer-format count, rail unread badge; no reactions/pins/hides or
exam-date chip: v1.1); UX §3.12 members (people → devices, unverified devices, organisers, remove / soft ban with the
ask-before switch, ask-before-join, transcription helpers, consent records and Withdraw), invite dialog (code, reduced
QR, two-line file, link), join dialog (paste/file/deep link, preview, folder, audio, rules, waiting states of sync spec
§8 incl. the 90 s retry, check words), admission notices, `DeepLinks.tsx`; Settings › Sharing (UX §3.14.5: restart,
diagnostics without the API port, this computer's check words); UX §3.15.1–§3.15.5, §3.15.9 and §3.15.12 (first share,
sync error card, mass-delete guard local and received, folder missing card, recently deleted with restore, Windows
file-name notice, copied identity); `site/join/index.html`. Pairing and rotation are v1.1.

**Must-pass scenarios**: `tab=members&join=ask --click=member-admit --expect-not=member-waiting`; `dialog=invite
--expect-text=invite-code=tri1_`; `dialog=join&code=<fixture> --click=join-continue --expect-attr=join-submit:disabled=true
--click=join-rules --expect-attr=join-submit:disabled=null`; `tab=chat --type=chat-input=1 --expect-not=lecture-marker`.

**Peek (minimum)**: UX shots `chat`, `members`, `invite`, `join`; plus `chat` with `sync=offline` (pending "local"
messages), `members` with `unverified=1`, `settings-sharing` (`route=settings&section=sharing&sync=fake`),
`first-share` (`dialog=first-share`), `mass-delete` (`dialog=mass-delete`), the folder-missing card (`class=law&missing=1`),
`recently-deleted` (`dialog=recently-deleted`), `leave` (`dialog=leave&class=law`).

### 6.3 UI-LECTURES — lectures, lecture view, recording, transcription UI

**Owns**: `app/src/features/{lectures,lecture,record}/**`, `app/src/features/settings/TranscriptionSection.tsx`,
`app/src/ui/tramado/{Player,Timeline,TranscriptView,LevelMeter,MarkerButton}.tsx` (new) and `{MarkerIcon,ProgressSteps}.tsx`,
namespaces `lectures, record, speech` (PT/ES), services `lectures.ts`, `recording.ts`, `transcription.ts`,
`models.ts` + `services/types/{lectures,recording,transcription}.ts`, `app/src/core/{transcript,speech}/**` (fixes),
`app/src/platform/memory/speech.ts`, `tools/peek-routes/ui-lectures.json`.

**Build**: UX §3.4 lectures tab (grouped list, `TranscriptionState` rendering incl. waiting-audio, claimed/quiet/stale
with take over, local job, done, failed, unavailable); UX §3.5 lecture view (layout, `Player` over
`platform.media.url` with Blob fallback and stereo down-mix, `Timeline` over `speech.peaks`, `TranscriptView` with
follow-along, click-to-seek, find, legal-reference links, AI annotations, highlights via `AnnotationService`, **edit mode
(transcript corrections, speaker relabelling — in 0.1 since the 2026-11-04 scope change)**, side panel Notes / AI (summary, key terms, Annotate with AI, Make study notes via `AskService`) / Markers,
transcription status card incl. `arriving`, duplicate and untrusted states, states and test ids of §3.5.6–§3.5.7);
UX §3.6 recording flow (record dialog with versioned consent sentences, dock row with `LevelMeter` and
`MarkerButton`s 1 important / 2 confused / 3 exam / 4 todo / N note, not firing in text fields, live input meter,
pause/resume, save dialog: share audio and transcript / transcript only / keep on this computer, transcribe here /
classmate / OpenRouter / not now with the §3.6.4 default; crash recovery; import dialog; model dialog `model-prompt`);
dock job row (transcription progress with Stop only, model download with Pause), rail recording badge, Ctrl/⌘+Shift+R
and the opt-in OS-global marker shortcuts (Ctrl/⌘+Alt+1…4); Settings › Transcription (UX §3.14.4).

**Must-pass scenarios**: `route=lecture&class=law&lecture=l6 --click=lecture-note-add --type=lecture-note-input=1
--expect=lecture-marker:<count before>`; `dialog=record --expect-attr=record-start:disabled=true --click=record-consent
--expect-attr=record-start:disabled=null`; `route=lecture&class=law&lecture=l6&cite=1 --expect=transcript-para`.

**Peek (minimum)**: UX shots `class-lectures`, `lecture`, `lecture-dark`, `lecture-ai`, `record-dialog`, `recording`,
`model-prompt`, `empty-class`; plus `save` (`speech=fake&recording=1&dialog=save`), `recover` (`dialog=recover`),
`import` (`dialog=import`), lecture `l8` while Bruno transcribes (`sync=fake`), `model=downloading` dock row.

### 6.4 UI-DOCS — documents, document view, notes, search palette

**Owns**: `app/src/features/{documents,document,notes,search}/**`, `app/src/ui/tramado/{MarkdownView,SelectionToolbar,DropOverlay}.tsx`, namespaces
`documents, notes, search` (PT/ES), services `documents.ts`, `extraction.ts`, `search.ts`, `notes.ts`, `annotations.ts`
+ `services/types/{documents,notes,search}.ts`, `app/src/core/{import,search,text,notes}/**` (fixes),
`app/src/workers/**`, `tools/peek-routes/ui-docs.json`.

**Build**: UX §3.7.1 documents tab (folders/breadcrumb, recent, chips: searchable / scan / failed / duplicate,
attachments, conflict copies, import by dialog and drop (`app:drop` tokens, `DropOverlay`), rename/move, delete for
everyone with Undo, remove from this computer only, open/reveal); UX §3.7.2 document view (pdf.js pages with range
loading from the media URL, `doc-pdf-page`, cited passage `mark.cite`, page labels, article outline for law texts,
DOCX/ODT/RTF/MD/TXT/HTML/PPTX as text, images, private highlights/comments with `SelectionToolbar`, Explain/Ask);
UX §3.8 notes (my/class, editor + preview, autosave 2 s, editing presence, conflict dialog with line diff); UX §3.13
search results in the palette (groups, scope, keys, recent, indexing line).

**Must-pass scenarios**: `route=class&class=law --press=Control+K --type=palette-input=conteúdo essencial
--expect=palette-result`; `route=document&class=law&doc=lf&page=9&quote=nunca%20podem%20atingir --expect=doc-pdf-page`.

**Peek (minimum)**: UX shots `documents`, `document-pdf`, `palette` (steps: `--press=Control+K
--type=palette-input=conteúdo essencial`; results come from this WP's provider inside the shell's palette frame), plus `documents` for `stats` (local only), `document` for `slides6` (PPTX) and `resumo` (DOCX),
`note` (`note=class8`), `note` with `conflict=1`.

### 6.5 UI-EXAMS — exams, exam paper flow, practice, Ask

**Owns**: `app/src/features/{exams,exam,ask}/**`, `app/src/features/settings/AiSection.tsx`,
`ui/tramado/{AiCard,CitationChip,CitationPopover,SourceRow,QuotaMeter,CostLine}.tsx`, namespaces `exams, ask, ai` (PT/ES), services `ai.ts`, `exams.ts`,
`ask.ts` + `services/types/{ai,exams,ask}.ts`, `app/src/core/{ai,exam}/**` (fixes, prompt tuning),
`app/src/platform/memory/ai.ts`, `tools/peek-routes/ui-exams.json`.

**Build**: UX §3.9 exams (view models §3.9.1; tab with countdown chips never red; exam date dialog; exam paper dialog
with cost preview; extracting with `ProgressSteps`; **mandatory review**; answer settings (quick/deep, scope, cost and
quota via `CostLine`/`QuotaMeter`); answers view with try-first, `AiCard`, citation chips/popovers, unverified
sentences, shared answer sets, marks; practice session queue Again / Got it; route `practice`); UX §3.11 Ask (tab and
route, threads, scope, cited answers, explain styles); UX §3.15.6–§3.15.7 (free models busy chooser with the explicit
"may train" opt-in through the native confirmation, cost confirm); UX §4 citation chip behaviour (open document at
page/quote, lecture at time, statuses ok/moved/changed/missing/hallucinated).

Also: Settings › AI (UX §3.14.3: privacy identifiers `zdr`/`no-training`/`standard`, busy policy with the native
confirmation, Turn off AI, general-knowledge default), the inline `BusyChooser.tsx`, Ask's [Post to class chat] rule.

**Must-pass scenarios**: `route=exam&class=law&exam=mock&mode=answers --expect-not=ai-answer --click=reveal-answer
--expect=ai-answer`; `--click=citation-chip --expect=screen-document --expect=doc-pdf-page`; `route=settings&section=ai
--expect=ai-privacy-no-training`.

**Peek (minimum)**: UX shots `exam-review`, `exam-answers`, `exam-practice`, `ask`, `ai-busy`, `settings-ai`; plus `exams` tab
(`tab=exams`), `exam-date` and `exam-paper` dialogs, `exam` extracting (`exam=final&mode=extracting`), `answer-settings`
(`dialog=answer-settings`), `ask` with `ai=off`, `ai=quota`, route `ask` (all classes).

---

## 7. Gate G2 (after wave 2)

Merge order: R-SPEECH → UI-SHELL → UI-GROUP → UI-LECTURES → UI-DOCS → UI-EXAMS. The integrator wires
`AiPipe::request_blocking` into `SpeechConfig.stt` (desktop crate). Gate:
```bash
npm ci && npm run typecheck && npm test && npm run test:property && npm run build
npm run check:rust && npm run test:rust && npm run test:rust:speech && npm run lint:rust && npm run check:leaks
cargo test -p tramado-speech transcribes_through_cloud_mock -- --ignored
OPENROUTER_API_KEY=… cargo test -p tramado-speech --test live -- --ignored     # or report "not run: no credit"
node tools/peek-matrix.mjs --axe                                      # every route of every WP: 0 errors, 0 overflow, 0 serious axe
npm run screenshots                                                   # manual pictures, 3 languages
```
The orchestrator opens a sample of the matrix PNGs (at least one per screen in each language) and checks visual
consistency. Commit `G2: wave 2 integrated`, tag `wave2`, push.

---

## 8. Wave 3 — integration, documentation, translation

### 8.1 INT — desktop integration, end-to-end tests, packaging (HEAVY)

**Owns**: `tools/desktop-e2e/**`, `tools/screenshots/capture.mjs`, `tools/desktop-smoke.mjs`, and integration fixes in
`app/src/**` (except `core/i18n/locales/{pt,es}/**`), `crates/**`, `desktop/**`; each fix is its own small commit
naming the defect.

**Tasks**
1. Run the real app (`npm run dev`, then release builds) through every screen; fix TS ↔ Rust mismatches (types,
   events, channel re-attach after a webview reload, error data payloads).
2. Desktop e2e harness from `$TRAMA/tools/desktop-e2e/run.mjs` (WebDriver plumbing, `CLOSE_WINDOWS_PY`,
   `externalSockets()`, stand-in OpenAI server) adapted per `research/trama-ui.md` §4.5 and critique C38; dialog
   answers through `TRAMADO_E2E_DIALOGS` (arch §6.3).
3. Suites: `smoke` (onboarding, create class, import a PDF, search finds an article, CSP style probe, fonts, no
   external sockets from WebKit processes, app process only to the allow-list, close → exit handlers ran; with
   `TRAMADO_AI_LIVE=1` one real Ask in the real app, logging the model that answered),
   `sync-two` (two `TRAMADO_DATA_DIR`s, loopback Syncthing, A shares, B joins with the code, a document and a chat line
   cross, A imports a recording, exactly one transcript appears on both, ✓ Sent ticks, instances stopped one after
   the other), `sync-three` (soft ban with `ignoredFolders`, forged member file and forged deletion healed, leaving while
   the others are offline — sync spec §24; rotation and pairing are v1.1), `media` (PulseAudio null sink:
   `pulseaudio --start`, `pactl load-module module-null-sink`; media self-test passes in WebKitGTK).
4. Hidden-window measurement (arch Q6): hide the window 15 min with a pending joiner and an expiring volunteer delay;
   report; if either fails, implement the documented fallback.
5. Packaging: `npm run build:desktop` → AppImage + deb; install the deb in a throw-away container if available,
   otherwise run the AppImage under Xvfb; record installer sizes (critique R19).
6. Remove every reachable `NOT_IMPLEMENTED`: `grep -rn 'not_implemented(' crates desktop/src-tauri/src | grep -v 'fn not_implemented'`
   and `grep -rn "NOT_IMPLEMENTED" app/src --include=*.ts --include=*.tsx | grep -v -e errors.ts -e '\.test\.'` are empty.

**Acceptance**
```bash
npm run build:desktop
npm run e2e:desktop && npm run e2e:sync && node tools/desktop-e2e/run.mjs --suite=sync-three && npm run e2e:media
```

### 8.2 DOCS — repository documents, CI, supply chain

**Owns**: `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `PRIVACY.md` (generated), `NOTICE`,
`docs/manual/**`, `docs/release-notes/**`, `docs/dev/**` (except the frozen copies), `.github/**` (incl.
`workflows/pages.yml`, which deploys `site/` to GitHub Pages), `deny.toml`, `tools/check-versions.mjs`,
`tools/screenshots/shots.mjs`. (The sync spec wording of arch Q1 was already amended in spec 1.1.)

**Tasks**: README (what Tramado is, privacy stance, install, build, screenshots); AGENTS.md (final commands, layout,
rules, glossary, privacy, speech, sync — Trama's AGENTS.md as the model); PRIVACY.md via `npm run gen:privacy`;
manual skeleton per language with the screenshots; release notes v0.1.0 (EN/PT-PT/ES); `ci.yml` (jobs `web`,
`rust-light` incl. contract tests with the pinned binary, `rust-speech` on schedule or path filter, `release` manual on
3 OSes with the Windows `CMAKE_C_FLAGS_RELEASE` fix of trama-rust §2.6); `canary.yml` (daily, repository secret
`OPENROUTER_API_KEY`, 3 tiny requests per privacy level, opens an issue after 3 failing days; critique G21);
`pages.yml`; `npm run check:leaks` in `ci.yml`; `deny.toml` (arch §18.6); `tools/check-versions.mjs` (arch §18.6);
architecture updates that record decisions made during integration.

**Acceptance**: `npm run gen:privacy && npm run --workspace app check:privacy`; `node tools/check-versions.mjs`
(prints the table; failures listed in the report, not fixed by DOCS); `cargo deny check` (or the report lists
blockers); `actionlint` if available; links in README resolve.

### 8.3 L10N — translations

**Owns**: `app/src/core/i18n/locales/{pt,es}/**`, `desktop/src-tauri/macos/{pt,es}.lproj/**`.

**Tasks**: review every PT-PT and ES string against the glossary (arch §14) and register (PT "você" implied, ES
"usted"); European variants only (ecrã, ficheiro, transferir, definições; ordenador, archivo, ajustes); academic
vocabulary (Disciplina/Aula/Exame/Turma; Asignatura/Clase/Examen; frequência, época de recurso, convocatoria
extraordinaria; valores 0–20, puntos 0–10); plurals with `pt-PT`/`es-ES`; consent sentences (unchanged meaning, one
version `v1`); error sentences; `catalogs.test.ts` green (≤ 5 % identical to EN).

**Acceptance**: `npm run typecheck && npm test`; `node tools/peek-matrix.mjs --lang=pt` and `--lang=es` (no
truncation or overflow introduced; the agent reviews PNGs).

---

## 9. Gate G3 — release candidate 0.1.0-rc.1

Merge order: INT → DOCS → L10N. Gate:
```bash
npm ci && npm run typecheck && npm test && npm run test:property && npm run build
npm run check:rust && npm run test:rust:all && npm run lint:rust && npm run test:contract
node tools/peek-matrix.mjs --axe && npm run screenshots
npm run build:desktop && npm run e2e:desktop && npm run e2e:sync && node tools/desktop-e2e/run.mjs --suite=sync-three && npm run e2e:media
npm run check:versions && cargo deny check && npm audit --omit=dev && npm run check:leaks
npm run gen:privacy && git diff --exit-code PRIVACY.md
curl -sf https://feiteira.github.io/Tramado/join/ >/dev/null && echo "join page live: build with JOIN_PAGE set" \
  || echo "join page not live: keep JOIN_PAGE=''"
```
Bump versions (arch §18.6), commit `G3: 0.1.0-rc.1`, tag `v0.1.0-rc.1`, push. A GitHub release is created only when
the user asks.

---

## 10. Ownership matrix (who may edit what, per wave)

| Path | Wave 0 | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|---|
| Frozen files (arch §19.1), `Cargo.lock`, `test-vectors/**`, `docs/spec/check-words-v1.txt` | M0 | integrator | integrator | integrator |
| `docs/dev/plan.md`, `docs/dev/research/**`, `tools/lab/**` (copies) | M0-TS | integrator | integrator | DOCS |
| `app/src/services/types/common.ts` | M0 | integrator | integrator | INT |
| `site/join/index.html` | M0 (placeholder) | — | UI-GROUP | DOCS |
| `crates/tramado-base/**` | M0 | R-SHELL | — | INT |
| `crates/tramado-net/**` | M0 | R-SHELL | — | INT |
| `crates/tramado-sync/**`, `tools/test-contract.mjs` | M0 | R-SYNC | — | INT |
| `crates/tramado-speech/**`, `tools/fetch-speech-assets.mjs` | M0 | R-SPEECH | R-SPEECH (until G2) | INT |
| `desktop/src-tauri/src/commands/{app,classes,dialogs,ai,system}.rs`, `media.rs`, `tray.rs`, `window.rs`, `deeplink.rs` | M0 | R-SHELL | — | INT |
| `desktop/src-tauri/src/commands/sync.rs` | M0 | R-SYNC | — | INT |
| `desktop/src-tauri/src/commands/speech.rs`, `resources/media/selftest.webm` | M0 | R-SPEECH | R-SPEECH (until G2) | INT |
| `desktop/src-tauri/{tauri.conf.json,tauri.sidecar.conf.json,capabilities/**}` | M0 | integrator | integrator | INT |
| `desktop/src-tauri/{Info.plist,macos/**,icons/**}` | M0 | R-SHELL | — | INT (+ L10N for `{pt,es}.lproj`) |
| `app/src/platform/types/{common,app,classes,ai}.ts`, `platform/tauri/{index,app,classes,dialogs,ai,system,events,media}.ts` | M0 | R-SHELL (additive) | integrator | INT |
| `app/src/platform/types/sync.ts`, `platform/tauri/sync.ts`, `platform/tauri/sync.test.ts` | M0 | R-SYNC (additive) | integrator | INT |
| `app/src/platform/types/speech.ts`, `platform/tauri/speech.ts`, `platform/tauri/speech.test.ts` | M0 | R-SPEECH (additive) | R-SPEECH until G2, then integrator | INT |
| `app/src/platform/memory/{index,app,files,classes,dialogs,secrets,media,window,system,events}.ts` | M0 | integrator | integrator | INT |
| `app/src/platform/memory/{sync,mesh}.ts` | M0 | T-SYNC | UI-GROUP | INT |
| `app/src/platform/memory/ai.ts` | M0 | T-AI | UI-EXAMS | INT |
| `app/src/platform/memory/speech.ts` | M0 | T-LECTURES | UI-LECTURES | INT |
| `app/src/core/{model,errors.ts,hlc.ts,ids.ts,json.ts,bytes.ts,util}` | M0 | integrator | integrator | INT |
| `app/src/core/sync/**` (except `checkWords.ts`, frozen) | M0 (`checkWords.ts`) | T-SYNC | UI-GROUP (fixes) | INT |
| `app/src/core/{ai,exam}/**` | — | T-AI | UI-EXAMS (fixes) | INT |
| `app/src/core/{import,search,text,notes}/**`, `app/src/workers/**` | M0 | T-DOCS | UI-DOCS (fixes) | INT |
| `app/src/core/{transcript,speech}/**` | M0 | T-LECTURES | UI-LECTURES (fixes) | INT |
| `app/src/core/privacy/**` | — | — | UI-SHELL | DOCS |
| `app/src/services/{index,store,context,prefs,identity,hlcClock,classStore}.ts`, `services/types/index.ts` | M0 | integrator | integrator | INT |
| `app/src/services/{library,class,notifications}.ts`, `types/{library,class}.ts` | M0 | T-SYNC | UI-SHELL | INT |
| `app/src/services/{sync,presence,trust,claims,chat}.ts`, `types/{sync,chat}.ts`, `services/mesh/**` | M0 | T-SYNC | UI-GROUP | INT |
| `app/src/services/{ai,exams,ask}.ts`, `types/{ai,exams,ask}.ts`, `services/testing/fakeSearch.ts` | M0 | T-AI | UI-EXAMS | INT |
| `app/src/services/{documents,extraction,search,notes,annotations}.ts`, `types/{documents,notes,search}.ts` | M0 | T-DOCS | UI-DOCS | INT |
| `app/src/services/{lectures,recording,transcription,models}.ts`, `types/{lectures,recording,transcription}.ts`, `services/testing/fakeClaims.ts`, `app/public/demo/lecture.webm` | M0 | T-LECTURES | UI-LECTURES | INT |
| `app/src/core/i18n/locales/en/<ns>.ts` | M0 (UX §5) | integrator | namespace owner (arch §14) | INT |
| `app/src/core/i18n/locales/{pt,es}/<ns>.ts` | M0 | integrator | namespace owner | L10N |
| `app/src/ui/**` (except the rows below) | M0 | integrator | UI-SHELL | INT |
| `app/src/ui/tramado/MarkdownView.tsx` | M0 | T-DOCS | UI-DOCS | INT |
| `app/src/ui/tramado/{SelectionToolbar,DropOverlay}.tsx` | M0 | integrator | UI-DOCS | INT |
| `app/src/ui/tramado/{AiCard,CitationChip,CitationPopover,SourceRow,QuotaMeter,CostLine}.tsx` | M0 | integrator | UI-EXAMS | INT |
| `app/src/ui/tramado/{Composer,QrCode,CheckWords,Avatar,PresenceDot}.tsx` | M0 | integrator | UI-GROUP | INT |
| `app/src/ui/tramado/{MarkerIcon,ProgressSteps}.tsx` | M0 | integrator | UI-LECTURES | INT |
| `app/src/ui/tramado/{Player,Timeline,TranscriptView,LevelMeter,MarkerButton}.tsx` | — | — | UI-LECTURES | INT |
| `app/src/features/settings/{AiSection,TranscriptionSection,SharingSection}.tsx` | M0 (placeholders) | — | UI-EXAMS / UI-LECTURES / UI-GROUP | INT |
| `app/src/shell/**` (except `routes.ts`) | M0 | integrator | UI-SHELL | INT |
| `app/src/features/registry.tsx`, `app/src/shell/routes.ts`, `app/src/services/types/viewModels.ts` | M0 | integrator | integrator | INT |
| `app/src/features/<folder>/**` | M0 (placeholders) | — | owner per arch §11.5 | INT |
| `app/src/demo/{boot,freeze,hooks,controls,keys}.ts` | M0 | integrator | integrator | INT |
| `app/src/demo/{seed.ts,fakeMedia.ts,example/**,assets/**}`, `tools/fixtures/**` | M0 (minimal seed) | T-DEMO | integrator (UI WPs request changes in their report) | INT |
| `tools/screenshots/shots.mjs` | M0 | — | UI-SHELL | DOCS |
| `tools/peek.mjs`, `tools/peek-matrix.mjs` | M0 | integrator | integrator | INT |
| `tools/peek-routes/<wp>.json` | M0 (`m0.json`) | each WP its own file | each WP its own file | INT |
| `tools/desktop-smoke.mjs` | — | R-SHELL | — | INT |
| Root docs (`README.md`, `AGENTS.md`, `NOTICE`, …), `.github/**`, `deny.toml`, `tools/check-versions.mjs`, `tools/{redact-fixtures,check-leaks}.mjs` | M0 | integrator | integrator | DOCS |

Before merging, the orchestrator runs `git diff --name-only main...wp/<wp>` and rejects any path not owned by that WP
in that wave (the WP fixes it or the integrator applies it as a contract change).

---

## 11. Risks and fallbacks

| Risk | Signal | Fallback |
|---|---|---|
| whisper.cpp / libopus builds exhaust RAM when parallel | OOM kills, swap storms | stagger (§0); `CARGO_BUILD_JOBS=2`; other WPs use `--no-default-features` |
| keyring 4.2.0 API or Secret Service unavailable | init error | file fallback (`config/secrets.json` 0600) with a visible note (critique R13) |
| `<audio>` seeking from `tramado-media` wrong in a webview (critique R3) | media self-test fails | Blob URL fallback; on WebKitGTK failure decode to a cached WAV via a new speech command (contract change) |
| Free default model busy (`google/gemma-4-31b-it:free` 429; it was busy for a whole research session) | live test cannot reach Gemma | the live test still MUST get one 200 from the no-training chain (`gemma-4-26b`, `dots-3-note`); the pinned-Gemma attempts are reported, not failed; if the whole chain fails for a day, the gate waits or the chain's order is revisited (critique G21) |
| A UX/spec mismatch reappears | two packages implement two variants | arch §1.2 is the single answer; anything new is a contract change raised in the WP report |
| Signature and person-key code (D-15) is new | M0/T-SYNC overrun | the vectors (`ids.json`, RFC 8785 examples, a real Syncthing `cert.pem`/`key.pem` pair from the contract test) are written first; arch Q13 |
| Syncthing REST behaviour differs from the spec | contract tests fail | R-SYNC writes the contract tests first; deviations are reported against the spec before building on them |
| TS ↔ Rust IPC drift | `commands.test.ts`, binding tests, G1 smoke | additive-only rule; integrator reconciles at gates |
| Hidden-window timers too coarse (arch Q6) | INT measurement | move volunteer timers to Rust (documented fallback) |
| An agent edits shared files | ownership diff check (§10) | reject; registries make shared edits unnecessary |
| UX spec (`docs/design/ux-mvp.md`) not ready for wave 2 | file missing | build from `research/product-ux.md`; reconcile in wave 3 |

---

## 12. Review resolution log (review round 1, 2026-11-03)

Findings are numbered 1–122 in the order of the three reviewers' JSON (1–53 consistency, 54–89 protocol adversary,
90–122 requirements and implementability). "FS" = folder spec 1.1, "SS" = sync spec 1.1, "A" = architecture 1.1,
"UX" = UX spec, "P" = this plan. All five documents were edited in place. Accepted findings were applied as proposed
unless the column says otherwise.

| # | Finding | Decision | Where fixed |
|---|---|---|---|
| 1 | UX privacy identifiers inverted | Accept | UX X8, §3.14.3, §5.14 (`zdr/noTraining/standard` keys); A D-11, §1.2 |
| 2 | Whisper model ids four ways | Accept | FS §2 `ModelId`, §8.3, §8.8 (`modelId`), §8.10; A §5.4 registry |
| 3 | UX invite code/QR/file vs SS §7 | Accept | UX §3.12.2–§3.12.3, X11; SS §7.2 (QR rule, one rule) |
| 4 | Check words three ways | Accept: words in 0.1 | SS §25 Q1, §9.3; UX §3.12.6, OQ12; A §11.1 `checkWords.ts`, Q8, §19.1; P §2.2 (list file) |
| 5 | `admission::decide` signatures | Accept | A §5.3 (`decide(policies, global, offer, now_ms)`, `Skip`), §1.2, §19.1 |
| 6 | Serde wire shapes | Accept (TS `AiBase` made tagged) | A §5 attribute table, §9 `AiBase`, `ipc-samples.json` |
| 7 | Zoom capability, textSize values | Accept | A §18.4, §13.3, §9 `window.setZoom`; UX §3.14.2, OQ9 |
| 8 | lucide 1.60 vs 1.67 | Accept with #117: 1.60.0 | A §3.4 (+ note); UX already 1.60.0 |
| 9 | OpenDyslexic missing | Accept | A §3.4, §13.3 `ui.readingFont` |
| 10 | Demo segment ids too short | Accept | UX §7.3 (`s_l6a00` …) |
| 11 | Exam metadata not storable | Accept | FS §8.12, §8.13; A §11.2 `createUpcoming/updateUpcoming`; UX §3.9.3 |
| 12 | Colour, vocabulary, notify storage | Accept | FS §8.2 `vocabulary`, §8.3 `colour`; A §9 `initialPrompt`, §11.2, §13.3; UX §1.3, §3.3.1 |
| 13 | Language tags | Accept (keep `es-ES` + matching rule) | FS §2 `Lang`, §8.2, §8.8; UX §3.3.1 |
| 14 | Marker kinds and keys | Accept, UX set and keys (not #104's) | FS §8.11; A §9, §1.2, Q10 |
| 15 | Highlight `note` vs `other`, annotation path | Accept; shared display SHOULD/v1.1 (#122) | UX §3.5.3, §5.7, tokens, X3, OQ3; FS §14 Q2 |
| 16 | Edit-op names | Accept (both ops v1.1) | UX §3.5.1, §3.9.3, OQ6, OQ15 |
| 17 | Media URLs and peaks | Accept | UX §3.5.2, §2.11, §7.1, OQ5 |
| 18 | Volunteer default | Accept as #92 (`plugged`, effective with a model) | A §13.3; SS §14.3; UX §3.14.4, OQ7 |
| 19 | One global marker shortcut | Accept (kept in 0.1) | A §6.5, §7.1, §9, §13.3; UX §3.14.4 |
| 20 | Update checks without backend | Accept: removed | UX §3.14.8–§3.14.9, §5.17–§5.18; A Q3 |
| 21 | Storage/sharing commands missing | Accept (forget own device → v1.1 with pairing) | A §6.1–§6.2, §6.7 `sync_restart`, §9; SS §19 removal steps; UX §3.14.5, §3.14.7–§3.14.8 |
| 22 | AI activity fields, clear | Accept | A §5.2, §6.4, §9; UX §3.14.8, §5.18 |
| 23 | Lasting busy relaxation | Accept | A D-10, §5.2, §6.4, §9; UX §3.14.3, §3.15.6 |
| 24 | `ChatAi.replyTo` required | Accept | FS §8.16; A `AskService.postToChat`; UX §3.11 |
| 25 | "Nothing yet" share | Accept | A §9 `ShareMode`, §11.2; UX §3.6.2, §3.6.4 |
| 26 | Consent records disagree | Accept | FS §8.5; A §14, §11.2; UX §3.6.2, §3.12.1, §5.8 |
| 27 | Missing prefs keys | Accept | A §13.3 (full table); UX key citations |
| 28 | `ExtractionService` missing | Accept (merged with #96) | A §11.2 |
| 29 | Live mic meter | Accept | A §6.8, §7.2, §9, §11.2 `RecordingService.startMeter` |
| 30 | Import attach | Accept | A D-7, §5.4, §6.8, §9 |
| 31 | Ask thread path | Accept | P §4.2 |
| 32 | Notification strings twice | Accept | UX §5.22 (new), §5.2, §2.8; A §11.2, §14 |
| 33 | Claim health names | Accept | UX §2.12, §3.5.5, §5.7 |
| 34 | Transcription pause | Accept: removed | UX §2.7, §2.12, §3.5.5, §5.7 |
| 35 | `UNSUPPORTED_CPU` | Accept | UX §3.5.5, §3.14.4 |
| 36 | `secrets.set` name; link confirmation | Accept (allow-list) | UX §3.1, §3.14.3; A §6.5 |
| 37 | API port in diagnostics | Accept | UX §3.14.5, §5.17 |
| 38 | `.tramado-invite` association | Accept | A §18.3, §5.5, §7.1 |
| 39 | `unsure`, practice, hints storage | Accept | A §11.2, §13.2; UX §3.9.1 |
| 40 | Exam view-model fields | Accept | FS §8.12 `extraPoints`; UX §3.9.1 mapping, `true_false`, `import` mode |
| 41 | Leave dialog choices | Accept (`unregister` not offered) | UX §3.3.4; A §9 `LeaveOptions`; SS §17 |
| 42 | Decline / Not now | Accept | UX §3.12.1; SS §9.3 |
| 43 | DialogId vs inline UI | Accept | A §11.4–§11.5 (`CLASS_STATES`); UX §7.2 |
| 44 | FS §12 drifted | Accept: FS §12 points to A §13 | FS §12; A §13.2 (`lectures/`, `ui-state.json`, `trusted/`) |
| 45 | More sync-spec errata | Accept: applied now, not in wave 3 | SS §0.6, §1, §6.1, §8, §20; A D-1, Q1 closed; P §8.2 |
| 46 | Unlisted FS deviations | Accept | FS §5.1 |
| 47 | Unlisted A deviations | Accept (audio path made Rust-internal) | A D-12, D-13, D-14; FS §8.6–§8.7 |
| 48 | Rust/TS twins differ | Accept | A §5.1 `ClassEntryView`, §5.3 `share_class`, §9 `SecretStatus` |
| 49 | `localIgnores` representation | Accept | FS §11.2; A §5.1, §9 |
| 50 | M0 files not in A | Accept | A §2, §11.1, §11.2, §11.6, §19.1; P §2.1–§2.2, §10 |
| 51 | HLC vectors, wrong plan ref | Accept | A §17, §11.5 |
| 52 | `NOT_IMPLEMENTED` string, `{name}` | Accept | UX §5.20; A §15 |
| 53 | Name length, icon count | Accept | UX §3.1, §3.3.1 |
| 54 | Self-declared `memberId` | Accept | FS §6.2 rule 6, §8.16; SS §15; P §4.1 tests |
| 55 | Deletions unchecked | Accept (signed files: deletions ignored) | FS §6.2 rule 4, §8.2 vacancy, §9.2; SS §12.1; A §13.2 |
| 56 | Verdict not bound to bytes | Accept | FS §6.2; SS §12.1; A §9 `FileSyncInfo`, §12 |
| 57 | `modifiedBy` forgeable | Accept: device signatures | FS §6.1, §6.5, §6.6; SS §12.4; A D-15, §3.2, §6.7 `sync_sign` |
| 58 | TOFU binding | Accept: person keys | FS §2, §8.3.1; A §5.2 `person`, §6.1; SS §19 |
| 59 | Manifest writer pinning | Accept: derived IDs | FS §2.1, §6.2 rule 3, §8.1, §8.6, §8.12; A `core/model/derive.ts` |
| 60 | Bans/organisers vs time | Accept | FS §8.2, §8.3.1, §8.19; SS §18.1 `apply_bans` |
| 61 | Soft ban gaps | Accept | SS §18.1, §9.2; FS §8.19; UX §3.12.1, §5.15 |
| 62 | Transcript heal war | Accept | SS §12.3, §14.5, §14.8; FS §8.8, §10; A §5.1, §5.3 |
| 63 | Durable facts in deleted claims | Accept | SS §14.2, §14.4; FS §8.10 |
| 64 | Done claim, blocks not arrived | Accept | SS §14.1, §14.4; UX `arriving` state |
| 65 | No re-evaluation when stale | Accept | SS §14.3 |
| 66 | Mass-delete guard | Accept (+ receiving side) | SS §2.4, §5, §22.2; A §6.7, §7.1; UX §3.15.3 |
| 67 | Leaving with nobody online | Accept | SS §17, §9.2; A §5.1, §9 |
| 68 | keepLocal keeps the class ID | Accept: fork | SS §17; FS §8.1; A §6.2 `class_fork`, `class_adopt` |
| 69 | Stuck-joiner loop | Accept | SS §10 |
| 70 | Join order lock-out | Accept | SS §8, §9.2 strikes; UX §3.12.3 |
| 71 | Burst joins, DoS | Accept | SS §9.2 |
| 72 | Rotation acceptance | Accept (rotation v1.1) | SS §18.2; FS §8.18 `excluded` |
| 73 | Future-stamped registers | Accept | FS §3.4; A `HlcClock.override` |
| 74 | Windows paths | Accept | SS §3.6 |
| 75 | Webview can widen access | Accept | SS §9.5; A §6.7 (commands removed), §16 |
| 76 | Undo trust, Recently deleted | Accept | SS §22.1; FS §6.2 rule 1 |
| 77 | Copied identity | Accept | SS §2.2, §2.5; A §6.7, §15; UX §3.15.12 |
| 78 | Event shapes | Accept | SS §12.2, §15, §4; A §7.1, §9 |
| 79 | Resume and settle | Accept | SS §14.5; A §5.4 heartbeat |
| 80 | Presence staleness at start | Accept | SS §13; FS §8.4 |
| 81 | Partial arrival, renamed dirs | Accept | FS §5.3, §8.6, §8.12 |
| 82 | Chat order and months | Accept | FS §8.16; SS §15 |
| 83 | Lost Syncthing home | Accept | SS §2.3, §2.7 |
| 84 | Mirror self-heal costs | Accept | FS §10; SS §12.3; A §5.1, §5.3 |
| 85 | Device name leaks | Accept | SS §9.4, §2.7, §8; A §9 `SyncSettings` |
| 86 | Pairing bypass | Accept (pairing v1.1) | SS §19, §9.2 `pairing_peer`; A §5.3 |
| 87 | Meta values unvalidated | Accept | FS §8.2 |
| 88 | Local write consistency | Accept (HLC ceiling) | FS §3.3; SS §12.3; A §5.1 |
| 89 | Start-up admits on stale policy | Accept | SS §9.2 start-up rule; A D-1, §4.4 |
| 90 | Wave-1 Rust depends on stubs | Accept: M0 implements `http`, secrets file backend; `SttTransport` | A §5.2, §5.4; P §2.2, §2.6, §3.2–§3.3 |
| 91 | No successful live OpenRouter test | Accept | A §5.2, §17; P §3.1, §4.2, §5, §8.1, §11 |
| 92 | Nobody transcribes | Accept | SS §14.1, §14.3; UX §3.6.4, §3.14.4, OQ7; A §13.3 |
| 93 | AI does not annotate transcripts | Accept | A §11.1 `radar.ts`/`references.ts`, §11.2; FS §8.17 `ai`; UX §3.5.3–§3.5.4; P §4.4 |
| 94 | Join page unowned | Accept | P §6.2, §8.2, §9; SS §25 Q4; UX §3.12.2 |
| 95 | Registry and core types undefined | Accept | A §11.2, §11.4 |
| 96 | Worker hosts not wireable | Accept | A §11.2 `AppContext`, factories, §11.7 |
| 97 | `MemoryPlatform` undefined | Accept | A §10 |
| 98 | No Rust time utility | Accept | A §5.1 `time`; P §2.2 `time.json` |
| 99 | `Cargo.lock` unowned | Accept | A §3.2, §19.1; P §1.3, §10 |
| 100 | Stub clippy fails R-SHELL | Accept | P §2.6 |
| 101 | Identity needs ports/sidecar | Accept | SS §2.3–§2.4; A §4.4, §6.7; UX §3.1 |
| 102 | `ui/tramado` ownership | Accept | A §11.3; P §6, §10 |
| 103 | Settings across packages | Accept: API freeze **and** sections moved | A §11.2, §11.5; P §5, §6, §10 |
| 104 | Reconciliation table | Accept (MarkerKind per #14, not #104's choice) | A §1.2 |
| 105 | Prefs typed and complete | Accept | A §11.2 `PREF_DEFAULTS`, §13.3 |
| 106 | No behaviour assertions | Accept | A §17; P §2.3, §6 must-pass scenarios |
| 107 | PulseAudio, cargo-deny missing | Accept (user action) | P §0 pre-flight, §3.1 |
| 108 | Resource plan | Accept | A §3.2 profiles; P §0, §1.1 |
| 109 | MVP too big | Accept in part: all listed items v1.1 **except** "Recently deleted" (kept: shared folders must stay recoverable; its commands exist) | A §1.1; UX X12; specs "(v1.1)" marks; P scope line |
| 110 | M0 critical path | Accept | P §0, §2, §5, §7 |
| 111 | Wave-1 TS cross-deps | Accept | A §11.1; P §2.2, §4.3, §4.5, §5 |
| 112 | `AiPipe` unfit for STT | Accept | A §5.2, §5.4, §11.1.1; P §3.3, §7 |
| 113 | Backup recordings transcribed twice | Accept | SS §14.2–§14.3; FS §8.6; UX §2.12, §3.5.5 |
| 114 | Fixture `user_id` leak | Accept | A §3.4 `check:leaks`, §17; P §1.3, §4.2, §8.2, §9 |
| 115 | Briefs depend on /tmp | Accept | A header, §2; P header, §2 |
| 116 | QR sizing | Accept | SS §7.2; UX §3.12.2, §2.11, X11 |
| 117 | lucide 1.67.0 too new | Accept | A §3.4 |
| 118 | Vision chain | Accept | A §11.1.1 |
| 119 | Privacy identifiers (duplicate of 1) | Accept | as 1 |
| 120 | Ownership gaps and naming | Accept | P §3.2, §3.3, §1.4, §2.2, §10; A §19 tags |
| 121 | Bundle targets | Accept | A §3.4 `build:linux`, §18.3 |
| 122 | Shared annotations display | Accept: SHOULD, v1.1 | FS §14 Q2, §8.17; A Q5; UX OQ3 |

No finding was rejected: each was checked against the documents (and, where claimed, the lab outputs: Ed25519 device
certificates and `blocksHash` in `lab/adversarial/adv.out`, the reset restore in `reset.out`, npm publish dates of
lucide-react 1.60.0/1.67.0, `ed25519-dalek` 3.0.0) and found correct.

**Decisions for the lead to confirm with the user**: (a) the 0.1 scope cut of arch §1.1 (notably transcript
corrections, pairing a second computer, chat reactions/pins); (b) shipping person keys and device signatures in 0.1
(arch D-15, Q13), which changes how classes are identified and needs about a week more of foundation work; (c) the
volunteer default `plugged` (opt-out notice) instead of the UX's Off; (d) the pre-flight `sudo apt install` and a funded
OpenRouter key for the live STT check.

---

## 13. G0 contract changes (gate G0 integrator, 2026-11-03)

Each item is a deviation from arch/UX/plan text that M0 shipped, accepted at G0 so the two halves stay consistent. The
documents above are not rewritten; this list overrides them where they differ. Items marked **open** are suggestions
the lead decides; nothing was changed for them.

**Applied by the integrator at G0**
1. Leave dialog test id: the M0 placeholder used `leave-dialog`; changed to `confirm-dialog` as UX §3.3.4 says
   (`useConfirm`), and `tools/peek-routes/m0.json` (`dialog-leave`) now waits for `confirm-dialog`.
2. `.gitignore`: `.env*` added next to `.env` / `.env.*`.

**Accepted (Rust, M0-RUST)**
3. `Cargo.lock` pins `rust-ini` to 0.21.1 (`cargo update -p rust-ini --precise 0.21.1`): `tauri-plugin-deep-link =2.6.2`
   does not compile with `rust-ini` ≥ 0.21.2. Whoever regenerates the lock (arch §3.2) re-applies the pin, or bumps the
   plugin.
4. `tauri.conf.json` adds `bundle.macOS.files` mapping `Resources/{en,pt,es}.lproj/InfoPlist.strings` (the §18.3 text
   needs it; its JSON omitted it).
5. `AiWireEvent::Fail` in Rust carries a typed `code: Code` and optional `data`, matching TS `platform/types/ai.ts`.
6. Public API additions: `tramado_base::ids::{derive_class_id, derive_item_id, member_id, device_id_from_cert_der,
   device_id_from_sha256, is_valid_device_id}`; `tramado_base::files::{write_atomic_mode, check_line,
   conflict_original}`; `Code::ALL`, `Code::parse`, `Deserialize for Code`; `Paths::for_tests`.
7. `desktop/src-tauri/src/lib.rs` declares its modules `pub mod` (arch §5.5 shows private `mod`) so the stubs pass
   clippy `-D warnings`.
8. `fetch-syncthing.mjs`: the archive's `AUTHORS.txt` is installed as `resources/syncthing/AUTHORS`; `--gpg` requires a
   `VALIDSIG` by the release key `FBA2E162…` and reads only the signed text (the checksum file carries a second
   signature by a key we do not ship, so plain `gpg --verify` exits non-zero).
9. **Open:** the `.st*` name rule is case-sensitive in both TS (`core/model/paths.ts`) and Rust (`confine`), matching
   each other and the folder spec. M0-RUST suggests making it case-insensitive on both sides (macOS/Windows file
   systems); that is a folder-spec change plus a `class-paths.json` vector change.
10. **Known:** 52 locked crates (e.g. `ureq 3.5.0`, 2026-10-21) are younger than the 14-day rule (D-5); a future
    `check:versions` fails until about 2026-11-17.

**Accepted (TypeScript, M0-TS)**
11. UX §5.14 `ai.cite` had duplicate keys; they are `hallucinatedNote` and `missingNote`.
12. Test ids: class settings dialog root is `class-settings` (UX §3.3.1; the arch §11.5 table says `class-dialog`, which
    the New class dialog keeps); the Missing state is `missing-item` (UX §3.15.10).
13. `layers.test.ts` lets `ui/` and `workers/` `import type` from `services/types`, `services/context` and
    `platform/types`; tests and `services/testing/**` may import the memory platform.
14. Additions to frozen files: `ClassStoreImpl.ingest` / `.idle`, `ClassLibraryImpl.entry`, `AppServicesImpl.dispose`;
    `DropOverlay` prop `classLabel`; `Composer` props `onAttach`, `replyTo`; `AiClient` is a placeholder (`= object`)
    until T-AI; `CommandPalette` takes search providers and renders `palette-result` rows.
15. Extra files: `platform/memory/{keys,signer}.ts`, `core/model/icons.ts`, `core/util/sha256.ts`,
    `services/testing/context.ts`, `shell/undoManager.ts`, `shell/pills.ts`, `features/placeholder.tsx`,
    `ui/tramado/citationText.ts`, `ui/marks.tsx`, `tools/peek-lib.mjs`.
16. `.gitattributes` adds `app/test-fixtures/** -text` (CRLF/BOM/cp1252 import fixtures stay byte-exact).
17. Measured values: `rec-text` contrast 5.539 (UX says 5.54); `app/public/demo/lecture.webm` is 1.28 MB (plan said
    ≈ 0.9 MB).
18. `test-vectors/hlc.json` override vectors use start-up counter 1.
19. `package-lock.json` was seeded from Trama's lock (npm bug workaround); `npm ci` in a fresh clone passes.
20. `main.tsx` and `demo/boot.ts` use the worker hosts of arch §11.7; search through them answers `NOT_IMPLEMENTED`
    until T-DOCS.
21. `check-leaks.mjs` also scans `docs/` for `sk-or-v1-` keys and compares against the local key file's value without
    printing it.

---

## 14. G1 integration log (gate G1 integrator, 2026-11-04)

Merged in this order, each with `git merge --no-ff` and the quick check after it: R-SHELL (`beeedac`), R-SYNC
(`72aa367`), R-SPEECH (`40d260a`; merged at G1 instead of G2 because its acceptance passed), T-SYNC (`682f599`),
T-DOCS (`e5dc258`), T-LECTURES (`1f12077`), T-AI (`68b427f`), T-DEMO (`c7b834e`). No branch touched `Cargo.lock`,
`package-lock.json` or a manifest; every changed path was inside the package's owned paths (§10; `tauri.test.ts`,
`library.test.ts`, `annotations.test.ts` are tests of owned modules). R-SHELL's `target/` became the main one.

Integration fixes (each found by the quick check or by the gate):
1. **tramado-speech import race** (`import_mp3_to_webm` failed under load): the import thread sent `Done` before it
   set its `done` flag, so `pending_recordings()` called on `Done` still skipped the import. The flag is now set
   first (`crates/tramado-speech/src/lib.rs`).
2. **Stale registry entry in class stores** (`recording.test.ts`, 2 tests, after T-LECTURES on top of T-SYNC): a
   class's `ClassStore` kept the `ClassEntry` it was created with, so `entry.shared` stayed false after sharing and
   RecordingService skipped the `share` consent line. `ClassStoreImpl.setEntry` is new; `services/index.ts` hands each
   live store the reloaded entry whenever the library publishes, sets the trust gate when a class becomes shared, and
   calls `lectures.dispose()` when a class leaves the library or the services are disposed (T-LECTURES request 6).
   T-SYNC's `liveEntry()` workarounds stay correct and are now redundant.
3. **API freeze fallout**: `services/testing/fakeClaims.ts` implements the ClaimEngine/PresenceService members that
   moved into `services/types` (below).
4. **Desktop wiring**: `commands/sync.rs` and `commands/speech.rs` also `manage` `Arc<SyncEngine>` / `Arc<Speech>`,
   which `diag_collect` reads (R-SHELL's convention); `speech::init` passes `PipeStt::new(Arc<AiPipe>)` (R-SHELL
   manages the pipe and `ai::init` runs first), so cloud transcription no longer answers `NOT_IMPLEMENTED`.
5. **check-leaks**: the fixed fictional `user_id` that `redact-fixtures.mjs` writes is exempt (T-AI request 6); any
   other 20+ character `user_id` still fails.
6. **One volunteering rule**: `core/sync/claims.ts` `autoDelayMs` and `effectiveVolunteer` delegate to
   `core/speech/volunteer.ts` (the TranscriptionQueue's); the member file's `caps.volunteer` counts a local model only
   with `cpuOk && localWhisper`, as the queue does (T-LECTURES request 8).
7. **Shell start-up** (T-LECTURES request 5): `AppState.enter` calls `recording.recover()` after `library.load()` and
   `transcription.start()` once `sync.boot()` settled.
8. **Demo boot** (T-SYNC 4, T-DEMO 1, T-LECTURES 4, T-AI 5, T-DOCS 6): `DemoControls.{ai,sync,speech,media}` are
   wired; `seedDemo` gets `join`, `unverified`, `conflict`, `ai`; the speech fake is bound to the platform with
   `recordingClassId = law` and scripted with `demoTranscript('l8' | 'b4')`; `tick` also advances `tickFakeMedia`;
   `?ai=real` reads the key typed in Settings from the memory secrets (`mem.peekSecret`) and seeds no fictional key.
   `main.tsx` and the demo wire `imagePrep`/`pdfRender` over `workers/image.worker.ts`.
9. **Memory platform**: `mem.putRecording` lets the speech fake's private ("transcript only") audio reach
   `media.url({kind:'private'})` (T-LECTURES request 9); `MemoryMesh.device(name, { speech })` takes a fake speech.
10. **Peek routes**: the four `*-missing` entries of `m0.json` use the unknown key `zz` (T-DEMO request 3).
11. **Plan §5.1 integration tests**: `services/mesh/transcription.test.ts` (real TranscriptionQueue over the real
    ClaimEngine, two devices: volunteering and simultaneous manual claims each end with exactly one transcript, one
    `done` claim, no conflict copy); `exams.test.ts` "over the real SearchService" (T-DOCS' index: citations point
    to the class document, the private note never leaves); `demo/seed.ts` writes `transcript.md`/`.vtt` with T-LECTURES'
    renderer and `example.test.ts` asserts byte equality.
12. **G1 flow** (`desktop-smoke.mjs --flow=g1`): onboarding is driven through its DOM; class creation and the PDF
    import go through the services (`window.__tramadoE2E`, set only when `AppInfo.e2e`), because those screens are
    wave-2 placeholders; extraction runs in the webview's pdf.js worker (WebKitGTK) and `features/search/provider.ts`
    is a minimal palette provider over `SearchService.passages` (UI-DOCS replaces it).

## 15. G1 contract changes (gate G1 integrator, 2026-11-04)

As in §13: the documents above are not rewritten; this list overrides them where they differ. **Open** items are for
the lead; nothing was changed for them.

**Applied by the integrator (TypeScript)**
1. API freeze (arch §11.2): T-SYNC's `*Impl` extras are now members of the frozen interfaces, and the `*Impl` names
   are aliases (`export type ClassServiceImpl = ClassService`, likewise Sync/Trust/ClaimEngine/Presence/Notification):
   - `ClassService` + `model: ReadableStore<ClassModel>`, `ready()`, `reload()`, `personAt(deviceId, hlc?)`,
     `isOrganiserAt(memberId | null, hlc)`, `deviceRef(deviceId): DeviceRef`, `nameOf(deviceId)`,
     `policy(): ClassPolicy | null`, `writeBan(target, state, reason?)`, `removeOwnFiles()`,
     `writeFork(newClassId, nonce)`, `uiState()`, `setUiState(patch)`; `ClassModel` moved to `types/class.ts`.
   - `SyncService` + `connections: ReadableStore<Record<DeviceId, ConnectionState>>`, `connectionOf(deviceId)`,
     `onIndexUpdated(cb)`, `noteForeignWrite(classId, path)`, `fork(classId): Promise<ClassId>`, `completeForks()`;
     `ConnectionState` moved to `types/sync.ts`.
   - `TrustService` + `ready`, `keptPaths`, `kept`, `deletionHonoured`, `dropKept`, `left(): ReadonlyMap<DeviceId,
     FormerEntry>`, `noteLeft`, `vacated`, `addVacated`, `pinnedWriter`, `foreignWrites`, `recentRemote`, `flush`;
     `FormerEntry` moved to `types/sync.ts`.
   - `ClaimEngine` + `trustedClaim(lectureId, kind, deviceId)`, `foldWinner(lectureId)`, `foldTrigger(lectureId)`,
     `onReevaluate(cb)`, `releaseAll()`, `ready()`.
   - `PresenceService` + `activityOf(deviceId)`, `mine()`; `NotificationService` + `recent()`.
   - `MemoryMesh`'s additive members and `MeshOptions.startMs` were already in T-SYNC's own file; G1 adds
     `device(name, { speech? })`.
2. `ChatMessageView` + `thanks?: { to: { memberId; name }; lectureId } | null` (T-SYNC 6). For `kind: 'thanks'`,
   `text` is now `''` (was: the lecture id) and `mentions` still names the thanked person.
3. i18n `members.invite.fileSentence` (EN/PT-PT/ES); the `.tramado-invite` second line uses it in the inviter's UI
   language (was an English constant) (T-SYNC 5).
4. `ClassStoreImpl.setEntry(entry)` (services-internal, fix 2 above).
5. `MemoryPlatform.mem` + `putRecording(recordingId, bytes | null)`, `peekSecret(name)`; `DemoControls` +
   `media?: { tick(ms) }`; `DemoFlags.ai` + `'real'`.
6. `window.__tramadoE2E` (the AppServices) exists only when `AppInfo.e2e` (desktop, `TRAMADO_E2E=1` +
   `TRAMADO_DATA_DIR`).

**Accepted as delivered by the packages (already in their owned files)**
7. R-SHELL: `AppInfo` + `mediaAudio?: 'scheme' | 'blob'`, `traySupported?: boolean`; e2e dialog queue entries
   `{confirm: bool}`; env `TRAMADO_E2E_EVAL`, `TRAMADO_E2E_MEDIA_SELFTEST` (only with `TRAMADO_DATA_DIR` +
   `TRAMADO_E2E=1`); `Secrets::get` is `pub`; stricter: `models/<id>/endpoints` refuses empty/`.`/`..` segments,
   `class_open` refuses programs and launchers (`INVALID`), `service-hosts.json` stores `{id, base, label}`,
   `app_take_pending_links` returns an opened invite file's text. **Arch §8: on Linux (WebKitGTK) audio plays from a
   Blob URL** (`<audio>` refuses the custom scheme; the self-test passes on the Blob path: duration 300.008, seek 252).
8. R-SYNC: `SyncSink::trash` (default `IO_ERROR`), `SyncEngine::set_pick_resolver`, `has_shared_class`, `new`
   registers its own `WriteObserver`; threads `tramado-sync-{work,discovery,ready,boot,stop}` and a re-entrant config
   lock instead of a `tramado-sync-config` thread (arch §4.2); `appdata.json` + `userPaused`, `settings`,
   `lostIdentity`; `sync_join_class` on a class already here → `CONFLICT` with `data.classId`; `sync_admit` unknown or
   unshared class → `NOT_FOUND`, no offer or banned device → `PERMISSION_DENIED`; diagnostics `status.deviceId` is a
   ShortId; Syncthing also starts at launch when the only shared class is still leaving.
   Spec errata accepted: sync spec §6.1 (a folder created paused has no directory or marker until the ignores POST and
   resume); §22.2 counts deletions only (Syncthing reports new and modified files alike); §3.6 converts separators
   only (no NFC crate; Syncthing keeps NFC).
9. R-SPEECH: `FinishedRecording` + `audio?: PublishedAudio`, `import?: ImportInfo` and `ImportInfo { fileName, mime,
   hadVideo, lectureDir }` (TS and Rust); `speech_recording_publish` also fails with `JOB_BUSY` (still recording) and
   `NOT_FOUND`, a second publish → `CONFLICT`; journal page every 17 packets (≈ 1 s), not 50 (arch §5.4);
   audio-pipeline §2.7 erratum: intermediate Ogg granules are samples × 3, only the last page is `preskip + real × 3`
   (RFC 7845 §4); local jobs report `checking → vad → transcribing` (no `decoding`); `auto` with no detection → `und`;
   peaks scale the loudest bucket to 255; new modules `recorder`, `pieces`, `samples`, `langs`.
10. T-SYNC: sync spec §14.5 — a new claim starts at `heartbeat: firstHeartbeat(observations, me)` (1 + the largest
    heartbeat of a `supersedes` entry naming me, else 0; was `0`) — the 2000-run property test found two `working`
    devices otherwise. Folder spec §6.2 rule 3 — a writer change in the same round is also accepted when the new
    writer's `done` claim wins that round (also T-LECTURES 10; without it readers pinned to a partition's losing side
    refuse the winner's transcript forever).
11. T-AI: `services/types/{ai,exams,ask}.ts` additions as reported (`AiClient` re-exported from `core/ai/client`,
    `AiService.label/ready`, `AiSettingsExtra`, `AnswerOptions`, `startTyped`, `cancelDraft`, `retryDraft`,
    `cancelAnswers`, `progress`, `AskOptions`, `ExplainStyle` + `'detail' | 'exam'`, `removeThread`, `lectureNotes`,
    optional `AskTurn` fields); `createFakeAi()` returns `FakeAi` and defaults to mode `off`.
12. T-DOCS: `DocumentService.import(picks, destDir?, opts?: { allowDuplicate?: boolean })`; `ExtractionService.status`
    + `progress?`, `pages?`; `Passage` + `title?`, `private?`; `resolve` result + `path?`; `SearchService` +
    `settled?(classId)`, `refresh?(classId)`; Markdown `Inline` + `cite`, `mention`, `MarkdownOptions` + `citations`,
    `mentions`, `relative`, `parseInline(s, options?)`, `MarkdownViewProps` + `citations`, `renderCite`, `mentions`,
    `renderMention`; `ImportFormat` + `'pptx'`. Private notes are `SourceRef {kind:'note', path:'notes/<name>.md'}`
    with `Passage.private: true`, and are never cited in shared content.
    Spec over plan: annotations are private only in 0.1 (`visibility:'class'` → `NOT_IMPLEMENTED`, folder spec §8.17,
    arch §1.1); "Keep both" names the copy `<base> (2).md` (sync spec §16.3–4) — **UX §3.8's "(Bruno's copy)" is
    superseded; UI-DOCS uses the spec's name**.
13. T-LECTURES: `LectureDetail.canEdit: boolean` (was `false`, the scope change), `EffectiveTranscript.correctedBy`,
    `LectureService.edit: TranscriptEditor`, `fold(id, opts?: { takeOver?: boolean })`; `RecordingState.warnings`,
    `RecordingService.imports`, `share(recordingId, mode)`, `importAudio` options `language`, `transcribe`, `consent`;
    `TranscriptionQueue` job `phase`/`engine`, `volunteerNotice`, `notify`, `start()`, `ackVolunteerNotice(turnOff)`,
    `notifyWhenReady(classId, lectureId, on)`; `ModelsService.info`, `downloads`, `refresh()`.
14. T-DEMO: `SeedOptions` + optional `join`, `unverified`, `conflict`, `ai`, `assets`; `PlayerHandle` is exported from
    `demo/fakeMedia.ts` (UI-LECTURES uses it); `l6` has one pending correction (corrections are in 0.1).

New private files (arch §13.2): `data/recordings/<id>.{ogg,json,webm}`, `data/transcribe/<lectureId>.{json,partial.json,
result.json}`, `data/transcribe/speed.json` (R-SPEECH); `private/<classId>/fork.json` and `trust.json` `left` entries
with `memberId`, `name`, `deviceName` (T-SYNC); `private/<classId>/notes-index.json` (`tramado.notes-private` v1,
T-DOCS); `private/<classId>/drafts/<recordingId>.json` (`tramado.recording-draft`) and `lectures/<id>.json` +
`noAutoClaim`, `nudgedAt` (T-LECTURES).

**Deferred / open**
15. R-SYNC 5 — `SyncEvent {type:'left'; classId; afterwards}`: not applied (needs Rust emission, the TS type and
    SyncService handling). Until then `SyncService.completeForks()` notices `leftClasses` itself. Wave 2: UI-GROUP
    with the integrator at G2.
16. **Open** — T-SYNC 3, folder spec §8.2 vacancy: the replay uses the reader's current `vacated` set, so a self-add
    made before the organisers left becomes valid afterwards; T-SYNC suggests evaluating `vacated` as of each op's
    HLC. A spec change for the lead.
17. **Open** — T-LECTURES 10: `label_speaker` lines have no timestamp (a late, older label can override a folded one);
    the `.md` date is the UTC date; the merge text is `a + " " + b`. Folder spec wording for the lead.
18. R-SPEECH gaps carried into wave 2/INT: `small`/`large-v3` (and their DTW presets) never run; the live STT check
    used a stand-in transport (the real `PipeStt` is wired now but untested live); Windows/macOS and system-audio
    capture untested; a finished, untaken result does not restart its claim heartbeat after an app restart.

**Gate G1 run (2026-11-04, on `G1: contract updates`)** — all pass: `npm ci`, `typecheck`, `npm test` (136 files, 946
tests + 3 opt-in live skipped), `test:property` (2000 runs), `build`, `check:rust:lite`, `test:rust`,
`lint:rust:lite`, `test:contract` (18 contract + 13 two-instance tests on Syncthing v2.1.7, none left running),
`check:leaks`, `desktop-smoke` (onboarding in the real window), `desktop-smoke --flow=g1` (all six steps; extraction and
indexing in WebKitGTK workers), `peek-matrix` (108/108: m0 54, t-demo 54), live `core/ai/live.test.ts` (4/4, free
models) and `tramado-net --test live` (answered by `google/gemma-4-26b-a4b-it:free`, 200 on the first attempt). Also
run: `check:rust`, `lint:rust` (full workspace with whisper), `cargo test -p tramado-speech` (twice) and
`-p tramado-desktop`. No paid request was sent by the integrator.

**Wave-2 follow-ups found at G1** (not blocking): the §14.8 fold hand-over is never scheduled — `ClaimEngine.foldTrigger`
/ `foldWinner` and `LectureService.fold({ takeOver: true })` exist, but nothing checks the trigger hourly and claims the
fold (UI-LECTURES, who owns `services/{lectures,transcription}.ts` from G1); `joinStalled` counts from `join()`, not from
the first connection (UI-GROUP); chat is not in the search index, so the palette's Chat group needs another source
(UI-DOCS); `features/search/provider.ts` is a G1 stand-in whose rows do not navigate yet (UI-DOCS).
