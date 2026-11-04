# AGENTS.md

Guidance for coding agents (and people) working in this repository. `CLAUDE.md` imports this file. The contract is
[`docs/dev/architecture.md`](docs/dev/architecture.md) ("arch"); what is on disk and on the wire is specified in
[`docs/spec/`](docs/spec/); every screen, string and test id is in [`docs/design/ux-mvp.md`](docs/design/ux-mvp.md)
("UX"). When they disagree: the specs win for files and the wire, the architecture for code structure, the UX
specification for screens and strings; the integration logs of [`docs/dev/plan.md`](docs/dev/plan.md) §13–§18 record
where the code departs from all three.

## What Tramado is

A desktop app for university students: record and transcribe lectures, keep a class's documents, notes and exams
together, share a class with classmates peer to peer (Syncthing, no server, no account), and practise for exams with
an AI (the student's own OpenRouter key, or a local OpenAI-compatible service) that cites its sources. Tauri 2 + React
18 + TypeScript + Rust, MPL-2.0, built on [Trama](https://github.com/feiteira/Trama). Status: release candidate
0.1.0-rc.1, tested on Linux (Ubuntu 24.04, WebKitGTK); the Windows and macOS builds come from CI and are untested.

## Commands (arch §3.4)

```bash
npm install                      # from the repo root (npm workspaces: app, desktop)
npm run dev:web                  # the browser demo (memory platform, fictional classes) at http://localhost:1420
npm run dev                      # desktop app (fetches Syncthing and the Silero VAD first, SHA-256 checked)
npm run dev:lite                 # desktop app without whisper.cpp (cloud transcription and the loudness cut only)
npm run build:desktop            # AppImage + deb in target/release/bundle/ (Linux)
npm run typecheck                # tsc --noEmit (fails on a missing translation key too)
npm test                         # Vitest under Node (app/src/**/*.test.ts); VITEST_MAX_WORKERS=2 when agents share the machine
npm run test:property            # property tests, 2000 runs (200 in npm test)
npm run build                    # the web build of app/ (the desktop crate embeds app/dist)
npm run check:rust               # cargo check --workspace --all-targets (builds whisper.cpp and libopus once)
npm run check:rust:lite          # the same without default features (no whisper.cpp)
npm run test:rust                # tramado-base, tramado-net, tramado-sync unit tests
npm run test:rust:speech         # tramado-speech (heavy)
npm run test:rust:all            # every crate
npm run lint:rust                # cargo fmt --check + clippy -D warnings, whole workspace
npm run lint:rust:lite           # the same for the light crates
npm run test:contract            # real Syncthing contract and two-instance tests (Linux)
npm run e2e:desktop              # desktop e2e through tauri-driver under Xvfb (tools/desktop-e2e; also e2e:sync, e2e:sync-three, e2e:media, e2e:model, e2e:hidden)
npm run fetch:syncthing          # the pinned Syncthing binary (v2.1.7), checked by SHA-256 (--gpg also checks the signature)
npm run fetch:speech             # the Silero VAD; --model=small|turbo|large-v3 [--dest=.tramado-dev/models] for tests
npm run gen:privacy              # PRIVACY.md (+ .pt, .es) from app/src/core/privacy/flows.ts; check:privacy in CI
npm run check:leaks              # secrets and account ids must never be committed (run before every push)
npm run check:versions           # no locked crate or npm package younger than 14 days (D59; run at release)
cargo deny check                 # licences, bans, sources, advisories (deny.toml)
node .github/scripts/check-links.mjs   # every relative link and picture of the README, manual and release notes
npm run peek -- --route=<r> --query='…' --ready=<testid> --axe [--lang=pt] [--theme=dark] [--scale=1.25] \
     [--click=<id>] [--press=<key>] [--type=<id>=<text>] [--expect=<id>[:n]] [--expect-not=<id>] \
     [--expect-text=<id>=<s>] [--expect-attr=<id>:<attr>=<v|null>] --out=<png>
node tools/peek-matrix.mjs [--only=m0] [--name=<entry>,…] [--axe] [--jobs=N] [--lang=pt|es]   # every entry of tools/peek-routes/*.json
npm run screenshots              # the manual's pictures, en/pt/es (see "Manual screenshots")
node tools/desktop-smoke.mjs [--flow=g1] [--media-selftest]             # the real debug app under Xvfb
```

Heavy Rust builds: `CARGO_BUILD_JOBS=3 CMAKE_BUILD_PARALLEL_LEVEL=3`; run cargo **from the repository root** (Cargo
reads `.cargo/config.toml` from the working directory: `GGML_NATIVE=OFF` + AVX/AVX2/FMA/F16C, macOS 14.2). Linux build
packages: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev patchelf
libasound2-dev libpulse-dev libclang-dev cmake`. Node ≥ 22.12, Rust stable ≥ 1.90 (`rust-toolchain.toml`).

Opt-in live AI checks (free models only, never in CI):
`TRAMADO_AI_LIVE=1 OPENROUTER_API_KEY=… npx vitest run --root app src/core/ai/live.test.ts` and
`OPENROUTER_API_KEY=… cargo test -p tramado-net --test live -- --ignored`. Read a local key only at run time, e.g.
`OPENROUTER_API_KEY="$(tr -d '[:space:]' < ~/.openrouter.key)"`; never print it.

### Environment variables

| Variable | Effect |
|---|---|
| `TRAMADO_DATA_DIR=<dir>` | isolated config/data/cache/classes under `<dir>` (development, e2e); also disables single-instance, forces the secrets file and keeps Syncthing on loopback |
| `TRAMADO_E2E=1` | e2e hooks (`window.__tramadoE2E`, dialog queue `TRAMADO_E2E_DIALOGS`, `TRAMADO_E2E_EVAL`, `TRAMADO_E2E_MEDIA_SELFTEST`); honoured only with `TRAMADO_DATA_DIR` |
| `TRAMADO_SYNCTHING_BIN` | the Syncthing binary to run (else the sidecar next to the executable) |
| `TRAMADO_SPEECH_DIR` | the folder with model files for the opt-in `tramado-speech` tests (`crates/tramado-speech/tests/*.rs`); the app ignores it |
| `TRAMADO_SYNCTHING_FROM`, `TRAMADO_SPEECH_FROM` | the fetch scripts copy from a local folder instead of downloading |
| `TRAMADO_AI_LIVE=1` | runs the live AI tests (with `OPENROUTER_API_KEY`) |
| `TRAMADO_PROPERTY_RUNS` | property-test runs (`test:property` sets 2000) |
| `TRAMADO_RELEASE=1` | `catalogs.test.ts` fails while any translation namespace is still `pending` |

Browser demo URL parameters (UX §7.2, `app/src/demo/boot.ts`): `route`, `class`, `tab`, `lecture`, `doc`, `exam`,
`mode`, `section`, `lang=en|pt|es`, `theme`, `clock`, `demo=empty`, `ai=fake|off|busy|quota|badkey|real`,
`speech=fake`, `sync=fake|offline|error|local`, `model=ready|missing|downloading`, `recording=1`, `join=ask`,
`missing=1`, `dialog=<id>`, `code=demo`, and a few more (`DemoFlags`).

## Layout

```
app/src/core/       pure TS, no DOM: model (spec types, ids, HLC, signatures), sync semantics, transcript format,
                    speech helpers, import, search, text, notes, ai (request builder, SSE, classifier, chains,
                    prompts, citations), exam pipeline, privacy flows, i18n catalogs (locales/{en,pt,es}/<ns>.ts)
app/src/platform/   the device boundary: types/ (the Platform interface), tauri/ (bindings), memory/ (demo, Vitest,
                    fakes, the memory mesh of several devices)
app/src/services/   stateful, no DOM: library, class, sync, chat, presence, trust, claims, lectures, recording,
                    transcription, models, documents, extraction, search, notes, annotations, ai, exams, ask,
                    notifications; mesh/ (multi-device tests)
app/src/workers/    search, extraction and image Web Workers
app/src/ui/         design system (tokens, kit) and Tramado components (ui/tramado/)
app/src/shell/      app state, router, layout, rail, pills, dock, palette, savers, undo
app/src/features/   one folder per screen family, mounted through features/registry.tsx
app/src/demo/       the browser demo: boot, seed, fictional example content
app/scripts/        gen-privacy.ts
desktop/src-tauri/  the Tauri shell (tramado-desktop): commands/{app,classes,dialogs,ai,system,sync,speech}.rs,
                    media scheme, tray, window, deep links
crates/             tramado-base (paths, registry, confined class FS, picks, watcher, media, ids, log),
                    tramado-net (HTTP, AI pipe, hosts, secrets, person key, AI activity log),
                    tramado-sync (everything Syncthing), tramado-speech (capture, Opus/WebM, decode, VAD,
                    whisper.cpp, cloud STT, models)
test-vectors/       JSON vectors read by both Vitest and cargo test
tools/              fetch scripts, peek, screenshots, desktop smoke and e2e, leak and version checks, lab sources
site/join/          the static join page (GitHub Pages, .github/workflows/pages.yml)
docs/               dev/ (architecture, plan, research), spec/ (folder format, sync protocol, check words),
                    design/ (UX), manual/{en,pt,es}/, release-notes/
.github/            workflows ci.yml, canary.yml, pages.yml; scripts/ (canary, link check)
```

## Rules (arch §19)

1. **Ownership.** Every file has one owner per wave (plan: owned paths per work package). Frozen after M0 and
   changed only by the integrator at a gate: `Cargo.toml`, `desktop/src-tauri/src/{lib.rs,state.rs,util.rs,commands/mod.rs}`,
   all `package.json` files, `app/src/platform/types/index.ts`, `app/src/services/{index,store,context,prefs,identity,hlcClock,classStore}.ts`,
   `app/src/services/types/index.ts`, `core/i18n/locales/*/index.ts`, `features/registry.tsx`, `shell/routes.ts`,
   `demo/{boot,hooks,controls,keys,freeze}.ts`, `services/types/viewModels.ts`, `core/errors.ts`,
   `core/model/{derive,jcs,sig}.ts`, `core/sync/checkWords.ts`, `docs/spec/check-words-v1.txt`, `test-vectors/*`,
   `Cargo.lock`.
2. **Additive contract changes only.** Anything else (renames, removals, new commands, new dependencies) goes under
   "Contract changes requested" in your report; the integrator applies it at the gate.
3. **Registries instead of shared edits**: routes, class tabs, settings sections, dock rows, overlays, palette
   providers and rail badges are pre-registered lazy imports in `app/src/features/registry.tsx`.
4. **Strings**: every user-facing string in EN, PT-PT and ES in the same change, in your own namespaces
   (`app/src/core/i18n/locales/<lang>/<namespace>.ts`). PT-PT: "você" register, Disciplina/Aula/Exame,
   apontamentos, ficheiro. ES: "usted" register, Asignatura/Clase/Examen, apuntes, archivo.
5. **Test ids** (`data-testid`) on every element a test, peek step or e2e touches; identity via `data-*` attributes.
6. **Layers** (checked by `app/src/layers.test.ts`): core → core; platform → core; services → core,
   platform/types, services; workers → core; ui → core and React; shell and features → anything but
   `platform/tauri` and `platform/memory` (only `main.tsx` and `demo/` choose a platform). No DOM in core/services.
7. **Rust**: no `unwrap`/`expect` outside tests and `run()`; named threads; disk and network work in `blocking`.
8. **No StrictMode**; fictional fixtures only; no network in tests (live AI tests only with `TRAMADO_AI_LIVE=1`).
9. **Commits**: `<work-package>: <summary>`, a body that explains why, and the trailer
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tags: `m0`, `wave1`, `wave2`, `v0.1.0-rc.1`.

Also: the UI is plain React DOM with CSS beside each component and the tokens of `ui/tokens.css` (light and dark);
icons from `lucide-react`; fonts self-hosted through `@fontsource` (never a font CDN). Test at 1000 × 660 and at a
fractional scale (`--scale=1.25`): WebKitGTK rounds sizes. Component tests are not used (Vitest runs without a DOM);
UI behaviour is asserted with peek steps and the desktop e2e.

## Privacy

Tramado has **no server, no account and no telemetry**. The webview has **no network**: CSP `connect-src` allows IPC,
the `tramado-media` scheme, `blob:` and `data:` only, and no plugin permission is granted to the window (arch §16,
§18.4; inline styles depend on `dangerousDisableAssetCspModification: ["style-src"]`). All HTTP runs in Rust on `ureq`
(`tramado-net`): OpenRouter, AI hosts the person approved in a native dialog (`service-hosts.json`; plain `http` only
for loopback and private addresses), Hugging Face for speech models. The OpenRouter key and Syncthing's API key never
cross IPC outward. Dialogs run in Rust and return opaque pick tokens; every class operation is confined to a
registered class folder.

`app/src/core/privacy/flows.ts` is the single list of what leaves the computer; it generates `PRIVACY.md`,
`PRIVACY.pt.md` and `PRIVACY.es.md` (`npm run gen:privacy`) and Settings › Privacy. Any feature that sends something
off the computer adds a row there in the same change. Logs and diagnostics carry no content and shorten device IDs.

## AI

- `tramado-net`'s AI pipe adds the key, overwrites `provider` for the privacy level (`no-training` →
  `{data_collection: "deny"}`, `zdr` → also `zdr: true`, `standard` → none), strips `user`, and allows only the
  listed paths. Relaxing privacy (a per-request override, `ai_privacy_set`, `ai_busy_policy_set(true)`) needs a native
  confirmation (D-10). Every request is written to the private AI activity log.
- `app/src/core/ai/ai-defaults.json` holds the free chains per privacy level (default
  `google/gemma-4-31b-it:free`, at most 3 models per request), the vision chains, the NVIDIA training opt-in, the
  cloud STT model and the task profiles. Free models are often busy (429): the UI says so, names the model that
  answered, and never relaxes privacy without asking. The daily **AI canary** (`.github/workflows/canary.yml`, secret
  `OPENROUTER_API_KEY`) sends three tiny free requests per level and opens an issue after three failing days; update
  the JSON when a model disappears or stays busy.
- Answers cite their sources (`ai.cite`); citations resolve to a document page, a law article or a lecture moment.
  Private notes are never cited in shared content. Exam answers come only after the person checked the questions.
- A custom OpenAI-compatible endpoint (Ollama, LM Studio, a school server) is the path for students under 18
  (OpenRouter's terms require 18+).

## Speech

- **On-demand models.** Nothing big ships: the installer carries only the Silero VAD (885 KB). Whisper models
  (`small` 190 MB "Draft", `turbo` 574 MB "Recommended", `large-v3` 1.08 GB "Most accurate") download from Hugging Face
  at a pinned commit, SHA-256 checked (`tramado-speech::registry` is the source of truth;
  `tools/fetch-speech-assets.mjs` mirrors it and a unit test compares them), into Tramado's own data folder; a model
  file can also be imported from disk. `TRAMADO_SPEECH_DIR` points tests at local models.
- **whisper.cpp for other people's CPUs**: `GGML_NATIVE=OFF` + AVX2/FMA/F16C (`.cargo/config.toml`); x86-64 without
  them is refused (`SPEECH_UNSUPPORTED_CPU`). Windows release builds need `CMAKE_C_FLAGS_RELEASE` /
  `CMAKE_CXX_FLAGS_RELEASE = /MD /O2 /Ob2 /DNDEBUG` (the cmake crate drops MSVC's optimisation level; `ci.yml` checks
  `CMakeCache.txt`). Do not use whisper-rs 0.16's `set_abort_callback_safe` (Trama gotcha).
- **Recording**: cpal capture (microphone, or what the computer plays), Opus at 24 kbps (16 kbps "Storage saver",
  32 kbps for two channels) into a crash-safe Ogg journal under `data/recordings/`, remuxed to WebM when published to the class
  (`audio.webm`). Crash recovery at start-up; markers and notes as the recording runs; global marker shortcuts
  optional. Imports decode with symphonia (+ libopus) and transcode to WebM Opus.
- **Transcription**: Silero VAD finds speech, whisper.cpp transcribes, times map back word by word; long lectures run
  in windows with resume (`data/transcribe/`). Cloud STT goes through the AI pipe from Rust (`audio/transcriptions`,
  16 kHz WAV pieces ≤ 30 s), so audio never passes through the webview.
- **Exactly one transcriber per lecture** in a shared class: claims in `.tramado/claims/` (sync spec §14), ranked in TS
  (`core/sync/claims.ts`, `services/claims.ts`), heartbeat of a running claim in Rust; volunteering
  (`speech.volunteer`: off / plugged / always) only once a local model is installed. Transcript corrections are edit
  lines folded by the transcript owner (fold claims and hand-over, sync spec §14.8); anchors survive a correction.
- Tests: `platform/memory/speech.ts` fakes the shell (`?speech=fake` in the demo); `cargo test -p tramado-speech`;
  opt-in real runs in `crates/tramado-speech/tests/*.rs` (`#[ignore]`, see their headers).

## Sync

- **Syncthing v2.1.7** runs as the sidecar `tramado-syncthing` (one per installation; loopback REST on a fresh port with
  its own API key and GUI password; sync port 22100–22199; usage reporting off; no introducers). It is fetched and
  SHA-256-checked by `tools/fetch-syncthing.mjs`; missing → `SYNC_UNAVAILABLE` and local classes keep working.
- **Split by concern (D-1).** Rust (`tramado-sync`) runs everything that touches Syncthing and must work without a
  webview: supervisor, REST, event loops, folder create/join/leave, admission (by folder-ID proof), reconciliation of
  the Syncthing config with the roster, discovery injection, self-heal of own files, ban application, the mass-delete
  guard, scan coalescing, device signatures. TypeScript (`core/sync`, `services/{sync,trust,claims,chat,presence}.ts`)
  computes the class-folder semantics (trust of content, device → person binding, organisers, bans, claims, chat,
  presence, invites) and pushes a persisted **class policy** to Rust; Rust only narrows access until this session's
  policy arrived and re-checks every widening itself.
- **Trust**: membership and authority records are signed with the device's Syncthing key and bound to an Ed25519 person
  key (D-15); a machine file is trusted only when its writer matches (`modifiedBy`, bound to the bytes read); own files
  self-heal; deletions need the writer's authorship.
- **Formats**: one writer per machine file under `.tramado/` (folder spec §5–§8); HLC stamps order chat lines, edits
  and metadata; content directories are localised (`Lectures`/`Aulas`/`Clases`…) and found by manifest.
- **Tests**: the memory mesh (`createMemoryMesh()`, several devices with fake clocks) for multi-device flows and
  property tests (claims, chat, roster convergence); `npm run test:contract` for the real binary (contract and
  two-instance tests); the desktop e2e suites `sync-two` and `sync-three`.
- v1.1, not in 0.1: class rotation, pairing a second computer, shared markers and annotations, chat reactions/pins,
  relocating a moved class folder, update checks (arch §1.1).

## Languages

Everything user-facing ships in English, European Portuguese (pt-PT) and European Spanish (es-ES): the UI, the
manual, the privacy page, the release notes. English (`locales/en/<ns>.ts`) is the source; `pt/` and `es/` are typed
`Messages['<ns>']`, so a missing key fails `npm run typecheck`; `catalogs.test.ts` fails when more than 5 % of a
language equals English or a placeholder is lost. Plurals `{ one, other }`. Consent sentences have versioned keys
(`record.dialog.consent.v1`); changing one means adding `.v2`. Strings written into files (directory names,
transcript labels, AI prompts) are not catalog strings.

| EN | PT-PT | ES |
|---|---|---|
| class | disciplina | asignatura |
| class group (the people) | turma | grupo de clase |
| lecture | aula | clase |
| exam / test | exame / teste | examen / prueba |
| exam paper | enunciado | enunciado (examen) |
| organiser | organizador(a) | organizador/a |
| classmate | colega | compañero/a |
| recording / transcript | gravação / transcrição | grabación / transcripción |
| notes (mine / class) | apontamentos (os meus / da turma) | apuntes (míos / compartidos) |
| invite code | código de convite | código de invitación |
| check words | palavras de verificação | palabras de verificación |
| share / shared | partilhar / partilhado | compartir / compartido |
| file / folder | ficheiro / pasta | archivo / carpeta |
| download | transferir | descargar |
| computer | computador | ordenador |
| settings | definições | ajustes |
| source / citation | fonte / citação | fuente / cita |
| Ask (tab) / @AI | Perguntar / @IA | Preguntar / @IA |

Portuguese is European (ecrã, ficheiro, transferir, definições, telemóvel; frequência, época de recurso, valores 0–20);
Spanish is from Spain (ordenador, archivo, ajustes, móvil; convocatoria extraordinaria, puntos 0–10). Address the
reader formally ("você" implied; "usted").

## Manual screenshots

The manual (`docs/manual/{en,pt,es}/`) shows pictures of the browser demo (fictional classes, fixed clock
2026-11-03 15:30 Lisbon). `tools/screenshots/shots.mjs` defines them; `npm run screenshots` takes all of them in the
three languages as PNG into `docs/manual/img/<lang>/` (git-ignored there). The manual commits lossless WebP copies of
the pictures it uses, at most 1440 px wide and 10 MB together:

```bash
npm run screenshots
grep -ohE 'img/(en|pt|es)/[a-z-]+\.webp' docs/manual/*/*.md README.md | sort -u | while read -r p; do
  convert "docs/manual/${p%.webp}.png" -resize '1440x>' -define webp:lossless=true -define webp:method=6 "docs/manual/$p"
done
node .github/scripts/check-links.mjs     # links resolve, every picture is used, size and width limits hold
```

## Releases

Bump the version in `desktop/src-tauri/tauri.conf.json`, `Cargo.toml` (`[workspace.package]`), `app/package.json` and
`desktop/package.json`; write `docs/release-notes/v<version>.md` (English, Portuguese, Spanish in one file; a
pre-release `x.y.z-rc.n` uses `vx.y.z.md`). Before tagging: `npm run check:versions`, `cargo deny check`,
`npm audit --omit=dev`, `npm run check:leaks`, `npm run gen:privacy && git diff --exit-code PRIVACY.md`. Installers for
the three systems come from CI, only when asked: `gh workflow run ci.yml --ref main -f release=build` (artifacts) or
`-f release=publish` (also a draft GitHub release). Never trigger the Windows or macOS builds otherwise.

## Never commit secrets

This repository is public. Never commit an OpenRouter key (or any fragment of one), account ids (`user_id`),
credit or usage figures, e-mail addresses or generation ids. Saved model outputs go through
`node tools/redact-fixtures.mjs` first, and `npm run check:leaks` must pass before every push.
