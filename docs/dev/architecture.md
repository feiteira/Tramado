# Tramado developer architecture

| | |
|---|---|
| Status | Draft 1.1 (2026-11-03, review round 1 applied; §1.1 release scope, §1.2 reconciliation). Normative for the implementation of Tramado 0.1. |
| Normative inputs | [`../spec/class-folder-v1.md`](../spec/class-folder-v1.md) ("folder spec"), [`../spec/sync-protocol-v1.md`](../spec/sync-protocol-v1.md) ("sync spec"). |
| Baseline | Research critique §5 DECISIONS 1–59, §6 layout, §7 identity, §8 error taxonomy (cited as "D#", "critique §n"). Every deviation is listed in §1 with its reason. |
| Companion | The implementation plan (work packages, waves, gates): [`plan.md`](plan.md) (copied into the repository by M0 as its first step, with the research reports in `docs/dev/research/` and the lab sources in `tools/lab/`); ownership rules it relies on are restated in §19. |
| Licence | MPL-2.0. Code derived from Trama keeps Trama's file headers; `NOTICE` credits Trama. |

This document is the contract between the people (and agents) who build Tramado. It fixes the repository
layout, every dependency version, every Tauri command and event, the TypeScript `Platform` interface, the
layers of the TypeScript code, the services' public APIs, how screens learn about changes, the error codes,
the security rules, the tests and the build. When this document and the two specs disagree, **the specs win**
for anything on disk or on the wire; this document wins for code structure.

Words: MUST / SHOULD / MAY as in RFC 2119. "Rust" means the app process; "the webview" means the React
app; "TS" means the TypeScript code in `app/src`.

---

## 0. The shape of Tramado in one page

```
┌───────────────────────────── Tramado app process (Rust, tramado-desktop) ─────────────────────────────┐
│  tauri runtime + plugins (dialog, opener, notification, deep-link, single-instance, autostart,        │
│  global-shortcut, tray)                                                                                │
│                                                                                                        │
│  tramado-base   errors · paths · class registry · confined class FS (atomic writes, appends, mirror)   │
│                 · picks · notify watcher · media Range server · power · app log                         │
│  tramado-net    ureq agents · OpenRouter/custom-host pipe (key injection, privacy enforcement,         │
│                 SSE pass-through) · hosts allow-list · secrets (keychain / 0600 file) · person key ·    │
│                 AI activity log                                                                        │
│  tramado-sync   Syncthing supervisor · REST client · config writer · event loops · admission ·         │
│                 roster reconciliation of the Syncthing config · discovery injection · self-heal ·      │
│                 mass-change guard · scan coalescer · policy store · device signatures                  │
│  tramado-speech capture (cpal) · Opus encode · Ogg journal · WebM remux · decode (symphonia+libopus)  │
│                 · Silero VAD + whisper.cpp · cloud STT · model registry + download · jobs · peaks      │
│                                                                                                        │
│      ▲ typed commands (invoke)        │ global events (class:changed, sync:event, app:*)               │
│      │ raw-body writes                ▼ Channels (AI lines, recorder/transcribe/model/import progress) │
├──────┴──────────────────────────── webview (React 18, TS) ─────────────────────────────────────────────┤
│  platform/   Platform interface · tauri/* bindings · memory/* (demo + Vitest) · fakes · memory mesh    │
│  core/       pure: spec model types · HLC · ids · sanitize · i18n · import · search (PassageIndex) ·   │
│              ai (builder, SSE parser, classifier, retry, throttle, tool loop, prompts, citations) ·    │
│              exam pipeline · transcript format · sync semantics (meta LWW, person binding, signature    │
│              checks, derived IDs, bans, trust judgement, claims ranking, chat fold, invites, policy)   │
│  services/   stateful orchestration over Platform: ClassStore, library, class, sync, chat, presence,   │
│              trust, claims, lectures, recording, transcription, models, documents, extraction,         │
│              search, notes, annotations, ai, exams, ask, notifications                                  │
│  ui/ shell/ features/ demo/ workers/                                                                   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
         │ child process (stdout/stderr → rotated log; key via env)
         ▼
   tramado-syncthing v2.1.7 (one per installation, loopback REST on a fresh port, sync port 22100–22199)
```

The webview has **no network**: CSP `connect-src` allows IPC, the `tramado-media` scheme, `blob:` and `data:` only (D-13). All HTTP
(OpenRouter, custom AI hosts, Hugging Face, Syncthing REST, discovery lookups) runs in Rust on `ureq` with std
threads (D3; critique C5). The OpenRouter key and the Syncthing API key never reach the webview (D4).

---

## 1. Deviations from the baseline

| # | Baseline | Deviation | Reason |
|---|---|---|---|
| D-1 | Sync spec §0.6 and §1: "All of this protocol runs in Rust"; module table lists `sync::roster`, `sync::trust`, `sync::claims`, `sync::chat`, `sync::presence` in Rust. | **Split by concern.** Rust (`tramado-sync`) runs every Syncthing-facing algorithm: supervisor (§2), REST (§3–4), event loops (§5), folder create / join / leave / rotate mechanics (§6, §8, §17, §18.2), **admission** (§9, executed autonomously), **reconciliation of the Syncthing config with the roster** (§10), discovery injection (§11), self-heal of own files (§12.3), ban application (§18.1), mass-delete guard (§22.2), scan coalescing (§3.4) and the heartbeat of a running transcription claim (§14.5 "in Rust"). TypeScript computes the **class-folder semantics**: trust judgement of content (§12.1–12.2), device→person binding, organisers, effective bans, `askBeforeAdmit`, claim ranking and claim rounds (§14), chat (§15), presence (§13), invite and pairing codes (§7, §19). TS pushes the results to Rust as a persisted **class policy** (§5.3, §6.7); Rust executes admission and reconciliation from the last policy even when the webview is reloading, re-checks every widening action itself (sync spec §9.5) and only narrows access until this session's policy arrived (sync spec §9.2 start-up rule). Notifications are raised by TS (`NotificationService`) and shown through Rust (`notify_show`). Device signatures are made by Rust (the key never leaves it); TS verifies them. | One implementation of the folder semantics, shared by the UI, the browser demo and the Vitest memory mesh. Sync spec §24 itself requires `createMemoryMesh()` property tests of claims, chat and roster, which only test real code if that code is TS. Rust keeps everything that must run without a webview. The webview still never sees the API key, the GUI port or raw REST bodies (it gets typed projections). Sync spec 1.1 §0.6 and §1 state this split (Q1 closed). |
| D-2 | Critique §8 taxonomy. | Adds `NOT_IMPLEMENTED` (common). | Scaffold stubs (M0) return it; the release gate fails if any command still can. |
| D-3 | Folder spec §12 private files. | `classes.json` adds per-class `joining: boolean`, `skipAudio: boolean` and `leaving: {since, afterwards} \| null`, and top-level `root` (where new classes are created) and `leftClasses: ClassId[]`; `identity.json` adds `deviceName`, `colour` and `personPub`; `hlc.json` carries `format`/`version` like every other record. §13 is the single list of private files (folder spec §12 points here). | Sync spec §8 needs a persisted "joining" state, §17 a persisted "leaving" state; §21 "Skip audio files" is per class per device. `classes.json` is private (not part of the format). |
| D-4 | Trama opens dialogs from JS (`@tauri-apps/plugin-dialog`) and passes absolute paths to Rust. | Dialogs run in Rust and return **opaque pick tokens**; commands that read or write outside class folders accept tokens, never paths. | An XSS in rendered classmate content could otherwise read any file (`~/.ssh/id_rsa`) and write it into a synced class folder, i.e. exfiltrate it to a classmate. |
| D-5 | D1 "Tauri 2.12", critique V10 lists latest versions. | Exact pins at releases ≥ 14 days old today (D59): `tauri =2.12.4`, `tauri-build =2.7.3`, plugins at their 2026-10-14 releases, `notify =8.2.0`, `@tauri-apps/cli 2.12.3`, `ureq =3.5.0` (D59). `opusic-sys =0.7.6` is the lab-verified version and turns 14 days old on 2026-11-09, before any release. | D59. |
| D-6 | Trama destroys the window on close. | Main window uses `backgroundThrottling: "disabled"`; "close to tray" **hides** the window (the webview keeps running). | D-1 needs the TS engine alive while in the tray (D48). Rust still owns all liveness-critical loops, so throttled timers only coarsen timing (§4.3). |
| D-7 | Critique C37 (Channel + `*_status()` for re-attach). | Generalised: every long job takes a `Channel` and has a `*_attach(..., channel)` command that replaces the job's channel after a webview reload (`speech_recorder_attach`, `speech_transcribe_attach`, `speech_model_attach`, `speech_import_attach`). | One pattern for recorder, transcription, model download and import. |
| D-8 | Critique G9.5 "optionally persist the index". | No index persistence in 0.1: indexes are rebuilt from the per-file text cache when a class opens (≈0.3 s per 3.5 M chars, critique V7). | Less code, no cache invalidation bugs; revisit if a class takes > 1 s (Q4). |
| D-9 | — | New command `speech_peaks` (waveform peaks computed in Rust, cached by SHA-256). | The lecture timeline needs a waveform; decoding Opus in the webview would need WebAudio on a 10 MB file per open. |
| D-11 | — | The UX spec (`docs/design/ux-mvp.md`) is authoritative for routes, feature folders, test ids, i18n namespaces and English strings, UI components and their props, view models and demo fixtures (§11.3–§11.6, §14). One departure: the recording dock **row** lives in `features/record/` (UX §0.2 places `RecordDock` in `shell/`) and the shell only hosts dock rows. (The `notify` namespace and the privacy identifiers `zdr` / `no-training` / `standard` are now in the UX spec itself, §1.2.) | Disjoint ownership. |
| D-10 | Critique C1 "Rust overwrites `provider`". | Kept, plus: a per-request privacy relaxation (`privacyOverride: "standard"`), a lasting relaxation (`ai_privacy_set`) or the lasting busy-only relaxation (`ai_busy_policy_set(true)`, "Use NVIDIA free models when the others are busy") requires a **native** confirmation dialog shown by Rust. With `busyRelax` on, a request that carries `busyFallback: true` and `privacyOverride: "standard"` is relaxed without a dialog. | Otherwise any script in the webview could downgrade privacy (D9 "never relax privacy silently"). |
| D-12 | Critique C1/D5: AI paths `chat/completions`, `embeddings`, `key`, `models`, `models/{id}/endpoints`. | `AiPipe` also allows `audio/transcriptions` and `GET models?output_modalities=transcription`, for **Rust-internal** requests only (`speech::remote`, D25). The TS `AiPath` type and `ai_send` refuse them. | Cloud transcription is the user's chosen cloud option; Rust runs it so the audio never passes through the webview. |
| D-13 | D2: CSP `connect-src` "IPC and `tramado-media` only". | `connect-src` also allows `'self' blob: data:`. | The Blob-URL media fallback (D21) and pdf.js (which fetches the document it was given as a `blob:`/`data:` URL) need them; neither reaches the network. |
| D-14 | D19: Opus 24 kbps mono or 32 kbps stereo. | Adds 16 kbps mono as an opt-in "Storage saver" (UX §3.14.4); folder spec §8.6–§8.7 allow `bitrate: 16000`. | About 7 MB per lecture hour for students with little disk. |
| D-15 | Critique §7: trust-on-first-use binding, vouches, manifest writer pinning; `modifiedBy` as the only authorship proof. | Person keys (Ed25519) bind devices to people; Syncthing device keys sign `class.json`, `meta`, `members`, `bans`, `consent` and `mod`; class, lecture and exam IDs are derived from the creating device; trust verdicts are bound to the bytes read (`blocksHash`); deletions need the writer's `modifiedBy` (folder spec §2.1, §6, §8.3.1; sync spec §12). | Review round 1 showed that any member with a file manager could take over a class, lift bans or disconnect the mesh, and that a modified Syncthing can claim any `modifiedBy`. |
| D-16 | Critique §5 scope (all of D1–D59 in 0.1). | Some flows move to **v1.1** (§1.1). Their formats stay in the specs and readers tolerate them. | Landing 0.1 with quality, and paying for D-15. |
| D-17 | UX spec and specs disagreed on several names and shapes. | One resolution per item, applied in all documents (§1.2). | Two packages must never implement two variants. |

### 1.1 Release scope: what 0.1 does not build (v1.1)

Formats stay in the specs, readers in 0.1 tolerate and (where stated) honour them, and the UI hides the entry points.
These commands, Platform methods and UI pieces are **not** part of the 0.1 contract: M0 does not register them and
`Platform` does not declare them.

| v1.1 item | Spec | Not built in 0.1 |
|---|---|---|
| Class rotation ("Start a fresh class without…") | sync spec §18.2 | `sync_rotate_class`, `sync_accept_rotation`, `core/sync/rotate.ts`, `SyncService.rotate`, `[member-fresh-class]` |
| Pairing a second computer, removing one of your computers | sync spec §19 | `GlobalPolicy` push from TS (Rust keeps `ownDevices = []`), pair dialog, `SyncService.pairing`, `[pair-show]`, `[pair-dialog]`, Settings "Your computers" list beyond this computer |
| Transcript corrections (edit mode, fold, fold claims, speaker relabelling) | folder spec §8.9, §8.10 fold, sync spec §14.8 | `LectureService.edit`, edit mode and `[transcript-edit]`, `[transcript-segment-*]`, "Speakers…" |
| Exam edits by members other than the importer | folder spec §8.13 | non-importers see exam details read-only |
| Shared markers | folder spec §8.11 | `LectureService.markers.share` |
| Chat reactions, pins, hides; the moderation log; organiser audio removal | folder spec §8.16 reactions, §8.18 | `ChatService.react/pin/hide`, `PinsStrip`, `[chat-react]`, `[chat-pin]`, pins in `ClassView.pins` (always `[]`) |
| "Since you were away" digest, AI title suggestion, exam-date chip in chat | UX §3.2, §3.6.4, §3.10 | `[lecture-title-suggestion]`, `ChatMessageView.examDate` (always `null`) |
| Relocating a moved class folder ("Find it…") | sync spec §22.3 | `sync_relocate`, `SyncService.relocate` ("Recently deleted" **stays** in 0.1: deletions by any member must stay recoverable, and its commands exist anyway) |
| Shared annotations | folder spec §8.17 | writing and displaying shared annotation files |
| Update checks | critique G28 | no updater (Q3) |

The OS-global marker shortcuts, the mass-delete guard, soft bans and "Ask before letting people in" **are** in 0.1.
If T-AI slips, "Deep answer" (tool loop) is the next item to move.

### 1.2 UX ↔ spec reconciliation (one answer per item)

| Item | Resolution (binding for every package) |
|---|---|
| Privacy identifiers | `zdr` ("Keep nothing"), `no-training` ("No training (recommended)", the default), `standard` ("Allow free models that may train"), everywhere (UX §3.14.3, §5.14). |
| Speech model ids | Registry ids `turbo`, `small`, `large-v3` in prefs, member `caps`, claims and requests; `transcript.json` `engine.model` is the ggml file stem plus `modelId` (folder spec §2, §8.8). |
| Marker kinds and keys | `MarkerKind = 'important' \| 'confused' \| 'exam' \| 'todo' \| 'note'` (UX §2.12), one export in `core/model/files.ts`, imported by `platform/types/speech.ts` and `viewModels.ts`. Keys `1` important, `2` confused, `3` exam, `4` todo, `N` note; global `Ctrl/⌘+Alt+1…4` in the same order. Highlight colours: the four kinds plus `other`. |
| Exam kinds | `quiz \| test \| midterm \| final \| resit \| special \| oral \| practice \| assignment \| other` (folder spec §8.12); UX `ExamKind` is the first eight. |
| Exam date fields | `allDay`, `coversText`, `weightText`, `extraPoints` (folder spec §8.12). |
| Edit ops | `label_speaker` (transcripts, v1.1), `set_exam` (exams, v1.1). |
| Check words | `ADJ[h[0]]-NOUN[h[1]]`, `h = SHA-256("tramado-check-v1|" + dashed deviceId)`, lists in `docs/spec/check-words-v1.txt` (sync spec §25 Q1). |
| Admission | `decide(policies, global, offer, nowMs) → 'share' \| 'queue' \| 'ban' \| 'skip' \| 'unknown'` (§5.3). |
| Peaks | `speech_peaks` → `number[]`, cached `cache/peaks/<sha256>-<buckets>.json`. |
| Ask history | `private/<classId>/ask/<threadId>.jsonl`. |
| Claim health | `healthy` (< 2 min) / `slow` (2–10 min) / `stale` (≥ 10 min). |
| Lecture share choice | `'audio+transcript' \| 'transcript-only' \| 'none'` (§9 `PublishRequest`). |
| Consent text ids | `record.dialog.consent.v1`, `record.dialog.consentShare.v1` (catalog keys = `textId`). |
| Notifications | One `notify` namespace (UX §5.22), raised by TS, shown through `notify_show`. |
| Volunteering | `speech.volunteer` default `plugged`, effective only once a local model is installed; one-time opt-out notice (sync spec §14.3). |
| Language tags | BCP 47 with the matching rule of folder spec §2 (`es-ES` matches `es`). |

---

## 2. Repository layout

npm workspaces `app` (`@tramado/app`) and `desktop` (`@tramado/desktop`); one Cargo workspace at the repository
root. `app/` is the whole React app (desktop UI and browser demo). `desktop/src-tauri` is the Tauri shell crate;
heavy native dependencies live in separate crates so that light work never compiles whisper.cpp.

```
Tramado/
├── AGENTS.md                      rules for coding agents (CLAUDE.md imports it)
├── CLAUDE.md                      "@AGENTS.md"
├── README.md  LICENSE (MPL-2.0)  NOTICE  PRIVACY.md  SECURITY.md  CONTRIBUTING.md
├── package.json  package-lock.json             npm workspaces ["app", "desktop"]
├── Cargo.toml  Cargo.lock                      Cargo workspace (§3.2)
├── rust-toolchain.toml  .cargo/config.toml     copied verbatim from Trama (§3.1)
├── deny.toml                                    cargo-deny policy (wave 3)
├── .gitignore  .gitattributes  .editorconfig
├── test-vectors/                                JSON vectors read by BOTH Vitest and cargo test (hlc.json: TS only)
│   ├── admission.json  class-paths.json  hlc.json  error-codes.json  ids.json  time.json  check-words.json
├── app/                                         @tramado/app (React + Vite + Vitest)
│   ├── package.json  tsconfig.json  vite.config.ts  index.html
│   ├── public/                                  favicon.svg, brand.svg, demo/lecture.webm (300 s demo audio)
│   ├── scripts/                                 gen-privacy.ts (PRIVACY.md generator)
│   ├── test-fixtures/                           import/ (copied from Trama) + tramado/ (pdf, pptx, webm, exams)
│   └── src/
│       ├── main.tsx  App.tsx  env.d.ts
│       ├── core/          platform-free TS (§11.1)
│       ├── platform/      the device boundary (§9, §10)
│       ├── services/      stateful orchestration (§11.2)
│       ├── ui/            design system (§11.3); Tramado components in ui/tramado/
│       ├── shell/         app state, router, layout, rail, pills, dock frame (§11.4)
│       ├── features/      registry.tsx + one folder per screen family (§11.5)
│       ├── workers/       search and extraction Web Workers (§11.7)
│       └── demo/          browser demo per UX §7: boot, freeze, controls, example/, seed.ts, fakeMedia.ts, assets/ (§11.6)
├── desktop/                                     @tramado/desktop (holds @tauri-apps/cli)
│   ├── package.json
│   └── src-tauri/                               crate tramado-desktop (lib tramado_desktop_lib)
│       ├── Cargo.toml  build.rs  tauri.conf.json  tauri.sidecar.conf.json
│       ├── capabilities/default.json
│       ├── icons/                               generated by `tauri icon` from icons/source.svg
│       ├── binaries/                            tramado-syncthing-<triple>[.exe]   (gitignored, fetched)
│       ├── resources/
│       │   ├── speech/ggml-silero-v5.1.2.bin    (gitignored, fetched, SHA-256 pinned)
│       │   ├── syncthing/LICENSE.txt AUTHORS    (gitignored, fetched with the binary)
│       │   └── media/selftest.webm              (committed, generated once by tramado-speech example)
│       ├── macos/  Info.plist  Entitlements.plist  {en,pt,es}.lproj/InfoPlist.strings
│       └── src/  main.rs lib.rs state.rs util.rs media.rs tray.rs window.rs deeplink.rs
│                 commands/{mod,app,classes,dialogs,ai,system,sync,speech}.rs
├── crates/
│   ├── tramado-base/      light: errors, paths, registry, class FS, picks, watch, media, power, ids, log
│   ├── tramado-net/       light: HTTP agents, AI pipe, hosts, secrets, activity log, test mock server
│   ├── tramado-sync/      light: everything Syncthing (§5.3)
│   └── tramado-speech/    HEAVY: cpal, libopus (cmake), whisper.cpp (cmake), symphonia
├── tools/
│   ├── fetch-syncthing.mjs  fetch-speech-assets.mjs  test-contract.mjs  check-versions.mjs
│   ├── peek.mjs                                 one-shot demo screenshot + axe + overflow (from the lab)
│   ├── peek-matrix.mjs  peek-routes/<wp>.json   every registered screen state, one JSON file per work package
│   ├── desktop-smoke.mjs                        launch the debug app under Xvfb and screenshot it (wave 1)
│   ├── screenshots/  capture.mjs shots.mjs fixtures/
│   ├── fixtures/build-demo-assets.mjs           demo PDFs/PPTX/DOCX/PNG from demo/example/content (UX §7.1)
│   ├── desktop-e2e/  run.mjs  lib/*.mjs  suites/{smoke,sync-two,sync-three,media}.mjs  README.md   (wave 3)
│   ├── redact-fixtures.mjs  check-leaks.mjs     fixture redaction; secret/user_id leak check before every push
│   ├── lab/                                     research lab sources copied by M0 (no outputs with user ids)
│   └── keys/syncthing-release.asc               Syncthing release signing key (GPG check, optional)
├── site/join/index.html                         static join page (GitHub Pages; UX §8 OQ1)
├── docs/
│   ├── spec/   class-folder-v1.md  sync-protocol-v1.md  check-words-v1.txt (M0)
│   ├── design/ ux-mvp.md
│   ├── dev/    architecture.md (this file)  plan.md  research/*.md   (copied by M0)
│   ├── manual/ {en,pt,es}/                      (wave 3)
│   └── release-notes/
└── .github/workflows/  ci.yml  canary.yml  pages.yml   (wave 3)
```

`.gitignore` keeps every entry of the existing file (secrets, `node_modules/`, `dist/`, `target/`,
`desktop/src-tauri/gen/`, `desktop/src-tauri/binaries/`, `desktop/src-tauri/resources/speech/`, `tools/.cache/`, …)
and adds: `desktop/src-tauri/resources/syncthing/`, `.tramado-dev/` (local dev data dirs and test models),
`*.tmp`, `*.part`, `peek-*.png`. Downloads of the fetch scripts are cached in `tools/.cache/`.

---

## 3. Toolchains, versions and manifests

### 3.1 Toolchain files (verbatim from Trama)

`rust-toolchain.toml`:
```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
```

`.cargo/config.toml` (whisper-rs-sys forwards every `GGML_*`/`WHISPER_*`/`CMAKE_*` variable to CMake; Cargo finds
this file from the **current working directory**, so every script runs cargo from the repository root):
```toml
[env]
MACOSX_DEPLOYMENT_TARGET = "14.2"
GGML_NATIVE = "OFF"
GGML_AVX = "ON"
GGML_AVX2 = "ON"
GGML_FMA = "ON"
GGML_F16C = "ON"
```

Node ≥ 22.12 (`engines`). Rust stable ≥ 1.90 (MSRV of tauri 2.12; this machine has 1.92 stable, while its
*default* toolchain is nightly, which is why `rust-toolchain.toml` is mandatory).

Linux build packages: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev patchelf libasound2-dev
libpulse-dev libclang-dev cmake` (cpal/ALSA+Pulse, bindgen, whisper.cpp and libopus).

### 3.2 Root `Cargo.toml` (workspace)

Exact pins (`=`) for anything with a native build, a security role or a fast release cadence; caret floors for
ubiquitous crates (the lockfile pins them; `npm run check:versions` refuses a release when any locked version is
younger than 14 days, D59).

```toml
[workspace]
resolver = "2"
members = [
  "crates/tramado-base",
  "crates/tramado-net",
  "crates/tramado-sync",
  "crates/tramado-speech",
  "desktop/src-tauri",
]
# `cargo test` / `cargo check` without -p or --workspace touch only the light crates.
default-members = ["crates/tramado-base", "crates/tramado-net", "crates/tramado-sync"]

[workspace.package]
version = "0.1.0"
edition = "2021"
rust-version = "1.90"
license = "MPL-2.0"
repository = "https://github.com/feiteira/Tramado"
authors = ["Tramado contributors"]

[workspace.dependencies]
tramado-base   = { path = "crates/tramado-base" }
tramado-net    = { path = "crates/tramado-net" }
tramado-sync   = { path = "crates/tramado-sync" }
tramado-speech = { path = "crates/tramado-speech", default-features = false }

serde            = { version = "1.0.228", features = ["derive"] }
serde_json       = "1.0.149"
thiserror        = "2.0.18"
log              = "0.4.30"
base64           = "0.22.1"
percent-encoding = "2.3.2"
walkdir          = "2.5.0"
http-range       = "0.1.5"
tempfile         = "3.27.0"

sha2             = "=0.11.1"
getrandom        = "=0.4.3"
libc             = "=0.2.191"
bcrypt           = "=0.19.3"
fs4              = "=1.1.0"
trash            = "=5.2.9"
keyring          = "=4.2.0"
notify           = "=8.2.0"
notify-debouncer-full = "=0.7.0"
ureq             = { version = "=3.5.0", features = ["json"] }
ed25519-dalek    = { version = "=3.0.0", features = ["pkcs8", "pem"] }   # device signatures (key.pem) and the person key

tauri                         = { version = "=2.12.4", features = ["tray-icon"] }
tauri-build                   = { version = "=2.7.3", features = [] }
tauri-plugin-dialog           = "=2.8.3"
tauri-plugin-opener           = "=2.7.2"
tauri-plugin-notification     = "=2.7.0"
tauri-plugin-deep-link        = "=2.6.2"
tauri-plugin-single-instance  = { version = "=2.5.4", features = ["deep-link"] }
tauri-plugin-autostart        = "=2.7.0"
tauri-plugin-global-shortcut  = "=2.4.1"

whisper-rs       = "=0.16.0"
cpal             = "=0.18.2"
symphonia        = { version = "=0.6.1", default-features = false, features = ["all-codecs", "all-formats", "opt-simd"] }
opusic-c         = "=1.6.1"
opusic-sys       = "=0.7.6"
ogg              = "=0.9.2"
gio              = "=0.18.4"
objc2            = "0.6.4"
objc2-foundation = { version = "0.3.2", default-features = false, features = ["std", "NSProcessInfo", "NSString"] }
windows-sys      = "=0.61.2"

[profile.dev]
debug = "line-tables-only"          # smaller target/ and less link RAM with several worktrees (8 CPUs, 11 GB)
[profile.dev.package."*"]
debug = false

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```

`Cargo.lock` is generated by M0 with every feature and optional dependency of §3.3 enabled (`cargo check --workspace
--all-targets` and `--no-default-features`) and is **integrator-owned**: a work-package branch that changes it is
rejected unless it lists a contract change.

`panic = "abort"` means exit hooks do not run on a panic: the Syncthing child must die by OS mechanism
(PDEATHSIG / Job Object, sync spec §2.4) and every thread body MUST catch errors instead of unwrapping.

### 3.3 Crate manifests

`crates/tramado-base/Cargo.toml`
```toml
[package]
name = "tramado-base"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
log.workspace = true
sha2.workspace = true
getrandom.workspace = true
walkdir.workspace = true
percent-encoding.workspace = true
http-range.workspace = true
notify.workspace = true
notify-debouncer-full.workspace = true

[target.'cfg(unix)'.dependencies]
libc.workspace = true

[target.'cfg(windows)'.dependencies]
windows-sys = { workspace = true, features = ["Win32_Foundation", "Win32_System_Power"] }

[dev-dependencies]
tempfile.workspace = true
```

`crates/tramado-net/Cargo.toml`
```toml
[package]
name = "tramado-net"
# (workspace package keys as above)

[features]
testutil = []          # exposes tramado_net::testutil::MockServer to other crates' tests

[dependencies]
tramado-base.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
log.workspace = true
ureq.workspace = true
keyring.workspace = true          # default features "v1": macOS keychain, Windows, zbus Secret Service
getrandom.workspace = true
base64.workspace = true
sha2.workspace = true
ed25519-dalek.workspace = true    # person key (person.rs)

[dev-dependencies]
tempfile.workspace = true
```

`crates/tramado-sync/Cargo.toml`
```toml
[package]
name = "tramado-sync"

[dependencies]
tramado-base.workspace = true
tramado-net.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
log.workspace = true
ureq.workspace = true
bcrypt.workspace = true
getrandom.workspace = true
sha2.workspace = true
percent-encoding.workspace = true
base64.workspace = true
ed25519-dalek.workspace = true    # sign.rs: signatures with the Syncthing key.pem (sync spec §12.4)

[target.'cfg(target_os = "linux")'.dependencies]
libc.workspace = true
[target.'cfg(target_os = "macos")'.dependencies]
libc.workspace = true
[target.'cfg(windows)'.dependencies]
windows-sys = { workspace = true, features = ["Win32_Foundation", "Win32_System_JobObjects", "Win32_System_Threading", "Win32_Security"] }

[dev-dependencies]
tempfile.workspace = true
tramado-net = { workspace = true, features = ["testutil"] }
```

`crates/tramado-speech/Cargo.toml`
```toml
[package]
name = "tramado-speech"

[features]
default = ["local-whisper"]
local-whisper = ["dep:whisper-rs"]   # whisper.cpp + Silero VAD; off = cloud STT + loudness cut only

[dependencies]
tramado-base.workspace = true
tramado-net.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
log.workspace = true
ureq.workspace = true
sha2.workspace = true
base64.workspace = true
fs4.workspace = true
symphonia.workspace = true
opusic-c.workspace = true
opusic-sys.workspace = true
ogg.workspace = true
cpal.workspace = true
whisper-rs = { workspace = true, optional = true }

[target.'cfg(target_os = "linux")'.dependencies]
cpal = { workspace = true, features = ["pulseaudio"] }
gio.workspace = true                         # logind inhibitor (awake.rs); same gtk-rs generation as Tauri
[target.'cfg(target_os = "macos")'.dependencies]
objc2.workspace = true
objc2-foundation.workspace = true
[target.'cfg(windows)'.dependencies]
windows-sys = { workspace = true, features = ["Win32_Foundation", "Win32_System_Power", "Win32_System_Threading"] }

[dev-dependencies]
tempfile.workspace = true
tramado-net = { workspace = true, features = ["testutil"] }
```

`desktop/src-tauri/Cargo.toml`
```toml
[package]
name = "tramado-desktop"
description = "Tramado — organise your classes (desktop shell)"
# (workspace package keys)

[lib]
name = "tramado_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[features]
default = ["local-whisper"]
local-whisper = ["tramado-speech/local-whisper"]   # `--no-default-features` = no whisper.cpp build

[build-dependencies]
tauri-build.workspace = true

[dependencies]
tramado-base.workspace = true
tramado-net.workspace = true
tramado-sync.workspace = true
tramado-speech.workspace = true
tauri.workspace = true
tauri-plugin-dialog.workspace = true
tauri-plugin-opener.workspace = true
tauri-plugin-notification.workspace = true
tauri-plugin-deep-link.workspace = true
tauri-plugin-autostart.workspace = true
tauri-plugin-global-shortcut.workspace = true
serde.workspace = true
serde_json.workspace = true
log.workspace = true
percent-encoding.workspace = true
trash.workspace = true

[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-single-instance.workspace = true
```

### 3.4 npm manifests (exact versions)

Root `package.json`:
```json
{
  "name": "tramado",
  "private": true,
  "description": "Tramado — organise your classes: lectures, documents, exams and class groups, serverless.",
  "license": "MPL-2.0",
  "workspaces": ["app", "desktop"],
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "node tools/fetch-syncthing.mjs && node tools/fetch-speech-assets.mjs && npm run dev --workspace desktop",
    "dev:lite": "node tools/fetch-syncthing.mjs && node tools/fetch-speech-assets.mjs && npm run dev:lite --workspace desktop",
    "dev:web": "npm run dev --workspace app",
    "build": "npm run build --workspace app",
    "build:desktop": "node tools/fetch-syncthing.mjs && node tools/fetch-speech-assets.mjs && npm run build:linux --workspace desktop",
    "typecheck": "npm run typecheck --workspace app",
    "test": "npm run test --workspace app",
    "test:property": "npm run test:property --workspace app",
    "check:rust": "cargo check --workspace --all-targets",
    "check:rust:lite": "cargo check --workspace --all-targets --no-default-features",
    "test:rust": "cargo test -p tramado-base -p tramado-net -p tramado-sync",
    "test:rust:speech": "cargo test -p tramado-speech",
    "test:rust:all": "cargo test --workspace",
    "lint:rust": "cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings",
    "lint:rust:lite": "cargo fmt --all --check && cargo clippy -p tramado-base -p tramado-net -p tramado-sync --all-targets -- -D warnings",
    "test:contract": "node tools/test-contract.mjs",
    "fetch:syncthing": "node tools/fetch-syncthing.mjs",
    "fetch:speech": "node tools/fetch-speech-assets.mjs",
    "peek": "node tools/peek.mjs --app=app",
    "screenshots": "npm run screenshots --workspace app",
    "gen:privacy": "npm run gen:privacy --workspace app",
    "check:versions": "node tools/check-versions.mjs",
    "check:leaks": "node tools/check-leaks.mjs",
    "e2e:desktop": "node tools/desktop-e2e/run.mjs --suite=smoke",
    "e2e:sync": "node tools/desktop-e2e/run.mjs --suite=sync-two",
    "e2e:media": "node tools/desktop-e2e/run.mjs --suite=media"
  }
}
```

`app/package.json`:
```json
{
  "name": "@tramado/app",
  "private": true,
  "version": "0.1.0",
  "license": "MPL-2.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:property": "node scripts/env-run.mjs TRAMADO_PROPERTY_RUNS=2000 -- vitest run property",
    "gen:privacy": "vite-node scripts/gen-privacy.ts",
    "check:privacy": "vite-node scripts/gen-privacy.ts -- --check",
    "screenshots": "node ../tools/screenshots/capture.mjs"
  },
  "dependencies": {
    "@fontsource-variable/atkinson-hyperlegible-next": "5.3.0",
    "@fontsource-variable/bricolage-grotesque": "5.3.0",
    "@fontsource-variable/figtree": "5.3.0",
    "@fontsource-variable/source-serif-4": "5.3.1",
    "@fontsource/opendyslexic": "5.3.0",
    "@tauri-apps/api": "2.12.4",
    "@xmldom/xmldom": "0.9.12",
    "fflate": "0.8.3",
    "lucide-react": "1.60.0",
    "luxon": "3.7.2",
    "mammoth": "1.13.0",
    "pdfjs-dist": "6.3.289",
    "qrcode": "1.5.4",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/luxon": "3.7.5",
    "@types/node": "26.6.3",
    "@types/qrcode": "1.5.6",
    "@types/react": "18.3.28",
    "@types/react-dom": "18.3.7",
    "@vitejs/plugin-react": "6.1.1",
    "axe-core": "4.14.0",
    "fast-check": "4.10.2",
    "jszip": "3.10.1",
    "pdf-lib": "1.17.1",
    "playwright-core": "1.62.1",
    "typescript": "5.9.3",
    "vite": "8.3.1",
    "vite-node": "6.0.0",
    "vitest": "5.0.2"
  }
}
```
`test:property` needs no extra package: `app/scripts/env-run.mjs` (≈10 lines) sets the `NAME=value` arguments
before `--` in the environment and spawns the rest with `shell: false`; `vitest run property` runs the files whose
path contains `property` (convention: `*.property.test.ts`). Property tests read the run count from
`Number(process.env.TRAMADO_PROPERTY_RUNS ?? 200)`, so plain `npm test` runs them briefly.

Notes on pins: `lucide-react 1.60.0` (published 2026-10-20) is the version every icon name of UX §1.3/§1.5 was
verified against (`ui/classIcons.test.ts` asserts each name is exported; 1.67.0 is too new for D59);
`@fontsource/opendyslexic` backs UX's third font option; `playwright-core 1.62.1` matches the Chromium revision cached on this machine
(`~/.cache/ms-playwright/chromium-1234`); `@xmldom/xmldom` MUST stay `0.9.12` in the app workspace (mammoth pulls
0.8.x at the root); TypeScript stays 5.9.3 (7.x is a separate migration); there is **no**
`@tauri-apps/plugin-dialog` / `-http` / `-opener` / `-shell` / `-fs` in the app (D-4, D2).

`desktop/package.json`:
```json
{
  "name": "@tramado/desktop",
  "private": true,
  "version": "0.1.0",
  "license": "MPL-2.0",
  "scripts": {
    "tauri": "tauri",
    "dev": "tauri dev --config src-tauri/tauri.sidecar.conf.json",
    "dev:lite": "tauri dev --config src-tauri/tauri.sidecar.conf.json -- --no-default-features",
    "build": "tauri build --config src-tauri/tauri.sidecar.conf.json",
    "build:linux": "tauri build --config src-tauri/tauri.sidecar.conf.json --bundles appimage,deb",
    "build:debug": "tauri build --debug --config src-tauri/tauri.sidecar.conf.json"
  },
  "devDependencies": { "@tauri-apps/cli": "2.12.3" }
}
```

---

## 4. Runtime architecture

### 4.1 Processes

| Process | Started by | Network |
|---|---|---|
| `tramado` (Rust) | the user / autostart (`--hidden`) / a deep link | OpenRouter + user-confirmed AI hosts, `huggingface.co` + `*.hf.co` (model download), `discovery-lookup.syncthing.net` (sync spec §11.1). Nothing else. |
| WebKitGTK / WKWebView / WebView2 processes | Tauri | **None** (CSP; the desktop e2e audits sockets, critique C38). |
| `tramado-syncthing` | `tramado-sync` supervisor, lazily (sync spec §2.9) | Its own: listeners on P (22100–22199), discovery, relays, LAN broadcast. Loopback REST on a fresh port. |

### 4.2 Rust threads (all named; none of them may panic)

| Thread name | Owner | Life |
|---|---|---|
| `tramado-syncthing` | sync supervisor | Spawns **and waits on** the child (PDEATHSIG follows the forking thread). Lives while sharing is on. |
| `tramado-sync-events-a`, `tramado-sync-events-b` | sync events | Long-poll loops A and B (sync spec §5). |
| `tramado-sync-config` | sync config writer | Serialises every config mutation (sync spec §3.3). |
| `tramado-sync-ticker` | sync | 1 s tick: admission sweep (5 s), discovery (10 s), reconciliation (60 s), scan coalescer flush, mass-delete window. |
| `tramado-watch` | base watch | notify-debouncer-full (300 ms) for every registered class root → `class:changed`. |
| `tramado-ai-<n>` | net AI pipe | One per in-flight request (≤ 6). |
| `tramado-model-dl` | speech models | One download at a time. |
| `tramado-rec-capture`, `tramado-rec-mix`, `tramado-rec-write` | speech recorder | cpal streams (stay on their thread), mixer, Opus/Ogg writer. |
| `tramado-transcribe` | speech jobs | One transcription job at a time (+4 `tramado-stt-<n>` workers for cloud pieces). |
| `tramado-claim-heartbeat` | speech jobs | Rewrites the running job's claim every 60 s (D-1). |

Blocking work started by a command runs in `tauri::async_runtime::spawn_blocking` through `util::blocking`
(Trama's helper); long-lived loops use the named threads above, never the blocking pool.

### 4.3 What keeps running when the window is hidden

Closing the window while at least one class is shared and `app.trayOnClose = "1"` **hides** the window (D-6): the
webview, its services and Rust keep running. Liveness-critical work never depends on webview timers:

| Concern | Runs in | Webview needed? |
|---|---|---|
| Syncthing, events, admission, reconciliation, discovery, self-heal | Rust | No (uses the last persisted policy) |
| Heartbeat of my running transcription claim | Rust (`tramado-claim-heartbeat`) | No |
| Presence heartbeat, volunteer delays, claim rounds, chat receive, notifications, policy updates | TS services | Yes (timers may be throttled to ≥ 1/min by the OS; correctness unaffected, timing coarser) |

`backgroundThrottling: "disabled"` is honoured by macOS 14+ (Tauri docs); on Windows/Linux hidden pages may
throttle timers, which only delays volunteering and presence. Q6 tracks verification in wave 3.

### 4.4 Start-up sequence

1. Rust `setup`: resolve `Paths` (§5.1), open the app log, load `classes.json`, construct
   `Shared {paths, registry, picks, fs}` (M0, `state.rs`), then call each domain's `init(app, &shared)` in this
   order: `commands::app`, `commands::classes`, `commands::dialogs`, `commands::ai`, `commands::system`,
   `commands::sync`, `commands::speech`. Each `init` returns its state, managed with `app.manage`.
2. If `config.xml` exists, `commands::sync::init` calls `identity()` (no daemon, no port probe) and
   `ClassFs::set_device`. If at least one registered class has `shared: true` (and none is only `leaving`), it then
   starts Syncthing in the background (sync spec §2.9); otherwise nothing networked starts.
3. The main window is created hidden (`visible: false`) and shown by `window.rs` unless argv contains `--hidden`.
4. Webview: `main.tsx` → `createTauriPlatform()` → `AppStateProvider` reads prefs and identity → phase
   `welcome` (no identity; onboarding calls `person_init` and `sync_identity`) or `ready` → `createServices(ctx)` →
   `SyncService.boot()` (snapshot, trust pass, policy push for every shared class; until a class's first push Rust
   only narrows access for it, sync spec §9.2) → screens.

---

## 5. Rust crates

Every public IPC type is a serde struct with `#[serde(rename_all = "camelCase")]` and its TS twin in
`app/src/platform/types/*.ts` (§9). Enums with data use `#[serde(tag = "type", rename_all = "camelCase")]`
(variant names in camelCase on the wire), with these explicit exceptions, whose TS twins match exactly:

| Rust type | Attribute | Wire values |
|---|---|---|
| `PrivacyLevel` | `#[serde(rename_all = "kebab-case")]` | `"standard"`, `"no-training"`, `"zdr"` |
| `Method` | `#[serde(rename_all = "UPPERCASE")]` | `"GET"`, `"POST"` |
| `AiBase` | default tag rule | `{"type":"openrouter"}`, `{"type":"host","hostId":"…"}` |
| `AudioSource`, `TranscribeEngine` | `#[serde(tag = "kind", rename_all = "camelCase")]` | `{"kind":"class",…}` / `{"kind":"private",…}`; `{"kind":"local","model":"turbo"}` / `{"kind":"cloud","model":"…"}` |
| `ShareMode` | `#[serde(rename_all = "kebab-case")]` plus `rename = "audio+transcript"` | `"audio+transcript"`, `"transcript-only"`, `"none"` |
| `Code` (errors) | `SCREAMING_SNAKE_CASE` | §15 |

`platform/tauri/tauri.test.ts` and a Rust serde round-trip test per crate (`types_roundtrip.rs`, reading
`test-vectors/ipc-samples.json`, written by M0) cover every tagged type. Optional fields are `Option<T>` with
`#[serde(skip_serializing_if = "Option::is_none")]` on output and `#[serde(default)]` on input.

### 5.1 `tramado-base` (light; M0 implements, R-SHELL extends)

```rust
pub mod error;    // AppError, Code, AppResult (§15)
pub mod ids;      // validators and generators
pub mod paths;    // Paths
pub mod registry; // ClassRegistry (classes.json)
pub mod confine;  // class path rules + symlink refusal
pub mod files;    // atomic write, append, ranges, listing (Trama files.rs, adapted)
pub mod classfs;  // ClassFs: confined ops + mirror + WriteObserver hook
pub mod picks;    // PickRegistry (opaque tokens for dialog results)
pub mod appfiles; // allow-listed app files, private/<classId>/, cache keys
pub mod watch;    // ClassWatcher (notify-debouncer-full)         — R-SHELL
pub mod media;    // Range parsing + response building             — R-SHELL
pub mod power;    // system_power()                                — R-SHELL
pub mod applog;   // app.log with rotation (2 × 5 MiB)             — R-SHELL
pub mod time;     // now_ms, instant(ms), parse_rfc3339              — M0 (test-vectors/time.json, shared with TS)
pub fn blocking_hint(); // (no async runtime here; desktop wraps calls in spawn_blocking)
```

`time` (M0, with unit tests; the workspace has no time crate):
```rust
pub fn now_ms() -> u64;                         // SystemTime since UNIX_EPOCH
pub fn instant(ms: u64) -> String;              // "YYYY-MM-DDTHH:MM:SS.mmmZ" (civil-from-days algorithm)
pub fn parse_rfc3339(s: &str) -> Option<i64>;   // ms since epoch; fractional seconds up to 9 digits; "Z" or ±hh:mm
                                                // (Syncthing's lastSeen / versionTime / modified carry ns and offsets)
```

`ids`:
```rust
pub fn is_class_id(s: &str) -> bool;        // ^tramado-[a-z2-7]{26}$
pub fn is_device_id(s: &str) -> bool;       // ^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$
pub fn short_id(device: &str) -> &str;      // first 7 chars
pub fn is_ulid(s: &str) -> bool;            // ^[0-7][0-9A-HJKMNP-TV-Z]{25}$
pub fn new_ulid(now_ms: u64) -> String;     // 48-bit time + 80 random bits (getrandom), Crockford upper case
pub fn random_token_hex(bytes: usize) -> String;
pub fn random_alnum(len: usize) -> String;  // [A-Za-z0-9] (Syncthing API key, GUI password)
```

`paths::Paths`:
```rust
pub struct Paths {
    pub config: PathBuf,        // app_config_dir   or $TRAMADO_DATA_DIR/config
    pub data: PathBuf,          // app_local_data_dir or $TRAMADO_DATA_DIR/data
    pub cache: PathBuf,         // app_cache_dir    or $TRAMADO_DATA_DIR/cache
    pub resources: Option<PathBuf>,          // tauri resource_dir (None in unit tests)
    pub default_classes_root: PathBuf,       // ~/Tramado   or $TRAMADO_DATA_DIR/classes
    pub dev_isolated: bool,                  // TRAMADO_DATA_DIR set
    pub e2e: bool,                           // TRAMADO_E2E=1 (only honoured when dev_isolated)
}
impl Paths {
    pub fn resolve(config: PathBuf, data: PathBuf, cache: PathBuf, home: PathBuf, resources: Option<PathBuf>) -> Self; // applies env overrides
    pub fn syncthing_home(&self) -> PathBuf;   // data/syncthing
    pub fn models_dir(&self) -> PathBuf;       // $TRAMADO_SPEECH_DIR or data/models
    pub fn recordings_dir(&self) -> PathBuf;   // data/recordings
    pub fn transcribe_dir(&self) -> PathBuf;   // data/transcribe
    pub fn private_dir(&self, class: &str) -> PathBuf;   // data/private/<classId>
    pub fn vad_path(&self) -> Option<PathBuf>; // models_dir, then resources/speech/ggml-silero-v5.1.2.bin
}
```
A relative `TRAMADO_DATA_DIR` is resolved against the current directory. Setting it disables single-instance,
forces the secrets file fallback (critique G29) and makes Syncthing loopback-only (sync spec §2.3).

`registry::ClassRegistry` (owner of `config/classes.json`, folder spec §12 + D-3):
```rust
#[derive(Serialize, Deserialize, Clone)] #[serde(rename_all = "camelCase")]
pub struct ClassEntry {
    pub class_id: String, pub path: PathBuf, pub shared: bool, #[serde(default)] pub joining: bool,
    pub archived: bool, #[serde(default)] pub skip_audio: bool, pub aliases: Vec<String>,
    pub local_ignores: Vec<String> /* class paths; managed.rs emits "(?d)/" + path */, pub added_at: String,
    #[serde(default)] pub leaving: Option<Leaving>,               // sync spec §17
    #[serde(flatten)] pub unknown: serde_json::Map<String, serde_json::Value>,   // kept on rewrite
}
pub struct Leaving { pub since: String, pub afterwards: String /* "keepLocal" | "trash" */ }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct ClassEntryView { #[serde(flatten)] pub entry: ClassEntry, pub dir_name: String, pub available: bool }
    // returned by EVERY command whose TS type is `ClassEntry` (§6.2, §6.7); available = root and .tramado/class.json exist
impl ClassRegistry {
    pub fn load(config_dir: &Path) -> AppResult<Self>;
    pub fn list(&self) -> Vec<ClassEntry>;
    pub fn get(&self, class_id: &str) -> Option<ClassEntry>;     // also resolves aliases
    pub fn root(&self, class_id: &str) -> AppResult<PathBuf>;    // NOT_FOUND if unknown
    pub fn insert(&self, e: ClassEntry) -> AppResult<()>;        // CONFLICT on duplicate id or path
    pub fn update(&self, class_id: &str, f: impl FnOnce(&mut ClassEntry)) -> AppResult<ClassEntry>;
    pub fn remove(&self, class_id: &str) -> AppResult<()>;
    pub fn rename_id(&self, old: &str, new: &str) -> AppResult<()>;   // fork (§17) and rotation (v1.1): id = new, aliases += old
    pub fn left_classes(&self) -> Vec<String>; pub fn add_left_class(&self, id: &str) -> AppResult<()>;   // top-level "leftClasses"
    pub fn root_dir(&self) -> Option<PathBuf>; pub fn set_root_dir(&self, p: PathBuf) -> AppResult<()>;   // top-level "root"
    pub fn subscribe(&self, f: Box<dyn Fn(Option<&ClassEntry>, Option<&ClassEntry>) + Send + Sync>);   // (before, after)
}
```
Writes are atomic and serialised by an internal `Mutex`.

`confine` (rules shared with TS through `test-vectors/class-paths.json`):
```rust
pub fn validate_class_path(rel: &str) -> AppResult<()>;   // INVALID unless: non-empty, ≤ 200 UTF-16 units, '/'-separated,
    // NFC (checked by round-trip is not available in Rust std → TS normalises; Rust refuses only control chars),
    // no leading '/', no '\\', no NUL, no "." or ".." segment, no empty segment, no segment starting with ".st"
    // (.stfolder/.stignore/.stversions), no "*.tmp"/"*.part" segment unless under ".tramado/tmp/"
pub fn confine(root: &Path, rel: &str) -> AppResult<PathBuf>;
    // validate, then walk each existing component with symlink_metadata: any symlink → SYMLINK_REFUSED;
    // the result is root.join(rel) (never canonicalised through links); PATH_OUTSIDE_CLASS if a component escapes.
```

`files` (from Trama `files.rs`, adapted):
```rust
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()>;
    // tmp = same dir, ".<name>.<8 random [a-z0-9]>.tmp" (folder spec §4.4), write_all, sync_all, rename,
    // fsync parent dir on Unix; tmp removed on failure; creates parent dirs.
pub fn append_line(path: &Path, line: &[u8]) -> AppResult<u64>;
    // line MUST end in '\n', contain no other '\n', be ≤ 65 536 bytes (else INVALID);
    // O_APPEND, ONE write_all call, sync_data; returns new length.
pub fn read_optional(path: &Path) -> AppResult<Option<Vec<u8>>>;
pub fn read_range(path: &Path, offset: u64, len: u64) -> AppResult<Vec<u8>>;
pub fn list(root: &Path, dir: &Path, opts: ListOptions) -> AppResult<Vec<FileEntry>>;
pub struct ListOptions { pub recursive: bool, pub max_depth: usize /* ≤ 16 */, pub include_tramado: bool, pub max_entries: usize /* 50 000 */ }
    // never follows links; always skips folder spec §4.5 names (.stfolder, .stversions, .stignore,
    // .syncthing.*.tmp, ~syncthing~*.tmp, *.tmp, *.part, .tramado/tmp); skips other dot-names unless they are
    // inside .tramado and include_tramado; reports conflict_of for "*.sync-conflict-*" names.
pub struct FileEntry { pub path: String /* class path */, pub name: String, pub is_dir: bool, pub size: u64, pub mtime_ms: u64, pub conflict_of: Option<String> }
pub fn sweep_stale_tmps(dir: &Path, older_than: Duration) -> AppResult<usize>;   // only our ".<name>.<8>.tmp" files
pub fn sha256_file(path: &Path) -> AppResult<String>;   // streaming, 1 MiB buffer, lower-case hex
pub fn remove_file_if_exists(path: &Path) -> AppResult<bool>;
pub fn remove_dir_all_if_exists(path: &Path) -> AppResult<bool>;
```

`classfs::ClassFs` — the only way any Rust code (commands, sync self-heal, speech publish, claim heartbeat) touches
a class folder:
```rust
pub struct ClassFs { /* registry, paths, my_device: RwLock<Option<String>>, observer: RwLock<Option<Arc<dyn WriteObserver>>>, recent_self: Mutex<..> */ }
pub enum WriteKind { Write, Append, Remove, Move { from: String } }
pub trait WriteObserver: Send + Sync { fn wrote(&self, class_id: &str, path: &str, kind: &WriteKind); }
impl ClassFs {
    pub fn new(paths: Arc<Paths>, registry: Arc<ClassRegistry>) -> Self;
    pub fn set_device(&self, device_id: &str);                      // after sync identity is known
    pub fn set_observer(&self, o: Arc<dyn WriteObserver>);           // tramado-sync: scans + own-deletion log
    pub fn write(&self, class: &str, path: &str, bytes: &[u8], own: bool) -> AppResult<FileStamp>;
    pub fn append(&self, class: &str, path: &str, line: &[u8], own: bool) -> AppResult<FileStamp>;
    pub fn read(&self, class: &str, path: &str) -> AppResult<Vec<u8>>;
    pub fn read_range(&self, class: &str, path: &str, offset: u64, len: u64) -> AppResult<Vec<u8>>;
    pub fn stat(&self, class: &str, path: &str) -> AppResult<Option<FileEntry>>;
    pub fn list(&self, class: &str, dir: &str, opts: ListOptions) -> AppResult<Vec<FileEntry>>;
    pub fn mkdir(&self, class: &str, path: &str) -> AppResult<()>;
    pub fn rename(&self, class: &str, from: &str, to: &str) -> AppResult<()>;      // CONFLICT if `to` exists
    pub fn remove(&self, class: &str, path: &str, recursive: bool) -> AppResult<()>;
    pub fn hash(&self, class: &str, path: &str) -> AppResult<String>;
    pub fn stage_and_place(&self, class: &str, dest: &str, fill: impl FnOnce(&mut File) -> AppResult<()>, own: bool) -> AppResult<FileStamp>;
        // writes .tramado/tmp/<random>.part, fsync, renames into dest (CONFLICT if dest exists); large files
    pub fn is_recent_self_write(&self, class: &str, path: &str, within: Duration) -> bool;
    pub fn mirror_path(&self, class: &str, path: &str) -> PathBuf;   // data/private/<class>/mirror/<path>
}
pub struct FileStamp { pub path: String, pub size: u64, pub mtime_ms: u64, pub sha256: Option<String> }
```
`own = true` is accepted only for (a) paths under `.tramado/` whose device segment equals my device ID, or
(b) manifest names `class.json`, `lecture.json`, `exam.json`, `transcript.json`, `transcript.md`,
`transcript.vtt`, `audio.webm` (the caller asserts ownership; TS knows the writer). Own writes of files of 1 MiB or
less are copied to the mirror, **except** `transcript.json`, `.md` and `.vtt` (their owner can change; TS decides,
sync spec §12.3); for `audio.webm` only `{size, sha256}` is recorded (`mirror/<path>.meta.json`). `remove` of an own
path removes its mirror copy. `ClassFs` holds a per-path lock across read-modify-write sequences and across
"append + mirror append" (sync spec §12.3); at start it re-copies every own JSONL file whose `local.modifiedBy` is me
over its mirror. Every successful write, append, move or remove calls the observer.

`picks::PickRegistry`: `register(path, kind: Open|Save|Folder) -> Picked`, `resolve(token, expect) -> AppResult<PathBuf>`
(`INVALID` for unknown/expired; tokens live until quit, 128-bit random hex).

`appfiles`:
```rust
pub enum AppFile { Prefs, Identity, Hlc }                 // config/prefs.json, config/identity.json, data/hlc.json
pub fn private_path(paths: &Paths, class: &str, rel: &str) -> AppResult<PathBuf>;   // refuses "mirror/…" (Rust-only)
pub fn storage_usage(paths: &Paths, registry: &ClassRegistry) -> StorageUsage;    // walks class roots incl. .stversions
pub fn cache_path(paths: &Paths, key: &str) -> AppResult<PathBuf>;
    // key regex: ^(text/[0-9a-f]{64}\.json|peaks/[0-9a-f]{64}-\d{2,5}\.json|models-catalog\.json|ocr/[0-9a-f]{64}\.json)$
```

`watch::ClassWatcher` (R-SHELL): `new(sink: Arc<dyn Fn(ClassChanged) + Send + Sync>)`, `watch(class_id, root)`,
`unwatch(class_id)`. Debounce 300 ms; ignores §4.5 names; maps absolute paths back to class paths; sets
`self_write` when `ClassFs::is_recent_self_write(.., 2 s)`; sends `rescan: true` when notify reports an overflow.

`media` (R-SHELL): `pub fn serve(path: &Path, mime: &str, range: Option<&str>, origin: Option<&str>) -> MediaResponse`
(single byte range; 200/206/416; `Accept-Ranges: bytes`; `Content-Type` explicit; CORS headers per §8).

`power` (R-SHELL): `pub fn system_power() -> Power { source: Ac|Battery|Unknown, percent: Option<u8> }`
(Linux `/sys/class/power_supply/*/{type,online,status,capacity}`; Windows `GetSystemPowerStatus`; macOS
`pmset -g batt` parsed; anything else `Unknown`).

### 5.2 `tramado-net` (light; R-SHELL)

```rust
pub mod http;      // agent builders
pub mod hosts;     // Trama service/hosts.rs (KEEP): Endpoint::parse, HostList (config/service-hosts.json)
pub mod secrets;   // Secrets
pub mod privacy;   // PrivacyStore (config/ai.json)
pub mod ai;        // AiPipe
pub mod activity;  // ActivityLog (data/ai-activity.jsonl, metadata only)
#[cfg(any(test, feature = "testutil"))] pub mod testutil;   // MockServer (Trama service::mock, extended with SSE)
```

`http` (implemented by **M0**, not stubbed, because R-SYNC and R-SPEECH build on it in parallel with R-SHELL):
```rust
pub fn ai_agent(version: &str) -> ureq::Agent;        // timeout_connect 15 s, recv_response 120 s, per_read 30 s, global None,
                                                      // http_status_as_error(false), user_agent "Tramado/<v>" (critique C35)
pub fn download_agent(version: &str) -> ureq::Agent;  // connect 15 s, recv_response 30 s, per_read 30 s
pub fn loopback_agent() -> ureq::Agent;               // proxy None; per-call timeouts set by tramado-sync (sync spec §3.2)
pub fn lookup_agent(version: &str) -> ureq::Agent;    // discovery-lookup: recv 10 s, per_read 10 s
```

`secrets::Secrets`: `new(config_dir, file_only: bool)`, `set(name, value) -> AppResult<SecretStatus>`,
`status(name)`, `clear(name)`, `get(name) -> AppResult<Option<Zeroizing-free String>>` (crate-internal: used by
`ai`, `person` and `speech::remote` only; **never** exposed to IPC). The file backend (`file_only`) is implemented by
**M0**; R-SHELL adds the keychain. Names: `openrouter`, `host:<hostId>`, and the internal `person` (the person
key seed; `secret_set` / `secret_status` / `secret_clear` refuse it with `INVALID`). Store: OS
keychain through `keyring` 4.2.0 (service `eu.thehumanloop.tramado`, user = name); when the native store cannot be
initialised, or `file_only`, `config/secrets.json` (mode 0600 on Unix) `{"format":"tramado.secrets","version":1,"secrets":{name:value}}`.
`SecretStatus { set, last4, store: "keychain" | "file" }`. The exact keyring 4 initialisation calls are the
implementer's first task (keyring 4 is a facade over `keyring-core` 1.x); a failed initialisation MUST fall back
to the file, never error.

`privacy::PrivacyStore` (`config/ai.json` = `{"format":"tramado.ai-settings","version":1,"privacy":"no-training","busyRelax":false}`):
`get() -> PrivacyLevel` (default `NoTraining`, D7), `set(level)`, `busy_relax() -> bool`, `set_busy_relax(bool)`.

`person::Person` (folder spec §8.3.1): `init(secrets) -> AppResult<PersonInfo>` (creates the Ed25519 seed from
`getrandom` on first call; `PersonInfo { member_id, pub_b64url }`, `member_id` = `memberId(pub)` of folder spec §2.1),
`prove(class_id, device_id) -> AppResult<PersonProof>` (signs only `"tramado-member-v1|" + class_id + "|" + device_id
+ "|" + member_id` with `device_id` = this device, so a webview script cannot bind a foreign device), and the
crate-internal `seed()` for pairing (v1.1).

`ai::AiPipe` (critique C1, D5, D-10):
```rust
pub struct AiRequest { pub request_id: String, pub base: AiBase, pub method: Method /* Get|Post */, pub path: String,
                       pub body: Option<AiBody>, pub stream: bool, pub privacy_override: Option<PrivacyLevel>,
                       pub busy_fallback: bool, pub activity: Option<ActivityTag>, pub internal: bool /* Rust callers only */ }
pub enum AiBase { OpenRouter, Host { host_id: String } }
pub enum AiBody { Json(serde_json::Value), Multipart(Vec<Part>) }   // Multipart: custom OpenAI-compatible STT hosts only
pub struct Part { pub name: String, pub file_name: Option<String>, pub mime: Option<String>, pub bytes: Vec<u8> }
pub struct ActivityTag { pub class_id: Option<String>, pub action: String /* AiAction, §9 */, pub passages: u32 }
pub enum AiWireEvent {           // tag "type"
    Head { status: u16, headers: BTreeMap<String, String> },   // allow-listed headers only (below)
    Line { line: String },       // one SSE line verbatim ("data: …", ": OPENROUTER PROCESSING"); blank lines dropped
    Body { text: String },       // whole body when !stream or status ≥ 300; top-level "user_id" removed
    End,
    Fail { code: String, message: String },
}
impl AiPipe {
    pub fn new(secrets: Arc<Secrets>, hosts: Arc<HostList>, privacy: Arc<PrivacyStore>, activity: Arc<ActivityLog>, version: String) -> Self;
    pub fn send(&self, req: AiRequest, confirm: &dyn Fn(&str) -> bool, sink: Box<dyn Fn(AiWireEvent) + Send>) -> AppResult<()>;
        // validates synchronously, then runs on a `tramado-ai-<n>` thread; JOB_BUSY when the 6 slots are taken
    pub fn request_blocking(&self, req: AiRequest, timeout: Duration) -> AppResult<(u16, Vec<u8>)>;
        // Rust callers (speech::remote): waits in a FIFO for a free slot instead of JOB_BUSY; at most 4 of the
        // 6 slots are ever used by blocking callers, so interactive chat always finds 2
    pub fn cancel(&self, request_id: &str);
    pub fn clear_activity(&self) -> AppResult<()>;
}
```
Rules enforced by `send` (none can be bypassed by TS):
1. `path` ∈ { `chat/completions`, `embeddings`, `key`, `models`, `models/<id>/endpoints` (id `^[\w.:/-]{1,120}$`) };
   with `internal: true` (Rust callers only; `ai_send` always sets `false`) also `audio/transcriptions` and
   `models?output_modalities=transcription` (D-12); else `INVALID`. Method: `GET` for `key`, `models…`,
   `models/*/endpoints`; `POST` otherwise.
2. Base `OpenRouter` = `https://openrouter.ai/api/v1`; `Host` = a host in `service-hosts.json` (else `AI_HOST_NOT_ALLOWED`).
3. Key from `Secrets` (`openrouter` / `host:<id>`); none and base OpenRouter → `AI_NO_KEY` (a custom host MAY have no key).
4. Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`, `Accept: text/event-stream` when
   streaming, `HTTP-Referer: https://github.com/feiteira/Tramado`, `X-OpenRouter-Title: Tramado` (OpenRouter only).
5. Body rewriting for POST on OpenRouter: `provider` is **overwritten** from the effective level
   (`no-training` → `{"data_collection":"deny"}`; `zdr` → `{"data_collection":"deny","zdr":true}`; `standard` → removed);
   `user` is removed. On custom hosts `provider` and `user` are removed. Effective level = stored level, unless
   `privacy_override == Standard` **and** either `confirm(host)` returned true (native dialog shown by the command
   layer, D-10) or (`busy_fallback` and `busy_relax()`). For `audio/transcriptions` the same `provider` rule
   applies; a 404 "no endpoints found matching your data policy" maps to `AI_PRIVACY_BLOCKS` with
   `data.stt = true` (UI: "Cloud transcription isn't available at the Keep nothing level").
6. Response: forward `Head` with headers `retry-after`, `x-ratelimit-limit`, `x-ratelimit-remaining`,
   `x-ratelimit-reset`, `x-openrouter-error-origin`, `content-type`; then `Line`s (stream, 2xx) or one `Body`.
   Transport errors → `Fail{AI_TIMEOUT}` (timeouts) / `Fail{AI_OFFLINE}` (connect/DNS); cancel → `Fail{CANCELLED}`.
   Body cap 32 MiB.
7. Activity: one line per request in `data/ai-activity.jsonl`
   `{at, host, path, model (from body), status, code, ms, bytesOut, bytesIn, privacy, classId, action, passages}`
   (the last three from `activity`) — never content, never `user_id`, never `metadata.raw` (critique §8).

Live check (R-SHELL acceptance, opt-in): `crates/tramado-net/tests/live.rs` `#[ignore] live_openrouter_pipe` reads
`OPENROUTER_API_KEY` from the environment (never written to disk), sends a streamed chat request through `AiPipe`
at `no-training` with the default chain, and asserts `Head{200}`, at least one `data:` line and `[DONE]`; then
`GET key` returns `free_model_daily_requests`.

### 5.3 `tramado-sync` (light; R-SYNC)

Modules follow sync spec §1, with the D-1 split:

```
src/lib.rs        SyncEngine (public handle), SyncConfig, SyncSink
src/types.rs      every IPC type of §6.7 (serde, camelCase)
src/init.rs       identity (§2.3): API key, bcrypt GUI password, config.xml template, generate, device-id, instance file;
                  pre-spawn (§2.4): copied-identity check, port probe, GUI port, pausing every class folder in config.xml
src/supervisor.rs spawn/wait/restart/backoff/orphan clean-up/stop (§2.4–2.8); Linux PDEATHSIG, Windows Job Object
src/client.rs     typed REST client (§3, §4); 403 → restart; timeouts per §3.2; native ↔ class path conversion (§3.6)
src/config_writer.rs  single-thread queue; read-modify-write; PUT /rest/config for ignores (§3.3)
src/events.rs     loops A and B, priming, gap detection (§5)
src/managed.rs    managed options/ignores/folder settings re-applied at start (§2.7, §6.2, folder spec §11)
src/folders.rs    share (§6.1), join from the decoded invite code (§8), cancel join, accept folder, leave as a background
                  state + finish_leaving (§17); rotate + rotation accept (§18.2) and relocate (§22.3) are v1.1
src/invite.rs     decode + validate InviteV1 codes in Rust (§7.2–§7.3, §9.5): the join adds only the code's devices
src/admission.rs  §9 exactly, with decisions from the class policy (decide() shared with TS via test-vectors/admission.json),
                  §9.5 widening checks, the start-up rule, strikes, early eviction, batched ignores
src/reconcile.rs  §10 exactly, roster from the class policy (each device re-checked, §9.5); left(); stuck_joiner()
src/bans.rs       apply_bans() declaratively over every class (§18.1: ignoredFolders, "tramado-ban" ignores; §25 Q7 fallback)
src/sign.rs       Ed25519 signatures with <home>/key.pem over the §12.4 message; cert DER for `Sig.cert`
src/discovery.rs  §11.1 address injection; own_addresses() §11.2
src/selfheal.rs   §12.3 using the ClassFs mirror (only when SHA-256 differs; never transcript.*; audio.webm via versions)
src/guard.rs      mass-change guard (§22.2): own-deletion log from the WriteObserver; local guard (pause + massDelete,
                  reset/respawn/unpause restore) and receiving guard (massDeleteRemote)
src/scan.rs       WriteObserver impl: coalesced POST /rest/db/scan?sub= (one in flight + one queued per sub-path)
src/policy.rs     PolicyStore: data/syncthing/policy.json {"format":"tramado.sync-policy","version":1,"global":…,"classes":{id:ClassPolicy}}
src/appdata.rs    data/syncthing/appdata.json: ignored{dev:{at,until,strikes,reason}}, failed[{source,at}], seenMember{class:[dev]},
                  proofAt{class:{dev:at}}, guardPaused[class], policyReceived (this session only, not persisted)
src/diag.rs       diagnostics (log tail with device IDs truncated to ShortId, ports, version, errors)
src/existing.rs   detection of a user's own Syncthing (critique G1; never touches it)
```

Public handle (every method blocking; the desktop layer wraps calls in `blocking`):
```rust
pub struct SyncConfig { pub paths: Arc<Paths>, pub fs: Arc<ClassFs>, pub registry: Arc<ClassRegistry>, pub version: String,
                        pub sidecar: Option<PathBuf> /* resolved: TRAMADO_SYNCTHING_BIN, else next to the exe */ }
pub trait SyncSink: Send + Sync { fn event(&self, e: SyncEvent); }
pub struct SyncEngine;
impl SyncEngine {
    pub fn new(cfg: SyncConfig, sink: Arc<dyn SyncSink>) -> Self;
    pub fn identity(&self) -> AppResult<SyncIdentity>;            // init.rs identity only: no daemon, no port probe (§2.3)
    pub fn start(&self) -> AppResult<SyncStatus>;                 // idempotent, lazy start (§2.9)
    pub fn stop(&self, deadline: Duration);                       // API shutdown → 3 s → SIGTERM → kill at 5 s
    pub fn status(&self) -> SyncStatus;
    pub fn snapshot(&self) -> AppResult<SyncSnapshot>;
    pub fn apply_settings(&self, s: SyncSettings) -> AppResult<()>;
    pub fn set_class_policy(&self, p: ClassPolicy) -> AppResult<()>;   // persist, then reconcile + bans + ignores for that class
    pub fn share_class(&self, class_id: &str, label: &str) -> AppResult<ClassEntry>;
    pub fn join_class(&self, req: JoinRequest) -> AppResult<ClassEntry>;          // decodes req.code itself (§9.5)
    pub fn cancel_join(&self, class_id: &str) -> AppResult<()>;
    pub fn accept_folder(&self, req: AcceptFolderRequest) -> AppResult<ClassEntry>;   // devices [me, offeredBy]; offer must be pending
    pub fn leave_class(&self, class_id: &str, opts: LeaveOptions) -> AppResult<()>;   // persists `leaving`; finish_leaving runs later
    pub fn admit(&self, class_id: &str, device: &str) -> AppResult<()>;           // PERMISSION_DENIED unless the offer is pending
    pub fn decline(&self, class_id: &str, device: &str) -> AppResult<()>;
    pub fn sign(&self, class_id: &str, path: &str, canonical: &[u8]) -> AppResult<Sig>;   // §12.4; works without the daemon
    pub fn restart(&self) -> AppResult<SyncStatus>;                               // stop + start (Settings › Sharing)
    pub fn resolve_mass_delete(&self, class_id: &str, action: MassDeleteAction) -> AppResult<()>;   // §22.2 restore | confirm
    pub fn resolve_copied_identity(&self, action: CopiedIdentityAction) -> AppResult<SyncIdentity>; // §2.5 step 0: new | same
    pub fn normalize_ids(&self, ids: &[String]) -> AppResult<Vec<Option<String>>>;
    pub fn own_addresses(&self) -> AppResult<Vec<String>>;
    pub fn file_info(&self, class_id: &str, paths: &[String]) -> AppResult<Vec<FileSyncInfo>>;
    pub fn wait_available(&self, class_id: &str, path: &str, min_devices: usize, timeout: Duration) -> AppResult<bool>;
    pub fn wait_caught_up(&self, class_id: &str, timeout: Duration) -> AppResult<CaughtUp>;
    pub fn device_stats(&self) -> AppResult<BTreeMap<String, DeviceStat>>;
    pub fn folder_status(&self, class_id: &str) -> AppResult<FolderView>;
    pub fn versions(&self, class_id: &str) -> AppResult<Vec<VersionEntry>>;
    pub fn restore(&self, class_id: &str, items: &[RestoreItem]) -> AppResult<()>;
    pub fn folder_errors(&self, class_id: &str) -> AppResult<Vec<FolderError>>;
    pub fn pause_class(&self, class_id: &str, paused: bool) -> AppResult<()>;
    pub fn scan(&self, class_id: &str, path: Option<&str>) -> AppResult<()>;
    pub fn diagnostics(&self) -> AppResult<SyncDiagnostics>;
    pub fn existing_syncthing(&self) -> ExistingSyncthing;
}
```

Admission with the policy (sync spec §9.2, D-1): `handle_pending_devices` runs as specified (bans are not checked
there). `handle_pending_folders` uses, for a class `cls`: `banned(cls, dev)` = `dev ∈ policy[cls].bannedDevices`;
`cls.askBeforeAdmit` = `policy[cls].askBeforeAdmit`; `known_member(cls, dev)` = `dev ∈ policy[cls].knownDevices`;
`pairing_peer(dev)` = `dev ∈ global.ownDevices` or (`global.pairingOpenUntil > now` and dev's pending name carries a
pairing token that verifies, sync spec §19, v1.1). `GlobalPolicy` is Rust state (written only by Rust's own pairing
run; `{ownDevices: [], pairingOpenUntil: null}` in 0.1); TS cannot set it. Offers of a class in `leftClasses` or in an
`aliases` list are dropped silently; offers of another **unknown** `tramado-*` folder are never auto-created: Rust
emits `folderOffer` and TS decides (the "Accept / Ignore" prompt; pairing and rotation in v1.1).
The pure function
```rust
pub fn decide(policies: &BTreeMap<String /*ClassId*/, ClassPolicy>, global: &GlobalPolicy, offer: &FolderOffer, now_ms: u64) -> Decision;
#[derive(Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct FolderOffer { pub folder_id: String, pub device_id: String, pub in_folder: bool }
#[derive(Serialize, Deserialize, PartialEq)] #[serde(rename_all = "lowercase")]
pub enum Decision { Share, Queue, Ban, Skip /* already in the folder */, Unknown /* not one of my classes */ }
```
is mirrored by `app/src/core/sync/admission.ts` (`decide(policies, global, offer, nowMs): 'share' | 'queue' | 'ban' |
'skip' | 'unknown'`) and both are tested against `test-vectors/admission.json` (frozen, §19.1).

Reconciliation (§10) uses `roster = policy[cls].roster` (TS has already applied the trust, signature and binding
checks; Rust re-checks each roster device's member file `modifiedBy`, sync spec §9.5), `banned =
policy[cls].bannedDevices`; `left()`, `seenMember`, `proofAt` and the provisional list are Rust state. It runs on
`set_class_policy`, at start, after gap detection and every 60 s, and ends with `apply_bans()` (declarative over all
classes, sync spec §18.1).

Self-heal (§12.3): on `RemoteChangeDetected` or `LocalChangeDetected` for a path whose mirror copy exists, if the
event's `modifiedBy` ≠ my ShortId (remote) or the change is not a recent self write (local), **and** the file's
SHA-256 differs from the mirror's, Rust rewrites the file from the mirror with `ClassFs::write(.., own = true)` and
emits `foreignWrite`. `transcript.*` is never healed by Rust; `audio.webm` is restored from the local trashcan
(`POST /rest/folder/versions`); claims and presence files older than their retention are not restored. A deletion of
my own path is restored the same way unless `ClassFs` recorded that I deleted it.

### 5.4 `tramado-speech` (HEAVY; R-SPEECH)

```
src/lib.rs        Speech (public handle), SpeechConfig
src/types.rs      IPC types of §6.8
src/registry.rs   MODELS = [{id:'turbo', file:'ggml-large-v3-turbo-q5_0.bin', tier:'default'}, {id:'small', file:'ggml-small-q5_1.bin',
                  tier:'draft'}, {id:'large-v3', file:'ggml-large-v3-q5_0.bin', tier:'advanced'}], REV pin 5359861c…, DTW presets (D23)
src/download.rs   32 MiB Range chunks, re-resolve the HF URL per chunk, resume with re-hash, DISK_FULL check (fs4), MODEL_INTEGRITY (D22)
src/cpu.rs        cpu_supported() (x86-64: avx2 && fma && f16c; aarch64: true)
src/awake.rs      Trama verbatim ("Tramado" strings)
src/capture.rs    Trama capture.rs: modes room (mic) / online (system [+ mic]); device picker; Status; level meter without a journal (meter)
src/mixer.rs      Trama mixer + pause-aware clock (audio-pipeline §4.4)
src/encode.rs     opusic-c Encoder: 16 kHz, Voip, Voice, VBR, complexity 10, 60 ms packets, 24/32/16 kbps; pre-skip
src/journal.rs    Ogg Opus journal (ogg 0.9.2): page every 50 packets, fsync 5 s; journal.json; crash recovery (CRC scan, EOS)
src/webm.rs       in-memory EBML writer: Info/Duration, Tracks (A_OPUS, CodecDelay, SeekPreRoll), Clusters ~5 s, Cues, DiscardPadding
src/publish.rs    remux journal → ClassFs::stage_and_place(<lectureDir>/audio.webm) or data/recordings/<id>.webm (local-only)
src/decode.rs     symphonia demux + libopus decode at 16 kHz with manual pre-skip; other codecs via symphonia; HE-AAC → SPEECH_UNSUPPORTED_AUDIO
src/resample.rs   Trama verbatim
src/import.rs     decode any supported file → encode → WebM (audio-pipeline §2.8, critique G23)
src/vad.rs        Silero VAD v5.1.2 (whisper-rs WhisperVadContext) [feature local-whisper]; loudness cut fallback
src/whisper.rs    Trama transcribe.rs: join/place/DTW, raw abort callback, windowed ~10 min, partial persistence, initial prompt
                  from TranscribeRequest.initialPrompt (class vocabulary) [feature local-whisper]
src/remote.rs     Trama remote.rs: 30 s pieces, 4 workers, verbose_json→json downgrade, `prompt` = initialPrompt; written against
                  `trait SttTransport { fn post(&self, path: &str, body: AiBody, timeout: Duration) -> AppResult<(u16, Vec<u8>)> }`
                  (the desktop crate passes AiPipe::request_blocking; tests pass a double) (paid STT, D25)
src/jobs.rs       one job at a time; Channel re-attach (transcription and import); result file data/transcribe/<lectureId>.result.json
                  (kept 7 days after take, sync spec §14.5); partial file
src/heartbeat.rs  claim heartbeat thread (rewrites the claim JSON every 60 s preserving unknown fields; also writes
                  lastHeartbeatWallMs to data/transcribe/<lectureId>.json, sync spec §14.5)
src/peaks.rs      waveform peaks (u8 per bucket) → cache/peaks/<sha256>-<buckets>.json
examples/gen_selftest.rs   writes resources/media/selftest.webm (300 s synthetic speech-like tone, committed)
```

```rust
pub struct SpeechConfig { pub paths: Arc<Paths>, pub fs: Arc<ClassFs>, pub stt: Arc<dyn SttTransport>, pub version: String }
pub trait Sink<E>: Send + Sync { fn send(&self, e: E) -> bool; }   // false = channel gone (webview reloaded)
pub struct Speech;
impl Speech {
    pub fn new(cfg: SpeechConfig) -> Self;     // installs whisper logging hooks once
    pub fn info(&self) -> SpeechInfo;
    pub fn models(&self) -> Vec<ModelState>;
    pub fn download(&self, id: &str, sink: Arc<dyn Sink<ModelEvent>>) -> AppResult<()>;
    pub fn attach_download(&self, id: &str, sink: Arc<dyn Sink<ModelEvent>>) -> bool;
    pub fn cancel_download(&self, id: &str); pub fn delete_model(&self, id: &str) -> AppResult<()>;
    pub fn import_model(&self, id: &str, file: &Path) -> AppResult<ModelState>;
    pub fn devices(&self) -> AudioDevices;
    pub fn meter_start(&self, req: MeterRequest, sink: Arc<dyn Sink<MeterEvent>>) -> AppResult<()>;   // JOB_BUSY while recording
    pub fn meter_stop(&self);
    pub fn recorder_start(&self, req: RecorderStartRequest, sink: Arc<dyn Sink<RecorderEvent>>) -> AppResult<RecorderStatus>;
    pub fn recorder_attach(&self, sink: Arc<dyn Sink<RecorderEvent>>) -> Option<RecorderStatus>;
    pub fn recorder_pause(&self) -> AppResult<RecorderStatus>; pub fn recorder_resume(&self) -> AppResult<RecorderStatus>;
    pub fn recorder_mark(&self, kind: MarkerKind, note: Option<String>) -> AppResult<Marker>;
    pub fn recorder_stop(&self) -> AppResult<FinishedRecording>;
    pub fn pending_recordings(&self) -> AppResult<Vec<FinishedRecording>>;   // recovers torn journals first
    pub fn publish(&self, req: PublishRequest) -> AppResult<PublishedAudio>;
    pub fn discard(&self, recording_id: &str) -> AppResult<()>;
    pub fn import_audio(&self, req: ImportAudioRequest, file: &Path, sink: Arc<dyn Sink<ImportEvent>>) -> AppResult<()>;
    pub fn attach_import(&self, recording_id: &str, sink: Arc<dyn Sink<ImportEvent>>) -> bool;
        // finished imports whose lecture.json was not written yet are also reported by pending_recordings()
    pub fn transcribe_start(&self, req: TranscribeRequest, sink: Arc<dyn Sink<TranscribeEvent>>) -> AppResult<String>;
    pub fn transcribe_attach(&self, job_id: &str, sink: Arc<dyn Sink<TranscribeEvent>>) -> Option<JobSummary>;
    pub fn transcribe_cancel(&self, job_id: &str, keep_partial: bool);
    pub fn jobs(&self) -> Vec<JobSummary>;
    pub fn take_result(&self, job_id: &str) -> AppResult<TranscriptionResult>;
    pub fn peaks(&self, source: &AudioSource, buckets: u32) -> AppResult<Vec<u8>>;
    pub fn shutdown(&self);                    // cancel job (keep partial), stop recorder (finalise journal)
}
```
**Claim file hand-over (one writer at a time on this device).** From `speech_transcribe_start(req{claim})` until
`speech_transcribe_take` or `speech_transcribe_cancel` returns, Rust is the only writer of that claim file: it rewrites
it every 60 s (`status:"working"`, `heartbeat+1`, `progress`, `etaMs`, `updatedAt`, unknown fields preserved), keeps it
`working` with `progress: 1.0` while a finished result is untaken (so a crashed or hidden webview never lets a
completed claim go stale, D-1, §4.3), and on a job failure writes `status:"failed"` with `error` and stops. After
`take` TS writes `transcript.json`, `.md`, `.vtt`, then the claim `done` (sync spec §14.5 order); after `cancel` (lost
the claim) TS deletes the claim file.

### 5.5 `tramado-desktop` (`desktop/src-tauri`)

`lib.rs` (M0, frozen afterwards):
```rust
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    if std::env::var_os("TRAMADO_DATA_DIR").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| deeplink::on_second_instance(app, argv)));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("tramado-media", media::handle)
        .setup(|app| state::setup(app))          // Shared + every commands::<domain>::init, tray, deep links, window
        .on_window_event(window::on_window_event)
        .invoke_handler(tauri::generate_handler![ /* every command of §6, grouped by module */ ])
        .build(tauri::generate_context!())
        .expect("Tramado failed to start")
        .run(|app, event| if let tauri::RunEvent::Exit = event { state::on_exit(app) });
}
```
`state::on_exit` calls, in order: `commands::speech::on_exit` (finalise recording journal, cancel job keeping
partials), `commands::sync::on_exit` (background stop with a 5 s deadline), `commands::app::on_exit` (flush log).
Each `commands::<domain>` module exports `pub fn init(app: &AppHandle, shared: &Shared) -> AppResult<()>` (it
calls `app.manage(..)` itself) and `pub fn on_exit(app: &AppHandle)`.

`state::Shared` (M0): `{ paths: Arc<Paths>, registry: Arc<ClassRegistry>, fs: Arc<ClassFs>, picks: Arc<PickRegistry>, version: String }`.

`deeplink.rs` (R-SHELL): `tramado://join/…` and `tramado://pair/…` URLs from the plugin and from single-instance
argv become `app:deep-link {url}`. A `.tramado-invite` path (argv, or the macOS open-file event of the file
association, §18.3) is read **in Rust** (≤ 64 KiB, UTF-8) and its text is delivered as `app:deep-link {url: 'file:',
text}`; the webview never receives the path (D-4).
`util.rs` (M0): Trama's `blocking`, `body_bytes`, `header` (percent-decoded), plus
`fn not_implemented(cmd: &str) -> AppError`.

Window behaviour (`window.rs`, R-SHELL): `CloseRequested` is **not** intercepted in Rust; the webview handles it
(Trama pattern: `onCloseRequested` → `preventDefault` → savers → `window.hide()` when tray mode applies, else
`app_quit`). `app_quit` runs the exit path. The tray (`tray.rs`) exists while `app_set_background_mode` says
`trayOnClose && sharedClasses > 0`; menu: Open Tramado, Pause sharing / Resume sharing, Quit; clicks emit
`app:tray`.

---

## 6. IPC contract: every Tauri command

### 6.0 Conventions

- Command names are `snake_case`, grouped by prefix. JS calls them with **camelCase top-level arguments**
  (Tauri converts `classId` → `class_id`); fields inside struct arguments are camelCase through serde.
- Every command is `async`, returns `AppResult<T>` and wraps disk, CPU or network work in `util::blocking`.
- Errors reject with `{ code: ErrorCode, message: string, data?: object }` (§15). Every command can also fail with
  `INVALID` (bad argument), `IO_ERROR` and, until implemented, `NOT_IMPLEMENTED`; the tables list the other codes.
- Binary results use `tauri::ipc::Response` (JS receives an `ArrayBuffer`). Binary uploads are a **raw body**
  (`Uint8Array` covering its whole buffer) plus percent-encoded headers (`x-class`, `x-path`, `x-own: "1"|"0"`,
  `x-name`), as in Trama.
- Paths in arguments are **class paths** (folder spec §1) inside a registered class, or app-file names, or **pick
  tokens** (D-4). No command accepts an absolute path from the webview.
- Long jobs take a `tauri::ipc::Channel<E>` named `onEvent` and have an `*_attach` command (D-7).
- "Impl" names the Rust module (desktop `commands/<file>.rs` → crate function). M0 registers every command of these
  tables; until a work package implements it, its body is `Err(util::not_implemented("<command>"))`. Commands of
  v1.1 items (§1.1) are not in these tables and are not registered.
- Every command whose TS return type is `ClassEntry` returns Rust's `ClassEntryView` (§5.1).

TS types named below are defined in `app/src/platform/types/*.ts` (§9); Rust twins live in the implementing crate's
`types.rs` (or `tramado_base::…`).

### 6.1 App, files, private data, cache — `commands/app.rs` (R-SHELL)

| Command | Args | Returns | Other errors | Impl |
|---|---|---|---|---|
| `app_info` | — | `AppInfo` | — | `tramado_base::paths` + tauri |
| `app_file_read` | `name: AppFileName` | `string \| null` | — | `base::appfiles` |
| `app_file_write` | `name: AppFileName, text: string` | `void` | `DISK_FULL` | `base::appfiles` (atomic) |
| `app_log` | `level: 'error'\|'warn'\|'info', message: string, data?: object` | `void` | — | `base::applog` (`data/logs/app.log`, 2 × 5 MiB) |
| `app_take_pending_links` | — | `string[]` | — | `deeplink.rs` (links received before the webview listened) |
| `app_set_background_mode` | `mode: { trayOnClose: boolean, sharedClasses: number }` | `void` | — | `tray.rs` |
| `app_autostart_get` | — | `boolean` | — | autostart plugin |
| `app_autostart_set` | `enabled: boolean` | `void` | `PERMISSION_DENIED` | autostart plugin (launch arg `--hidden`) |
| `app_quit` | — | `void` | — | exit path (§5.5) |
| `diag_collect` | — | `RustDiagnostics` | — | app + `sync::diag` + `speech::info` + `net::activity` |
| `person_init` | — | `PersonInfo { memberId, pub }` | — | `net::person::init` (creates the person key on first call; onboarding) |
| `person_prove` | `classId` | `PersonProof { pub, sig }` | `SYNC_UNAVAILABLE` (no device identity yet) | `net::person::prove(classId, own device ID)` (folder spec §8.3.1) |
| `storage_usage` | — | `StorageUsage` | — | `base::appfiles::storage_usage` (walks class roots incl. `.stversions`, models, cache) |
| `cache_clear` | — | `void` | — | deletes `app_cache_dir/**` except `models-catalog.json` |
| `app_reveal` | `which: 'classesRoot' \| 'private' \| 'models' \| 'cache', classId?: ClassId` | `void` | `NOT_FOUND` | opener `reveal_item_in_dir` from Rust (private = `data/private/<classId>` or `data/private`) |
| `private_read` | `classId, path: string` | `ArrayBuffer \| null` | `NOT_FOUND` (class) | `base::appfiles::private_path` |
| `private_write` | raw body; headers `x-class`, `x-path` | `void` | `DISK_FULL` | atomic write |
| `private_append` | raw body; headers `x-class`, `x-path` | `number` (new length) | `DISK_FULL` | `files::append_line` |
| `private_list` | `classId, dir: string` | `string[]` (relative paths, recursive) | — | |
| `private_remove` | `classId, path: string, recursive: boolean` | `void` | — | |
| `private_purge` | `classId` | `void` | — | deletes `data/private/<classId>/` (keeps nothing) |
| `cache_read` | `key: CacheKey` | `ArrayBuffer \| null` | — | `base::appfiles::cache_path` |
| `cache_write` | raw body; header `x-name` (= key) | `void` | `DISK_FULL` | atomic |
| `cache_remove` | `key: CacheKey` | `void` | — | |

`AppFileName` = `'prefs.json' | 'identity.json' | 'hlc.json'` (config, config, data). Private paths follow class
path rules and MUST NOT start with `mirror/` (Rust-only).

### 6.2 Class registry and class files — `commands/classes.rs` (R-SHELL)

| Command | Args | Returns | Other errors | Impl |
|---|---|---|---|---|
| `classes_list` | — | `ClassEntry[]` | — | `base::registry` (+ `available` = root and `.tramado/class.json` exist) |
| `classes_root` | — | `ClassesRoot { path: string, names: string[] }` | — | `root` from `classes.json`, else `Paths.default_classes_root`; `names` = existing child names (TS makes new directory names unique with them) |
| `classes_set_root` | `pick: PickToken` (folder) | `ClassesRoot` | `PERMISSION_DENIED` | persists in `config/classes.json` field `root` |
| `class_create` | `req: { classId, dirName: string, parent?: PickToken }` | `CreatedClass { entry: ClassEntry, warnings: ('cloudFolder')[] }` | `CONFLICT` (dir exists / id registered), `PERMISSION_DENIED` | mkdir `<root>/<dirName>` + `.tramado/`; register (`shared:false`) and watch. TS then writes `class.json` + meta. |
| `class_adopt` | `pick: PickToken` (folder) | `AdoptedClass { entry: ClassEntry, foreignMembers: boolean }` | `NOT_FOUND` (no `.tramado/class.json`), `CONFLICT` | reads `classId` from `class.json`; registers; watches; `foreignMembers` = `.tramado/members/` holds files of other devices → TS forks it (sync spec §17) |
| `class_fork` | `classId, newClassId` | `ClassEntry` | `CONFLICT` (shared, or `class.json` does not carry `newClassId`) | after TS wrote the forked `class.json` (folder spec §8.1): registry `rename_id`, `data/private/<old>` → `<new>`, re-watch, purge the old mirror |
| `class_update` | `classId, patch: { archived?: boolean, skipAudio?: boolean, localIgnores?: string[] }` | `ClassEntry` | `NOT_FOUND` | registry; registry observers fire (tramado-sync re-applies the folder's ignores when `skipAudio`/`localIgnores` changed) |
| `class_forget` | `classId` | `void` | `CONFLICT` (still shared: leave first) | unregister + unwatch; files stay |
| `class_trash` | `classId` | `void` | `CONFLICT` (still shared) | OS trash (`trash` crate), then forget |
| `class_trash_empty` | `classId` | `void` | `NOT_FOUND` | deletes `<root>/.stversions/**` (the class's 30-day trashcan on this computer) |
| `class_list` | `classId, dir: string, opts: { recursive: boolean, maxDepth?: number, includeTramado?: boolean }` | `ClassFileEntry[]` | `NOT_FOUND`, `SYMLINK_REFUSED` | `ClassFs::list` |
| `class_stat` | `classId, path` | `ClassFileEntry \| null` | `SYMLINK_REFUSED` | |
| `class_read` | `classId, path` | `ArrayBuffer` | `NOT_FOUND`, `SYMLINK_REFUSED`, `PATH_OUTSIDE_CLASS` | |
| `class_read_range` | `classId, path, offset: number, length: number` | `ArrayBuffer` | as above | |
| `class_write` | raw body; headers `x-class`, `x-path`, `x-own` | `FileStamp` (sha256 set) | `DISK_FULL`, `SYMLINK_REFUSED`, `PATH_OUTSIDE_CLASS` | `ClassFs::write` (atomic, mirror if own, observer → scan) |
| `class_append` | raw body (one line incl. `\n`); headers `x-class`, `x-path`, `x-own` | `FileStamp` (size = new length, sha256 null) | `DISK_FULL`, `INVALID` (line rules) | `ClassFs::append` |
| `class_mkdir` | `classId, path` | `void` | | |
| `class_move` | `classId, from, to` | `void` | `CONFLICT` | |
| `class_remove` | `classId, path, recursive: boolean` | `void` | `NOT_FOUND` | records own deletion (mass-delete guard) |
| `class_hash` | `classId, path` | `Hex64` | | streaming SHA-256 |
| `class_import` | `classId, pick: PickToken, dest: string` | `FileStamp` | `CONFLICT`, `DISK_FULL` | copy picked file via `stage_and_place` |
| `class_export` | `classId, path, pick: PickToken` (save) | `void` | | copy out |
| `class_reveal` | `classId, path?: string` | `void` | | opener `reveal_item_in_dir` (from Rust) |
| `class_open` | `classId, path` | `void` | | opener `open_path` (system app) |

### 6.3 Dialogs — `commands/dialogs.rs` (R-SHELL)

| Command | Args | Returns | Impl |
|---|---|---|---|
| `dialog_pick_files` | `req: { title: string, filters: FileFilter[], multiple: boolean }` | `Picked[]` | dialog plugin from Rust in `blocking`; empty filter lists removed (Trama gotcha) |
| `dialog_pick_folder` | `req: { title: string }` | `Picked \| null` | |
| `dialog_save` | `req: { title: string, defaultName: string, filters: FileFilter[] }` | `Picked \| null` | |

When `TRAMADO_DATA_DIR` **and** `TRAMADO_E2E=1` are set, dialogs do not open: they pop answers from the JSON
array in the file named by `TRAMADO_E2E_DIALOGS` (`[{"paths": ["/abs/a.pdf"]}, {"cancel": true}, …]`), so the
desktop e2e can drive imports (replaces Trama's `window.__TRAMA_E2E_DIALOGS__`).

### 6.4 Secrets and AI — `commands/ai.rs` (R-SHELL → `tramado-net`)

| Command | Args | Returns | Other errors | Events |
|---|---|---|---|---|
| `secret_set` | `name: SecretName, value: string` (1–400 chars, no whitespace) | `SecretStatus` | | |
| `secret_status` | `name: SecretName` | `SecretStatus` | | |
| `secret_clear` | `name: SecretName` | `void` | | |
| `ai_send` | `request: AiPipeRequest, onEvent: Channel<AiWireEvent>` | `void` (worker started) | `AI_NO_KEY`, `AI_HOST_NOT_ALLOWED`, `JOB_BUSY` (all slots taken) | channel: `head`, `line`*, `body`, `end` \| `fail` |
| `ai_cancel` | `requestId: string` | `void` | | channel gets `fail{CANCELLED}` |
| `ai_hosts` | — | `AiHost[]` | | |
| `ai_host_allow` | `base: string, text: ConfirmText` | `AiHost \| null` (null = user declined) | `AI_BAD_ADDRESS` | native confirm; `{host}` filled by Rust |
| `ai_host_forget` | `hostId: string` | `void` | | also clears `host:<id>` secret |
| `ai_privacy_get` | — | `PrivacyLevel` | | |
| `ai_privacy_set` | `level: PrivacyLevel, text: ConfirmText` | `boolean` | | native confirm only when relaxing (`zdr` → `no-training` → `standard`) |
| `ai_activity` | `limit: number` (≤ 500) | `AiActivityEntry[]` (newest first) | | |
| `ai_activity_clear` | — | `void` | | truncates `data/ai-activity.jsonl` |
| `ai_busy_policy_get` | — | `boolean` (`busyRelax`) | | |
| `ai_busy_policy_set` | `relax: boolean, text: ConfirmText` | `boolean` (false = declined) | | native confirm when turning on (D-10) |

`ai_send` with `privacyOverride: "standard"` and `overrideText: ConfirmText` shows a native confirmation (once per
request) before relaxing, unless `busyFallback: true` and `busyRelax` is on (D-10); declined → channel
`fail{AI_PRIVACY_BLOCKS}` with `data.declined = true`. `secret_*` refuse the name `person` (`INVALID`).

### 6.5 System — `commands/system.rs` (R-SHELL)

| Command | Args | Returns | Notes |
|---|---|---|---|
| `open_external` | `url: string, text: ConfirmText` | `boolean` | `https://` only (else `INVALID`); native confirm showing the host, **except** for URLs that start with `https://openrouter.ai/`, `https://huggingface.co/`, `https://github.com/feiteira/Tramado` or `https://feiteira.github.io/Tramado/` (opened at once); opener from Rust |
| `notify_show` | `n: { title: string, body: string, tag?: string }` | `void` | notification plugin from Rust; no JS permission |
| `shortcut_set_markers` | `accelerators: Partial<Record<'important' \| 'confused' \| 'exam' \| 'todo', string>> \| null` | `void` | registers (or, with `null`, unregisters) the opt-in OS-global marker shortcuts (D28; default `Ctrl/⌘+Alt+1…4`, UX §2.10); a press only emits `app:shortcut {id:'marker', kind}` and `RecordingService` calls `speech_recorder_mark` (the webview keeps running while hidden, D-6); `CONFLICT` if an accelerator is taken |
| `system_power` | — | `Power { source: 'ac'\|'battery'\|'unknown', percent: number \| null }` | `base::power` |

### 6.6 Media

No command: URLs are built in TS (§8). The scheme handler lives in `desktop/src-tauri/src/media.rs` (R-SHELL).

### 6.7 Sync — `commands/sync.rs` (R-SYNC → `tramado-sync`)

| Command | Args | Returns | Other errors |
|---|---|---|---|
| `sync_identity` | — | `SyncIdentity` | `SYNC_UNAVAILABLE` (no sidecar) |
| `sync_identity_resolve` | `action: 'new' \| 'same'` | `SyncIdentity` | — (after `SYNC_IDENTITY_COPIED`, sync spec §2.5 step 0) |
| `sync_start` | — | `SyncStatus` | `SYNC_UNAVAILABLE`, `SYNC_LOCKED`, `SYNC_PORT`, `SYNC_IDENTITY_COPIED` |
| `sync_restart` | — | `SyncStatus` | as `sync_start` |
| `sync_status` | — | `SyncStatus` | |
| `sync_snapshot` | — | `SyncSnapshot` | `SYNC_UNAVAILABLE` |
| `sync_settings_apply` | `settings: SyncSettings` | `void` | |
| `sync_policy_set` | `policy: ClassPolicy` | `void` | `NOT_FOUND` (class) |
| `sync_sign` | raw body (RFC 8785 canonical JSON of the record without `sig`); headers `x-class`, `x-path` | `Sig` | `SYNC_UNAVAILABLE` (no identity) |
| `sync_share_class` | `classId, label: string` | `ClassEntry` | `SYNC_UNAVAILABLE`, `CONFLICT` (already shared / folder ID taken by another path) |
| `sync_join_class` | `req: JoinRequest` | `ClassEntry` (`joining: true`) | `CONFLICT` (dir exists), `SYNC_INVITE_INVALID`, `NEWER_FORMAT` |
| `sync_cancel_join` | `classId` | `void` | |
| `sync_accept_folder` | `req: AcceptFolderRequest` | `ClassEntry` | `CONFLICT` |
| `sync_leave_class` | `classId, opts: LeaveOptions` | `void` | |
| `sync_admit` | `classId, deviceId` | `void` | `NOT_FOUND` (no pending request), `PERMISSION_DENIED` (the offer is not pending, sync spec §9.5) |
| `sync_decline` | `classId, deviceId` | `void` | |
| `sync_normalize_ids` | `ids: string[]` | `(DeviceId \| null)[]` | `SYNC_UNAVAILABLE` |
| `sync_own_addresses` | — | `string[]` | |
| `sync_file_info` | `classId, paths: string[]` (≤ 500) | `FileSyncInfo[]` | |
| `sync_wait_available` | `classId, path, minDevices: number, timeoutMs: number` | `boolean` | |
| `sync_wait_caught_up` | `classId, timeoutMs: number` | `CaughtUp` | |
| `sync_device_stats` | — | `Record<DeviceId, DeviceStat>` | |
| `sync_folder_status` | `classId` | `FolderView` | |
| `sync_versions` | `classId` | `VersionEntry[]` | |
| `sync_restore` | `classId, items: RestoreItem[]` | `void` | `NOT_FOUND` |
| `sync_folder_errors` | `classId` | `FolderError[]` | |
| `sync_pause_class` | `classId, paused: boolean` | `void` | |
| `sync_mass_delete_resolve` | `classId, action: 'restore' \| 'confirm'` | `void` | — (sync spec §22.2: restore = reset + respawn + unpause) |
| `sync_scan` | `classId, path?: string` | `void` | |
| `sync_diagnostics` | — | `SyncDiagnostics` | |
| `sync_existing` | — | `ExistingSyncthing` | |

Events: global `sync:event` (§7). Stop happens on quit and inside `sync_restart`. Not in 0.1 (§1.1):
`sync_rotate_class`, `sync_accept_rotation`, `sync_relocate`, pairing commands. Removed for security (sync spec §9.5):
`sync_global_policy_set`, `sync_add_device`, `sync_share_with_device` (devices are added only inside a join from a
decoded code, by admission, or by Rust's own pairing run).

### 6.8 Speech — `commands/speech.rs` (R-SPEECH → `tramado-speech`)

| Command | Args | Returns | Other errors | Channel |
|---|---|---|---|---|
| `speech_info` | — | `SpeechInfo` | | |
| `speech_models` | — | `ModelState[]` | | |
| `speech_model_download` | `modelId: ModelId, onEvent` | `void` | `JOB_BUSY`, `DISK_FULL`, `SPEECH_UNSUPPORTED_CPU` | `ModelEvent` |
| `speech_model_attach` | `modelId, onEvent` | `boolean` | | `ModelEvent` |
| `speech_model_cancel` | `modelId` | `void` (keeps `.part`) | | |
| `speech_model_delete` | `modelId` | `void` | `JOB_BUSY` (in use) | |
| `speech_model_import` | `modelId, pick: PickToken` | `ModelState` | `MODEL_INTEGRITY` | |
| `speech_devices` | — | `AudioDevices` | | |
| `speech_meter_start` | `req: MeterRequest, onEvent` | `void` | `JOB_BUSY` (recording), `SPEECH_NO_DEVICE`, `SPEECH_PERMISSION` | `MeterEvent` (10 Hz; no journal) |
| `speech_meter_stop` | — | `void` | | |
| `speech_recorder_start` | `req: RecorderStartRequest, onEvent` | `RecorderStatus` | `JOB_BUSY`, `SPEECH_NO_DEVICE`, `SPEECH_PERMISSION`, `SPEECH_NO_SYSTEM_AUDIO`, `DISK_FULL` | `RecorderEvent` (10 Hz status) |
| `speech_recorder_attach` | `onEvent` | `RecorderStatus \| null` | | `RecorderEvent` |
| `speech_recorder_pause` | — | `RecorderStatus` | `NOT_FOUND` | |
| `speech_recorder_resume` | — | `RecorderStatus` | `NOT_FOUND` | |
| `speech_recorder_mark` | `m: { kind: MarkerKind, note?: string }` | `Marker` | `NOT_FOUND` | |
| `speech_recorder_stop` | — | `FinishedRecording` | `NOT_FOUND` | |
| `speech_recordings_pending` | — | `FinishedRecording[]` | | |
| `speech_recording_publish` | `req: PublishRequest` | `PublishedAudio` | `CONFLICT`, `DISK_FULL` | |
| `speech_recording_discard` | `recordingId` | `void` | | |
| `speech_import_audio` | `req: ImportAudioRequest, onEvent` | `void` | `SPEECH_UNSUPPORTED_AUDIO`, `UNSUPPORTED_FILE` | `ImportEvent` |
| `speech_import_attach` | `recordingId, onEvent` | `boolean` | | `ImportEvent` |
| `speech_transcribe_start` | `req: TranscribeRequest, onEvent` | `string` (jobId) | `JOB_BUSY`, `MODEL_NOT_DOWNLOADED`, `MODEL_UNREADABLE`, `SPEECH_UNSUPPORTED_CPU`, `AI_NO_KEY`, `CONFLICT` (sha mismatch) | `TranscribeEvent` |
| `speech_transcribe_attach` | `jobId, onEvent` | `JobSummary \| null` | | `TranscribeEvent` |
| `speech_transcribe_cancel` | `jobId, keepPartial: boolean` | `void` | | |
| `speech_jobs` | — | `JobSummary[]` | | |
| `speech_transcribe_take` | `jobId` | `TranscriptionResult` | `NOT_FOUND` | |
| `speech_peaks` | `req: { source: AudioSource, buckets: number }` (100–4000) | `number[]` (0–255) | `SPEECH_UNSUPPORTED_AUDIO` | |

---

## 7. Events and channels

### 7.1 Global events (`app.emit`; JS `listen` from `@tauri-apps/api/event`)

| Event | Payload (TS) | Emitted by |
|---|---|---|
| `class:changed` | `ClassChangedEvent { classId, paths: string[], selfWrite: boolean, rescan: boolean }` | `base::watch` via desktop (debounced 300 ms; `rescan` = re-list everything) |
| `sync:event` | `SyncEvent` (below) | `tramado-sync` sink |
| `app:deep-link` | `{ url: string; text?: string }` (`tramado://join/…`; `tramado://pair/…` in v1.1; `url: 'file:'` + `text` for an opened `.tramado-invite`) | `deeplink.rs` |
| `app:shortcut` | `{ id: 'marker'; kind: MarkerKind }` | `system.rs` |
| `app:tray` | `{ action: 'open' \| 'pause-sharing' \| 'resume-sharing' \| 'quit' }` | `tray.rs` |
| `app:drop` | `{ picked: Picked[], x: number, y: number }` — files dropped on the window, registered as pick tokens (D-4) | `window.rs` (`WindowEvent::DragDrop`) |

```ts
export type SyncEvent =
  | { type: 'status'; status: SyncStatus }
  | { type: 'gap' }                                                    // events were dropped: re-read sync_snapshot
  | { type: 'remoteChange'; classId: ClassId; path: ClassPath; action: 'modified' | 'deleted';
      modifiedBy: ShortId }                                             // RemoteChangeDetected, type == file only (loop B);
                                                                        // a trigger to re-judge the path, never a verdict (§12)
  | { type: 'folder'; folder: FolderView }                              // FolderSummary / StateChanged / paused / resumed
  | { type: 'completion'; classId: ClassId; deviceId: DeviceId; completion: number; needItems: number;
      remoteState: RemoteState }                                        // FolderCompletion
  | { type: 'indexUpdated'; classId: ClassId; remote: boolean }         // Local/RemoteIndexUpdated (delivery ticks)
  | { type: 'connection'; deviceId: DeviceId; connected: boolean; relay: boolean; address: string | null }
  | { type: 'joinRequest'; request: JoinRequestView }                   // ask-before-admit queue (§9.3)
  | { type: 'joinRequestGone'; classId: ClassId; deviceId: DeviceId }
  | { type: 'admitted'; classId: ClassId; deviceId: DeviceId; name: string }   // this device shared the folder with a joiner
  | { type: 'admittedMe'; classId: ClassId; byDevice: DeviceId }       // joiner side: remoteState valid (§8)
  | { type: 'folderOffer'; offer: FolderOfferView }                     // unknown tramado-* folder offered
  | { type: 'foreignWrite'; classId: ClassId; path: ClassPath; modifiedBy: ShortId; healed: boolean }
  | { type: 'massDelete'; classId: ClassId; count: number; sample: ClassPath[] }   // local guard; folder already paused
  | { type: 'massDeleteRemote'; classId: ClassId; by: ShortId; count: number; sample: ClassPath[] }   // receiving guard
  | { type: 'folderErrors'; classId: ClassId; errors: FolderError[] }
  | { type: 'markerMissing'; classId: ClassId }
  | { type: 'listenAddresses'; addresses: string[] };                  // ListenAddressesChanged (member file refresh)
```

### 7.2 Channels (one per job; every union is tagged by `type`)

```ts
export type AiWireEvent =
  | { type: 'head'; status: number; headers: Record<string, string> }
  | { type: 'line'; line: string }
  | { type: 'body'; text: string }
  | { type: 'end' }
  | { type: 'fail'; code: ErrorCode; message: string; data?: Record<string, unknown> };

export type ModelEvent =
  | { type: 'started'; total: number; resumedFrom: number }
  | { type: 'progress'; done: number; total: number; bytesPerSec: number }      // ≤ 4 Hz
  | { type: 'verifying' }
  | { type: 'done'; model: ModelState }
  | { type: 'failed'; code: ErrorCode; message: string }
  | { type: 'cancelled' };

export type RecorderEvent =
  | { type: 'status'; status: RecorderStatus }                                  // 10 Hz
  | { type: 'warning'; code: 'silentMic' | 'lowDisk' | 'lowBattery' | 'deviceLost' }
  | { type: 'marker'; marker: Marker }                                          // also from the global shortcut
  | { type: 'stopped'; reason: 'user' | 'error' | 'diskFull'; code?: ErrorCode };

export type TranscribeEvent =
  | { type: 'phase'; phase: 'checking' | 'decoding' | 'vad' | 'transcribing' | 'uploading' }
  | { type: 'progress'; progress: number; etaMs: number | null }               // ≤ 1 Hz; also written to the claim
  | { type: 'done'; summary: JobSummary }                                      // result ready: speech_transcribe_take
  | { type: 'failed'; code: ErrorCode; message: string }
  | { type: 'cancelled' };

export type ImportEvent =
  | { type: 'progress'; done: number }                                          // 0..1
  | { type: 'done'; audio: PublishedAudio }
  | { type: 'failed'; code: ErrorCode; message: string };

export type MeterEvent = { type: 'level'; mic: TrackLevel | null; system: TrackLevel | null };   // 10 Hz
```

A channel whose webview went away makes `Channel::send` fail; the job continues and the next `*_attach` replaces the
channel (D-7).

---

## 8. Media scheme `tramado-media`

Registered with `register_asynchronous_uri_scheme_protocol("tramado-media", media::handle)` (critique C10, D21).

| Platform | Base URL (from `AppInfo.mediaBase`) |
|---|---|
| Linux, macOS | `tramado-media://localhost` |
| Windows | `http://tramado-media.localhost` |

Paths (every segment percent-encoded with `encodeURIComponent`):

| URL path | Serves | Confinement |
|---|---|---|
| `/c/<classId>/<class path segments…>` | a file inside a registered class | `ClassFs` confine + symlink refusal |
| `/r/<recordingId>.webm` | a local-only recording (`data/recordings/<id>.webm`, "Transcript only", D54) | ULID check |
| `/res/selftest.webm` | bundled 300 s media self-test file (critique R3) | resource dir |

Response rules: `GET` and `HEAD` only (`OPTIONS` → 204 with CORS headers); single `Range: bytes=a-b` →
`206` + `Content-Range`; unsatisfiable → `416`; no Range → `200`; always `Accept-Ranges: bytes`,
`Content-Length`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; `Access-Control-Allow-Origin` echoes
the request `Origin` only if it is `tauri://localhost` or `http://tauri.localhost`, plus
`Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length`. MIME is chosen by extension
(never sniffed): `webm`→`audio/webm`, `ogg|oga|opus`→`audio/ogg`, `mp3`→`audio/mpeg`, `m4a`→`audio/mp4`,
`wav`→`audio/wav`, `flac`→`audio/flac`, `mp4`→`video/mp4`, `pdf`→`application/pdf`, `png`, `jpg|jpeg`, `gif`,
`webp`, `svg`→`image/svg+xml` (with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`),
`txt|md|vtt`→`text/plain; charset=utf-8`, else `application/octet-stream` with
`Content-Disposition: attachment`. Errors: 404 (not found / not confined), 403 (symlink), 405 (method).
The Range logic is a pure function in `tramado_base::media` with unit tests (copying the behaviour of Tauri's
`protocol/asset.rs`).

Blob fallback (D21): when `<audio>` fires `MEDIA_ERR_SRC_NOT_SUPPORTED` for a scheme URL, the player reads the bytes
with `class_read` and plays a `blob:` URL; the media self-test (Settings → Help → Diagnostics) plays
`/res/selftest.webm`, seeks to 252 000 ms and checks `|currentTime − 252| ≤ 0.25` and `duration ≈ 300`.

---

## 9. The TypeScript `Platform` interface (the device boundary)

`app/src/platform/types/` holds one file per domain plus `index.ts` with `Platform`. These files are the TS side of
§6–§7: a field added here MUST be added to the Rust twin in the same change. Identifier types come from
`core/model/ids.ts` (plain `string` aliases plus validators; no branded types).

```ts
// ───────────────────────────── platform/types/common.ts ─────────────────────────────
import type { ClassId, ClassPath, DeviceId, ShortId, MemberId, Ulid, Hex64, Instant, EpochMs, Lang } from '../../core/model/ids';
import type { ClaimFile } from '../../core/model/files';
import type { ErrorCode } from '../../core/errors';
export type Unsubscribe = () => void;
export type PickToken = string;                       // opaque, 32 hex chars, valid until quit (D-4)
export interface ConfirmText { title: string; message: string; confirm: string; cancel: string }   // message may contain {host}
export interface FileFilter { name: string; extensions: string[] }  // extensions without the dot

// ───────────────────────────── platform/types/app.ts ─────────────────────────────
export interface AppInfo {
  version: string;
  os: 'linux' | 'macos' | 'windows' | 'web';
  arch: string;
  webview: string | null;                  // e.g. "WebKitGTK 2.52.6"; null in the demo
  devIsolated: boolean;                    // TRAMADO_DATA_DIR set (dev / e2e)
  e2e: boolean;                            // TRAMADO_E2E=1
  startedHidden: boolean;                  // launched by autostart with --hidden
  mediaBase: string;                       // 'tramado-media://localhost' | 'http://tramado-media.localhost' | 'blob:' (demo)
  paths: { config: string; data: string; cache: string };   // display only (Storage, diagnostics)
}
export type AppFileName = 'prefs.json' | 'identity.json' | 'hlc.json';
export type CacheKey = string;   // ^(text/[0-9a-f]{64}\.json|peaks/[0-9a-f]{64}-\d{2,5}\.json|models-catalog\.json|ocr/[0-9a-f]{64}\.json)$
export interface Power { source: 'ac' | 'battery' | 'unknown'; percent: number | null }
export interface RustDiagnostics {
  app: { version: string; os: string; arch: string; webview: string | null; cpu: { avx2: boolean; fma: boolean; f16c: boolean } };
  sync: SyncDiagnostics | null;
  speech: { cpuOk: boolean; models: ModelState[]; vad: boolean };
  ai: { lastCodes: Array<{ at: Instant; code: ErrorCode }> };             // last 20, no content
  logTail: string[];                                                       // app.log, device IDs truncated to ShortId
}
export type TrayAction = 'open' | 'pause-sharing' | 'resume-sharing' | 'quit';
export interface PersonInfo { memberId: MemberId; pub: string }                 // base64url public key (folder spec §8.3.1)
export interface PersonProof { pub: string; sig: string }
export interface StorageUsage {
  classes: Array<{ classId: ClassId; total: number; audio: number; trash: number }>;   // bytes; trash = <root>/.stversions
  models: number; cache: number; privateData: number;
}

// ───────────────────────────── platform/types/classes.ts ─────────────────────────────
export interface ClassEntry {
  classId: ClassId; path: string; dirName: string;
  shared: boolean; joining: boolean; archived: boolean; skipAudio: boolean;
  aliases: ClassId[]; localIgnores: ClassPath[] /* class paths; Rust emits "(?d)/" + path */; addedAt: Instant;
  leaving: { since: Instant; afterwards: 'keepLocal' | 'trash' } | null;   // sync spec §17 (hidden from the UI)
  available: boolean;                      // root and .tramado/class.json present (false → the folder-missing card)
}
export interface AdoptedClass { entry: ClassEntry; foreignMembers: boolean }   // true → TS forks it (sync spec §17)
export interface ClassesRoot { path: string; names: string[] }
export interface CreatedClass { entry: ClassEntry; warnings: Array<'cloudFolder'> }
export interface ClassFileEntry { path: ClassPath; name: string; isDir: boolean; size: number; mtimeMs: number; conflictOf: ClassPath | null }
export interface FileStamp { path: ClassPath; size: number; mtimeMs: number; sha256: Hex64 | null }
export interface ClassChangedEvent { classId: ClassId; paths: ClassPath[]; selfWrite: boolean; rescan: boolean }
export interface Picked { token: PickToken; name: string; path: string; size: number | null; isDir: boolean }

// ───────────────────────────── platform/types/ai.ts ─────────────────────────────
export type SecretName = 'openrouter' | `host:${string}`;
export interface SecretStatus { set: boolean; last4: string | null; store: 'keychain' | 'file' | 'memory' }   // 'memory': demo only (no Rust twin value)
export type PrivacyLevel = 'standard' | 'no-training' | 'zdr';
export interface AiHost { id: string; base: string; label: string }
export type AiPath = 'chat/completions' | 'embeddings' | 'key' | 'models' | `models/${string}/endpoints`;   // audio: Rust-internal (D-12)
export type AiBase = { type: 'openrouter' } | { type: 'host'; hostId: string };
export type AiAction = 'ask' | 'chat' | 'explain' | 'summary' | 'terms' | 'annotate' | 'studyNotes' | 'examExtract' | 'examOcr'
  | 'examAnswer' | 'hint' | 'deep' | 'title' | 'describe' | 'docOcr' | 'cloudSpeech' | 'keyCheck' | 'catalog';
export interface AiPipeRequest {
  requestId: string;                                   // uuid; used by ai_cancel
  base: AiBase;
  method: 'GET' | 'POST';
  path: AiPath;
  body?: unknown;                                      // JSON; `provider` and `user` are rewritten by Rust
  stream: boolean;
  privacyOverride?: 'standard';                        // per-request relaxation, native confirmation (D-10)
  overrideText?: ConfirmText;
  busyFallback?: boolean;                              // the busy chooser's NVIDIA fallback; no dialog when busyRelax is on
  activity?: { classId: ClassId | null; action: AiAction; passages: number };   // for the activity log (no content)
}
export type AiWireEvent =
  | { type: 'head'; status: number; headers: Record<string, string> }
  | { type: 'line'; line: string }
  | { type: 'body'; text: string }
  | { type: 'end' }
  | { type: 'fail'; code: ErrorCode; message: string; data?: Record<string, unknown> };
export interface AiActivityEntry {   // one entry per request; the UI groups them per action
  at: Instant; host: string; path: string; model: string | null; status: number | null; code: ErrorCode | null;
  ms: number; bytesOut: number; bytesIn: number; privacy: PrivacyLevel | 'custom-host';
  classId: ClassId | null; action: AiAction | null; passages: number;
}

// ───────────────────────────── platform/types/sync.ts ─────────────────────────────
export type SyncState = 'stopped' | 'starting' | 'running' | 'restarting' | 'error';
export interface SyncIdentity { deviceId: DeviceId; shortId: ShortId; syncPort: number }
export interface SyncStatus {
  state: SyncState; deviceId: DeviceId | null; version: string | null; syncPort: number | null;
  localOnly: boolean; paused: boolean; startedAt: Instant | null; restarts: number; error: ErrorCode | null;
}
export type FolderState = 'idle' | 'scanning' | 'syncing' | 'sync-preparing' | 'sync-waiting' | 'scan-waiting' | 'error' | 'paused' | 'unknown';
export type RemoteState = 'valid' | 'notSharing' | 'paused' | 'unknown';
export interface FolderView {
  classId: ClassId; label: string; path: string; paused: boolean; state: FolderState;
  globalFiles: number; inSyncFiles: number; needFiles: number; needBytes: number; pullErrors: number; error: string | null;
  devices: DeviceId[];
  completion: Record<DeviceId, { completion: number; needItems: number; remoteState: RemoteState }>;
}
export interface DeviceView {
  deviceId: DeviceId; name: string; connected: boolean; relay: boolean; address: string | null; paused: boolean;
  lastSeen: Instant | null; folders: ClassId[]; provisional: boolean; ignored: boolean;
}
export interface JoinRequestView { classId: ClassId; deviceId: DeviceId; name: string; address: string; at: Instant }
export interface FolderOfferView { folderId: ClassId; label: string; offeredBy: DeviceId; offeredByName: string; at: Instant }
export interface ExistingSyncthing { running: boolean; configFound: boolean }
export interface SyncSnapshot {
  status: SyncStatus; folders: FolderView[]; devices: DeviceView[];
  joinRequests: JoinRequestView[]; folderOffers: FolderOfferView[]; existing: ExistingSyncthing;
}
export interface SyncSettings { localOnly: boolean; paused: boolean; maxSendKbps: number; maxRecvKbps: number;
  deviceName: string }   // "<person> (<computer>)", announced only while a class is joining; otherwise "Tramado" (sync spec §9.4)
export interface RosterDevice { deviceId: DeviceId; memberId: MemberId; name: string; deviceName: string; addresses: string[] }
export interface ClassPolicy {
  classId: ClassId; label: string;             // label = effective meta name (Syncthing folder label)
  askBeforeAdmit: boolean;                     // effective, organiser-filtered (folder spec §8.2)
  roster: RosterDevice[];                      // devices with a TRUSTED member file (sync spec §10)
  knownDevices: DeviceId[];                    // devices with a trusted member file whose person proof verifies (sync spec §9.2 known_member)
  bannedDevices: DeviceId[];                   // effective bans expanded to devices (§18.1)
  updatedAt: Instant;
}
export interface GlobalPolicy { ownDevices: DeviceId[]; pairingOpenUntil: EpochMs | null }   // Rust state (v1.1 pairing); TS uses it in decide() vectors only
export interface DeviceSpec { deviceId: DeviceId; name: string; addresses: string[] }       // decoded invite device (InvitePreview)
export interface JoinRequest {
  code: string;                                                // the invite code text; Rust decodes and validates it (sync spec §8, §9.5)
  dirName: string;                                             // sanitize(invite label) made unique by TS (folder spec §5.4)
  parent?: PickToken;                                          // default: classes root
  includeAudio: boolean;                                       // false → "(?d)/**/audio.webm" + skipAudio
}
export interface AcceptFolderRequest { folderId: ClassId; offeredBy: DeviceId; label: string; dirName: string; parent?: PickToken; includeAudio: boolean }   // devices [me, offeredBy]
export interface LeaveOptions { afterwards: 'keepLocal' | 'trash' }   // sync spec §17; keepLocal = forked local class
export interface Sig { cert: string; value: string }               // folder spec §6.6
export type MassDeleteAction = 'restore' | 'confirm';
export interface FileSyncInfo {
  path: ClassPath; localModifiedBy: ShortId | null; localDeleted: boolean; localSize: number | null;
  localBlocksHash: string | null; localModified: Instant | null; localVersion: string[]; localSequence: number | null;
  globalModifiedBy: ShortId | null; globalDeleted: boolean;
  availability: DeviceId[];                                    // entries with fromTemporary == false only; never this device
}
export interface CaughtUp { complete: boolean; waitedMs: number; pending: DeviceId[] }
export interface DeviceStat { lastSeen: Instant | null; lastConnectionDurationS: number }
export interface VersionEntry { path: ClassPath; versionTime: Instant; modTime: Instant; size: number }
export interface RestoreItem { path: ClassPath; versionTime: Instant }
export interface FolderError { path: ClassPath; error: string }
export interface SyncDiagnostics {
  status: SyncStatus; ports: { sync: number | null; guiOpen: boolean }; listeners: Record<string, string | null>;
  connections: number; relayed: number; lastErrors: Array<{ when: Instant; message: string }>; logTail: string[];
}
// SyncEvent: the union of §7.1, copied verbatim into this file.

// ───────────────────────────── platform/types/speech.ts ─────────────────────────────
export type ModelId = 'turbo' | 'small' | 'large-v3';
export interface ModelState {
  id: ModelId; file: string; size: number; sha256: Hex64; tier: 'default' | 'draft' | 'advanced'; recommended: boolean;
  state: 'absent' | 'partial' | 'downloading' | 'verifying' | 'ready' | 'failed'; bytes: number; error: ErrorCode | null;
  speedRT: number | null;                   // × real time measured by the last local job (member file caps.localModel.speedRT)
}
export interface SpeechInfo {
  cpuOk: boolean; localWhisper: boolean; vad: boolean; engineVersion: string;   // "whisper.cpp 1.8.3"
  defaultModel: ModelId; models: ModelState[];
  systemAudio: { supported: boolean; reason: ErrorCode | null };
  recorder: RecorderStatus | null; jobs: JobSummary[];
}
export interface AudioDevices { inputs: Array<{ id: string; name: string; isDefault: boolean }>; systemAudio: { supported: boolean; reason: ErrorCode | null } }
// MarkerKind = 'important' | 'confused' | 'exam' | 'todo' | 'note' — imported from core/model/files.ts (§1.2), not redeclared
export interface Marker { id: Ulid; atMs: number; rawMs: number; kind: MarkerKind; note?: string }
export interface MeterRequest { inputDeviceId: string | null; mode: 'room' | 'online' }
export interface RecorderStartRequest {
  recordingId: Ulid;                        // becomes the lecture id (draftId in presence)
  classId: ClassId; title: string; mode: 'room' | 'online'; includeMic: boolean;
  inputDeviceId: string | null; language: Lang | 'auto'; bitrate: 16000 | 24000 | 32000;
  markerOffsetMs: number;                   // reflex offset, default 3000 (at = raw − offset)
}
export interface TrackLevel { peak: number; rmsDb: number; clipping: boolean; device: string | null; error: ErrorCode | null; silentForMs: number }
export interface RecorderStatus {
  recordingId: Ulid; classId: ClassId; state: 'recording' | 'paused' | 'stopping'; ms: number;
  tracks: { mic: TrackLevel | null; system: TrackLevel | null }; bytesWritten: number; diskFree: number | null; markers: number;
}
export interface FinishedRecording {
  recordingId: Ulid; classId: ClassId; title: string; mode: 'room' | 'online'; language: Lang | 'auto';
  startedAt: Instant; durationMs: number; channels: 1 | 2; bitrate: number;
  speakers: Array<{ index: number; speaker: 'lecture' | 'me' | 'class' }>;
  pauses: Array<{ atMs: number; wallFrom: Instant; wallTo: Instant }>;
  markers: Marker[]; state: 'stopped' | 'recovered'; recoveredLostMs: number | null;
}
export type AudioSource = { kind: 'class'; classId: ClassId; path: ClassPath } | { kind: 'private'; recordingId: Ulid };
export type ShareMode = 'audio+transcript' | 'transcript-only' | 'none';
export interface PublishRequest { recordingId: Ulid; classId: ClassId; lectureDir: ClassPath; share: ShareMode }
  // 'transcript-only': the WebM stays at data/recordings/<id>.webm (AudioSource private) and lecture.json has audio.shared:false;
  // 'none': nothing is written to the class; the recording stays in speech_recordings_pending until a share mode is chosen
export interface PublishedAudio { source: AudioSource; size: number; sha256: Hex64; durationMs: number; channels: 1 | 2; bitrate: number; sampleRate: 16000 }
export interface ImportAudioRequest { recordingId: Ulid; pick: PickToken; classId: ClassId; lectureDir: ClassPath; keepVideo: boolean }
export interface TranscribeRequest {
  jobId: string; lectureId: Ulid; source: AudioSource; expectSha256: Hex64;
  engine: { kind: 'local'; model: ModelId } | { kind: 'cloud'; model: string };   // Rust TranscribeEngine, tag "kind"
  language: Lang | 'auto'; channels: 'mix' | 'split';
  initialPrompt: string | null;                                          // class vocabulary (meta `vocabulary`, ≤ 500 chars)
  claim: { classId: ClassId; path: ClassPath; file: ClaimFile } | null;   // Rust rewrites it every 60 s (heartbeat+1, progress, etaMs, updatedAt)
  resume: boolean;                                                       // continue from data/transcribe/<lectureId>.partial.json
}
export interface JobSummary {
  jobId: string; lectureId: Ulid; state: 'running' | 'done' | 'failed' | 'cancelled';
  progress: number; etaMs: number | null; startedAt: Instant; error: ErrorCode | null; resultReady: boolean;
}
export interface TranscriptionResult {
  lectureId: Ulid; durationMs: number; language: string;
  engine: { kind: 'local' | 'cloud'; name: string; version?: string; model?: string; modelSha256?: Hex64; vad?: string };
  tracks: Array<{ speaker: 'lecture' | 'me' | 'class'; segments: Array<{ startMs: number; endMs: number; text: string;
                  words?: Array<{ startMs: number; endMs: number; text: string; p: number }> }> }>;
}
// ModelEvent, RecorderEvent, TranscribeEvent, ImportEvent, MeterEvent: exactly as in architecture §7.2

// ───────────────────────────── platform/types/index.ts ─────────────────────────────
export interface Platform {
  readonly kind: 'desktop' | 'demo' | 'test';
  info(): Promise<AppInfo>;
  log(level: 'error' | 'warn' | 'info', message: string, data?: object): void;   // fire-and-forget

  appFiles: {
    read(name: AppFileName): Promise<string | null>;
    write(name: AppFileName, text: string): Promise<void>;                          // atomic
  };
  privateFiles: {                                                                    // data/private/<classId>/ (never synced)
    read(classId: ClassId, path: string): Promise<Uint8Array | null>;
    write(classId: ClassId, path: string, bytes: Uint8Array): Promise<void>;
    append(classId: ClassId, path: string, line: Uint8Array): Promise<number>;
    list(classId: ClassId, dir: string): Promise<string[]>;
    remove(classId: ClassId, path: string, recursive?: boolean): Promise<void>;
    purge(classId: ClassId): Promise<void>;
  };
  cache: {
    read(key: CacheKey): Promise<Uint8Array | null>;
    write(key: CacheKey, bytes: Uint8Array): Promise<void>;
    remove(key: CacheKey): Promise<void>;
    clear(): Promise<void>;
  };
  person: {                                                                         // folder spec §8.3.1
    init(): Promise<PersonInfo>;
    prove(classId: ClassId): Promise<PersonProof>;
  };
  storage: {
    usage(): Promise<StorageUsage>;
    reveal(which: 'classesRoot' | 'private' | 'models' | 'cache', classId?: ClassId): Promise<void>;
  };

  classes: {                                                                         // registry (config/classes.json)
    list(): Promise<ClassEntry[]>;
    root(): Promise<ClassesRoot>;
    setRoot(pick: PickToken): Promise<ClassesRoot>;
    create(req: { classId: ClassId; dirName: string; parent?: PickToken }): Promise<CreatedClass>;
    adopt(pick: PickToken): Promise<AdoptedClass>;
    fork(classId: ClassId, newClassId: ClassId): Promise<ClassEntry>;
    update(classId: ClassId, patch: { archived?: boolean; skipAudio?: boolean; localIgnores?: ClassPath[] }): Promise<ClassEntry>;
    forget(classId: ClassId): Promise<void>;
    trash(classId: ClassId): Promise<void>;
    emptyTrash(classId: ClassId): Promise<void>;
    reveal(classId: ClassId, path?: ClassPath): Promise<void>;
    open(classId: ClassId, path: ClassPath): Promise<void>;
  };
  fs: {                                                                              // inside one registered class, confined
    list(classId: ClassId, dir: ClassPath | '', opts: { recursive: boolean; maxDepth?: number; includeTramado?: boolean }): Promise<ClassFileEntry[]>;
    stat(classId: ClassId, path: ClassPath): Promise<ClassFileEntry | null>;
    read(classId: ClassId, path: ClassPath): Promise<Uint8Array>;
    readRange(classId: ClassId, path: ClassPath, offset: number, length: number): Promise<Uint8Array>;
    write(classId: ClassId, path: ClassPath, bytes: Uint8Array, opts: { own: boolean }): Promise<FileStamp>;
    append(classId: ClassId, path: ClassPath, line: Uint8Array, opts: { own: boolean }): Promise<FileStamp>;
    mkdir(classId: ClassId, path: ClassPath): Promise<void>;
    move(classId: ClassId, from: ClassPath, to: ClassPath): Promise<void>;
    remove(classId: ClassId, path: ClassPath, opts?: { recursive?: boolean }): Promise<void>;
    hash(classId: ClassId, path: ClassPath): Promise<Hex64>;
    importFile(classId: ClassId, pick: PickToken, dest: ClassPath): Promise<FileStamp>;
    exportFile(classId: ClassId, path: ClassPath, pick: PickToken): Promise<void>;
  };
  dialogs: {
    pickFiles(req: { title: string; filters: FileFilter[]; multiple: boolean }): Promise<Picked[]>;
    pickFolder(req: { title: string }): Promise<Picked | null>;
    save(req: { title: string; defaultName: string; filters: FileFilter[] }): Promise<Picked | null>;
  };
  secrets: {
    set(name: SecretName, value: string): Promise<SecretStatus>;
    status(name: SecretName): Promise<SecretStatus>;
    clear(name: SecretName): Promise<void>;
  };
  ai: {
    send(req: AiPipeRequest, onEvent: (e: AiWireEvent) => void): Promise<void>;     // resolves when the worker started
    cancel(requestId: string): Promise<void>;
    hosts(): Promise<AiHost[]>;
    allowHost(base: string, text: ConfirmText): Promise<AiHost | null>;
    forgetHost(hostId: string): Promise<void>;
    privacy(): Promise<PrivacyLevel>;
    setPrivacy(level: PrivacyLevel, text: ConfirmText): Promise<boolean>;
    busyPolicy(): Promise<boolean>;
    setBusyPolicy(relax: boolean, text: ConfirmText): Promise<boolean>;
    activity(limit: number): Promise<AiActivityEntry[]>;
    clearActivity(): Promise<void>;
  };
  sync: {
    identity(): Promise<SyncIdentity>;
    resolveCopiedIdentity(action: 'new' | 'same'): Promise<SyncIdentity>;
    start(): Promise<SyncStatus>;
    restart(): Promise<SyncStatus>;
    status(): Promise<SyncStatus>;
    snapshot(): Promise<SyncSnapshot>;
    applySettings(s: SyncSettings): Promise<void>;
    setPolicy(p: ClassPolicy): Promise<void>;
    sign(classId: ClassId, path: ClassPath, canonical: Uint8Array): Promise<Sig>;   // folder spec §6.6, sync spec §12.4
    shareClass(classId: ClassId, label: string): Promise<ClassEntry>;
    joinClass(req: JoinRequest): Promise<ClassEntry>;
    cancelJoin(classId: ClassId): Promise<void>;
    acceptFolder(req: AcceptFolderRequest): Promise<ClassEntry>;
    leaveClass(classId: ClassId, opts: LeaveOptions): Promise<void>;
    admit(classId: ClassId, deviceId: DeviceId): Promise<void>;
    decline(classId: ClassId, deviceId: DeviceId): Promise<void>;
    resolveMassDelete(classId: ClassId, action: MassDeleteAction): Promise<void>;
    normalizeIds(ids: string[]): Promise<Array<DeviceId | null>>;
    ownAddresses(): Promise<string[]>;
    fileInfo(classId: ClassId, paths: ClassPath[]): Promise<FileSyncInfo[]>;
    waitAvailable(classId: ClassId, path: ClassPath, minDevices: number, timeoutMs: number): Promise<boolean>;
    waitCaughtUp(classId: ClassId, timeoutMs: number): Promise<CaughtUp>;
    deviceStats(): Promise<Record<DeviceId, DeviceStat>>;
    folderStatus(classId: ClassId): Promise<FolderView>;
    versions(classId: ClassId): Promise<VersionEntry[]>;
    restore(classId: ClassId, items: RestoreItem[]): Promise<void>;
    folderErrors(classId: ClassId): Promise<FolderError[]>;
    pauseClass(classId: ClassId, paused: boolean): Promise<void>;
    scan(classId: ClassId, path?: ClassPath): Promise<void>;
    diagnostics(): Promise<SyncDiagnostics>;
    existing(): Promise<ExistingSyncthing>;
  };
  speech?: {                                                                         // absent in the demo unless ?speech=fake
    info(): Promise<SpeechInfo>;
    models(): Promise<ModelState[]>;
    downloadModel(id: ModelId, onEvent: (e: ModelEvent) => void): Promise<void>;
    attachModel(id: ModelId, onEvent: (e: ModelEvent) => void): Promise<boolean>;
    cancelModel(id: ModelId): Promise<void>;
    deleteModel(id: ModelId): Promise<void>;
    importModel(id: ModelId, pick: PickToken): Promise<ModelState>;
    devices(): Promise<AudioDevices>;
    meter: {                                                                        // live input level outside a recording
      start(req: MeterRequest, onEvent: (e: MeterEvent) => void): Promise<void>;
      stop(): Promise<void>;
    };
    recorder: {
      start(req: RecorderStartRequest, onEvent: (e: RecorderEvent) => void): Promise<RecorderStatus>;
      attach(onEvent: (e: RecorderEvent) => void): Promise<RecorderStatus | null>;
      pause(): Promise<RecorderStatus>;
      resume(): Promise<RecorderStatus>;
      mark(kind: MarkerKind, note?: string): Promise<Marker>;
      stop(): Promise<FinishedRecording>;
      pending(): Promise<FinishedRecording[]>;
      publish(req: PublishRequest): Promise<PublishedAudio>;
      discard(recordingId: Ulid): Promise<void>;
    };
    importAudio(req: ImportAudioRequest, onEvent: (e: ImportEvent) => void): Promise<void>;
    attachImport(recordingId: Ulid, onEvent: (e: ImportEvent) => void): Promise<boolean>;
    transcribe: {
      start(req: TranscribeRequest, onEvent: (e: TranscribeEvent) => void): Promise<string>;
      attach(jobId: string, onEvent: (e: TranscribeEvent) => void): Promise<JobSummary | null>;
      cancel(jobId: string, keepPartial: boolean): Promise<void>;
      jobs(): Promise<JobSummary[]>;
      take(jobId: string): Promise<TranscriptionResult>;
    };
    peaks(source: AudioSource, buckets: number): Promise<number[]>;
  };
  media: {
    url(source: AudioSource | { kind: 'file'; classId: ClassId; path: ClassPath } | { kind: 'selftest' }): string;   // pure (§8)
    blobUrl(classId: ClassId, path: ClassPath, mime: string): Promise<string>;      // fallback; caller revokes
  };
  notifications: { show(n: { title: string; body: string; tag?: string }): Promise<void> };
  window: {
    setTitle(title: string): Promise<void>;
    onCloseRequested(handler: () => Promise<'hide' | 'quit' | 'stay'>): Unsubscribe;   // one handler; Trama pattern
    show(): Promise<void>;
    hide(): Promise<void>;
    quit(): Promise<void>;
    setBackgroundMode(m: { trayOnClose: boolean; sharedClasses: number }): Promise<void>;
    setZoom(factor: 0.875 | 1 | 1.125 | 1.25 | 1.5): Promise<void>;   // getCurrentWebview().setZoom (capability §18.4); CSS zoom in the demo
    autostart: { get(): Promise<boolean>; set(enabled: boolean): Promise<void> };
  };
  system: {
    power(): Promise<Power>;
    openExternal(url: string, text: ConfirmText): Promise<boolean>;
    setMarkerShortcuts(accelerators: Partial<Record<'important' | 'confused' | 'exam' | 'todo', string>> | null): Promise<void>;
    takePendingLinks(): Promise<string[]>;
    diagnostics(): Promise<RustDiagnostics>;
  };
  events: {
    onClassChanged(cb: (e: ClassChangedEvent) => void): Unsubscribe;
    onSync(cb: (e: SyncEvent) => void): Unsubscribe;
    onDeepLink(cb: (e: { url: string; text?: string }) => void): Unsubscribe;
    onShortcut(cb: (e: { id: 'marker'; kind: MarkerKind }) => void): Unsubscribe;
    onTray(cb: (action: TrayAction) => void): Unsubscribe;
    onDrop(cb: (e: { picked: Picked[]; x: number; y: number }) => void): Unsubscribe;   // drag and drop (tokens, D-4)
  };
}
```

`PlatformError(code: ErrorCode, message?: string, data?: Record<string, unknown>)` lives in `core/errors.ts` and is
what every platform method throws (`toPlatformError` maps Rust `{code, message, data}` objects and Tauri's own
string errors, Trama pattern).

---

## 10. Platform implementations

| File | Purpose | Owner after M0 |
|---|---|---|
| `platform/tauri/index.ts` | `createTauriPlatform(): Platform`; `isTauri()`; `call<T>(cmd, args?, headers?)`, `toBytes`, `body`, header encoding (Trama) | R-SHELL |
| `platform/tauri/{app,classes,dialogs,ai,system,events,media}.ts` | bindings of §6.1–6.6 and §7.1 | R-SHELL |
| `platform/tauri/sync.ts` | bindings of §6.7 | R-SYNC |
| `platform/tauri/speech.ts` | bindings of §6.8 (Channel wiring: `new Channel<E>()`, `onmessage`) | R-SPEECH |
| `platform/memory/index.ts` | `createMemoryPlatform(opts): MemoryPlatform` assembling the parts below | M0 (frozen in wave 1) |
| `platform/memory/{app,files,classes,dialogs,secrets,media,window,system,events}.ts` | Map-backed implementations; `files.ts` enforces the same path rules (`core/model/paths.ts`) and emits `onClassChanged` after every write (selfWrite) | M0 |
| `platform/memory/ai.ts` | `createFakeAi()`: a fake transport that turns scripted answers into the **same wire events** Rust emits (`head`, `line` with real SSE `data:` JSON chunks, heartbeats, errors with real OpenRouter bodies) so `core/ai/sse.ts` and the classifier run unchanged; `?ai=real` in the demo uses `window.fetch` to OpenRouter with a session-only key (CORS `*`) | T-AI |
| `platform/memory/speech.ts` | `createFakeSpeech()`: models (absent → downloading → ready via scripted `ModelEvent`s), recorder (synthetic levels, markers, `FinishedRecording`), publish (writes a tiny valid WebM fixture), transcription (scripted `TranscriptionResult`, progress steps, failure injection), peaks | T-LECTURES |
| `platform/memory/sync.ts` + `platform/memory/mesh.ts` | `createMemoryMesh(opts)`: N devices, each a `MemoryPlatform` whose `sync` is a simulated Syncthing (below). Single-device demo without `?sync=mesh`: identity only, every folder op succeeds locally | T-SYNC |

`MemoryPlatform` (M0 implements every hook; T-SYNC builds the mesh on them without editing the frozen files):
```ts
export interface MemoryPlatform extends Platform {
  mem: {
    deviceId: DeviceId;                         // a valid canonical ID derived from a generated Ed25519 "cert" (WebCrypto)
    signer: { cert: Uint8Array; sign(message: Uint8Array): Promise<Uint8Array> };   // backs sync.sign() (folder spec §6.6)
    onWrite(cb: (classId: ClassId, path: ClassPath, bytes: Uint8Array | null,
                 kind: 'write' | 'append' | 'remove' | 'move', from?: ClassPath) => void): Unsubscribe;
    applyRemote(classId: ClassId, path: ClassPath, bytes: Uint8Array | null,
                meta: { modifiedBy: ShortId; mtimeMs: number }): void;     // as Syncthing would: no onWrite echo, emits class:changed
    list(classId: ClassId): Map<ClassPath, { bytes: Uint8Array; mtimeMs: number; modifiedBy: ShortId }>;
    setSync(impl: Platform['sync']): void;      // the mesh installs its simulated Syncthing here
    emitSync(e: SyncEvent): void;
    emitClassChanged(e: ClassChangedEvent): void;
    addFile(classId: ClassId, path: ClassPath, bytes: Uint8Array): void;   // demo hook (DemoControls.files.addFile)
    queueDialog(a: DialogAnswer): void;
    setClock(c: Clock): void;
  };
}
export type DialogAnswer = { picks: Array<{ name: string; bytes: Uint8Array; isDir?: boolean }> } | { cancel: true };
```

**Memory mesh** (`createMemoryMesh`) — the multi-device test harness (D56, sync spec §24):
```ts
export interface MeshOptions { seed: number; clockSkewMs?: Record<string, number>; autoFlush?: boolean }
export interface MemoryMesh {
  device(name: string, opts?: { deviceId?: DeviceId; memberId?: MemberId }): MemoryPlatform;   // creates a device
  flush(): Promise<void>;              // propagate every pending change between connected devices sharing a folder (one round)
  settle(maxRounds?: number): Promise<void>;   // flush until quiescent
  partition(...groups: string[][]): void;      // devices in different groups cannot exchange
  heal(): void;
  crash(name: string): void; restart(name: string): MemoryPlatform;   // drop in-memory services, keep files
  advance(ms: number): Promise<void>;          // fake clocks (monotonic + wall, per-device skew)
  forge(by: string, owner: string, classId: ClassId, path: ClassPath, bytes: Uint8Array): void;  // foreign write (critique V3)
  files(name: string, classId: ClassId): Map<ClassPath, Uint8Array>;
}
```
Semantics: a folder exists on a device after `shareClass`/`joinClass`/`acceptFolder`; a joiner is admitted when any
connected member's last `ClassPolicy` and `core/sync/admission.decide()` say `share` (the same decision table as
Rust); `fileInfo` reports `localBlocksHash` computed by the same `blocksHash` as sync spec §12.1, and the mesh can
deliver an event before or after the bytes it describes (`opts.eventLag`); `flush` copies changed files (last write wins by version vector, conflicting concurrent writes create
`<base>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ShortId>.<ext>`), records `modifiedBy` per file, emits `remoteChange`
events with `modifiedBy`, `class:changed` events, `completion` and `indexUpdated`; `fileInfo` reports
`localModifiedBy`/`availability`; `waitCaughtUp` resolves when no connected peer needs items. Deletions propagate
as Syncthing does; trashcan versions are kept per device so `versions`/`restore` work.

---

## 11. TypeScript layers

Dependency rule (enforced by a Vitest test `src/layers.test.ts` that scans `import` statements):
`core` imports only `core`; `platform` imports `core` and `@tauri-apps/api`; `services` imports `core`, `platform/types`
and other `services`; `workers` import `core`; `ui` imports `core` (i18n, text) and React; `shell` and `features`
import everything except `platform/tauri` and `platform/memory` (only `main.tsx` and `demo/` choose a platform).
No DOM API in `core/` or `services/` (they run under Node in Vitest).

### 11.1 `core/` — pure, platform-free

| Path | Contents (key exports) | Origin | Owner |
|---|---|---|---|
| `core/errors.ts` | `ERROR_CODES` (as const, §15), `ErrorCode`, `PlatformError`, `toPlatformError(e)`, `errorData(e)` | new | M0 |
| `core/model/ids.ts` | `ClassId, DeviceId, ShortId, MemberId, Ulid, SegmentId, QuestionId, Hlc, Hex64, Hex40, Instant, LocalDateTime, EpochMs, ClassPath, ColourHex, IconName, Lang` (string aliases); `RE_*` regexes of folder spec §2; `isClassId(…)` etc.; `shortIdOf(d)`, `hlcNodeOf(d)` (lower-case ShortId), `dashless(d)`, `dashed(s)` | new | M0 |
| `core/model/files.ts` | every interface of folder spec §8 verbatim (`ClassFile, Reg, MetaFile, MemberFile, PresenceFile, ConsentLine, LectureFile, TranscriptFile, Segment, TranscriptEditLine, ClaimFile, MarkersFile, ExamFile, Question, ExamEditLine, AnswersFile, Answer, Citation, SourceRef, Locator, TextQuote, ChatLine` (union of the six), `MsgRef, AnnotationLine, ModLine, BansFile`) + `InviteV1`, `PairV1` (sync spec §7.1, §19) + private files (`IdentityFile`, `HlcFile`, `TrustCacheFile`, `PrivateMarkersFile`, `MarksFile`, `AskHistoryLine`) | spec | M0 |
| `core/model/formats.ts` | `FORMATS` table (folder spec §7.1), `KNOWN_VERSION`, `isNewer(format, version)`, `negotiate(format, rosterFormats[]): number` (§7.2) | spec | M0 |
| `core/model/parse.ts` | `parseRecord<F extends FormatName>(format, raw: unknown): Parsed<RecordOf<F>>` (`{ok, value, newer, unknown}`); `parseJsonl(bytes, from?)` → `{ lines: Array<{offset, length, value \| error}>, consumed }` (drops a trailing line without `\n`, lines > 65 536 B, unparseable lines); `mergeUnknown(prev, next)` (keeps unknown keys on rewrite, folder spec §4.3) | spec | M0 |
| `core/model/paths.ts` | `validateClassPath(p)` (shares `test-vectors/class-paths.json` with Rust), `classifyPath(p): PathInfo` (every machine path of folder spec §5.1 → `{kind, deviceId?, objectId?, month?}`; `lectureManifest`, `transcript*`, `audio`, `examManifest`, `conflictCopy`, `skipped`, `content`), `writerFromPath(p)`, `isSkippedName(name)`, `parseConflictName(name)` | spec | M0 |
| `core/model/sanitize.ts` | `sanitize(name, fallback)` and `unique(siblings, name)` exactly as folder spec §5.4; `lectureDirName(startedAt, title, tz)`; `fitClassPath(dir, name)` (≤ 200 UTF-16) | spec | M0 |
| `core/model/derive.ts` | `classIdOf(deviceId, nonce)`, `itemIdOf(ms, deviceId, nonce)`, `memberIdOf(pub)`, `newNonce(rand)` (folder spec §2.1; `test-vectors/ids.json`) | spec | M0 |
| `core/model/jcs.ts`, `core/model/sig.ts` | RFC 8785 canonical JSON; `deviceIdOfCert(der)` (SHA-256 → base32 + Luhn + dashes), `spkiKey(der)` (the 12-byte prefix rule), `verifySig(record, classId, path, writer)`, `verifyPersonProof(member, classId)` with WebCrypto Ed25519 (folder spec §6.6, §8.3.1) | spec | M0 |
| `core/model/legacy.ts` | `SyncPoint`, `LIMITS` shim so Trama's `core/import` compiles unchanged (trama-ts §9) | Trama | M0 |
| `core/model/time.ts` | `instant(ms)`, `parseRfc3339(s)` (`test-vectors/time.json`, same cases as Rust `tramado_base::time`) | new | M0 |
| `core/model/dirs.ts`, `limits.ts` | §5.2 table (`DIR_NAMES[lang]`), §4.6 limits | spec | M0 |
| `core/hlc.ts` | Trama `Hlc` verbatim + `observe` far-ahead guard (sync with folder spec §3.3–3.4, returns `'ahead'` instead of observing) + `toState()/fromState()` | Trama | M0 |
| `core/ids.ts` | `newUlid(nowMs, rand)` (random ULIDs: chat, edits, consent, answers, annotations), `newSegmentId(rand)`, `newQuestionId(rand)`, `base32Lower(bytes)`, `base62(n, rand)`; class, lecture, exam and member IDs come from `core/model/derive.ts` | new | M0 |
| `core/json.ts` | `manifestJson(v)` (2-space + `\n`), `compactJson(v)`, `jsonlLine(v)` (compact + `\n`, throws `INVALID` > 65 536 B) | new | M0 |
| `core/bytes.ts`, `core/util/{prng,result,debounce}.ts` | Trama bytes; mulberry32 PRNG; `Result<T>`; pure debounce helpers | Trama/new | M0 |
| `core/export/forgeZip.testutil.ts` | Trama's ZIP forger for import tests | Trama | M0 |
| `core/i18n/` | `translate.ts`, `languages.ts`, `catalogs.ts`, `catalogs.test.ts` (Trama verbatim) + `locales/{en,pt,es}/<namespace>.ts` (§14) | Trama | M0 + namespace owners |
| `core/text/` | `normalize.ts` (fold), `markdown.ts` → safe AST: no raw HTML, links `https:`/`mailto:` only, images only from the media scheme, inline nodes for `[S#]` citations and `<@member>` / `<@everyone>` / `<@ai>` tokens; `markdown.xss.test.ts` corpus (critique G27) | Trama + hardening | M0 copy, T-DOCS hardens |
| `core/import/` | Trama parsers (txt, md, docx, odt, rtf, html, pdf, vtt, srt, transcript text, detect, text, xml, entities; csv/xlsx/survey dropped) + new `pptx.ts` (slide order from `presentation.xml`, speaker notes), `pdfPages.ts` (`pageStarts`, `pageLabels`, `imagePages`), `headers.ts` (strip running header/footer lines present on ≥ 50 % of pages), `articles.ts` (article units), `units.ts` (`buildUnits(textCache): UnitSpan[]` with locators) | Trama + lab | M0 copy, T-DOCS adds |
| `core/search/` | from Trama `qda/` + lab: `text.ts`, `util.ts`, `rank.ts` (with the false cross-language comment fixed), `search.ts` (boolean search + KWIC), `stopwords/`, `passageIndex.ts` (lab, verified identical to `rankPassages`), `locators.ts` (`unit locator → folder spec §8.15 Locator`), `labels.ts` (`citationLabel(source, locator, lang)`), `resolve.ts` (citation resolution steps 1–4 of folder spec §8.15; M0 ports `resolveQuote` from the lab's `cite.ts`, T-DOCS completes the steps) | Trama + lab | M0 copy, T-DOCS adds |
| `core/speech/` | Trama `types.ts`, `transcript.ts` (`dropEcho`, `spokenLanguage`), `timing.ts` (`clock`, `timeLeft`) | Trama | M0 |
| `core/transcript/` | `fromResult(result, ctx) → TranscriptFile` (segment ids, speakers `lecture`/`me`/`class`, split-track interleave with `dropEcho`), `effective(t, editLines) → EffectiveTranscript` (folder spec §8.9 replay; 0.1 readers apply lines written by newer apps), `fold(t, lines)` (v1.1), `renderMarkdown(t, lecture, lang)` and `renderVtt(t)` byte-exact per §8.8, `paragraphs(t)`, `anchors.ts` (re-anchoring of annotations), `labels.ts` (speaker labels and "recorded by" by language matching, folder spec §2), `units.ts` (`transcriptUnits(t): Array<{start; end; locator: Locator}>`, used by search; **M0 implements it**), `radar.ts` (`examRadar(t, lang): Array<{segmentId; atMs}>`, the exam-radar phrases of product-ux §9.3), `references.ts` (`legalRefs(t, lang): Array<{segmentId; start; end; article: string; code: string \| null}>`, product-ux §9.3 regexes) | new | M0 (`units.ts`), T-LECTURES |
| `core/exam/` | `presplit(text)` (`^[IVX]+\b`, `^\d+[.)]`, `^[a-z]\)`, choose-N phrases; critique G10), `extractionPrompt(lang, text, blocks)`, `normalizeExtraction(raw, blocks) → Question[]`, `foldExamEdits(exam, lines)` (§8.13), `quickPlan(questions)` (cost and order), `presplit.golden.test.ts` over saved model outputs (critique R14) | new | T-AI |
| `core/ai/` | `types.ts` (ChatRequest, Msg, Part, ToolCall, AiEvent, Usage, Task), `defaults.ts` + `ai-defaults.json` (§11.1.1), `catalog.ts` (caps from `/models`, 24 h cache), `build.ts` (request builder, task profiles, chain per privacy level, capability filter), `sse.ts` (**line-based** parser of openrouter-lab §11.6: `createSseParser().push(line) → AiEvent[]`, `.end()`), `classify.ts` (HTTP status/body/headers → taxonomy code + data; critique §8 mapping incl. 400 "not a valid model ID", 404 data policy), `retry.ts` (policy §11.5), `throttle.ts` (token bucket 18/min for `:free`, ≤ 3 in flight, priorities `interactive` > `bulk`), `client.ts` (`AiClient`), `tools.ts` (`search_materials`, `read_passage` schemas, `RefTable`), `toolLoop.ts` (≤ 8 turns, ≤ 16 calls, final `tool_choice:"none"` + nudge, pinned model), `citations.ts` (`[S#]` regex of folder spec §8.15, chip numbering, hallucinated refs), `tolerantJson.ts`, `budget.ts` (3.5 chars/token, passage budget 12k tokens), `cost.ts` (request estimates, critique G11), `prompts/` (system prompts per task and language) | lab + new | T-AI |
| `core/sync/` | `meta.ts` (LWW registers with the override stamp of folder spec §3.4, validation, authority at HLC, organiser replay with monotonic vacancy — §8.2), `members.ts` (person-key binding §8.3.1, former bindings, `people()`), `bans.ts` (effective bans at HLC §8.19, claimant expansion), `trust.ts` (`writerShortId(path, content)`, `judge(…)` bound to `blocksHash`, prefix rule, derived-ID and signature checks, deletion rule, no-rollback rule, `blocksHash(bytes)` — folder spec §6.2, sync spec §12.1), `claims.ts` (constants §14.1, `isLive` incl. `in_cluster`, `isSuperseded`, `winner`, `staleness`, `reevaluateAt`, `autoDelayMs` §14.3 incl. the overlap rule, `nextClaimedAt`), `chat.ts` (fold of edit/delete/reaction/redaction, `(deviceId, id)` identity, display keys for replies, attribution to the bound person, month files by HLC, tokens), `annotations.ts`, `mod.ts` (honouring rules §8.18, read-only in 0.1), `presence.ts` (`PresenceTracker`: staleness by observed `seq` change, seeded per sync spec §13), `invite.ts` (encode/decode/validate/size reduction/QR reduction, `findCode(text)`), `checkWords.ts` (`checkWords(deviceId)`; lists imported from `docs/spec/check-words-v1.txt` at build time; `test-vectors/check-words.json`), `policy.ts` (`computePolicy(state) → ClassPolicy`), `admission.ts` (`decide(policies, global, offer, nowMs)` mirrored by Rust, `test-vectors/admission.json`), `consent.ts` (active consents, revocations by `{deviceId, id}`), `sign.ts` (builds the canonical bytes and calls `platform.sync.sign`); v1.1: `pair.ts`, `rotate.ts` | new | M0 (`checkWords.ts`), T-SYNC |
| `core/notes/` | `conflicts.ts` (group `*.sync-conflict-*` copies per note), `lineDiff.ts` (Myers, line level) | new | T-DOCS |
| `core/privacy/flows.ts` | data behind "What leaves this computer" and `PRIVACY.md` (Trama pattern) | Trama | UI-SHELL (wave 2) |

#### 11.1.1 `core/ai/ai-defaults.json` (D7, D8, critique G21)

```json
{
  "format": "tramado.ai-defaults", "version": 1, "updated": "2026-11-03",
  "chains": {
    "no-training": ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "dots-studio/dots-3-note-preview:free"],
    "standard":    ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-super-vl:free"],
    "zdr":         []
  },
  "vision": {
    "no-training": ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "dots-studio/dots-3-note-preview:free"],
    "standard":    ["nvidia/nemotron-3.5-super-vl:free", "dots-studio/dots-3-note-preview:free"],
    "zdr":         []
  },
  "trainingOptIn": ["nvidia/nemotron-3.5-super-vl:free", "nvidia/nemotron-3-ultra-550b-a55b:free", "openrouter/free"],
  "stt": { "model": "openai/whisper-large-v3-turbo", "usdPerHour": 0.012, "catalog": "models?output_modalities=transcription" },
  "profiles": {
    "exam-answer":       { "maxTokens": 8000, "temperature": 0.2, "reasoning": { "effort": "medium", "exclude": true } },
    "chat":              { "maxTokens": 4000, "temperature": 0.4, "reasoning": { "effort": "low", "exclude": true } },
    "expand":            { "maxTokens": 4000, "temperature": 0,   "reasoning": { "effort": "low", "exclude": true } },
    "extract-questions": { "maxTokens": 8000, "temperature": 0,   "reasoning": { "effort": "low", "exclude": true } },
    "ocr":               { "maxTokens": 4000, "temperature": 0,   "reasoning": { "enabled": false } },
    "summary":           { "maxTokens": 4000, "temperature": 0.3, "reasoning": { "effort": "low", "exclude": true } },
    "explain":           { "maxTokens": 4000, "temperature": 0.4, "reasoning": { "effort": "low", "exclude": true } },
    "title":             { "maxTokens": 400,  "temperature": 0.2, "reasoning": { "enabled": false } }
  },
  "limits": { "freePerMinute": 18, "maxInFlight": 3, "maxChain": 3 }
}
```
The user's chosen model (default `google/gemma-4-31b-it:free`, configurable) is always first; the chain fills the
remaining two slots from the level's list. In the vision chain the user's model is first too when its catalog
`architecture.input_modalities` includes `image` (verified 2026-11-03 for both Gemma 4 free models: image, text,
video input; tools; context 262 144). Validation against `/models` (cached 24 h in `cache/models-catalog.json`)
drops missing ids and, when the first is missing, falls back to the first catalog model with tools and context
≥ 128k that the level allows. Rust's `speech::remote` validates the STT model against
`GET /models?output_modalities=transcription` before the first cloud job of a session (plain `/models` does not list
`openai/whisper-large-v3-turbo`; D-12); a missing model fails the job with `AI_MODEL_UNKNOWN`.

### 11.2 `services/` — stateful orchestration over `Platform`

All services are created once by `services/index.ts` (`createServices(ctx)`, M0, frozen) from factories with fixed
signatures; each factory lives in its own file owned by one work package. A service exposes **read-only stores**
(`ReadableStore<T>`) and async actions; it never touches the DOM.

```ts
// services/store.ts (M0)
export interface ReadableStore<T> { get(): T; subscribe(listener: () => void): () => void }
export class Store<T> implements ReadableStore<T> { constructor(initial: T); get(): T; set(next: T): void; update(f: (t: T) => T): void; subscribe(l): () => void }
export function derived<A, T>(a: ReadableStore<A>, f: (a: A) => T, eq?: (x: T, y: T) => boolean): ReadableStore<T>;

// services/context.ts (M0)
export interface Clock { now(): number; mono(): number; setTimeout(f: () => void, ms: number): () => void }
export interface ImagePrep { prepare(bytes: Uint8Array, mime: string, maxSide: number, quality: number): Promise<{ jpeg: Uint8Array; width: number; height: number }> }
export interface PdfRender { pages(bytes: Uint8Array): Promise<number>; renderJpeg(bytes: Uint8Array, page: number, maxSide: number): Promise<Uint8Array> }
export interface AppContext {
  platform: Platform; info: AppInfo; clock: Clock; rand: () => number;
  prefs: PrefsStore;                               // typed view of prefs.json (§13.3)
  identity: ReadableStore<Identity | null>;
  device: ReadableStore<{ deviceId: DeviceId; shortId: ShortId } | null>;   // from sync.identity()
  hlc: HlcClock;
  imagePrep: ImagePrep; pdfRender: PdfRender;      // DOM/worker-backed in the app, fakes in tests
  indexHost: IndexHost; extractHost: ExtractHost;  // worker-backed in main.tsx and demo/boot.ts; createInlineHost() in Vitest
  log: (level: 'error' | 'warn' | 'info', msg: string, data?: object) => void;
}
export interface Identity { memberId: MemberId; name: string; deviceName: string; colour: ColourHex | null; personPub: string; createdAt: Instant }
export interface HlcClock {
  tick(): Hlc;                                     // folder spec §3.3 (persists the ceiling before use)
  observe(stamp: Hlc): 'ok' | 'ahead';             // 'ahead' = more than 1 h in the future: ordered, not observed
  override(current: Hlc | null): Hlc;              // max(tick(), succ(current)) for LWW registers (folder spec §3.4)
}
// services/prefs.ts (M0, frozen): every key of §13.3 with its default
export const PREF_DEFAULTS = { /* exactly the table of §13.3, e.g. 'ui.locale': '', 'ai.model': 'google/gemma-4-31b-it:free', … */ } as const;
export type PrefKey = keyof typeof PREF_DEFAULTS | `record.${string}` | `notify.class.${string}` | `pinsHidden.${string}`;
export interface PrefsStore {
  get(k: PrefKey): string;                         // default when unset (PREF_DEFAULTS, or '' for the template keys)
  set(k: PrefKey, v: string): Promise<void>;       // validates the value against §13.3; INVALID otherwise
  store: ReadableStore<Readonly<Record<string, string>>>;
}
export interface Parsed<T> { ok: boolean; value: T | null; newer: boolean; unknown: string[] }   // core/model/parse.ts
export interface IndexHost {                       // workers/rpc.ts; same messages as search.worker (§11.7)
  load(classId: ClassId, docs: Array<{ key: string; text: string; units: TextCache['units'] }>): Promise<void>;
  upsert(classId: ClassId, key: string, text: string, units: TextCache['units']): Promise<void>;
  remove(classId: ClassId, key: string): Promise<void>;
  query(scope: ClassId | 'all', q: string, opts?: { limit?: number; kinds?: Array<SourceRef['kind']>; exclude?: string[] }): Promise<Passage[]>;
  passage(classId: ClassId, id: string, opts?: { offset?: number; max?: number }): Promise<(Passage & { hasMore: boolean }) | null>;
  find(scope: ClassId | 'all', q: string, opts?: { limit?: number }): Promise<Array<{ classId: ClassId; key: string; before: string; match: string; after: string; start: number }>>;
  stats(classId: ClassId): Promise<{ docs: number; chars: number }>;
}
export interface ExtractHost {
  extract(bytes: Uint8Array, kind: DocSummary['kind'], name: string, onProgress: (p: number) => void, signal: AbortSignal): Promise<TextCache>;
}
export interface CatalogModel {                    // core/ai/catalog.ts, from GET /models (24 h cache)
  id: string; label: string /* UX §8 OQ13 */; free: boolean; context: number; tools: boolean; vision: boolean;
  levels: PrivacyLevel[];                          // privacy levels at which at least one endpoint serves it
}
```

```ts
// services/types/*.ts (one file per domain; index.ts re-exports; owners as in §19)
export interface AppServices {
  ctx: AppContext;
  library: ClassLibrary;          // services/library.ts
  sync: SyncService;              // services/sync.ts
  ai: AiService;                  // services/ai.ts
  search: SearchService;          // services/search.ts
  models: ModelsService;          // services/models.ts
  recording: RecordingService;    // services/recording.ts
  transcription: TranscriptionQueue;   // services/transcription.ts
  notifications: NotificationService;  // services/notifications.ts
  extraction: ExtractionService;  // services/extraction.ts
  forClass(classId: ClassId): ClassServices;     // created on first use, kept while the class is registered
}
export interface ClassServices {
  store: ClassStore;              // services/classStore.ts (M0, implemented)
  info: ClassService;             // services/class.ts
  lectures: LectureService;       // services/lectures.ts
  documents: DocumentService;     // services/documents.ts
  notes: NotesService;            // services/notes.ts
  annotations: AnnotationService; // services/annotations.ts
  exams: ExamService;             // services/exams.ts
  ask: AskService;                // services/ask.ts
  chat: ChatService;              // services/chat.ts
  presence: PresenceService;      // services/presence.ts
  claims: ClaimEngine;            // services/claims.ts
  trust: TrustService;            // services/trust.ts (installed as the store's TrustGate for shared classes)
}

// ── ClassStore (M0, implemented): the generic file layer of one class ──────────────────────────
export type ChangeKind = 'classFile' | 'meta' | 'members' | 'presence' | 'consent' | 'chat' | 'annotations' | 'claims'
  | 'edits' | 'markers' | 'examEdits' | 'answers' | 'mod' | 'bans' | 'lecture' | 'transcript' | 'audio' | 'exam'
  | 'document' | 'note' | 'conflict';
export interface IndexedItem { id: Ulid; dir: ClassPath; manifest: ClassPath; size: number; mtimeMs: number }
export interface ClassIndex {
  lectures: ReadonlyMap<Ulid, IndexedItem>; exams: ReadonlyMap<Ulid, IndexedItem>;
  documents: readonly (ClassFileEntry & { lectureId?: Ulid; examId?: Ulid })[];
  notes: readonly ClassFileEntry[]; machine: ReadonlyMap<ClassPath, ClassFileEntry>;
  conflicts: readonly { path: ClassPath; of: ClassPath }[]; duplicates: readonly { id: Ulid; paths: ClassPath[] }[];
}
export interface ClassStoreState {
  classId: ClassId; entry: ClassEntry; status: 'loading' | 'ready' | 'missing' | 'error'; error: ErrorCode | null;
  index: ClassIndex; revision: number; kinds: Readonly<Record<ChangeKind, number>>;   // per-kind change counters
}
export type TrustVerdict = { kind: 'trusted' } | { kind: 'prefix'; length: number } | { kind: 'untrusted'; reason: 'foreign-write' | 'writer-changed' | 'pending' } | { kind: 'unverified' };
export interface TrustGate {
  verify(path: ClassPath, bytes: Uint8Array, parsed: unknown | null): Promise<TrustVerdict>;
  noteOwnWrite(path: ClassPath, bytes: Uint8Array): void;
}
export interface Loaded<T> { value: T; verdict: TrustVerdict; newer: boolean; sha256: Hex64; size: number; mtimeMs: number }
export interface LoadedLines<T> { lines: Array<{ value: T; offset: number }>; consumed: number; verdict: TrustVerdict; skipped: number; newer: number }
export interface ClassStore {
  readonly state: ReadableStore<ClassStoreState>;
  start(): Promise<void>; stop(): void;
  setTrustGate(g: TrustGate): void;                   // default: everything 'trusted' (local-only classes, folder spec §6.3)
  setDirs(d: { lectures: string; documents: string; exams: string; notes: string; fromChat: string }): void;
  dir(key: 'lectures' | 'documents' | 'exams' | 'notes' | 'fromChat'): ClassPath;
  onChange(kinds: ChangeKind[], cb: (paths: ClassPath[]) => void): () => void;
  readBytes(path: ClassPath): Promise<Uint8Array | null>;
  readJson<T>(path: ClassPath, parse: (raw: unknown) => Parsed<T>): Promise<Loaded<T> | null>;
  readJsonl<T>(path: ClassPath, parse: (raw: unknown) => Parsed<T>, from?: { offset: number; prefixSha256: Hex64 }): Promise<LoadedLines<T>>;
  writeJson(path: ClassPath, value: object, opts: { own: boolean; manifest?: boolean }): Promise<FileStamp>;
  writeText(path: ClassPath, text: string, opts: { own: boolean }): Promise<FileStamp>;
  writeBytes(path: ClassPath, bytes: Uint8Array, opts: { own: boolean }): Promise<FileStamp>;
  appendLine(path: ClassPath, value: object): Promise<FileStamp>;   // always own
  remove(path: ClassPath, opts?: { recursive?: boolean }): Promise<void>;
  move(from: ClassPath, to: ClassPath): Promise<void>;
  mkdir(path: ClassPath): Promise<void>;
}

// ── Library and class ─────────────────────────────────────────────────────────────────────────────
// View models shared with the UI are the UX spec's, verbatim, in services/types/viewModels.ts (M0): ClassView, ClassSync,
// DeviceRef, ExamDateView, ExamKind, PinView, TranscriptionState, LectureView, Quota, ModelLabel (UX §2.12);
// ExamPaperView, QuestionView, AiAnswerView, Mark (UX §3.9.1); ChatMessageView (UX §3.10.1); the view-side Citation,
// SourceRef and Locator (UX §4.1; imported as ViewCitation, ViewSourceRef, ViewLocator next to the storage types of
// core/model/files.ts). Services map storage → view; screens never read files.
export interface ClassLibrary {
  classes: ReadableStore<ClassView[]>;                   // UX ClassView (archived included; the rail filters)
  load(): Promise<void>;
  create(input: { name: string; shortName?: string; colour: ColourHex; icon: IconName; lecturer?: string; term?: string; language: Lang | 'auto'; vocabulary?: string; share: boolean }): Promise<ClassId>;
      // derives classId from the device ID and a nonce, writes signed class.json, meta and member files (folder spec §2.1, §6.6)
  adopt(pick: Picked): Promise<ClassId>;                 // forks the folder when it holds other devices' member files (sync spec §17)
  archive(classId: ClassId, archived: boolean): Promise<void>;
  forget(classId: ClassId, opts: { trash: boolean }): Promise<void>;
  suggest(name: string): { shortName: string; icon: IconName; colour: ColourHex };
}
export interface Person {
  memberId: MemberId; name: string; colour: ColourHex | null; isMe: boolean; isOrganiser: boolean; banned: boolean;
  devices: Array<{ deviceId: DeviceId; deviceName: string; verified: boolean; online: boolean; relay: boolean;
                   lastSeen: Instant | null; caps: MemberFile['caps']; app: MemberFile['app']; activity: PresenceFile['activity'] | null; stale: boolean }>;
}
export interface ClassDetail {                             // what the class header, settings and members screens need beyond ClassView
  classId: ClassId; meta: EffectiveMeta; organisers: MemberId[]; people: Person[]; unverified: Person[];
  me: { deviceId: DeviceId; memberId: MemberId; isOrganiser: boolean }; shared: boolean; readOnly: boolean; newerItems: number;
}
export interface ClassService {
  detail: ReadableStore<ClassDetail>;
  setMeta(patch: Partial<Record<keyof MetaFile['fields'], unknown>>): Promise<void>;   // writes own meta file (LWW)
  setOrganiser(memberId: MemberId, on: boolean): Promise<void>; becomeOrganiser(): Promise<void>;
  refreshOwnMemberFile(): Promise<void>;                        // caps, addresses (≤ 1 / 5 min), app version, formats
  consent: { record(input: ConsentInput): Promise<{ deviceId: DeviceId; id: Ulid }>; revoke(ref: { deviceId: DeviceId; id: Ulid }): Promise<void>; active(): ConsentLine[] };
}
export interface EffectiveMeta {
  name: string; shortName: string; colour: ColourHex; icon: IconName; lecturer: string | null; term: string | null;
  language: Lang | 'auto'; description: string | null; vocabulary: string | null; askBeforeAdmit: boolean; largeClassAck: boolean;
  dirs: { lectures: string; documents: string; exams: string; notes: string; fromChat: string };
}
export interface ConsentInput {
  kind: 'record' | 'share'; scope: 'class' | 'lecture'; lectureId?: Ulid; share?: 'audio+transcript' | 'transcript-only';
  textId: 'record.dialog.consent.v1' | 'record.dialog.consentShare.v1';      // catalog keys = textId (§14)
  textLang: Lang; text: string; lecturer?: string;                            // the exact sentence shown (folder spec §8.5)
}
export type EffectiveTranscript = TranscriptFile & { concurrent: SegmentId[]; unfolded: number; stale: boolean; newer: boolean };

// ── Sync (app level) ──────────────────────────────────────────────────────────────────────────────
export interface InvitePreview { code: string; invite: InviteV1; devices: DeviceSpec[]; warnings: Array<'old' | 'ownInvite' | 'alreadyMember'>; classId: ClassId; checkWords: string }
export interface SyncUiState {
  status: SyncStatus | null; folders: Record<ClassId, FolderView>; joinRequests: JoinRequestView[]; offers: FolderOfferView[];
  massDelete: Array<{ classId: ClassId; count: number; sample: ClassPath[] }>;
  massDeleteRemote: Array<{ classId: ClassId; by: ShortId; byName: string; count: number; sample: ClassPath[] }>;
  foreignWrites: number; markerMissing: ClassId[]; identityCopied: boolean;
  joinStalled: ClassId[];                                  // not admitted 90 s after connecting (sync spec §8)
}
export interface SyncService {
  state: ReadableStore<SyncUiState>;
  boot(): Promise<void>;                                   // snapshot, trust pass, policy push, event routing
  ensureStarted(): Promise<void>;
  restart(): Promise<void>;
  share(classId: ClassId): Promise<void>;
  invite(classId: ClassId, opts?: { expiresAt?: EpochMs }): Promise<{ code: string; link: string; web: string | null; qrText: string; fileName: string; fileText: string }>;
      // qrText = the reduced invite as `web` (when JOIN_PAGE is set) or `link` (sync spec §7.2); fileText = link + "\n" + sentence
  parseCode(text: string): Promise<InvitePreview>;         // a pairing code (v1.1) → PlatformError NEWER_FORMAT with data.pair = true
  join(preview: InvitePreview, opts: { includeAudio: boolean; parent?: Picked }): Promise<ClassId>;   // passes preview.code to Rust
  cancelJoin(classId: ClassId): Promise<void>;
  leave(classId: ClassId, opts: { afterwards: 'keepLocal' | 'trash'; deleteMyNotes: boolean }): Promise<void>;   // sync spec §17
  admit(classId: ClassId, deviceId: DeviceId): Promise<void>;
  decline(classId: ClassId, deviceId: DeviceId): Promise<void>;     // organiser → ban entry; others → temporary ignore on this computer
  ban(classId: ClassId, target: { memberId: MemberId } | { deviceId: DeviceId }, reason?: string): Promise<void>;   // also sets askBeforeAdmit
  unban(classId: ClassId, target: { memberId: MemberId } | { deviceId: DeviceId }): Promise<void>;
  answerOffer(offer: FolderOfferView, accept: boolean): Promise<void>;
  applySettings(s: Partial<SyncSettings>): Promise<void>;
  versions(classId: ClassId): Promise<VersionEntry[]>;   // "Recently deleted": versions of paths deleted now, filtered per sync spec §22.1
  restore(classId: ClassId, items: RestoreItem[]): Promise<void>;   // Undo toasts and "Recently deleted"
  resolveMassDelete(classId: ClassId, action: 'restore' | 'confirm'): Promise<void>;
  resolveRemoteMassDelete(classId: ClassId, by: ShortId, action: 'restore' | 'keep'): Promise<void>;   // restore from the local trashcan
  resolveCopiedIdentity(action: 'new' | 'same'): Promise<void>;
  diagnosticsText(): Promise<string>;
}
export interface PresenceService {
  setActivity(a: Partial<PresenceFile['activity']> | null): Promise<void>;   // writes on change; 60 s heartbeat while non-empty
  others: ReadableStore<Record<DeviceId, { activity: PresenceFile['activity']; stale: boolean; power: PresenceFile['power'] }>>;
}
export interface TrustService extends TrustGate {
  pass(): Promise<{ checked: number; untrusted: number }>;            // start-up pass, sync spec §12.1
  noteRemote(path: ClassPath, modifiedBy: ShortId, mono: number): void;   // from sync:event remoteChange (kept 10 min)
}

// ── Chat ─────────────────────────────────────────────────────────────────────────────────────────
export interface ChatView { items: ChatMessageView[]; pins: PinView[]; unread: number; mentions: number; olderAvailable: boolean; newerFormatLines: number }
// ChatMessageView.id = `${deviceId}:${lineId}`; `msgRef(id)` turns it back into a folder-spec MsgRef.
export interface ChatService {             // 0.1: no react/pin/hide (v1.1, §1.1); ChatView.pins is always []
  view: ReadableStore<ChatView>;
  send(input: { text: string; replyTo?: MsgRef; attachments?: Picked[] }): Promise<MsgRef>;
  edit(ref: MsgRef, text: string): Promise<void>;
  remove(ref: MsgRef): Promise<void>;                        // delete line + redaction (per-path lock, sync spec §12.3)
  thank(memberId: MemberId, lectureId: Ulid): Promise<void>;
  loadOlder(): Promise<void>; markRead(): void;
}

// ── Lectures, recording, transcription, models ───────────────────────────────────────────────────
export interface ClaimView { deviceId: DeviceId; who: string; status: ClaimFile['status']; progress: number | null; etaMs: number | null; health: 'healthy' | 'slow' | 'stale'; sinceMs: number; mine: boolean }
export interface LectureDetail {
  view: LectureView; lecture: LectureFile; transcript: EffectiveTranscript | null; audioUrl: string | null;
  peaks: number[] | null; markers: Marker[];
  autoMarkers: Array<{ segmentId: SegmentId; atMs: number }>;            // core/transcript/radar.ts minus private removals
  references: Array<{ segmentId: SegmentId; start: number; end: number; article: string; code: string | null;
                      target: { path: ClassPath; page: number | null } | null }>;   // core/transcript/references.ts, resolved via SearchService article units
  aiNotes: { summary: AskTurn | null; terms: AskTurn | null };          // private/<classId>/lectures/<id>.json
  canEdit: false; isOwner: boolean;                                      // transcripts are read-only in 0.1 (§1.1)
}
export interface LectureService {
  list: ReadableStore<LectureView[]>;                       // UX LectureView (with TranscriptionState)
  open(id: Ulid): ReadableStore<LectureDetail | null>;
  rename(id: Ulid, title: string): Promise<void>; markDuplicate(id: Ulid, of: Ulid | null): Promise<void>;
  deleteLecture(id: Ulid): Promise<void>; deleteAudio(id: Ulid): Promise<void>;
  markers: { add(id: Ulid, m: Omit<Marker, 'id'>): Promise<void>; remove(id: Ulid, markerId: Ulid): Promise<void>; removeAuto(id: Ulid, atMs: number): Promise<void> };
  share(id: Ulid, mode: 'audio+transcript' | 'transcript-only'): Promise<void>;   // publishes a recording kept with share 'none'
  exportTranscript(id: Ulid, format: 'md' | 'vtt' | 'txt', pick: Picked): Promise<void>;
}
export interface RecordingState { status: RecorderStatus; classId: ClassId; title: string; markers: Marker[] }
export interface RecordingService {
  state: ReadableStore<RecordingState | null>; pending: ReadableStore<FinishedRecording[]>;
  meter: ReadableStore<{ mic: TrackLevel | null; system: TrackLevel | null } | null>;
  startMeter(req: MeterRequest): Promise<void>; stopMeter(): Promise<void>;   // record dialog and Settings › Transcription
  start(input: { classId: ClassId; title: string; mode: 'room' | 'online'; includeMic: boolean; inputDeviceId: string | null; language: Lang | 'auto'; consent: { record: ConsentInput; share: ConsentInput | null; remember: boolean } }): Promise<void>;
      // writes the consent lines (scope 'lecture', or 'class' when remember) before the recorder starts
  pause(): Promise<void>; resume(): Promise<void>; mark(kind: MarkerKind, note?: string): Promise<void>;
  stop(): Promise<FinishedRecording>;
  publish(rec: FinishedRecording, opts: { title: string; share: ShareMode; transcribe: 'here' | 'cloud' | 'classmate' | 'later' }): Promise<Ulid>;
  importAudio(classId: ClassId, pick: Picked, opts: { title: string; keepVideo: boolean; startedAt?: Instant }): Promise<Ulid>;
  discard(recordingId: Ulid): Promise<void>; recover(): Promise<void>;
}
export interface TranscriptionQueueState {
  job: (JobSummary & { classId: ClassId; title: string }) | null;
  lectures: Array<{ classId: ClassId; lectureId: Ulid; title: string; claim: ClaimView | null; eligible: boolean; reason: string | null }>;
  volunteer: 'off' | 'plugged' | 'always';                  // the preference
  volunteerEffective: 'off' | 'plugged' | 'always';         // what the member file reports (sync spec §14.3)
  cloud: { on: boolean; model: string; auto: boolean };
}
export interface TranscriptionQueue {
  state: ReadableStore<TranscriptionQueueState>;
  claim(classId: ClassId, lectureId: Ulid, engine: 'local' | 'cloud'): Promise<'won' | 'lost' | 'ineligible'>;
  takeOver(classId: ClassId, lectureId: Ulid): Promise<'won' | 'lost' | 'ineligible'>;
  release(classId: ClassId, lectureId: Ulid): Promise<void>;
  retranscribe(classId: ClassId, lectureId: Ulid): Promise<void>;
  setVolunteer(v: 'off' | 'plugged' | 'always'): Promise<void>;
  setCloud(on: boolean, model: string, auto: boolean): Promise<void>;   // prefs speech.cloud / cloudModel / cloudAuto
}
export interface ClaimEngine {          // per class; owns claims/<lectureId>/<me>.json and the §14.5 round
  claims(lectureId: Ulid, kind: 'transcribe' | 'fold'): ReadableStore<ClaimView[]>;
  winner(lectureId: Ulid, kind: 'transcribe' | 'fold'): ClaimView | null;
  tryClaim(lectureId: Ulid, kind: 'transcribe' | 'fold', input: { engine: ClaimFile['engine']; audioSha256: Hex64 | null; supersedeStale: boolean; newRound?: boolean }): Promise<'won' | 'lost'>;
  onLost(lectureId: Ulid, cb: () => void): () => void;      // fires when a running claim stops winning (abort the job)
  setStatus(lectureId: Ulid, kind: 'transcribe' | 'fold', patch: Partial<Pick<ClaimFile, 'status' | 'progress' | 'etaMs' | 'error' | 'finishedAt' | 'transcriptRevision'>>): Promise<void>;
  remove(lectureId: Ulid, kind: 'transcribe' | 'fold'): Promise<void>;
  sweep(): Promise<void>;                                     // retention rules folder spec §8.10
}
export interface ModelsService { models: ReadableStore<ModelState[]>; active: ReadableStore<ModelId>; download(id: ModelId): Promise<void>; cancel(id: ModelId): Promise<void>; remove(id: ModelId): Promise<void>; import(id: ModelId, pick: Picked): Promise<void>; setActive(id: ModelId): Promise<void> }

// ── Documents, notes, annotations, search ────────────────────────────────────────────────────────
export interface DocSummary {
  path: ClassPath; name: string; dir: ClassPath; size: number; mtimeMs: number; sha256: Hex64 | null;
  kind: 'pdf' | 'docx' | 'pptx' | 'odt' | 'md' | 'txt' | 'html' | 'rtf' | 'image' | 'audio' | 'video' | 'other';
  extraction: 'pending' | 'running' | 'ready' | 'scan' | 'failed' | 'unsupported'; pages: number | null;
  lectureId: Ulid | null; examId: Ulid | null; conflictOf: ClassPath | null; duplicateOf: ClassPath | null; fromChat: boolean;
}
export interface TextCache {   // cache/text/<sha256>.json, format "tramado.text-cache" v1
  sha256: Hex64; extractor: string; kind: DocSummary['kind']; text: string;
  pageStarts?: number[]; pageLabels?: Array<string | null>; imagePages?: number[]; slideStarts?: number[];
  headings?: Array<{ start: number; level: number; text: string }>; units: Array<{ start: number; end: number; locator: Locator }>; warnings: string[];
}
export interface DocumentService {
  list: ReadableStore<DocSummary[]>;
  import(picks: Picked[], destDir?: ClassPath): Promise<Array<{ name: string; path?: ClassPath; error?: ErrorCode; duplicateOf?: ClassPath }>>;
  remove(path: ClassPath, mode: 'everyone' | 'thisComputer'): Promise<void>;
  rename(path: ClassPath, name: string): Promise<ClassPath>; move(path: ClassPath, destDir: ClassPath): Promise<ClassPath>;
  text(path: ClassPath): Promise<TextCache>; url(path: ClassPath): string; reveal(path: ClassPath): Promise<void>; open(path: ClassPath): Promise<void>;
}
export interface NoteSummary { scope: 'class' | 'private'; path: string; title: string; mtimeMs: number; conflict: boolean; editingBy: string[] }
export interface NotesService {
  list: ReadableStore<NoteSummary[]>;
  read(scope: 'class' | 'private', path: string): Promise<string>;
  save(scope: 'class' | 'private', path: string, text: string): Promise<void>;   // caller debounces 2 s
  create(scope: 'class' | 'private', title: string): Promise<string>;
  rename(scope: 'class' | 'private', path: string, title: string): Promise<string>; remove(scope: 'class' | 'private', path: string): Promise<void>;
  conflicts(path: ClassPath): Promise<{ base: string; copies: Array<{ path: ClassPath; text: string }> }>;
  resolve(path: ClassPath, choice: { keep: 'base' | ClassPath } | { merged: string } | { keepBoth: true }): Promise<void>;
  editing(path: ClassPath | null): void;                    // presence activity.editing
}
export interface Annotation { id: Ulid; visibility: 'private' | 'class'; author: { memberId: MemberId; name: string }; kind: 'comment' | 'highlight'; target: AnnotationLine['target']; colour?: AnnotationLine['colour']; body?: string; ai?: { model: string }; ms: EpochMs; anchor: 'exact' | 'moved' | 'approximate' | 'lost' }
export interface ExtractionService {       // services/extraction.ts; writes cache/text/<sha256>.json through ctx.extractHost
  status: ReadableStore<{ running: number; queued: number; bySha: Readonly<Record<Hex64, 'pending' | 'running' | 'ready' | 'scan' | 'failed' | 'unsupported'>> }>;
  ensure(classId: ClassId, path: ClassPath): Promise<TextCache>;
  cancel(sha256: Hex64): void;
}
export interface AnnotationService {
  forSource(source: SourceRef): ReadableStore<Annotation[]>;
  add(a: Omit<Annotation, 'id' | 'author' | 'ms' | 'anchor'>): Promise<Ulid>; edit(id: Ulid, body: string): Promise<void>; remove(id: Ulid): Promise<void>;
}
export interface Passage { id: string; classId: ClassId; source: SourceRef; locator: Locator; label: string; text: string; score: number; hits: Array<[number, number]> }
export interface IndexStatus { classId: ClassId; state: 'idle' | 'building' | 'ready' | 'error'; docs: number; pending: number; chars: number }
export interface SearchService {
  status(classId: ClassId): ReadableStore<IndexStatus>;
  ensure(classId: ClassId): Promise<void>;
  passages(scope: ClassId | 'all', query: string, opts?: { limit?: number; kinds?: Array<SourceRef['kind']>; exclude?: string[] }): Promise<Passage[]>;
  passage(classId: ClassId, id: string, opts?: { offset?: number; max?: number }): Promise<(Passage & { hasMore: boolean }) | null>;
  find(scope: ClassId | 'all', query: string, opts?: { limit?: number }): Promise<Array<{ classId: ClassId; source: SourceRef; label: string; before: string; match: string; after: string; locator: Locator }>>;
  resolve(classId: ClassId, c: Citation): Promise<{ status: 'exact' | 'moved' | 'changed' | 'missing'; route: unknown | null; label: string }>;
}

// ── AI, exams, ask ───────────────────────────────────────────────────────────────────────────────
export interface AiSettingsView {
  key: SecretStatus; privacy: PrivacyLevel; model: string; fallbacks: string[]; chain: string[];
  customHost: AiHost | null; answerLanguage: 'question' | 'ui'; quota: Quota | null;
  catalogAge: number | null; lastAnswerModel: ModelLabel | null;
}
export interface AiService {
  settings: ReadableStore<AiSettingsView & { enabled: boolean; busyRelax: boolean; generalDefault: boolean }>;
  client: AiClient;                                         // core/ai/client.ts instance over platform.ai
  setKey(value: string): Promise<void>; clearKey(): Promise<void>; testKey(): Promise<{ ok: boolean; code?: ErrorCode; remaining?: number }>;
  setModel(id: string): Promise<void>; setFallbacks(ids: string[]): Promise<void>;
  setPrivacy(level: PrivacyLevel): Promise<boolean>; setCustomHost(base: string | null): Promise<void>;
  setEnabled(on: boolean): Promise<void>;                   // "Turn off AI on this computer" (prefs ai.enabled)
  setBusyPolicy(relax: boolean): Promise<boolean>;          // platform.ai.setBusyPolicy (native confirm when on)
  setGeneralDefault(on: boolean): Promise<void>;
  refreshQuota(): Promise<void>; catalog(): Promise<CatalogModel[]>;
  activity(limit: number): Promise<AiActivityEntry[]>; clearActivity(): Promise<void>;
  estimate(task: string, count: number): { requests: number; remaining: number | null };
}
export interface ExamDraft {
  id: string; classId: ClassId; step: 'ocr' | 'presplit' | 'extracting' | 'review' | 'saving' | 'failed';
  pages: number; ocrDone: number; text: string; questions: Question[]; meta: Partial<ExamFile>; cost: { requests: number }; error: ErrorCode | null; model: string | null;
}
export interface ExamService {
  list: ReadableStore<{ dates: ExamDateView[]; papers: ExamPaperView[] }>;   // UX view models
  open(id: Ulid): ReadableStore<ExamPaperView | null>;
  createUpcoming(input: Pick<ExamFile, 'title' | 'type' | 'date' | 'allDay' | 'durationMin' | 'room' | 'weight' | 'weightText' | 'covers' | 'coversText'>): Promise<Ulid>;
  updateUpcoming(examId: Ulid, patch: Partial<Pick<ExamFile, 'title' | 'type' | 'date' | 'allDay' | 'room' | 'weight' | 'weightText' | 'coversText'>>): Promise<void>;   // importer only in 0.1
  startImport(picks: Picked[], meta?: Partial<ExamFile>): Promise<string>;          // returns draft id
  draft(id: string): ReadableStore<ExamDraft | null>;
  saveReview(draftId: string, questions: Question[], meta: Partial<ExamFile>): Promise<Ulid>;   // writes exam.json (reviewedAt set)
  editQuestion(examId: Ulid, qid: QuestionId, field: string, value: unknown): Promise<void>;   // importer only in 0.1 (others: v1.1 exam-edit lines)
  addQuestion(examId: Ulid, q: Question, after: QuestionId | null): Promise<void>; deleteQuestion(examId: Ulid, qid: QuestionId): Promise<void>;
  answer(examId: Ulid, qids: QuestionId[], mode: 'quick' | 'deep', scope: Answer['scope']): ReadableStore<{ done: number; total: number; current: QuestionId | null; error: ErrorCode | null }>;
  setMyAnswer(examId: Ulid, qid: QuestionId, text: string): Promise<void>;
  setCorrect(examId: Ulid, qid: QuestionId, text: string): Promise<void>;     // "the correct answer", private
  setMark(examId: Ulid, qid: QuestionId, m: 'right' | 'partly' | 'wrong' | 'unsure' | null): Promise<void>;
  reveal(examId: Ulid, qid: QuestionId): Promise<void>;                       // try-first: marks the AI answer revealed
  hint(examId: Ulid, qid: QuestionId): Promise<void>;                         // private hint (never in answers/)
  practise(examId: Ulid, qid: QuestionId, result: 'again' | 'gotIt'): Promise<void>;
  setInPractice(examId: Ulid, qid: QuestionId, on: boolean): Promise<void>;
}
export interface AskTurn { id: Ulid; question: string; scope: { kinds: Array<SourceRef['kind']>; lectureId?: Ulid; docPath?: ClassPath }; answer: string; citations: Citation[]; model: string | null; status: 'running' | 'ok' | 'error'; error: ErrorCode | null; at: Instant }
export interface AskService {
  threads: ReadableStore<Array<{ threadId: Ulid; title: string; at: Instant }>>;   // private: data/private/<classId>/ask/<threadId>.jsonl (UX §3.11)
  thread(threadId: Ulid): ReadableStore<AskTurn[]>;
  ask(threadId: Ulid | null, question: string, scope: AskTurn['scope']): Promise<Ulid>;   // null = new thread
  explain(passage: Passage | { text: string; source: SourceRef; locator: Locator }, style: 'simpler' | 'example' | 'translate'): Promise<AskTurn>;
  summarize(lectureId: Ulid): Promise<AskTurn>; keyTerms(lectureId: Ulid): Promise<AskTurn>;   // saved in private lectures/<id>.json
  annotate(lectureId: Ulid): Promise<number>;                // "Annotate with AI": key terms → private AnnotationLines with ai:{model}
  studyNotes(lectureId: Ulid): Promise<string>;              // "Make study notes": a private note (headings, tramado:lecture time links, doc links)
  askInChat(question: MsgRef): Promise<void>;                // @AI in chat → writes an `ai` chat line replying to it
  postToChat(threadId: Ulid, turnId: Ulid): Promise<void>;   // an `ai` line with `question`, no replyTo; refused (INVALID) when it cites a private source
  clear(): Promise<void>;
}
export interface NotificationService {   // translates `notify.*` keys (UX §5.22) with the UI locale, honours prefs notify.*
  notify(kind: 'mention' | 'pin' | 'join' | 'transcript' | 'chat' | 'exam' | 'sync' | 'recording' | 'model', key: string /* notify.<id> */, vars: Record<string, string | number>, tag?: string): Promise<void>;
}
```

Factory signatures (frozen in `services/index.ts`): `createLibrary(ctx, app)`, `createSyncService(ctx, app)`,
`createAiService(ctx, app)`, `createSearchService(ctx, app)` (uses `ctx.indexHost`), `createExtractionService(ctx, app)`
(uses `ctx.extractHost`), `createModelsService(ctx, app)`, `createRecordingService(ctx, app)`,
`createTranscriptionQueue(ctx, app)`, `createNotificationService(ctx, app)`, and
per class `createClassStore(ctx, entry)`, `createClassService(ctx, app, store)`, `createLectureService(…)`,
`createDocumentService(…)`, `createNotesService(…)`, `createAnnotationService(…)`, `createExamService(…)`,
`createAskService(…)`, `createChatService(…)`, `createPresenceService(…)`, `createClaimEngine(…)`,
`createTrustService(…)` — every per-class factory takes `(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId })`.
M0 implements `services/index.ts`, `store.ts`, `context.ts`, `prefs.ts`, `identity.ts`, `hlcClock.ts`,
`classStore.ts` and a minimal `library.ts` (registry entries + `class.json` names); every other factory is a stub
returning empty stores and throwing `NOT_IMPLEMENTED` from actions. Test doubles live in `services/testing/`
(`fakeSearch.ts` → T-AI, `fakeClaims.ts` → T-LECTURES).

**API freeze at G1.** Service members consumed by another package (the interfaces above) are signature-frozen at
gate G1; wave-2 packages may only add members, never rename, remove or retype them.

### 11.3 `ui/` — design system (M0 ports Trama; UI-SHELL owns in wave 2)

Trama `ui/` is copied verbatim (Button/IconButton, Choice (Checkbox, Switch, RadioGroup), ColorPicker, Confirm,
Dialog, Feedback (Spinner, ProgressBar, EmptyState, Kbd, Badge, Notice, Card, Section, Toolbar), Field (TextField,
TextArea, SearchField, Select), Menu/MenuButton/ContextMenu, Popover, SplitPane, Table, Tabs, Toast, Tooltip,
`floating.ts`; helpers `cx, color, focus, grow, position, media, splitSize, confirmMatch, problems, icons, i18n.tsx`)
with the ADAPTs of UX §2.11. Visual identity per UX §1: `tokens.css` is UX §1.2 **verbatim** (it supersedes the lab
file), `classColor.ts` and `classIcons.ts` per UX §1.3, `fonts.css` + `fonts.ts` per UX §1.4; `tokens.test.ts`
contrast checks extended with the lab's `contrast.mjs` pairs and `classmix.mjs`; storage prefix `tramado.`.

New components live in `app/src/ui/tramado/` with the **exact props of UX §2.11**:

M0 builds the first 19 below (`PinsStrip` is v1.1); their props are frozen as UX §2.11. Owners in wave 2 (each owner may
change the internals and styles of its components, never their props):

| Owner in wave 2 | Components |
|---|---|
| UI-SHELL | `ClassTab`, `ClassChip`, `CountdownChip` (+ `ui/components/**`) |
| UI-EXAMS | `AiCard`, `CitationChip`, `CitationPopover`, `SourceRow`, `QuotaMeter`, `CostLine` |
| UI-GROUP | `Composer`, `QrCode`, `CheckWords`, `Avatar`, `PresenceDot` |
| UI-DOCS | `SelectionToolbar`, `DropOverlay`, `MarkdownView` (renders `core/text/markdown.ts`'s AST; T-DOCS hardens it in wave 1) |
| UI-LECTURES | `MarkerIcon`, `ProgressSteps`, and the new files `Player`, `Timeline`, `TranscriptView`, `LevelMeter`, `MarkerButton` |

### 11.4 `shell/` — app state, router, layout (M0; UI-SHELL owns in wave 2)

Copied from Trama: `router.tsx`, `commands.ts`, `useCommands.ts`, `CommandPalette.tsx`, `palette.css`,
`ErrorBoundary.tsx`, `arrival.ts` (KEYS = the identity attributes of UX §0.3), `activity.web.ts`, `keys.ts`,
`savers.ts`, `reloadGate.ts`, `useLive.ts` (re-targeted to stores), `undo.tsx`, `ScreenHeader.tsx`, `Placeholder.tsx`,
`initial.ts`, `helpTopic.ts`. New (UX §0.2, §2): `AppState.tsx`, `Layout.tsx`, `Rail.tsx`, `SyncPill.tsx`,
`AiPill.tsx`, `Dock.tsx` (frame; rows come from `DOCK_ROWS`), `routes.ts`, `useStore.ts`
(`useSyncExternalStore` over `ReadableStore`), `useDialogs.ts`.

Phases (UX §2.1): `{ name: 'loading' } | { name: 'welcome' } | { name: 'ready'; services: AppServices; initialRoute?: Route }`;
`welcome` while `identity.json` has no `name`. Never `StrictMode` (D49). Window close: `platform.window.onCloseRequested`
→ savers → `'hide'` when `prefs['app.trayOnClose'] === '1'` and a shared class exists, else `'quit'`.

Routes: `shell/routes.ts` holds **UX §2.1's `ClassTabId`, `SettingsSection` and `Route` verbatim** (`today`, `class`,
`lecture`, `document`, `note`, `exam`, `practice`, `ask`, `settings`); joining, inviting, creating a class and recording
are dialogs, not routes. Frozen after M0.

Registries (`app/src/features/registry.tsx`, the file UX §0.2 names; frozen after M0). Every entry is a lazy import of a
file owned by exactly one work package, so no two packages ever edit the same file. The slot types are exact:
```ts
type Lazy<P> = () => Promise<{ default: ComponentType<P> }>;
export type LazyScreen<N extends Route['name']> = Lazy<{ route: Extract<Route, { name: N }>; services: AppServices }>;
export type LazyTab = Lazy<{ classId: ClassId; services: AppServices }>;
export type LazySection = Lazy<{ services: AppServices }>;
export interface DialogPropsMap {
  'new-class': {}; 'class-settings': { classId: ClassId }; leave: { classId: ClassId }; invite: { classId: ClassId };
  join: { code?: string }; record: { classId?: ClassId }; save: { recording: FinishedRecording };
  recover: { recording: FinishedRecording }; import: { classId: ClassId; picked?: Picked[] };
  model: { classId: ClassId; lectureId: Ulid }; 'exam-date': { classId: ClassId; examId?: Ulid };
  'exam-paper': { classId: ClassId; picked?: Picked[] }; 'answer-settings': { classId: ClassId; examId: Ulid; qids: QuestionId[] };
  shortcuts: {}; 'first-share': { classId: ClassId }; 'mass-delete': { classId: ClassId }; 'recently-deleted': { classId: ClassId };
}
export type DialogId = keyof DialogPropsMap;   // 'pair' is v1.1; 'ai-busy' and 'folder-missing' are inline (below)
export type LazyDialog<I extends DialogId> = Lazy<{ props: DialogPropsMap[I]; services: AppServices; close(): void }>;
export type LazyDockRow = Lazy<{ services: AppServices }>;          // renders null when it has nothing to show
export type LazyOverlay = Lazy<{ services: AppServices }>;
export interface PaletteGroup { id: string; label: string; items: Array<{ id: string; label: string; detail?: string; icon?: string; run(): void }> }
export type LazyProvider = () => Promise<{ default: (s: AppServices) => {
  id: string; search(q: string, ctx: { classId: ClassId | null }, signal: AbortSignal): Promise<PaletteGroup[]> } }>;
export type LazyBadge = () => Promise<{ default: (s: AppServices, classId: ClassId) =>
  ReadableStore<{ count: number; tone: 'neutral' | 'info' | 'danger' } | null> }>;
export type LazyAction = () => Promise<{ default: (s: AppServices, classId: ClassId) => Promise<void> }>;

export const SCREENS: { [N in Route['name']]: LazyScreen<N> };          // features/<folder>/index.tsx (table below)
export const CLASS_TABS: Record<ClassTabId, LazyTab>;                    // features/<folder>/Tab.tsx; 'share' → features/class/ShareTab.tsx
export const SETTINGS_SECTIONS: Record<SettingsSection, LazySection>;    // features/settings/ (see §11.5 for the three sections owned elsewhere)
export const DIALOGS: { [I in DialogId]: LazyDialog<I> };                 // opened with useDialogs().open(id, props); the demo's `dialog=` param uses the same ids
export const DOCK_ROWS: LazyDockRow[];                                    // features/record/DockRow.tsx, features/record/JobRow.tsx (transcription job / model download), UX §2.7
export const OVERLAYS: LazyOverlay[];                                     // features/members/Admission.tsx, features/sync/Overlays.tsx, features/record/Recovery.tsx, features/members/DeepLinks.tsx
export const PALETTE_PROVIDERS: LazyProvider[];                           // features/search/provider.ts (UX §3.13)
export const RAIL_BADGES: LazyBadge[];                                    // features/chat/railBadge.ts, features/record/railBadge.ts
export const ACTIONS: { importDocuments: LazyAction; newNote: LazyAction };   // features/documents/actions.ts, features/notes/actions.ts
export const CLASS_STATES: { folderMissing: Lazy<{ classId: ClassId; services: AppServices }> };   // features/sync/FolderMissing.tsx
```
Not registry dialogs (rendered inline by their feature, UX §3.15.4, §3.15.6): the AI busy chooser
(`features/ask/BusyChooser.tsx`, used by Ask, exams and chat) and the folder-missing card (shown by the class screen in
place of the tabs through `CLASS_STATES`). Local to their feature (not in `DialogId`): `record-pick-class`
(`features/record/`), the note conflict dialog (`features/notes/`), the member remove dialog (`features/members/`).

### 11.5 `features/` — one folder per screen family (names and test ids from the UX spec)

| Folder | Contents | Root / ready test ids (UX) | Owner (wave 2) |
|---|---|---|---|
| `onboarding` | phase `welcome` (UX §3.1) | `onboarding-*` | UI-SHELL |
| `today` | route `today` (UX §3.2) | `screen-today` | UI-SHELL |
| `class` | route `class`: header, tab host, `ShareTab.tsx`, dialogs `new-class`, `class-settings`; archive/delete (UX §3.3) | `screen-class`, `class-dialog`, `class-share-tab` | UI-SHELL |
| `settings` | route `settings`: profile, appearance, notifications, storage, privacy ("What leaves this computer"), about; dialog `shortcuts` (UX §3.14, §2.10) | `screen-settings`, `settings-<section>`, `shortcuts-dialog` | UI-SHELL |
| `settings/AiSection.tsx` | Settings › AI (UX §3.14.3) | `settings-ai` | UI-EXAMS |
| `settings/TranscriptionSection.tsx` | Settings › Transcription (UX §3.14.4) | `settings-transcription` | UI-LECTURES |
| `settings/SharingSection.tsx` | Settings › Sharing + diagnostics (UX §3.14.5) | `settings-sharing` | UI-GROUP |
| `lectures` | tab `lectures` (UX §3.4) + transcription status card | `class-lectures`, `lecture-list` | UI-LECTURES |
| `lecture` | route `lecture` (UX §3.5) | `screen-lecture`, `lecture-transcript` | UI-LECTURES |
| `record` | dialogs `record`, `save`, `recover`, `import`, `model`; `DockRow.tsx`, `JobRow.tsx`, `Recovery.tsx`, `railBadge.ts` (UX §3.6, §2.7) | `record-dialog`, `record-save`, `record-recover`, `import-dialog` | UI-LECTURES |
| `documents` | tab `documents` (UX §3.7.1), `actions.ts` | `class-documents`, `doc-list` | UI-DOCS |
| `document` | route `document` (UX §3.7.2) | `screen-document` | UI-DOCS |
| `notes` | tab `notes` + route `note` (UX §3.8), `actions.ts` | `class-notes`, `note-list`, `screen-note` | UI-DOCS |
| `search` | palette provider (UX §3.13) | `palette`, `palette-result` | UI-DOCS |
| `exams` | tab `exams`; dialogs `exam-date`, `exam-paper` (UX §3.9.2–§3.9.4) | `class-exams`, `exam-list` | UI-EXAMS |
| `exam` | route `exam` (modes extracting, review, answers, practice), route `practice`, dialog `answer-settings` (UX §3.9.5–§3.9.9) | `exam-extracting`, `exam-review`, `exam-answers`, `question-list`, `exam-practice` | UI-EXAMS |
| `ask` | tab `ask`, route `ask`, inline `BusyChooser.tsx` (+ the cost confirm) (UX §3.11, §3.15.6–§3.15.7) | `class-ask`, `ask-thread`, `screen-ask`, `ai-busy-chooser` | UI-EXAMS |
| `chat` | tab `chat` (UX §3.10), `railBadge.ts` | `class-chat`, `chat-list` | UI-GROUP |
| `members` | tab `members`; dialogs `invite`, `join`, `leave`; `Admission.tsx` notices; `DeepLinks.tsx` (UX §3.12) | `class-members`, `member-list`, `invite-dialog`, `join-dialog` | UI-GROUP |
| `sync` | dialogs `first-share`, `mass-delete`, `recently-deleted`; `FolderMissing.tsx`; sync error card; copied-identity card; remote mass-deletion notice; Windows file-name notice; `Overlays.tsx` (UX §3.15.1–§3.15.4, §3.15.9) | `first-share-dialog`, `sync-error-card`, `mass-delete-dialog`, `mass-delete-remote`, `folder-missing`, `identity-copied`, `recently-deleted` | UI-GROUP |

The shell (UI-SHELL) owns the rail, pills, dock frame, palette frame, missing-item state, newer-format banner and crash
screen (UX §2, §3.15.8, §3.15.10–§3.15.11). M0 creates every file the registries import as a placeholder (plan §2.3
item 7) so every route, tab, section and dialog renders from day one.

### 11.6 `demo/` — the browser demo (UX §7 is authoritative)

The demo implements UX §7 exactly: fictional classes `law` (pt-PT), `bio` (en), `stats` (es-ES, local only), `hist`
(archived, empty); the content files, deterministic filler transcripts and peaks; the URL parameters and hooks of
UX §7.2; the shots of UX §7.4. `main.tsx`: `isTauri() ? createTauriPlatform() : (await import('./demo/boot')).bootDemo()`.

| File | Owner |
|---|---|
| `demo/boot.ts` (URL params, memory platform + fakes, initial route and `dialog=`), `demo/freeze.ts` (`freeze()` verbatim from Trama), `demo/hooks.ts` (`window.__tramadoDemo` = UX §7.2 hooks, delegating to `DemoControls`), `demo/controls.ts` (the interface below), `demo/keys.ts` (`DemoKeys`: demo keys → ids, filled by the seed) | M0 (frozen) |
| `demo/example/**` (types, people, law, bio, stats, hist, content, fill, example.test.ts), `demo/seed.ts` (writes spec-conformant class folders, private data and app files from the example objects — no services), `demo/fakeMedia.ts`, `demo/assets/**`, `tools/fixtures/build-demo-assets.mjs` | T-DEMO (wave 1), then integrator |

Fakes implement the demo modes and their part of `DemoControls`: `platform/memory/ai.ts` (`ai=fake|off|busy|quota|badkey`,
`aiNext`, `aiFail`), `platform/memory/sync.ts` (`sync=fake|offline|error|local`, `join=ask`, `unverified=1`,
`peerSays`, `peerAdds`, `peerJoins`, `setOnline`), `platform/memory/speech.ts` (`speech=fake`, `model=`, `recording=1`,
`claimTranscription`, `finishTranscription`, `tick`).
```ts
export interface DemoControls {
  files: { addFile(classKey: string, relPath: string, base64: string): Promise<void>; queueAnswer(a: DialogAnswer): void };
  ai?: { next(textOrFn: string | ((req: unknown) => string)): void; fail(code: ErrorCode): void };
  sync?: { peerSays(classKey: string, memberKey: string, text: string): Promise<void>;
           peerAdds(classKey: string, memberKey: string, relPath: string, base64: string): Promise<void>;
           peerJoins(classKey: string, name: string, deviceName: string): Promise<void>;
           setOnline(memberKey: string, online: boolean): void };
  speech?: { claimTranscription(lectureKey: string, memberKey: string, percent: number): Promise<void>;
             finishTranscription(lectureKey: string): Promise<void>; tick(ms: number): void };
}
```

### 11.7 `workers/`

| Worker | Messages (typed RPC in `workers/rpc.ts`) | Notes |
|---|---|---|
| `search.worker.ts` | `load(classId, docs: Array<{key, text, units}>)`, `upsert(classId, key, text, units)`, `remove(classId, key)`, `query(scope, q, opts) → Passage[]`, `passage(classId, id, opts)`, `find(scope, q)`, `stats(classId)` | Owns one `PassageIndex` per class (D16). `IndexHost` (§11.2): `createWorkerHost()` in `main.tsx` and `demo/boot.ts`, `createInlineHost()` (same engine, same thread) in Vitest; both passed in `AppContext`. |
| `extract.worker.ts` | `extract(bytes: ArrayBuffer (transferred), kind, name) → progress events → TextCache` ; `cancel(id)` | pdf.js page by page (`isEvalSupported: false`), mammoth lazily, pptx; one file at a time (≈ 80 MB RSS for 800 pages, critique G9). `ExtractHost` (§11.2) wraps it; `createInlineExtractHost()` in Vitest. |
| `image.worker.ts` | `prepare(bytes, mime, maxSide, quality)`, `renderPdfPage(bytes, page, maxSide)` | `OffscreenCanvas` + `createImageBitmap` (EXIF orientation `from-image`); backs `ImagePrep`/`PdfRender` |

---

## 12. State and reactivity: how screens see files change

```
 disk change (Tramado itself, Syncthing, a file manager)
   │
   ├─ Rust notify watcher (300 ms debounce) ──► `class:changed` {classId, paths, selfWrite, rescan}
   └─ Syncthing loop B ──► `sync:event` remoteChange {classId, path, action, modifiedBy}
                                   │
 platform.events ──► services/index.ts router
   ├─ remoteChange → TrustService.noteRemote(path, modifiedBy, mono)      (kept 10 min per path)
   └─ both        → ClassStore(classId).ingest(paths, {selfWrite, rescan})
                         │  ReloadGate (Trama): one load at a time, trailing reload, ≤ 500 ms coalescing
                         ▼
                    for each path: classifyPath → stat → (machine/manifest) read + parse + TrustGate.verify
                    → update index / file cache → bump `kinds[k]` → state.set(...) → onChange(k) listeners
                         │
 domain services (subscribed to kinds) recompute views with pure core functions
   → Store<T>.set(next) only when the view changed (structural equality on ids + revisions)
                         │
 React: const v = useStore(services.forClass(id).lectures.list)   // useSyncExternalStore
```

Rules:
1. **Trust before display.** For a machine file of a shared class, `ClassStore` exposes new content only after
   `TrustGate.verify` returns `trusted` (or `prefix`, then only the trusted prefix). The gate first compares the
   SHA-256 with the trust cache (unchanged content = trusted); otherwise it calls `platform.sync.fileInfo` and accepts
   `localModifiedBy` only when `localBlocksHash` equals the block hash of the bytes it read (retrying every 200 ms for
   up to 3 s, then `pending`, which keeps the last trusted content). A `remoteChange` event only triggers this check,
   never decides it (sync spec §12.1–12.2). Signed files also need a valid signature, person proof and no rollback;
   manifests a valid derived ID; deletions the writer's `modifiedBy` (folder spec §6). Untrusted content is ignored
   and counted in `SyncUiState.foreignWrites`. Local-only classes use the default gate (`trusted`), except that
   signatures and derived IDs are still checked on adopted folders.
2. **Own writes** update the store optimistically (`TrustGate.noteOwnWrite`); the echoing `class:changed` with
   `selfWrite: true` is dropped when size and mtime match the cache.
3. **Appends** (chat, edits, annotations, consent, mod, exam-edits) are read incrementally from the last offset
   (`readJsonl(path, {offset, prefixSha256})`); a shrunk file or changed prefix (redaction) triggers a whole re-read.
4. **Discovery** (folder spec §5.3) runs in `ClassStore.start()` (two listings: the content tree with
   `maxDepth: 6`, and `.tramado/` with `includeTramado: true`), on `rescan`, and as a safety pass every 10 minutes
   and when the window regains focus after ≥ 60 s hidden.
5. **Event routing** of `sync:event` (in `services/sync.ts`): `status`/`folder`/`connection`/`completion` →
   `SyncUiState` and `ClassDetail.people[].devices[].online`; `indexUpdated` → `ChatService` delivery ticks
   (≤ 1 poll / 2 s while unsent lines exist, sync spec §15); `joinRequest`/`admitted`/`folderOffer`/`massDelete`/`massDeleteRemote`/
   `markerMissing`/`folderErrors` → `SyncUiState` (UI overlays) and notifications; `gap` → re-snapshot, trust pass,
   policy push; `listenAddresses` → `ClassService.refreshOwnMemberFile()` (debounced 5 min).
6. **Policy push** (D-1): `ClassService` recomputes `computePolicy()` whenever trusted `members`, `meta`, `bans` or
   the binding change and calls `platform.sync.setPolicy()` (debounced 1 s; also at boot for every shared class).
7. **Search index**: `SearchService` listens to `document`, `transcript`, `note`, `exam` kinds; extracts changed files
   one at a time in `extract.worker`, writes `cache/text/<sha256>.json`, then `upsert`s the search worker.

---

## 13. Caches, private data and preferences

### 13.1 Cache (`app_cache_dir`, rebuildable, never synced)

| Key | Content | Written by |
|---|---|---|
| `text/<sha256>.json` | `{"format":"tramado.text-cache","version":1,…TextCache}`; `extractor` = `"tramado-extract/<n>"` — a different `n` means re-extract | `ExtractionService` (TS) |
| `ocr/<sha256>.json` | `{"format":"tramado.ocr-cache","version":1,"model","text","at"}` (image or PDF page bytes hash) — never pay twice for the same page | `ExamService` |
| `peaks/<sha256>-<buckets>.json` | `{"format":"tramado.peaks","version":1,"buckets":[0..255]}` | Rust `speech_peaks` |
| `models-catalog.json` | `{"fetchedAt": EpochMs, "data": [/models entries]}` (24 h) | `AiService` |

### 13.2 Private data (`app_local_data_dir/private/<classId>/`, never synced, critique D44)

| Path | Format | Owner service |
|---|---|---|
| `trust.json` | `{"format":"tramado.trust-cache","version":1,"files":{path:{sha256,length,prefixSha256,blocksHash,size,mtimeMs,hlc?,deletedAt?}},"pinnedTranscriptWriters":{lectureId:{deviceId,round}},"left":{deviceId:{at:Instant,hlc:Hlc}},"vacated":[MemberId]}` (entries of deleted files kept 31 days, folder spec §6.2 rule 1) | TrustService |
| `trusted/<class path>` | last trusted bytes of `class.json`, `members/*`, `meta/*`, `bans/*`, `mod/*` (≤ 64 KiB each; folder spec §6.2 rule 4) | TrustService |
| `lectures/<lectureId>.json` | `{"format":"tramado.lecture-private","version":1,"summary":AskTurn\|null,"terms":AskTurn\|null,"removedAutoMarks":[atMs]}` | LectureService / AskService |
| `ui-state.json` | `{"format":"tramado.ui-state","version":1,"dismissed":{"examIntegrity":[examId],"inviteCard":bool,"largeClass":bool}}` | UI owners through `ClassService` |
| `chat-state.json` | `{"format":"tramado.chat-state","version":1,"readHlc":Hlc,"offsets":{path:{offset,prefixSha256}}}` | ChatService |
| `notes/<name>.md` | private notes (Markdown) | NotesService |
| `annotations.jsonl` | `AnnotationLine` lines (private ones; `ai: {model}` for "Annotate with AI") | AnnotationService |
| `markers/<lectureId>.json` | `MarkersFile` shape (private markers) | LectureService |
| `exams/<examId>.json` | `{"format":"tramado.exam-private","version":1,"myAnswers":{qid:text},"correct":{qid:text},"marks":{qid:"right"\|"partly"\|"wrong"\|"unsure"},"revealed":{qid:true},"inPractice":{qid:true},"hints":{qid:{text,citations,model,at}},"practice":{qid:{last:Instant,result:"again"\|"gotIt",count:number}}}` (hints are private, never in `answers/`) | ExamService |
| `ask/<threadId>.jsonl` | `AskTurn` lines, one file per thread (UX §3.11) | AskService |
| `mirror/<class path>` | copies of my own machine files | **Rust only** |

### 13.3 App files and preferences

`config/identity.json` = `{"format":"tramado.identity","version":1,"memberId","name","deviceName","colour"|null,"personPub","createdAt"}`
(folder spec §12 plus `deviceName`, `colour` and `personPub`; `memberId = memberId(personPub)`, folder spec §2.1). The
person key itself is **not** in this file: it is the internal secret `person` of `tramado-net::secrets` (OS keychain,
or `config/secrets.json` mode 0600), used only by Rust (§5.2 `person`).
`data/hlc.json` = `{"format":"tramado.hlc","version":1,"ceilingMs"}` (folder spec §3.3).
`config/prefs.json` is a flat string map (Trama `parsePrefs`), written only by TS, read by Rust at start for the
keys marked R. `services/prefs.ts` exports this table as `PREF_DEFAULTS` (§11.2); `set` refuses values outside the
listed ones. JSON-valued keys hold compact JSON strings.

| Key | Values (default) | R |
|---|---|---|
| `ui.locale` | `en` \| `pt` \| `es` (detected) | |
| `ui.theme` | `system` \| `light` \| `dark` (`system`) | |
| `ui.textSize` | `0.875` \| `1` \| `1.125` \| `1.25` \| `1.5` (`1`) — webview zoom (UX §3.14.2) | |
| `ui.readingFont` | `default` \| `atkinson` \| `opendyslexic` (`default`) — `html[data-font]` | |
| `ui.reduceMotion` | `system` \| `1` (`system`) | |
| `ui.classOrder` | JSON array of ClassIds (`[]` = creation order) | |
| `app.trayOnClose` | `1` \| `0` (`1`, D48) | R |
| `app.trayAsked` | `0` \| `1` (`0`) | |
| `classes.last` | ClassId \| `''` | |
| `today.checklistDismissed` | `0` \| `1` (`0`) | |
| `search.recent` | JSON array of ≤ 5 strings (`[]`) | |
| `lecture.playbackRate` | `0.5` … `3` in the UX steps (`1`) | |
| `record.<classId>` | JSON `{mode: 'room'\|'online', includeMic: boolean, share: ShareMode, language: Lang\|'auto'}` (absent) | |
| `ai.enabled` | `1` \| `0` (`1`) | |
| `ai.model` | model id (`google/gemma-4-31b-it:free`) | |
| `ai.fallbacks` | JSON array of ≤ 2 ids (`[]` = level defaults) | |
| `ai.customHost` | hostId \| `''` | |
| `ai.answerLanguage` | `question` \| `ui` (`question`) | |
| `ai.generalDefault` | `0` \| `1` (`0`) | |
| `ai.deepDefault` | `0` \| `1` (`0`) | |
| `exam.tryFirst` | `1` \| `0` (`1`, D53) | |
| `speech.model` | `turbo` \| `small` \| `large-v3` (`turbo`) — the active model | |
| `speech.volunteer` | `off` \| `plugged` \| `always` (`plugged`; effective only with a local model, sync spec §14.3) | |
| `speech.volunteerAsked` | `0` \| `1` (`0`; the one-time notice was shown) | |
| `speech.cloud` | `0` \| `1` (`0`, D25) | |
| `speech.cloudModel` | model id (`openai/whisper-large-v3-turbo`) | |
| `speech.cloudAuto` | `0` \| `1` (`0`, sync spec §25 Q5) | |
| `speech.inputDevice` | device id \| `''` (`''` = system default) | |
| `speech.bitrate` | `24000` \| `16000` (`24000`; stereo online recordings always use 32000) | |
| `speech.markerShortcuts` | `''` (off) \| `1` (`Ctrl/⌘+Alt+1…4`) | R |
| `speech.markerOffsetMs` | `0` \| `3000` \| `5000` \| `10000` (`3000`) | |
| `sync.localOnly`, `sync.paused` | `0` \| `1` (`0`) | R |
| `sync.maxSendKbps`, `sync.maxRecvKbps` | integer ≥ 0 (`0`) | R |
| `notify.system` | `1` \| `0` (`1`) | |
| `notify.default` | `important` \| `all` \| `none` (`important`) — level for classes without their own | |
| `notify.class.<classId>` | `important` \| `all` \| `none` (absent = `notify.default`) | |
| `notify.transcripts`, `notify.joins`, `notify.exams`, `notify.model` | `1` \| `0` (`1`) | |
| `pinsHidden.<classId>` | `0` \| `1` (absent) — v1.1 pins strip | |
| `privacy.deleteAudioAfterDays` | `0` \| `30` \| `90` (`0`) | |
| `dev.rotation` | `0` (v1.1 flag; ignored in 0.1) | |

Rust-owned settings files: `config/classes.json` (§5.1), `config/ai.json` (privacy, `busyRelax`), `config/service-hosts.json`
(Trama format), `config/secrets.json` (fallback only; also the person key when there is no keychain),
`data/syncthing/{tramado-instance.json,runtime.json,policy.json,appdata.json}`, `data/ai-activity.jsonl`,
`data/logs/app.log`.

---

## 14. Internationalisation

Machinery copied verbatim from Trama (`core/i18n/translate.ts`, `languages.ts`, `catalogs.ts`, `catalogs.test.ts`,
`ui/i18n.tsx`): English is the source; `pt/<ns>.ts` and `es/<ns>.ts` are typed `Messages['<ns>']` so a missing key
fails `tsc`; `catalogs.test.ts` fails when more than 5 % of non-English strings equal English or a `{placeholder}` is
lost; plurals `{one, other}` with bcp47 `en-GB`, `pt-PT`, `es-ES`. Register: Trama's (PT "você" implied, ES "usted").

Namespaces are **the UX spec's** (UX §5, which holds every English string, "ready to paste", including `notify`, UX
§5.22). One file per namespace per language: `app/src/core/i18n/locales/{en,pt,es}/<ns>.ts`; the three `index.ts`
files are frozen after M0.

| Namespace | Source of the English strings | Owner |
|---|---|---|
| `common`, `errors`, `a11y` | UX §5.1, §5.20, §5.21 | M0 (EN/PT/ES complete; frozen) |
| `notify` | UX §5.22: notification texts raised by services (`NotificationService`) | M0 (EN/PT/ES complete; frozen) |
| `app`, `onboarding`, `today`, `classes`, `settings`, `privacy` | UX §5.2, §5.4, §5.5, §5.6, §5.17, §5.18 | UI-SHELL |
| `sync`, `chat`, `members` | UX §5.3, §5.12, §5.15 | UI-GROUP |
| `lectures`, `record`, `speech` | UX §5.7, §5.8, §5.19 | UI-LECTURES |
| `documents`, `notes`, `search` | UX §5.9, §5.10, §5.16 | UI-DOCS |
| `exams`, `ask`, `ai` | UX §5.11, §5.13, §5.14 | UI-EXAMS |

M0 pastes every English catalog of UX §5 into `en/<ns>.ts`. For `pt` and `es`, the four M0 namespaces are translated;
every other namespace starts as a copy of English that also exports `export const pending = true`. `catalogs.test.ts`
skips the "identical to English" check for pending namespaces (keys and placeholders are still checked, and `tsc` still
fails on a missing key); each wave-2 owner translates its namespaces and removes `pending`; with `TRAMADO_RELEASE=1`
the test fails while any `pending` remains (gate G3).

Strings that end up **in files** are not UI catalogs: localised directory names (`core/model/dirs.ts`), transcript
Markdown labels (`core/transcript/labels.ts`), AI prompts (`core/ai/prompts/*`). Consent sentences are catalog
strings with versioned keys (`record.dialog.consent.v1`, `record.dialog.consentShare.v1`, UX §5.8); the key is stored
as `textId` and the shown text verbatim (folder spec §8.5); changing a sentence means adding `….v2`.

Glossary (critique D51, C27; extends Trama's):

| EN | PT-PT | ES |
|---|---|---|
| Class | Disciplina (search keywords: cadeira, UC) | Asignatura |
| Class group (the people) | Turma | Grupo de clase |
| Lecture | Aula | Clase |
| Exam / Test | Exame / Teste | Examen / Prueba |
| Organiser | Organizador(a) | Organizador/a |
| Classmate | Colega | Compañero/a |
| Recording / Transcript | Gravação / Transcrição | Grabación / Transcripción |
| Notes (class / mine) | Notas (da turma / minhas) | Notas (de la clase / mías) |
| Invite code | Código de convite | Código de invitación |
| Shared | Partilhado | Compartido |
| File / Folder | Ficheiro / Pasta | Archivo / Carpeta |
| Settings | Definições | Ajustes |
| AI draft / Source | Rascunho da IA / Fonte | Borrador de la IA / Fuente |
| Ask (tab) / @AI | Perguntar / @IA | Preguntar / @IA |

---

## 15. Error taxonomy (critique §8 + D-2)

TS (`app/src/core/errors.ts`, M0):
```ts
export const ERROR_CODES = [
  // common
  'INVALID', 'NOT_FOUND', 'PERMISSION_DENIED', 'IO_ERROR', 'DISK_FULL', 'CANCELLED', 'JOB_BUSY', 'PATH_OUTSIDE_CLASS',
  'SYMLINK_REFUSED', 'CONFLICT', 'NEWER_FORMAT', 'UNSUPPORTED_FILE', 'NOT_IMPLEMENTED',
  // AI
  'AI_NO_KEY', 'AI_AUTH', 'AI_NO_CREDIT', 'AI_MODEL_GATED', 'AI_FLAGGED', 'AI_PRIVACY_BLOCKS', 'AI_UNSUPPORTED',
  'AI_MODEL_UNKNOWN', 'AI_TOO_LONG', 'AI_BAD_REQUEST', 'AI_BUSY', 'AI_FREE_LIMIT', 'AI_UPSTREAM', 'AI_UNAVAILABLE',
  'AI_TIMEOUT', 'AI_OFFLINE', 'AI_LENGTH', 'AI_HOST_NOT_ALLOWED', 'AI_BAD_ADDRESS',
  // speech
  'SPEECH_NO_DEVICE', 'SPEECH_PERMISSION', 'SPEECH_NO_SYSTEM_AUDIO', 'SPEECH_UNSUPPORTED_AUDIO', 'SPEECH_NO_SPEECH',
  'SPEECH_UNSUPPORTED_CPU', 'MODEL_NOT_DOWNLOADED', 'MODEL_UNREADABLE', 'MODEL_DOWNLOAD_FAILED', 'MODEL_INTEGRITY',
  // sync
  'SYNC_UNAVAILABLE', 'SYNC_LOCKED', 'SYNC_PORT', 'SYNC_FOLDER_MARKER_MISSING', 'SYNC_INVITE_INVALID', 'SYNC_FOREIGN_WRITE',
  'SYNC_IDENTITY_COPIED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export class PlatformError extends Error {
  constructor(readonly code: ErrorCode, message: string = code, readonly data: Record<string, unknown> = {}) { super(message); this.name = 'PlatformError'; }
}
export function toPlatformError(e: unknown): PlatformError;   // {code,message,data} objects; Tauri strings → INVALID/IO_ERROR
```

Rust (`crates/tramado-base/src/error.rs`, M0):
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Code {
    Invalid, NotFound, PermissionDenied, IoError, DiskFull, Cancelled, JobBusy, PathOutsideClass, SymlinkRefused,
    Conflict, NewerFormat, UnsupportedFile, NotImplemented,
    AiNoKey, AiAuth, AiNoCredit, AiModelGated, AiFlagged, AiPrivacyBlocks, AiUnsupported, AiModelUnknown, AiTooLong,
    AiBadRequest, AiBusy, AiFreeLimit, AiUpstream, AiUnavailable, AiTimeout, AiOffline, AiLength, AiHostNotAllowed, AiBadAddress,
    SpeechNoDevice, SpeechPermission, SpeechNoSystemAudio, SpeechUnsupportedAudio, SpeechNoSpeech, SpeechUnsupportedCpu,
    ModelNotDownloaded, ModelUnreadable, ModelDownloadFailed, ModelIntegrity,
    SyncUnavailable, SyncLocked, SyncPort, SyncFolderMarkerMissing, SyncInviteInvalid, SyncForeignWrite,
    SyncIdentityCopied,
}
impl Code { pub fn as_str(self) -> &'static str; /* match arm per variant, "INVALID" … */ }

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")] Coded { code: Code, message: String, data: Option<serde_json::Value> },
    #[error(transparent)] Io(#[from] std::io::Error),
}
pub type AppResult<T> = Result<T, AppError>;
impl AppError {
    pub fn new(code: Code, message: impl Into<String>) -> Self;
    pub fn with_data(self, data: serde_json::Value) -> Self;
    pub fn code(&self) -> Code;     // Io: NotFound→NotFound, PermissionDenied→PermissionDenied, AlreadyExists→Conflict,
                                    // StorageFull | QuotaExceeded | raw ENOSPC(28)/EDQUOT(122)/ERROR_DISK_FULL(112)/(39)→DiskFull, else IoError
}
impl serde::Serialize for AppError { /* {"code": as_str, "message": to_string, "data"?: …} */ }
```
`test-vectors/error-codes.json` lists the codes; `core/errors.test.ts` and a Rust unit test both compare against it.
Data payloads: `AI_FREE_LIMIT {resetAt: EpochMs|null, used?, limit?}`, `AI_UNAVAILABLE {retryAfterS}`,
`AI_BUSY {model?}`, `AI_MODEL_UNKNOWN {model}`, `AI_TOO_LONG {model}`, `AI_PRIVACY_BLOCKS {declined?: true}`,
`NEWER_FORMAT {format, version, pair?: true}`, `DISK_FULL {needBytes?, freeBytes?}`, `CONFLICT {path?}`,
`SYNC_FOREIGN_WRITE {name, path}` (`name` = the person whose file it is), `AI_PRIVACY_BLOCKS {declined?: true, stt?: true}`.
The UI shows
`t('errors.<CODE>', data)`; messages go to logs only; OpenRouter `user_id` and `metadata.raw` are never logged.

---

## 16. Security model

| Rule | Where |
|---|---|
| Webview has no network: CSP `connect-src 'self' ipc: http://ipc.localhost blob: data: tramado-media: http://tramado-media.localhost` | `tauri.conf.json` |
| No plugin permission is granted to JS except core window operations (§18.4); dialogs, opener, notifications, deep links, autostart and shortcuts are called from Rust | `capabilities/default.json` |
| Keys never cross IPC outward: `secret_*` only sets, reports `{set, last4, store}` and clears; Syncthing's key lives only in `config.xml` (0600) and the child's environment | `tramado-net::secrets`, `tramado-sync::init` |
| Every class operation is confined: registered class id + class path rules + symlink refusal on every existing component; no absolute paths from the webview; picks are tokens | `tramado-base::confine`, `picks` |
| AI requests: path allow-list, host allow-list, key injection, `provider` overwrite, `user` removal, native confirmation to relax privacy | `tramado-net::ai` |
| Syncthing: API key via `STGUIAPIKEY`, GUI password set (bcrypt), loopback GUI on a fresh port, no introducers, admission by folder-ID proof, config writer serialised | `tramado-sync` |
| Machine files trusted only after the authorship check bound to the bytes read; deletions need the writer's `modifiedBy`; own files self-heal from the mirror | `core/sync/trust.ts`, `tramado-sync::selfheal` |
| Membership and authority records signed with the device key (Rust holds it; the signed message has a Tramado prefix, the class ID and the path); person proofs with the person key (Rust holds it and signs only bindings of this device); class, lecture and exam IDs derived from the creating device | `tramado-sync::sign`, `tramado-net::person`, `core/model/{sig,derive}.ts` |
| Rust re-checks every widening action (share, admit, roster add, join devices) against Syncthing's own state, whatever the policy says; until this session's policy arrives it only narrows | `tramado-sync::admission`, `reconcile` (sync spec §9.5) |
| The Syncthing home is refused on another computer (copied identity) | `tramado-sync::init` (sync spec §2.5) |
| Untrusted Markdown (chat, notes, transcripts, AI output) rendered without raw HTML; links `https:`/`mailto:` only, opened through `open_external` with a native host confirmation; images only from `tramado-media:` | `core/text/markdown.ts`, `MarkdownView` |
| Media scheme serves only confined files with explicit MIME and `nosniff`; SVG gets a `default-src 'none'` CSP | `media.rs` |
| Logs and diagnostics carry no content and truncate device IDs to ShortIds | `applog`, `diag` |
| `TRAMADO_E2E` hooks are honoured only together with `TRAMADO_DATA_DIR` | `paths` |

---

## 17. Testing strategy

| Layer | What it proves | Where | Command | Runs |
|---|---|---|---|---|
| Vitest unit | pure core logic (spec algorithms, parsers, AI client, prompts) | `app/src/core/**/*.test.ts` | `npm test` | every change, CI |
| Vitest property | convergence under partitions, skew ±10 min, crashes (claims §14.9), HLC order, chat fold commutativity, meta LWW convergence, invite round trip | `**/*.property.test.ts` (fast-check, seeded) | `npm test` (200 runs) / `npm run test:property` (2000) | CI / nightly |
| Vitest services | services over the memory platform; multi-device flows over `createMemoryMesh()` (chat crosses, roster → policy, forged write and forged deletion ignored and healed, forged `memberId` attributed to the writer's person, claim hand-over, partition where both finish, leave while others are offline, ban effects; rotation and pairing in v1.1) | `app/src/services/**/*.test.ts`, `app/src/services/mesh/*.test.ts` | `npm test` | CI |
| Golden | tolerant parsing of saved real model outputs (exam extraction, OCR, SSE streams, error bodies) copied from the lab into `app/test-fixtures/ai/` | `core/ai/*.golden.test.ts`, `core/exam/*.golden.test.ts` | `npm test` | CI |
| Shared vectors | Rust and TS agree on class-path rules, admission decisions, error codes, derived IDs, time strings, check words, IPC samples (HLC vectors: TS only; Rust writes no HLCs) | `test-vectors/*.json` | both suites | CI |
| Contract checks | command names in `platform/tauri/*.ts` = `generate_handler!` list in `lib.rs`; layer import rules | `platform/commands.test.ts`, `layers.test.ts` | `npm test` | CI |
| Rust unit | confinement, atomic writes, line rules, registry (unknown fields kept), media Range, ids; AI pipe (SSE pass-through, header injection, provider overwrite per level, `user`/`user_id` stripping, path/host allow-lists) on `MockServer`; secrets file fallback (0600); sync init template, port probe, admission vectors, reconcile on a fake client, config-writer serialisation, event priming/gap detection; speech resample, Ogg recovery of a torn file, WebM remux read back by symphonia (duration, pre-skip), downloader (resume, 206/200, integrity) | `crates/*/src/**` `#[cfg(test)]` | `npm run test:rust` (light), `npm run test:rust:speech` | CI (light every change; speech nightly or on `crates/tramado-speech/**` changes) |
| Rust contract | real Syncthing v2.1.7 (sync spec §24): pre-seed + generate; create paused → ignores → resume; POST-replaces semantics; pending device → provisional → folder offer → share; outsider rejected and ignored; event names accepted; `modifiedBy` after a foreign write; `ignoredFolders` PATCH shape (§25 Q7); shutdown timing | `crates/tramado-sync/tests/contract.rs` (`#[ignore]`) | `npm run test:contract` | CI Linux |
| Rust two-instance | `SyncEngine` × 2 on loopback: invite → join → admitted; file and chat line cross with the right `modifiedBy`; forged own file healed; leave propagates; ban applies | `crates/tramado-sync/tests/two_instances.rs` (`#[ignore]`) | `npm run test:contract` | CI Linux |
| Speech opt-in | real transcription of a sample (`TRAMADO_SPEECH_SAMPLE`, `TRAMADO_SPEECH_DIR`), WER/RTF report on 3 reference clips (critique R8), 3 h synthetic lecture under 1.5 GB RSS with resume (R9), device recording | `crates/tramado-speech/tests/*.rs` (`#[ignore]`) | `cargo test -p tramado-speech --release -- --ignored <name>` | manual / pre-release |
| Peek | a demo screen renders: no page error, no Vite overlay, ready test id present, no sideways overflow, axe serious/critical = 0; steps (`--click`, `--press`, `--type`) and **assertions** (`--expect=<testid>[:<count>]`, `--expect-not=<testid>`, `--expect-text=<testid>=<substring>`, `--expect-attr=<testid>:<attr>=<value\|null>`; exit 1 on a mismatch) | `tools/peek.mjs`, `tools/peek-matrix.mjs` | `npm run peek -- --route=<r> --query='…' --ready=<id> --axe [--scale=1.25] [--lang=pt] [--theme=dark] [steps…] --out=<png>` | every UI change |
| Live AI (opt-in) | the default free chain answers through the real pipe: TS `live.test.ts` MUST get one HTTP 200 streamed completion from the no-training chain, separately tries `google/gemma-4-31b-it:free` pinned (6 attempts over 10 min, result reported), and checks `GET /models` lists the default id with price 0 and `tools`; Rust `live_openrouter_pipe` (§5.2); cloud STT `transcribes_through_openrouter_live` (10 s clip, run when the key has credit, else reported "not run: no credit") | `app/src/core/ai/live.test.ts`, `crates/tramado-net/tests/live.rs`, `crates/tramado-speech/tests/live.rs` | `TRAMADO_AI_LIVE=1 OPENROUTER_API_KEY=… npx vitest run …`, `cargo test -p tramado-net --test live -- --ignored` | G1, before releases |
| Screenshots | manual pictures in 3 languages | `tools/screenshots/` | `npm run screenshots` | release |
| Desktop e2e | the real app (release build) through tauri-driver under Xvfb + `dbus-run-session`: suites `smoke` (onboarding, create class, import via dialog queue, CSP style probe, fonts, no-network socket audit, close via `WM_DELETE_WINDOW`; with `TRAMADO_AI_LIVE=1` one real Ask, logging the answering model), `sync-two` (two `TRAMADO_DATA_DIR`s: share, invite, join, document + chat cross, imported recording → exactly one transcript; instances stopped one after the other), `media` (PulseAudio null sink; self-test seek, critique R3; the same self-test already runs in R-SHELL's acceptance) | `tools/desktop-e2e/` | `npm run e2e:desktop`, `npm run e2e:sync`, `npm run e2e:media` | wave 3, then before releases |

Conventions:
- Vitest runs under Node (`environment: 'node'`, Trama config) with `testTimeout: 60_000` and
  `maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || undefined` (set `VITEST_MAX_WORKERS=2` when several agents
  run tests at once).
- Time and randomness are injected (`Clock`, `rand`); no test sleeps on the wall clock. The mesh has fake clocks.
- No network in tests, except loopback (contract tests, MockServer) and opt-in live AI tests guarded by
  `TRAMADO_AI_LIVE=1` (never in CI).
- Fixtures are fictional (Trama rule). PDFs are generated by scripts (`app/test-fixtures/tramado/make-fixtures.mjs`).
  Saved OpenRouter outputs pass through `tools/redact-fixtures.mjs` (fixed fictional `user_id`, `metadata.raw`,
  `Authorization`), and `npm run check:leaks` (`git grep` for `"user_id": "<20+ alnum>"`, `sk-or-v1-<hex>`,
  `OPENROUTER_API_KEY=<value>` outside `docs/`) runs before every merge and push and in `ci.yml`.
- Component tests are not used (Vitest runs under Node without a DOM); UI behaviour is asserted with peek steps and
  assertions (above) and the desktop e2e.

---

## 18. Build and packaging

### 18.1 `tools/fetch-syncthing.mjs`

`node tools/fetch-syncthing.mjs [--target=<triple> | --all] [--gpg] [--force]`. Default target: the host triple
(`rustc -vV` → `host:`). Env `TRAMADO_SYNCTHING_FROM=<dir>` copies archives from a local folder (offline). For each
target: skip when `desktop/src-tauri/binaries/tramado-syncthing-<triple>[.exe]` exists and its `.sha256` stamp
matches the pinned archive hash; otherwise download
`https://github.com/syncthing/syncthing/releases/download/v2.1.7/<asset>` to `tools/.cache/<asset>.part`
(Node `fetch`, redirects followed, progress every 5 %), verify SHA-256, rename, extract `syncthing[.exe]`
(`tar -xzf` for `.tar.gz`; `tar -xf` (bsdtar) for `.zip` on macOS/Windows, `unzip -o` on Linux), copy it to
`desktop/src-tauri/binaries/tramado-syncthing-<triple>[.exe]` (mode 755) and `LICENSE.txt`, `AUTHORS` to
`desktop/src-tauri/resources/syncthing/`. `--gpg` also downloads `sha256sum.txt.asc`, runs
`gpg --verify` against `tools/keys/syncthing-release.asc` and checks the asset's line. On any failure: delete
partial outputs, print "nothing was kept", exit 1.

| Tauri triple | Asset | SHA-256 |
|---|---|---|
| `x86_64-unknown-linux-gnu` | `syncthing-linux-amd64-v2.1.7.tar.gz` | `2edc416e7ed136b7c858ed5f3f02a3b8316589605e54c380228ceea7acbf0142` |
| `aarch64-unknown-linux-gnu` | `syncthing-linux-arm64-v2.1.7.tar.gz` | `48e456690cd2b97e7d26b02b5ac35f62a3b36172267b144cfeaf02c993ab955c` |
| `x86_64-apple-darwin` | `syncthing-macos-amd64-v2.1.7.zip` | `b8be90176d0f24daebae7b5aaddac52ebfae395df6d99f5e0e54656db00868cb` |
| `aarch64-apple-darwin` | `syncthing-macos-arm64-v2.1.7.zip` | `2df075b463231a307c91da657157beaed06383a941ba7ea04d33d536e3c4af38` |
| `universal-apple-darwin` | `syncthing-macos-universal-v2.1.7.zip` | `a98fb709c79412e5586c81a1586bfb256b6e5a97b067ddf7447155bcdf6aac3f` |
| `x86_64-pc-windows-msvc` | `syncthing-windows-amd64-v2.1.7.zip` | `3ce7da770f546a8d02b65b2e7ee31f2a3b8b7c3f990ede045590cca4172ecfe1` |
| `aarch64-pc-windows-msvc` | `syncthing-windows-arm64-v2.1.7.zip` | `d535ffd611b3af223de64bc5dfc60c378881eb13d5c8ecb1431b7407094c15ff` |

Runtime resolution (sync spec §2.1): `TRAMADO_SYNCTHING_BIN` if set, else the sidecar next to the executable; missing
→ `SYNC_UNAVAILABLE` (local classes keep working).

### 18.2 `tools/fetch-speech-assets.mjs`

Default: the Silero VAD (bundled, D24) `https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v5.1.2.bin`
(885 098 B, `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf`) → `desktop/src-tauri/resources/speech/`.
`--model=small|turbo|large-v3 [--dest=.tramado-dev/models]` fetches a whisper model for tests from
`https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/<file>`:
`ggml-small-q5_1.bin` 190 085 487 B `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb`;
`ggml-large-v3-turbo-q5_0.bin` 574 041 195 B `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`;
`ggml-large-v3-q5_0.bin` 1 081 140 203 B `d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1`
(the same table as `tramado-speech::registry`, which is the source of truth; a unit test compares them).
`TRAMADO_SPEECH_FROM=<dir>` copies instead of downloading.

### 18.3 `desktop/src-tauri/tauri.conf.json`

```json
{
  "$schema": "../../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "Tramado",
  "version": "0.1.0",
  "identifier": "eu.thehumanloop.tramado",
  "build": {
    "frontendDist": "../../app/dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev --workspace @tramado/app",
    "beforeBuildCommand": "npm run build --workspace @tramado/app"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [{
      "label": "main", "title": "Tramado", "width": 1360, "height": 860, "minWidth": 1000, "minHeight": 660,
      "center": true, "visible": false, "backgroundThrottling": "disabled"
    }],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: tramado-media: http://tramado-media.localhost; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost blob: data: tramado-media: http://tramado-media.localhost; media-src 'self' blob: tramado-media: http://tramado-media.localhost; object-src 'none'; base-uri 'self'; form-action 'none'",
      "freezePrototype": false,
      "dangerousDisableAssetCspModification": ["style-src"]
    }
  },
  "bundle": {
    "active": true,
    "targets": ["appimage", "deb", "nsis", "dmg"],
    "fileAssociations": [{ "ext": ["tramado-invite"], "name": "Tramado invite", "description": "Tramado class invite",
                           "mimeType": "text/x-tramado-invite", "role": "Viewer" }],
    "category": "Education",
    "shortDescription": "Organise your classes: lectures, documents, exams and class groups",
    "longDescription": "Tramado keeps each class in a plain folder: record and transcribe lectures on your own computer, add documents, keep notes, practise past exams with AI answers that cite your materials, and share a class with classmates through Syncthing, with no server and no account.",
    "copyright": "© Tramado contributors",
    "license": "MPL-2.0",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
    "linux": {
      "deb": { "depends": ["libasound2t64 | libasound2", "libpulse0"] },
      "appimage": { "bundleMediaFramework": true }
    },
    "macOS": { "minimumSystemVersion": "14.2", "entitlements": "macos/Entitlements.plist" },
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper" },
      "nsis": { "languages": ["English", "Portuguese", "Spanish"], "displayLanguageSelector": true }
    }
  },
  "plugins": { "deep-link": { "desktop": { "schemes": ["tramado"] } } }
}
```
On Linux, `npm run build:desktop` builds only `appimage` and `deb` (`--bundles`, §3.4); `nsis` and `dmg` are built by
the per-OS CI release job. `dangerousDisableAssetCspModification: ["style-src"]` is mandatory (critique R17): without it WebKit drops every
inline style (class colours). `app/index.html` carries the same policy as a `<meta>` CSP **plus**
`https://openrouter.ai` in `connect-src` for the browser demo's `?ai=real`; inside Tauri both policies apply, so the
webview still cannot reach the network. `desktop/src-tauri/Info.plist` (merged by Tauri) holds
`NSMicrophoneUsageDescription`, `NSAudioCaptureUsageDescription`, `CFBundleLocalizations` = `[en, pt, es]`;
`macos/Entitlements.plist` holds `com.apple.security.device.audio-input`; localised `InfoPlist.strings` are mapped
with `bundle.macOS.files`.

### 18.4 `desktop/src-tauri/capabilities/default.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window: events and window control only. Every plugin is driven from Rust.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-set-title",
    "core:window:allow-destroy",
    "core:webview:allow-set-webview-zoom"
  ]
}
```
Never grant `shell:*`, `http:*`, `fs:*`, `opener:*`, `dialog:*`, `notification:*` to the webview (D2, D-4).

### 18.5 `desktop/src-tauri/tauri.sidecar.conf.json` (passed to `tauri dev`/`tauri build` with `--config`)

```json
{
  "bundle": {
    "externalBin": ["binaries/tramado-syncthing"],
    "resources": {
      "resources/speech/ggml-silero-v5.1.2.bin": "speech/ggml-silero-v5.1.2.bin",
      "resources/media/selftest.webm": "media/selftest.webm",
      "resources/syncthing/LICENSE.txt": "licenses/syncthing/LICENSE.txt",
      "resources/syncthing/AUTHORS": "licenses/syncthing/AUTHORS"
    }
  }
}
```
Keeping `externalBin` and resources out of `tauri.conf.json` means plain `cargo check/test/clippy` never needs
fetched files (tauri-build fails on a missing sidecar or resource, critique C4).

### 18.6 Packaging targets and supply chain

- Linux 0.1: AppImage (with GStreamer, so `<audio>` plays WebM Opus; no `tramado://` registration, critique G17) and
  deb (sidecar installed as `/usr/bin/tramado-syncthing`). Windows (NSIS) and macOS (dmg, ad-hoc signed) follow from
  the same configuration in CI.
- `npm run check:versions`: reads `Cargo.lock` and `package-lock.json`, queries publish dates, fails if any version
  is younger than 14 days (D59) — run at release.
- `cargo deny check` with `deny.toml` (licences: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0,
  Unicode-3.0, Zlib, CC0-1.0; advisories deny) and `npm audit --omit=dev` in CI.
- Version bump locations: `desktop/src-tauri/tauri.conf.json`, `Cargo.toml` `[workspace.package]`, the three
  `package.json` files; release notes `docs/release-notes/v<version>.md` in EN, PT-PT and ES.

---

## 19. Conventions for contributors and agents

1. **Ownership.** Every file has one owner per wave (the plan lists owned paths per work package). Frozen after
   M0 (changed only by the integrator at a gate): `Cargo.toml` (workspace, all dependencies declared),
   `desktop/src-tauri/src/{lib.rs,state.rs,util.rs,commands/mod.rs}`, all `package.json` files,
   `app/src/platform/types/index.ts` (the `Platform` interface shape),
   `app/src/services/{index,store,context,prefs,identity,hlcClock,classStore}.ts`,
   `app/src/services/types/index.ts`, the three
   `core/i18n/locales/*/index.ts`, `app/src/features/registry.tsx`, `app/src/shell/routes.ts`, `app/src/demo/{boot,hooks,controls,keys}.ts`,
   `app/src/services/types/viewModels.ts`, `core/errors.ts`, `core/model/{derive,jcs,sig}.ts`, `core/sync/checkWords.ts`,
   `docs/spec/check-words-v1.txt`, `app/src/demo/freeze.ts`, every file of `test-vectors/` (`admission.json`,
   `class-paths.json`, `hlc.json`, `error-codes.json`, `ids.json`, `time.json`, `check-words.json`, `ipc-samples.json`),
   and `Cargo.lock` (regenerated by the integrator at gates, §3.2).
2. **Additive contract changes.** The Rust work package owning a domain MAY add optional fields or new union
   members at the end of its `platform/types/<domain>.ts` and the Rust twin, and MUST update its
   `platform/tauri/<domain>.ts`. Anything else (renames, removals, new commands, new dependencies) is a contract
   change: list it under "Contract changes requested" in the final report; the integrator applies it at the gate.
3. **Registries instead of shared edits** (§11.4): routes, class tabs, settings sections, docks, overlays, palette
   providers and rail badges are pre-registered lazy imports.
4. **Strings**: every user-facing string in EN, PT-PT and ES in the same change, in the owner's namespaces only.
5. **Test ids** on every element a test, peek step or e2e touches; identity via `data-*` attributes.
6. **Rust**: no `unwrap`/`expect` outside tests and `run()`; named threads; disk/network in `blocking`; run cargo
   from the repository root (`.cargo/config.toml`); heavy builds with `CARGO_BUILD_JOBS=3` and
   `CMAKE_BUILD_PARALLEL_LEVEL=3` (8 CPUs, 11 GB RAM; at most two heavy Rust builds at once).
7. **No StrictMode**, no DOM in `core/` and `services/`, fictional fixtures only, no network in tests (§17).
8. **Commits**: `<work-package>: <summary>` (e.g. `R-SYNC: admission and reconciliation`), body explains why,
   trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Milestone tags `m0`, `wave1`, `wave2`, `v0.1.0-rc.1`.

---

## 20. Open questions (each with the default used until decided)

| # | Question | Default |
|---|---|---|
| Q1 | (closed) Sync spec wording for D-1. | Done in sync spec 1.1 (§0.6, §1, §6.1, §8, §20). |
| Q2 | Spoken questions (≤ 30 s, free omni model, critique C13). | v1.1. |
| Q3 | Updater plugin (critique G28). | Not in 0.1 (no control in the UI, nothing in the privacy table); opt-in `tauri-plugin-updater` in 0.2, which adds `github.com` to §4.1. |
| Q4 | Index persistence (D-8). | Off; persist `cache/index/<classId>.json` only if a class build exceeds 1 s on the reference machine. |
| Q5 | Shared annotations UI (folder spec §14 Q2). | v1.1: readers SHOULD display them; 0.1 neither writes nor displays them; `AnnotationService` keeps `visibility: 'class'` in its types for v1.1. |
| Q6 | Hidden-window JS timers on Windows/Linux (D-6, §4.3). | Accept coarse timing. WP-INT measures: window hidden 15 min while a joiner knocks and a volunteer delay expires; if either fails, move volunteer timers to Rust (new command `speech_volunteer_schedule`). |
| Q7 | keyring 4 initialisation API. | Default features (`v1`); any initialisation error → file fallback with a visible note (critique R13). |
| Q8 | (closed) Check words (sync spec §25 Q1). | Words in 0.1, `core/sync/checkWords.ts` over `docs/spec/check-words-v1.txt` (M0). |
| Q9 | Cloud STT upload format (audio-pipeline §7.6). | 16 kHz mono WAV pieces ≤ 30 s (Trama). |
| Q10 | (closed) Marker keys (critique C32). | UX mapping (§1.2): `1` important, `2` confused, `3` exam, `4` todo, `N` note; only when focus is not in a text field. |
| Q11 | "Delete audio after N days" scope. | Only my own recordings whose transcript is `ready` and not stale; default never (`0`). |
| Q12 | Rotation and pairing flows are not lab-verified (sync spec §18.2 note, §24). | Both are v1.1 (§1.1); their three-instance e2e is the gate for enabling them then. |
| Q13 | Shipping signatures and person keys in 0.1 (D-15) costs about a week of M0/T-SYNC/R-SYNC work. | Ship them: they cannot be added later without a format break for existing classes. |
