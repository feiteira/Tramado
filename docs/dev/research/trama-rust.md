# Trama → Tramado: reuse map of the Rust/Tauri shell

Research date 2026-11-03. Source: `/home/feiteira/Trama` (read only, git HEAD `681fd55`).
Experiments: `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/trama-rust/`
(Syncthing v2.1.7 binary + SHA-256 check, crate sources of tauri-plugin-shell 2.6.0 / tauri-build 2.7.4 /
tauri-utils 2.9.0 / tauri-bundler 2.10.4, a Rust supervisor prototype in `supervisor-proto/src/main.rs`).

Legend: **KEEP** = copy as is (rename strings only) · **ADAPT** = copy, then change as described · **DROP** = do not bring over.

---

## 0. Summary

| Trama file | LOC | Verdict | In one line |
|---|---:|---|---|
| `desktop/src-tauri/src/main.rs` | 6 | KEEP | rename `trama_desktop_lib` → `tramado_desktop_lib` |
| `src/lib.rs` | 428 | ADAPT (heavy) | keep helpers (`body_bytes`, `header`, `user_path`, `blocking`), `Paths`/data-dir override, Exit hook; drop db/kdf/blob commands; add class/sync/model/AI commands and new states |
| `src/error.rs` | 70 | KEEP + small ADAPT | drop `NotOpen`, `WrongKey`, `Db` (unless an index DB is kept); keep `Coded`/`Io`/`Invalid`/`Other` and `{code,message}` serialisation |
| `src/files.rs` | 632 | ADAPT | keep `write_atomic`, stale-tmp sweep, `append`, `write_at`, `read_range`, `read_optional`, `list`, `remove_*_if_exists`; drop project/blob/keyring layout; add class-relative path confinement + symlink refusal |
| `src/db.rs` | 553 | DROP (optionally re-use the runner for a *derived, non-synced* FTS index with plain `rusqlite` `bundled`) | no SQLCipher |
| `src/kdf.rs` | 75 | DROP | no Argon2 |
| `src/speech/mod.rs` | 575 | ADAPT | model lookup at call time (download on demand), path-based input instead of bytes over IPC, model registry, download job, DTW preset per model |
| `src/speech/capture.rs` | 528 | KEEP algorithm, ADAPT API | add capture modes (mic only for the lecture room, mic+system / system for online classes); write the WAV in Rust instead of shipping PCM through IPC |
| `src/speech/transcribe.rs` | 472 | KEEP (+ADAPT for long lectures) | VAD→join→whisper→DTW word placement is the crown jewel; add chunking/resume for 1.5–3 h lectures and DTW preset per model |
| `src/speech/remote.rs` | 584 | KEEP + ADAPT | OpenRouter/OpenAI transcription in 30 s pieces, 4 workers, retries; make provider routing configurable (ZDR breaks free models, verified) |
| `src/speech/decode.rs` | 217 | KEEP + tiny ADAPT | decode from a `File` instead of `Cursor<Vec<u8>>` |
| `src/speech/resample.rs` | 128 | KEEP as is | |
| `src/speech/awake.rs` | 167 | KEEP as is | change "Trama" strings |
| `src/service/mod.rs` | 548 | ADAPT | keep agent, `answer()` error mapping, multipart, mock server; add SSE streaming via `ipc::Channel`, tools, multimodal, `models` fallback, key held in Rust, configurable routing |
| `src/service/hosts.rs` | 227 | KEEP | allow-list + native confirmation; Syncthing loopback client is separate (never via this list) |
| `Cargo.toml` | — | ADAPT | see §9 |
| `build.rs` | 3 | KEEP | (optionally an app manifest restricting commands) |
| `tauri.conf.json` | — | ADAPT | CSP kept (+asset protocol for media), identifier/product, bundle |
| `tauri.speech.conf.json` | — | DROP → replace by `tauri.sidecar.conf.json` (externalBin) | model no longer bundled (VAD may be) |
| `capabilities/default.json` | — | ADAPT | + notification/opener only if used from JS |
| `.cargo/config.toml` | — | KEEP verbatim | GGML_NATIVE=OFF etc. |
| `rust-toolchain.toml` | — | KEEP verbatim | needed: on this machine the *default* toolchain is nightly 1.95, stable is 1.92 |
| `tools/fetch-speech-models.mjs` | 97 | ADAPT | becomes `fetch-syncthing.mjs` (+ VAD/dev model); same pin-by-SHA pattern |
| `tools/desktop-e2e/*` | 1085 | ADAPT | WebDriver plumbing, X11 close, /proc socket audit reusable; new two-student sync test |

Key verified facts from this research (new, not in the "established facts"):
1. **OpenRouter ZDR routing as Trama sends it breaks free models**: `provider: {"zdr": true, "data_collection": "deny"}` on `google/gemma-4-31b-it:free` and `nvidia/nemotron-3.5-super-vl:free` → HTTP 404 `"No endpoints found matching your data policy (Zero data retention)"`; `data_collection: "deny"` alone → 404 `"... (Free model training)"`. Trama maps 404 → `NO_MODEL`, which would mislead. Tramado must make routing a setting (off by default with free models) and map this 404 to its own code (e.g. `DATA_POLICY`).
2. **OpenRouter SSE**: before the first token the stream sends many `: OPENROUTER PROCESSING` comment lines (dozens while the `models` fallback/queue runs), then `data: {...chat.completion.chunk...}` with `choices[0].delta.content` **and a separate `choices[0].delta.reasoning`** (+`reasoning_details`) for reasoning models. A per-read timeout (not a global one) is the right ureq setting.
3. **Syncthing v2.1.7 runs as two processes even with `--no-restart`** (a monitor + a child in its *own* process group, env `STMONITORED=yes`). SIGTERM to the monitor stops both in ~1 s; **SIGKILL of the monitor orphans the child** (re-parented to init, keeps serving). Setting `STMONITORED=yes` ourselves gives **one process**; `POST /rest/system/restart` then exits with **code 3** (supervisor must restart), shutdown exits **0**, a second instance on the same home exits **1** (`Failed to acquire lock`). A Rust prototype with `PR_SET_PDEATHSIG` + `STMONITORED=yes` killed Syncthing when the parent was SIGKILLed (verified).
4. **Syncthing GUI is served without auth on its loopback port** (`GET /` → 200) while REST needs the key (`X-API-Key` or `Authorization: Bearer`, without → 403). Any local user/process can drive the web GUI unless a GUI user/password is set.
5. `STNODEFAULTFOLDER=1` → no default `~/Sync` folder (verified: `/rest/config/folders` = `[]`); `/rest/events/disk` reports `LocalChangeDetected` for files dropped into a folder (verified with `fsWatcherDelayS: 1`); Syncthing creates `.stfolder/` inside each folder (dot-prefixed → hidden by Trama's `list()`).
6. Tauri deb bundles put sidecars in **`/usr/bin/<name>`** (tauri-bundler 2.10.4 `linux/debian.rs`): a sidecar named `syncthing` would collide with the distro's `syncthing` package. Name it `tramado-syncthing`.
7. whisper-rs **0.16.0 is still the latest** (2026-03-12) and its `set_abort_callback_safe` bug is real in the published source (`whisper_params.rs:628-646`: the trampoline casts `user_data` to `*mut F` but stores `Box<Box<dyn FnMut>>`). Keep Trama's raw callback.
8. Hugging Face model URLs answer `302` to `us.aws.cdn.hf.co/...`, support `Range` (206 verified), and expose `x-linked-size` and `x-linked-etag` = **the file's SHA-256** (matches Trama's pinned hashes) → a model registry can be built from HEAD requests; table in §6.

---

## 1. Inventory and versions

- Rust crate `trama-desktop` 0.1.0, lib `trama_desktop_lib` (`crate-type = ["staticlib","cdylib","rlib"]` kept for future `tauri android/ios`), edition 2021, `rust-version = "1.88"` (**stale**: tauri 2.12 / tauri-build 2.7.4 / tauri-plugin-shell 2.6 declare MSRV **1.90**).
- Resolved in `Cargo.lock`: tauri 2.12.0, tauri-build 2.7.0, tauri-plugin-dialog 2.8.0, wry 0.57.0, tao 0.37.1, webkit2gtk 2.0.2, whisper-rs 0.16.0 / whisper-rs-sys 0.15.0 (**whisper.cpp 1.8.3** vendored), cpal 0.18.2, symphonia 0.6.1, ureq 3.5.0 (rustls 0.23.46), rusqlite 0.40.2, gio 0.18.4, objc2 0.6.4, windows-sys 0.61.2, base64 0.22.1, thiserror 2.0.21.
- Latest on crates.io today: tauri 2.12.5, tauri-build 2.7.4, tauri-plugin-dialog 2.8.4, tauri-plugin-shell 2.6.0, tauri-plugin-opener 2.7.2, tauri-plugin-notification 2.8.0, tauri-plugin-single-instance 2.5.5, tauri-plugin-fs 2.7.1, tauri-plugin-deep-link 2.6.3, tauri-plugin-updater 2.14.1, notify 8.2.1, notify-debouncer-full 0.7.0, ureq 3.5.1, sha2 0.11.1, keyring 4.2.0 (now a facade over keyring-core 1.0.1 + per-OS store crates), getrandom 0.4.3, libc 0.2.191, whisper-rs 0.16.0, cpal 0.18.2, symphonia 0.6.1.
- JS: `@tauri-apps/api` 2.12.0, `@tauri-apps/plugin-dialog` 2.8.0, `@tauri-apps/cli` 2.12.0; Vite dev server port **1420** (`strictPort`), `pdfjs-dist` 6.3.289.
- Toolchains on this machine: `stable-x86_64-unknown-linux-gnu` = rustc **1.92.0**, `nightly` (rustc 1.95) is the **default**. Trama's `rust-toolchain.toml` (`channel = "stable"`, `components = ["rustfmt","clippy"]`) is what makes Trama build with stable; **copy it into Tramado** (or `rustup update stable` first; 1.92 is ≥ MSRV 1.90).
- Linux build deps (AGENTS.md + CI): `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev patchelf libasound2-dev libclang-dev cmake` (last three: cpal/ALSA, bindgen, whisper.cpp).
- `desktop/src-tauri/target` is 18 GB in Trama (SQLCipher+OpenSSL+whisper.cpp builds) — dropping `bundled-sqlcipher-vendored-openssl` removes the slowest C build.

---

## 2. Build & configuration files

### 2.1 `Cargo.toml` — ADAPT
Keep: `tauri`, `tauri-plugin-dialog`, `serde`, `serde_json`, `walkdir`, `thiserror`, `percent-encoding`, `whisper-rs 0.16`, `symphonia 0.6 (default-features=false, ["all-codecs","all-formats","opt-simd"])`, `cpal 0.18` (+ Linux `features=["pulseaudio"]`), `ureq 3.5 ["json"]`, `base64 0.22`, `gio 0.18` (Linux), `objc2`/`objc2-foundation` (macOS), `windows-sys 0.61` (Windows), dev `tempfile`, the release profile (`codegen-units=1, lto=true, opt-level="s", panic="abort", strip=true`).
Drop: `rusqlite` (`bundled-sqlcipher-vendored-openssl`), `argon2`, `hex`, `zeroize` (unless used for the API key in memory).
Add: see §9 for the full proposal (sha2, libc, notify, single-instance, opener, notification, Job Objects feature).
Gotcha: `gio` must stay on the **same gtk-rs generation as Tauri's GTK stack** (0.18 today) — "already part of the GTK stack the window uses"; bump both together.
Gotcha: `panic = "abort"`: a panic in any thread (capture, transcription, a supervisor) kills the whole app **without** running `RunEvent::Exit` → any child (Syncthing) is orphaned unless the OS-level kill-with-parent mechanisms of §7 are used.

### 2.2 `build.rs` — KEEP
`fn main() { tauri_build::build() }`. tauri-build also **copies `bundle.externalBin` files (triple suffix stripped) next to the built binary** (`target/<profile>/`) and **fails the build if a listed sidecar is missing** (tauri-build 2.7.4 `copy_binaries`, lib.rs:139-168, 735-742) — this applies to `cargo test`/`clippy` too, because `tauri_build` reads `tauri.conf.json` + the `TAURI_CONFIG` env (lib.rs:71, 681). It also refuses a sidecar with the same name as the Cargo package. → Put `externalBin` in a separate config merged with `--config` (as Trama did for speech resources), see §7.4.
Optional hardening: `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&[...])))` to make custom commands permission-gated per window (Trama does not; all custom commands are callable by every window — fine while there is one window that renders no third-party origin).

### 2.3 `tauri.conf.json` — ADAPT
Trama values worth keeping verbatim:
```json
"app": {
  "withGlobalTauri": false,
  "windows": [{ "title": "Trama", "width": 1360, "height": 860, "minWidth": 1000, "minHeight": 660, "center": true }],
  "security": {
    "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: asset:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost blob: data:; media-src 'self' blob:",
    "freezePrototype": false,
    "dangerousDisableAssetCspModification": ["style-src"]
  }
}
```
- **Gotcha (CSP nonce)**: without `dangerousDisableAssetCspModification: ["style-src"]` Tauri injects a nonce into `style-src`; WebKit then ignores `'unsafe-inline'` and **drops every inline style** (React `style={{}}`, CSSOM) while the browser dev build still looks right. The desktop e2e checks this.
- `connect-src` IPC only = the webview cannot reach the network (§8: keep).
- `'wasm-unsafe-eval'` + `worker-src blob:` serve pdf.js (and sql.js in Trama). Keep for pdf.js.
- For playing lecture recordings / showing PDFs straight from class folders with range requests, enable the asset protocol: Cargo feature `tauri/protocol-asset`, `app.security.assetProtocol: {"enable": true, "scope": []}` and add the class roots at runtime with `app.asset_protocol_scope().allow_directory(root, true)` (tauri 2.12 `scope/fs.rs:351`). CSP then needs `media-src 'self' blob: asset: http://asset.localhost` and the same in `img-src` (`convertFileSrc` gives `asset://localhost/...` on Linux/macOS, `http://asset.localhost/...` on Windows).
- `identifier`: Trama `eu.thehumanloop.trama`. The identifier decides `app_data_dir` etc. (`~/.local/share/<identifier>`), so choose Tramado's once (e.g. `eu.thehumanloop.tramado`) and never change it.
- `build`: `frontendDist "../../app/dist"`, `devUrl "http://localhost:1420"`, `beforeDevCommand "npm run dev --workspace @trama/app"`, `beforeBuildCommand "npm run build --workspace @trama/app"` → rename workspace.
- `bundle`: targets `appimage, deb, nsis, msi`; `category "Education"`; Windows `webviewInstallMode: downloadBootstrapper`, NSIS languages `English, Portuguese, Spanish` + `displayLanguageSelector`, WiX `en-US, pt-PT, es-ES`; Linux `deb.depends ["libasound2"]`, rpm `["alsa-lib"]`, `appimage.bundleMediaFramework: true` (**keep: GStreamer inside the AppImage is what lets `<audio>` play recordings**); macOS `minimumSystemVersion "14.2"` (Core Audio process taps), `entitlements macos/Entitlements.plist`, localized `InfoPlist.strings` for en/pt/es.
- Drop: the `--example` launcher files (`linux/trama-example.desktop`, `windows/installer-hooks.nsh`, `windows/example-shortcut.wxs`, WiX `componentGroupRefs`) unless Tramado keeps a demo class.

### 2.4 `tauri.speech.conf.json` — DROP
It only adds `bundle.resources` for the two model files (575 MB). Tramado downloads the whisper model on demand. **Recommendation**: still bundle the 0.9 MB Silero VAD file (`ggml-silero-v5.1.2.bin`), so cloud transcription can cut silence without any download, and replace this file by `tauri.sidecar.conf.json` carrying `externalBin` (§7.4).

### 2.5 `capabilities/default.json` — ADAPT
Trama:
```json
{ "identifier": "default", "windows": ["main"],
  "permissions": ["core:default", "core:window:allow-destroy", "core:window:allow-set-title",
    "dialog:allow-open", "dialog:allow-save", "dialog:allow-message", "dialog:allow-ask", "dialog:allow-confirm"] }
```
`core:window:allow-destroy` is required by the close-request handler (`onCloseRequested` → `preventDefault` → save → `win.destroy()`). `core:default` already includes event listening (needed for `app.emit` → `listen()`); `ipc::Channel` needs no permission. Tramado additions only if the JS side calls them: `notification:default` (or call notifications from Rust and add nothing), opener scoped (`opener:allow-open-url` with an `https://*` scope, `opener:allow-reveal-item-in-dir`), or — preferred — expose one Rust command `open_external(url)` that validates `https://` and calls `app.opener().open_url(...)`, so the webview gets no opener permission at all. **Never** grant `shell:*`, `http:*`, `fs:*`.

### 2.6 `.cargo/config.toml` (repo root) — KEEP verbatim
```toml
[env]
MACOSX_DEPLOYMENT_TARGET = "14.2"
GGML_NATIVE = "OFF"
GGML_AVX = "ON"
GGML_AVX2 = "ON"
GGML_FMA = "ON"
GGML_F16C = "ON"
```
- whisper-rs-sys 0.15 `build.rs:279-287` forwards **every env var starting with `WHISPER_`, `GGML_` or `CMAKE_`** to CMake as `-D` definitions; that is how these reach whisper.cpp.
- Without `GGML_NATIVE=OFF` the binary is built with `-march=native` of the build machine → SIGILL on students' older CPUs. With AVX2/FMA/F16C ON, x86-64 CPUs lacking them must be refused at runtime (`cpu_supported()` → `UNSUPPORTED_CPU`).
- Gotcha: Cargo finds `.cargo/config.toml` by walking up from the **current working directory**, not from the manifest. Builds started from outside the repo (`cargo build --manifest-path /abs/...` from `$HOME`) silently lose these flags.
- whisper-rs-sys builds whisper.cpp as `RelWithDebInfo` in debug profiles (so dev transcription is not unusably slow) and sets `GGML_METAL=OFF` unless the `metal` feature is on, `GGML_OPENMP=OFF` unless `openmp`.
- CI gotchas worth copying from `.github/workflows/ci.yml`: Windows needs `CMAKE_C_FLAGS_RELEASE`/`CMAKE_CXX_FLAGS_RELEASE = "/MD /O2 /Ob2 /DNDEBUG"` (the cmake crate drops MSVC's optimisation level → whisper.cpp at `/Od`), verified by grepping `CMakeCache.txt`; macOS universal builds cross-compile the x86 slice → check AVX2/FMA instructions with `lipo -thin x86_64` + `otool -tv | grep vfmadd...ymm`; ad-hoc signing via `APPLE_SIGNING_IDENTITY: "-"`.

### 2.7 `desktop/package.json`, root `package.json` — ADAPT
Scripts to carry: `dev` (`tauri dev`), `build:desktop` (fetch → `tauri build --config ...`), `lint:rust` (`cargo fmt --check` + `clippy --all-targets -D warnings`), `test:rust`. Replace `fetch:speech` with `fetch:syncthing` (+ `fetch:speech` only for dev/CI tests).

### 2.8 macOS / Info.plist / Entitlements — ADAPT text
`Info.plist` keys `NSMicrophoneUsageDescription` and **`NSAudioCaptureUsageDescription`** (required for Core Audio process taps), `CFBundleLocalizations [en, pt, es]`, translated in `macos/<lang>.lproj/InfoPlist.strings`. `Entitlements.plist`: `com.apple.security.device.audio-input` (hardened runtime refuses the mic without it). Rewrite strings for lectures ("Tramado records the class you choose to record…"). Note the discrepancy: `capture.rs` header says "macOS 14.6+" for process taps while config/AGENTS say 14.2 — test on 14.2–14.5.
Syncthing on macOS/Windows will trigger the OS firewall prompt ("accept incoming connections") the first time it listens on `0.0.0.0:22000`; plan UX copy for it.

---

## 3. Module-by-module map

### 3.1 `main.rs` — KEEP
`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` (no console window on Windows release) + `fn main(){ tramado_desktop_lib::run() }`.

### 3.2 `lib.rs` — ADAPT (heavy)
Keep as is:
- `fn body_bytes(req: &Request<'_>) -> AppResult<Vec<u8>>` (lib.rs:64) — raw IPC bodies (`InvokeBody::Raw`).
- `fn header(req, name) -> AppResult<String>` (lib.rs:72) — **header values are percent-encoded by the UI** (`encodeURIComponent`), because HTTP headers cannot carry non-ASCII paths; decoded with `percent_decode_str(...).decode_utf8()`.
- `fn user_path(p) -> AppResult<PathBuf>` (lib.rs:84) — absolute paths only for files the user picked.
- `async fn blocking<T>(f) -> AppResult<T>` (lib.rs:93) — `tauri::async_runtime::spawn_blocking` for file/CPU work; use it everywhere a command touches disk or network.
- `resolve_data_dir` with an env override (`TRAMA_DATA_DIR` → `TRAMADO_DATA_DIR`, relative → `cwd.join`), used by the e2e and by testers. **Extend**: the same override must also relocate the Syncthing home, the models dir and the GUI port, so two Tramado "students" can run side by side on one machine for development and e2e. When it is set, skip `tauri-plugin-single-instance` (otherwise the second instance just focuses the first).
- The `RunEvent::Exit` hook (lib.rs:412-427) and `try_state` pattern ("absent when setup failed before managing it").
- `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`.

Drop: `db_*`, `project_*`, `erase_all`, `kdf_argon2id`, `blob_*`, `Paths.example` (unless a demo class is kept; then keep the "folder emptied at every start and exit" trick — on Windows close files before deleting).

Add (proposed states, all managed in `setup`):
```rust
app.manage(Paths::resolve(app.handle())?);   // config dir (prefs, secrets), local data (models, syncthing home, index), classes root
app.manage(Secrets::new(&paths.config));      // OpenRouter key; never in a synced folder, never echoed to the webview
app.manage(Service::new(&paths.config));      // service/ (allow-list file lives here, not in a class folder)
app.manage(Speech::new(app.handle(), &paths));// models dir + bundled VAD; job + recorder + download slots
app.manage(SyncState::start(app.handle().clone(), &paths)); // Syncthing supervisor thread + event pump
app.manage(Watcher::new(app.handle().clone()));             // notify-debouncer for class folders
```
and in the Exit hook: `speech.shutdown(); sync.shutdown(Duration::from_secs(5));`.

Gotchas from lib.rs:
- Tauri converts **top-level** command args from JS camelCase to Rust snake_case (`keyHex` → `key_hex`), but **fields inside a struct argument are serde as-is** (`ChatRequest.max_tokens` is sent as `max_tokens`).
- `async` commands that borrow `State<'_, T>` **must return a `Result`** (hence `AppResult` everywhere). `app_info` is the one sync command; sync commands run on the main thread — keep them trivial.
- Binary results: `tauri::ipc::Response::new(Vec<u8>)` → JS gets an `ArrayBuffer` (tauri.ts `toBytes` also accepts a number array from "older IPC paths").
- Raw request bodies: `invoke(cmd, uint8array, { headers })`; tauri.ts `body()` copies a `Uint8Array` that is a view into a bigger buffer, otherwise the whole underlying buffer would be sent.

### 3.3 `error.rs` — KEEP (+small ADAPT)
`AppError { NotOpen, WrongKey, Db(rusqlite::Error), Io(std::io::Error), Invalid(String), Coded(&'static str, String), Other(String) }`; `code()` → `"DB_NOT_OPEN" | "WRONG_KEY" | "DB_ERROR" | "NOT_FOUND" | "PERMISSION_DENIED" | "IO_ERROR" | "INVALID" | <coded> | "ERROR"`; custom `Serialize` → `{ "code", "message" }` (message for logs only, never content); `not_found(what)`. TS side `toPlatformError()` maps `{code,message}` objects and plain strings (Tauri's own errors: unknown command, bad args) to `PlatformError(code, message)`.
ADAPT: remove `NotOpen`/`WrongKey`/`Db` (or keep `Db` if an index DB is kept). Codes in use across modules that the UI must translate: `CANCELLED, BUSY, UNAVAILABLE, NO_AUDIO_DEVICE, UNSUPPORTED_AUDIO, MODEL_UNREADABLE, UNSUPPORTED_CPU (info reason), NO_MODEL (info reason), BAD_ADDRESS, HOST_NOT_ALLOWED, UNAUTHORIZED, NO_CREDIT, NO_MODEL, TIMEOUT, TOO_LARGE, RATE_LIMITED, REFUSED, SERVICE_ERROR, UNREACHABLE`. Add for Tramado: `DATA_POLICY` (OpenRouter 404 data-policy), `MODEL_NOT_DOWNLOADED`, `DOWNLOAD_FAILED`, `CHECKSUM_MISMATCH`, `SYNC_UNAVAILABLE`, `SYNC_LOCKED`, `PATH_OUTSIDE_CLASS`, `SYMLINK_REFUSED`, `CONFLICT`.

### 3.4 `files.rs` — ADAPT
Keep verbatim (generic and well tested):
- `write_atomic(path, bytes)` (files.rs:139): temp file `.{name}.{pid}-{counter}.tmp` in the same dir → `write_all` → `sync_all` → `rename` (replaces on Windows too) → on Unix `fsync` the parent dir (else a power cut can resurrect the old file); temp removed on failure.
- `remove_stale_tmps(dir)` + `is_atomic_tmp(name)` (files.rs:94-134): before each write, removes this function's own leftovers older than 1 h (`STALE_TMP`), never other dot-files. Comment: listings skip dot-files, so a leftover would be a hidden full-size copy "that sync clients keep uploading" — **exactly Tramado's case**.
- `append(path, bytes) -> u64` (creates, `sync_data`), `write_at(path, offset, bytes, truncate)` (no holes: offset ≤ len), `read_range(path, offset, len)`, `read_optional`, `remove_file_if_exists`, `remove_dir_if_exists`.
- `list(path, recursive, max_entries) -> Vec<Entry{path,name,is_dir,size,modified_ms,depth}>` (files.rs:337): walkdir, `max_depth 16`, `follow_links(false)`, `sort_by_file_name`, **skips names starting with '.'** (so `.stfolder`, `.stignore`, `.stversions`, `.syncthing.*.tmp` are hidden for free), unreadable entries skipped, missing folder → `NOT_FOUND`.

Drop: `PROJECTS_DIR`, `BLOB_DIR`, `DB_FILE`, `KEYRING_FILE`, `LIBRARY_FILE`, `list_blobs`, `list_projects`, `project_*`, `blob_*`, `erase_*`. Keep `APP_FILES` allow-list idea (`prefs.json`, plus Tramado's `classes.json` registry) for files in the app config dir.

ADAPT/ADD for synced class folders:
1. **Class-relative, confined paths**. Trama's `valid_name` (`[a-z0-9][a-z0-9._-]{0,63}`, no `..`, lower case to avoid case-insensitive aliasing) is right for ids but too strict for human file names. Add `class_path(root, rel)`: reject empty, NUL, `\`, absolute/prefix/`..`/`.` components, components starting with `.st` (Syncthing-reserved) or `.`, trailing space/dot and Windows reserved names (`CON`, `NUL`, `COM1`…); then walk the components with `symlink_metadata` and **refuse any symlink** — Syncthing syncs symlinks on Unix, so a classmate could plant `notes.md -> ~/.ssh/id_rsa`; `std::fs::read`/`write` follow links. Every class command takes `(class_id, rel_path)`, never an absolute path from the UI (only dialogs return absolute paths; those keep `user_path`).
2. **Conflict files**: Syncthing writes `name.sync-conflict-YYYYMMDD-HHMMSS-<DEVICEID7>.ext` (not dot-prefixed) → add `Entry.conflict_of: Option<String>` in `list()` so the UI can show/resolve them.
3. **`.stignore`**: atomic-write temp names (`.*.tmp`) can be picked up by the folder watcher mid-write; ship an ignore line such as `(?d).*.tmp` (and anything device-local). `.stignore` itself is **not synced** — every member's app must write it when it creates/joins a class (or keep a synced `#include .tramado-ignore`).
4. `write_atomic` is **not a cross-device lock**: two devices writing the same file concurrently produce a sync-conflict copy. The "only one member transcribes" claim protocol must be designed for eventual consistency (e.g. per-device claim files `claims/<recording>/<deviceId>.json` and a deterministic winner rule), not for atomic create.
5. Never put SQLite (or any file written in place by two processes) inside a synced folder; derived indexes go to app-local data.

### 3.5 `db.rs` — DROP
SQLCipher per project, `PRAGMA key = x'..'`, wrong key detection via `NotADatabase`, WAL. Nothing applies (plain files). Reusable bits if Tramado wants a device-local FTS5 search index (non-synced, rebuildable): the JSON⇄SQL value mapping (`to_sql`/`from_sql`), `batch_on` (one transaction), `script_on` (migrations), mutex-poison recovery (`lock().unwrap_or_else(|e| e.into_inner())`) and the "a call meant for a project you left fails" guard (`with_project`). Use `rusqlite = { version = "0.40", features = ["bundled"] }` then — or keep search in TypeScript (Trama's BM25 `core/qda/rank.ts`).

### 3.6 `kdf.rs` — DROP.

### 3.7 `speech/mod.rs` — ADAPT
What it is: state `Speech { dir: Option<PathBuf>, job: Mutex<Option<Arc<Job>>>, recorder: Mutex<Option<capture::Recorder>> }`; `RATE = 16_000`; `MODEL = ("ggml-large-v3-turbo-q5_0.bin", 574_041_195)`, `VAD = ("ggml-silero-v5.1.2.bin", 885_098)`; `ENGINE = "whisper.cpp 1.8, large-v3-turbo (q5_0), Silero VAD 5.1.2"` (audit string); `cpu_supported()` (x86-64: `avx2 && fma && f16c`, aarch64: true, else false); `locate()` (see §6); `Speech::new` calls **`whisper_rs::install_logging_hooks()`** (routes whisper.cpp/ggml logs into Rust's `log`, silencing stderr spam); `shutdown()` sets the job's cancel flag and stops the recorder.
Job model (reuse): one job at a time (`BUSY`), a named thread (`trama-transcribe`) holding an `Awake` guard, `Phase { Decoding, Transcribing, Done, Failed, Cancelled }`, `progress: Arc<AtomicI32>` (0–100), `cancel: Arc<AtomicBool>`, `outcome: Mutex<Option<Result<Transcript,(code,message)>>>`; the UI polls `transcribe_status` and then `transcribe_take` (returns the transcript **once**, then forgets the job; on failure it returns `None`, so read the error from `status` first).
`Transcript { tracks: Vec<Track{segments: Vec<Segment{start,end,text}>, language: Option<String>}>, duration: u64 /*ms*/, engine: String }` — TS `Transcription` in `app/src/core/speech/types.ts`.
`transcribe_start` headers: `x-ext` (decoder hint), `x-language` (ISO 639-1 or empty = auto), `x-channels` (`mix` | `split`), optional `x-engine: service` + `x-service-base`, `x-service-key`, `x-service-model`. Remote engine reuses the local VAD where the CPU can run it (`Engine::Service { client, model, vad }`); `run_remote_job` names the engine `"OpenRouter · <model>"` or `"<host> · <model>"`.

ADAPT for Tramado:
1. **Input by path, not bytes**: `transcribe_start { class_id, rel_path, language, channels, engine, model_id }` — Rust opens the file (lectures are 100–700 MB as WAV; Trama shipped the whole decrypted recording through IPC because only the UI could decrypt).
2. **Key stays in Rust**: no `x-service-key` header; `Secrets` supplies it.
3. **Model lookup at call time** + model registry + download job (§6). `SpeechInfo` becomes `{ transcribe: bool, reason: "MODEL_NOT_DOWNLOADED"|"UNSUPPORTED_CPU"|null, engine, models: [{id, size, installed, recommended}], vad: bool }`.
4. **Events instead of polling** (optional): keep the poll API (simple, survives reloads) but also `app.emit("transcribe:progress", ...)` so a background job can update a tray/notification.
5. **Progress persistence for the class claim**: write partial results per chunk (see transcribe.rs) so another member can see progress and a crashed device can resume.
6. Keep the opt-in tests (`TRAMA_SPEECH_SAMPLE=<file> [TRAMA_SPEECH_CHANNELS=split] cargo test --release transcribes_a_sample -- --ignored --nocapture`, and the `transcribes_a_sample_through_a_service` variant with `TRAMA_SERVICE_BASE/KEY/MODEL` or a mock).

### 3.8 `speech/capture.rs` — KEEP algorithm, ADAPT API
How it works (keep): two cpal input streams — track 0 microphone (left), track 1 "what the computer plays" (right) — opened on a **dedicated thread that owns the streams** ("on some systems they may not move between threads"; `cpal::Stream` is not `Send` everywhere); the data callback down-mixes each frame to mono and sends `(track, Vec<f32>)` over an `mpsc`; a **mixer thread** resamples each track to 16 kHz (`Resampler`), keeps both in step with the wall clock and interleaves **16-bit LE stereo** into `Shared.out`; the UI drains it with `recorder_take` (Trama: every 400 ms) and `recorder_stop`.
Per-OS loopback (`devices()`, capture.rs:178):
- Linux: `cpal::host_from_id(HostId::PulseAudio)` (cpal feature `pulseaudio`: PulseAudio **native protocol in Rust**, PipeWire serves it too); mic = `default_input_device()`; system = device id `"<default sink id>.monitor"` via `DeviceId::new(HostId::PulseAudio, format!("{}.monitor", id.id()))` + `host.device_by_id`. No sound server → plain ALSA, mic only.
- Windows: WASAPI loopback = `build_input_stream` on the **default output device**, config from `default_output_config()`. **WASAPI delivers nothing while nothing plays** → padding logic.
- macOS ≥ 14.2: cpal 0.18 Core Audio **process tap** on the default output, same "output device used as input" path; needs `NSAudioCaptureUsageDescription`.
Quirks encoded: stream errors `Xrun`, `DeviceChanged`, `RealtimeDenied` are ignored (stream continues), others recorded per track (`TrackLive.error`); `Recorder::start` fails only if **neither** track opens (`NO_AUDIO_DEVICE`), a missing track is recorded as silence and its status says why; clock sync `adjust(produced, expected)` with `TOLERANCE = 0.5 s` and `SLACK = 0.25 s` → `Pad(n)` silence / `Drop(n)` for a fast device clock; level meter "rises at once, falls gently" (`peak.max(shown*0.85)`); mixer loop `recv_timeout(100 ms)`; all sample formats `F32/I16/U16/I32/I8/U8/F64`; device names via cpal 0.18 `device.description()`. `Status { recording, ms, mic: TrackStatus{open, level, device, error}, system: TrackStatus }`. Holds an `Awake` guard while recording. Test: `cargo test record_from_devices -- --ignored --nocapture`.
ADAPT:
1. `recorder_start { mode: "room" | "online" | "system" , class_id, rel_path }`: room = mic only (mono file, half the size), online = mic+system split (left = student, right = lecturer/call), system = loopback only (muted student in an online class).
2. **Write the file in Rust** (no encryption → no reason to ship PCM over IPC): append PCM with `files::append` from the mixer thread every ~0.5 s and patch the WAV header (`files::write_at`) at stop and periodically (crash ⇒ header fixed from file size on next start). Keep `recorder_take`-style level/status polling only.
3. Size planning: 16 kHz 16-bit = 32 KB/s per channel → **115 MB/h mono, 230 MB/h stereo**. Too big to sync a semester of lectures among classmates; transcode after stop (keep the WAV until the transcode succeeds). Constraints: symphonia 0.6 decodes WAV/FLAC/MP3/AAC/Vorbis/ALAC but **not Opus** (decode.rs header); webview playback must work in WebKitGTK (GStreamer), WKWebView and WebView2. Candidates: FLAC (pure-Rust encoder `flacenc` 0.5.1, lossless, ~50–60 % of WAV, decodable everywhere), Ogg Vorbis (`vorbis_rs` 0.5.6, C libs, ~15–25 MB/h, symphonia decodes, Safari support uncertain), Opus (`opus` 0.4 + `symphonia-adapter-libopus` 0.3 for decoding; smallest, Safari Ogg/Opus support uncertain), MP3 via LAME (LGPL). Needs a decision/experiment — out of scope here.

### 3.9 `speech/transcribe.rs` — KEEP (+ADAPT for long lectures)
Pipeline: Silero VAD (`WhisperVadContext`, `WhisperVadParams::default()`, CPU, times in centiseconds) → `join()` stretches into one buffer with `START = 500 ms` silence at the head, `LEAD = 200 ms` before each stretch, `OVERLAP = 100 ms` after, `GAP = 100 ms` silence between → whisper `full` on the joined audio → per-token times (**DTW** `t_dtw`, fallback `t0`) mapped back with `place()` / `place_words()`, cutting segments at real pauses ≥ `SPLIT = 1 s`; tokens with `id >= token_eot` skipped; punctuation stays with the preceding word.
Params: `use_gpu false`, **`flash_attn false` (DTW does not work with flash attention; also slower on CPU)**, `DtwMode::ModelPreset { LargeV3Turbo }`, greedy `best_of 1`, `no_context true` (a misheard phrase is not carried on), `suppress_blank`, all prints off, `token_timestamps true`, language `auto` unless `get_lang_id(l)` knows it (then `full_lang_id_from_state` reports the detected one), threads = cores − 2 (−1 on ≤4 cores), max 8.
Documented gotchas:
- **whisper.cpp's own VAD only runs in `whisper_full`, not in `whisper_full_with_state` that whisper-rs calls**, and its segment start times after a pause are unreliable → separate VAD context + join/place.
- **Do not use whisper-rs 0.16 `set_abort_callback_safe`** (random aborts; verified in the 0.16.0 source). Use:
```rust
unsafe extern "C" fn abort_if_cancelled(flag: *mut c_void) -> bool {
    unsafe { (*(flag as *const AtomicBool)).load(Ordering::Relaxed) }
}
unsafe {
    params.set_abort_callback(Some(abort_if_cancelled));
    params.set_abort_callback_user_data(job.cancel.as_ptr() as *mut c_void); // AtomicBool::as_ptr
}
```
  (the flag lives in the `Job`, which outlives `state.full`). `set_progress_callback_safe` is fine.
ADAPT:
1. **DTW preset must match the model**: if Tramado offers several models, map `base → DtwModelPreset::Base`, `small → Small`, `medium → Medium`, `large-v3-turbo → LargeV3Turbo` (enum in whisper-rs `whisper_ctx.rs:631`: TinyEn, Tiny, BaseEn, Base, SmallEn, Small, MediumEn, Medium, LargeV1, LargeV2, LargeV3, LargeV3Turbo). Also change the `ENGINE` audit string per model.
2. **Memory for long lectures**: `decode` returns the whole track as `Vec<f32>` (64 KB/s) and `join` copies the speech part → a 3 h lecture ≈ 0.7 GB + ≈0.6 GB peak per track (×2 for `split`). Process in windows (e.g. VAD over the file, then transcribe groups of stretches of ≈10 min with the same `Piece`/`place` mapping, like `remote::pack` but bigger), report progress per window and persist partial transcripts — which also gives resume after a crash/sleep.
3. Optional speed-up on Apple silicon: whisper-rs feature `metal` for `cfg(all(target_os="macos", target_arch="aarch64"))` (not verified with DTW).

### 3.10 `speech/remote.rs` — KEEP + ADAPT
Cloud transcription with the same decode + VAD (or, where whisper.cpp cannot run, loudness cut `SILENT_RMS = 0.004`), stretches split at their quietest 50 ms before `MAX_STRETCH = 27 s` (`CUT_WINDOW = 7 s`), packed into pieces ≤ `MAX_PIECE = 30 s` of joined audio (services time out on long requests); on a split call a piece ends where the other side speaks (`pack(stretches, other)`), so turns keep their order; **4 workers** (`WORKERS`) over a shared index, first lasting error stops all; retries `2^n s` (2, 4, 8) for `RATE_LIMITED | TIMEOUT | SERVICE_ERROR | UNREACHABLE`, cancellable while waiting; `verbose_json` + `timestamp_granularities ["segment"]`, falling back for all later pieces to `json` when a model refuses (`REFUSED`, e.g. gpt-4o-transcribe); `read_answer` reads `text`, `segments[{start,end,text}]`, `language` ("portuguese" → "pt" via whisper's table); `place_heard` maps segment times back (no segments → one segment over the piece); per-track majority language.
Request shapes:
```jsonc
// OpenRouter: POST https://openrouter.ai/api/v1/audio/transcriptions  (JSON)
{ "model": "<model>", "input_audio": { "data": "<base64 16 kHz mono 16-bit WAV>", "format": "wav" },
  "response_format": "verbose_json", "timestamp_granularities": ["segment"], "language": "pt",
  "provider": { "zdr": true, "data_collection": "deny" } }      // ← Trama always adds this for OpenRouter
// Other OpenAI-compatible servers: multipart/form-data fields model, response_format,
// timestamp_granularities[], language, file=@speech.wav (audio/wav)
```
ADAPT: routing from settings (see §3.12); key from `Secrets`; consider `MAX_PIECE`/`WORKERS` as settings (free tiers rate-limit hard: 429 is retried only 3 times). Mock-server tests (`service::mock::serve`) carry over.

### 3.11 `speech/decode.rs` — KEEP + tiny ADAPT
Symphonia probe with extension hint → default audio track → decoder → `copy_to_vecs_planar::<f32>` → per-track resampler to 16 kHz; `Channels::Mix` (average of all channels) or `Split` (first two channels; a mono file feeds both tracks); damaged packets skipped (`DecodeError`), **missing clean EOF tolerated** (`IoError(UnexpectedEof)` → keep what was read), sample-rate change refused, `stop` closure polled per packet (`CANCELLED`); errors `UNSUPPORTED_AUDIO`. Formats: WAV, MP3, AAC (M4A/MP4/MOV), FLAC, Ogg Vorbis, ALAC, Matroska/WebM audio; **no Opus**.
ADAPT: `MediaSourceStream::new(Box::new(std::fs::File::open(path)?), Default::default())` instead of `Cursor::new(bytes)` (File implements `MediaSource`); optionally emit chunks instead of one `Vec` (see transcribe.rs ADAPT 2).

### 3.12 `speech/resample.rs` — KEEP as is
63-tap Hamming-windowed sinc low-pass at `0.45 × to/from` (only when down-sampling) + linear interpolation; streaming (`push(input, &mut out)`) for uneven device blocks; tests for 44.1/48 kHz, > 8 kHz rejection, 16 kHz passthrough.

### 3.13 `speech/awake.rs` — KEEP as is
`Awake::hold(reason)` guard: macOS `NSProcessInfo.beginActivityWithOptions(UserInitiated)` (no App Nap, no idle sleep); Windows `PowerCreateRequest` + `PowerSetRequest(PowerRequestSystemRequired)` ("unlike SetThreadExecutionState it belongs to no thread"); Linux logind `Inhibit("sleep:idle" → fallback "idle", "Trama", reason, "block")` over the **system** bus via gio, held while the returned fd is open (blocking sleep needs the local active session/polkit; over SSH only idle). Best effort, no-op elsewhere. Rename "Trama" → "Tramado" in the logind `who` and reasons. Very relevant for students recording a 2 h lecture on battery.

### 3.14 `service/mod.rs` — ADAPT
Keep:
- `ureq::Agent` config: `timeout_global(180 s)`, `timeout_connect(20 s)`, **`http_status_as_error(false)`** (read error bodies to tell "no credit" from "no model"), `user_agent("Trama/<version>")`; rustls + Mozilla roots, no OpenSSL.
- `Client { agent, endpoint, auth: Option<"Bearer <key>"> }` with `get`, `post_json`, `post_multipart`; no key ⇒ no Authorization header.
- `answer()` → JSON or coded error: transport `Timeout` → `TIMEOUT`, other transport → `UNREACHABLE`; body limit 32 MiB; `401/403 UNAUTHORIZED`, `402 NO_CREDIT`, `404 NO_MODEL`, `408/504 TIMEOUT`, `413 TOO_LARGE`, `429 RATE_LIMITED`, `400/422 REFUSED`, else `SERVICE_ERROR`; message = `HTTP <status>: <error.message ≤300 chars>`.
- Hand-built `Multipart` (boundary from `RandomState`, fine for a boundary, **not** for secrets).
- `service_allow`: the **shell** shows the confirmation (a page cannot answer a native dialog); the message must contain `{host}`, filled in by the shell from the parsed URL; runs `blocking_show()` inside `crate::blocking` (**never call a blocking dialog on the main thread**).
- `service_check`: OpenRouter `GET /key` → `data.limit_remaining` (credit), else `GET /models`.
- `#[cfg(test)] pub mod mock` (tiny HTTP/1.1 server on 127.0.0.1 answering canned responses and recording request line, headers and body) — reuse for AI, download and Syncthing-client tests.
ADAPT:
1. **Routing**: `Client::routing()` hard-codes `{"zdr": true, "data_collection": "deny"}` for OpenRouter → **every `:free` model 404s** (verified). Make it a per-request/per-setting option (`privacy: "zdr" | "no-training" | "default"`), default `"default"` for free models, and map 404 bodies containing "data policy" to `DATA_POLICY`.
2. **Streaming chat** with `tauri::ipc::Channel` (snippet in §8.3); `stream: true`, skip `:`-comment lines, parse `data:`; surface `delta.reasoning` separately; handle mid-stream `{"error": ...}` chunks and `finish_reason: "error"`; per-request `timeout_global(None)` + `timeout_per_read(Some(90 s))`; cancel flag per stream id.
3. **Request features** Tramado needs: `models: [...]` fallback (max 3, established), `tools`/`tool_choice` (citations: e.g. a `cite(source_id, page|article|t_ms)` tool or JSON output), multimodal content parts (exam images/PDF pages as `image_url` base64), `max_tokens` large enough for reasoning models (established: too low ⇒ empty `content`), optional `response_format: json_schema`. Change `Message.content: String` to `serde_json::Value` (string or parts array) and return `usage` + `model` + `provider`.
4. **Key custody**: Trama sends the key from the webview on every call (it lived in the encrypted library). Tramado: `secret_set(key)`/`secret_status()`/`secret_clear()` commands; Rust reads it per request; the webview never reads it back. Store in the OS keychain (`keyring` 4.x / `keyring-core` + store crates) with a fallback file `app_config_dir()/secrets.json` (0600), **never** inside a class folder.
5. Optional OpenRouter attribution headers `HTTP-Referer`/`X-Title: Tramado`; user agent `Tramado/<version>`.

### 3.15 `service/hosts.rs` — KEEP
`BUILT_IN = ["openrouter.ai"]`; `Endpoint::parse(base)`: scheme `https`, or `http` **only for local/private hosts** (`localhost`, `*.localhost`, `*.local`, loopback/private/link-local IPv4, `::1`, `fc00::/7`, `fe80::/10`); no userinfo (`@`), no query; host lowercased with port kept; `base` without trailing slash; look-alikes (`openrouter.ai.example.org`) are not built-in; `is_openrouter()` is an exact host match. Allowed list in `service-hosts.json` (host names only) next to prefs, written with `write_atomic`. Errors `BAD_ADDRESS`, `HOST_NOT_ALLOWED`. Keep for user-configured OpenAI-compatible servers (Ollama/LM Studio at `http://localhost:11434/v1`). Do **not** route Syncthing (loopback) or model downloads through this list — they are fixed, app-chosen endpoints with their own clients (model downloads: fixed `https://huggingface.co/...` URLs from the registry; ureq follows the `302` to `*.cdn.hf.co` itself).

---

## 4. Every Tauri command (Trama) with its TS binding and Tramado verdict

TS bindings are in `/home/feiteira/Trama/app/src/platform/tauri.ts` (line numbers below), types in `app/src/platform/types.ts`. `call<T>(cmd, args?, headers?)` wraps `invoke` and maps errors (tauri.ts:26-43).

| # | Command (Rust file:line) | Args (Rust) | Returns | TS binding (tauri.ts) | Tramado |
|---|---|---|---|---|---|
| 1 | `db_open` (lib.rs:104) | `project: String, key_hex: String, create: bool` | `()` | `projects.open` → `call('db_open',{project,keyHex,create})` :228 | DROP |
| 2 | `db_close` (lib.rs:119) | `project: Option<String>` | `()` | `TauriDb.close` :98 | DROP |
| 3 | `db_exec` (lib.rs:128) | `project: Option<String>, sql: String, params: Vec<Value>` | `ExecResult{changes: usize}` | `TauriDb.exec` :76 | DROP (or index DB) |
| 4 | `db_query` (lib.rs:138) | same | `Vec<Map<String,Value>>` | `TauriDb.query` :80 | DROP (or index DB) |
| 5 | `db_batch` (lib.rs:148) | `project, statements: Vec<Statement{sql, params}>` | `usize` | `TauriDb.batch` :84 | DROP |
| 6 | `db_script` (lib.rs:157) | `project, sql: String` | `()` | `TauriDb.script` :91 | DROP |
| 7 | `project_list` (lib.rs:164) | — | `Vec<String>` | `projects.list` :223 | ADAPT → `class_list` |
| 8 | `project_exists` (lib.rs:169) | `project: String` | `bool` | `projects.exists` :224 | ADAPT → `class_exists` |
| 9 | `project_erase` (lib.rs:174) | `project: String` | `()` | `projects.erase` :235 | ADAPT → `class_remove` (unshare first; ask whether to delete files) |
| 10 | `erase_all` (lib.rs:186) | — | `()` | `eraseAll` :220 | DROP |
| 11 | `kdf_argon2id` (lib.rs:194) | `secret_hex, salt_hex: String, m, t, p: u32, len: usize` | `String` (hex) | `tauriKdf` :118 | DROP |
| 12 | `app_file_read` (lib.rs:215) | `name: String` (allow-listed) | `Option<String>` | `prefs.get` :194, `keyring.read` :211, `libraryFile.read` :215 | KEEP (prefs, classes registry) |
| 13 | `app_file_write` (lib.rs:221) | `name: String, text: String` | `()` | `prefs.set` :204 (serialised queue), `keyring.write` :212, `libraryFile.write` :216 | KEEP |
| 14 | `blob_write` (lib.rs:226) | raw body; headers `x-project`, `x-blob-id` | `()` | `blobs.write` :240 | ADAPT → `class_file_write` (headers `x-class`, `x-path`) |
| 15 | `blob_read` (lib.rs:235) | `project, id: String` | `Response` (bytes) | `blobs.read` :241 | ADAPT → `class_file_read` |
| 16 | `blob_append` (lib.rs:243) | raw; `x-project`, `x-blob-id` | `u64` new length | `blobs.append` :244 | ADAPT/maybe DROP (recording written by Rust) |
| 17 | `blob_write_at` (lib.rs:254) | raw; `x-project`, `x-blob-id`, `x-offset`, `x-truncate: "1"` | `()` | `blobs.writeAt` :245 | ADAPT/maybe DROP |
| 18 | `blob_read_range` (lib.rs:267) | `project, id: String, offset: u64, length: u64` | `Response` | `blobs.readRange` :247 | ADAPT → `class_file_read_range` (or asset protocol) |
| 19 | `blob_size` (lib.rs:280) | `project, id` | `u64` | `blobs.size` :248 | ADAPT (fold into `class_stat`) |
| 20 | `blob_delete` (lib.rs:286) | `project, id` | `()` | `blobs.remove` :242 | ADAPT → `class_file_remove` |
| 21 | `blob_list` (lib.rs:291) | `project` | `Vec<String>` | `blobs.list` :243 | ADAPT → `class_list_files` (uses `files::list`, conflict flag) |
| 22 | `fs_read` (lib.rs:298) | `path: String` (absolute) | `Response` | `files.read` :251 | KEEP (dialog-picked imports) |
| 23 | `fs_write` (lib.rs:305) | raw; header `x-path` | `()` | `files.write` :252 | KEEP (exports) |
| 24 | `fs_list` (lib.rs:312) | `path: String, recursive: bool` (cap 20 000) | `Vec<Entry>` | `files.list` :253 | KEEP |
| 25 | `fs_remove` (lib.rs:318) | `path: String` (files only) | `()` | `files.remove` :254 | KEEP |
| 26 | `fs_exists` (lib.rs:325) | `path: String` | `bool` | `files.exists` :255 | KEEP |
| 27 | `app_info` (lib.rs:338, sync) | — | `AppInfo{version, os, data_dir, example}` | `info` :198 | ADAPT (+`classes_root`, drop `example`) |
| 28 | `speech_info` (speech/mod.rs:146) | — | `SpeechInfo{transcribe, reason, engine}` | `speech.info` :279 | ADAPT (models list, download state) |
| 29 | `transcribe_start` (speech/mod.rs:170) | raw body; headers `x-ext`, `x-language`, `x-channels`, opt. `x-engine:service`, `x-service-base`, `x-service-key`, `x-service-model` | `()` | `speech.transcribe.start` :281-289 | ADAPT (path-based, key in Rust, model id) |
| 30 | `transcribe_status` (speech/mod.rs:338) | — | `JobStatus{state: "idle"\|"decoding"\|"transcribing"\|"done"\|"failed"\|"cancelled", percent, error: Option<{code,message}>}` | `speech.transcribe.status` :290 | KEEP |
| 31 | `transcribe_take` (speech/mod.rs:370) | — | `Option<Transcript>` | `speech.transcribe.take` :291 | KEEP |
| 32 | `transcribe_cancel` (speech/mod.rs:389) | — | `()` | `speech.transcribe.cancel` :292 | KEEP |
| 33 | `recorder_start` (speech/mod.rs:399) | — | `capture::Status` | `speech.recorder.start` :295 | ADAPT (`mode`, output path) |
| 34 | `recorder_status` (speech/mod.rs:411) | — | `Option<Status>` | `speech.recorder.status` :296 | KEEP |
| 35 | `recorder_take` (speech/mod.rs:417) | — | `Response` (16-bit LE stereo 16 kHz) | `speech.recorder.take` :297 | DROP if Rust writes the file |
| 36 | `recorder_stop` (speech/mod.rs:430) | — | `Response` (rest of audio) | `speech.recorder.stop` :298 | ADAPT (returns `{path, ms, bytes}`) |
| 37 | `service_hosts` (service/mod.rs:217) | — | `Vec<String>` | `service.hosts` :302 | KEEP |
| 38 | `service_allow` (service/mod.rs:234) | `base: String, text: AllowText{title, message, allow, cancel}` | `bool` | `service.allow` :303 | KEEP |
| 39 | `service_forget` (service/mod.rs:270) | `host: String` | `()` | `service.forget` :304 | KEEP |
| 40 | `service_check` (service/mod.rs:286) | `base: String, key: String` | `CheckResult{credit: Option<f64>}` | `service.check` :305 | ADAPT (key from `Secrets`) |
| 41 | `service_chat` (service/mod.rs:330) | `request: ChatRequest{base, key, model, messages: [{role, content}], max_tokens?}` | `ChatAnswer{text, model}` | `service.chat` :306 | ADAPT (stream, tools, routing, fallback) |

Plugin/core calls from tauri.ts: `@tauri-apps/plugin-dialog` `open({directory, multiple, title, filters})`, `save({title, defaultPath, filters})` (empty filter lists are removed: an empty list hides every file on some systems; extensions without leading dot); `getCurrentWindow().onCloseRequested` (every close request is held: `preventDefault`, run all exit handlers once with `Promise.allSettled`, then `win.destroy()`), `setTitle`. `isTauri()` = `'__TAURI_INTERNALS__' in window`. E2E hook: `window.__TRAMA_E2E_DIALOGS__` answer queue (tauri.ts:155-162) — rename to `__TRAMADO_E2E_DIALOGS__`.

Proposed new Tramado commands (Rust-side only; names indicative):
- Classes: `class_create {name, root?}`, `class_list`, `class_file_read {class, path}`, `class_file_write` (raw; `x-class`, `x-path`), `class_file_read_range`, `class_file_remove`, `class_list_files {class, recursive}`, `class_reveal {class, path}` (opener from Rust), `class_watch {class}` (events `class:changed`).
- Models: `model_list`, `model_download_start {id}`, `model_download_status`, `model_download_cancel`, `model_delete {id}`, `model_import {path}` (verify SHA-256; offline campus).
- Secrets: `secret_set {name:"openrouter", value}`, `secret_status` (→ `{set: bool, last4}`), `secret_clear`.
- AI: `ai_chat {request}` (non-streaming), `ai_chat_stream {request, onEvent: Channel<ChatEvent>}` → stream id, `ai_cancel {id}`, `ai_models` (OpenRouter `/models`, filter `:free`, audio-capable).
- Sync: `sync_status` (`{running, device_id, version, port_listen}`), `sync_class_share {class}` → invite code, `sync_join {code, target_dir}`, `sync_peers {class}`, `sync_pending` (pending devices/folders), `sync_pause/resume`, events `sync:event` from a Rust long-poll pump (no Syncthing key/port ever given to the webview).
- `open_external {url}` (https only, via opener plugin from Rust).

---

## 5. Gotchas catalogue (all documented in Trama code/docs, plus new ones)

1. **whisper-rs 0.16 `set_abort_callback_safe` is broken** (trampoline type confusion → random aborts). Use the raw `abort_if_cancelled` + `job.cancel.as_ptr()` (transcribe.rs:211-214, 299-305).
2. **whisper.cpp VAD is not applied by `whisper_full_with_state`** (what whisper-rs calls) → run `WhisperVadContext` yourself; whisper's segment starts after pauses are unreliable → DTW word times + `place_words`.
3. **DTW requires `flash_attn: false`**; DTW preset must match the model family.
4. `whisper_rs::install_logging_hooks()` once at startup, else whisper.cpp/ggml log to stderr.
5. Token ids `>= ctx.token_eot()` are timestamps/specials, not words. Times are centiseconds (`× 10 ms`). `t_dtw == -1` → fall back to `t0`.
6. **`GGML_NATIVE=OFF` + AVX/AVX2/FMA/F16C ON** in `.cargo/config.toml`; refuse transcription on x86-64 without them (`UNSUPPORTED_CPU`) — otherwise SIGILL. `.cargo/config.toml` is found from the CWD.
7. Windows MSVC: set `CMAKE_C_FLAGS_RELEASE`/`CMAKE_CXX_FLAGS_RELEASE` to `/MD /O2 /Ob2 /DNDEBUG` or whisper.cpp builds unoptimised.
8. macOS: `MACOSX_DEPLOYMENT_TARGET=14.2` (process taps) in `[env]`; universal build → verify AVX2/FMA in the Intel slice; `NSAudioCaptureUsageDescription` + `com.apple.security.device.audio-input` entitlement.
9. whisper-rs-sys needs **libclang** (bindgen) and **cmake**.
10. **cpal streams stay on the thread that built them**; ignore `Xrun`/`DeviceChanged`/`RealtimeDenied`; WASAPI loopback sends **no data during silence** → clock-based padding; Linux loopback = PulseAudio `"<sink>.monitor"` via cpal's pure-Rust PulseAudio host (PipeWire ok), ALSA fallback has no loopback.
11. **CSP**: `dangerousDisableAssetCspModification: ["style-src"]` or WebKit drops all inline styles (nonce + `'unsafe-inline'`).
12. `freezePrototype: false`, `withGlobalTauri: false` (the e2e uses `window.__TAURI_INTERNALS__.invoke`).
13. Header values over IPC must be percent-encoded (non-ASCII paths); raw bodies must not be sub-views of a bigger buffer.
14. Native dialogs with `blocking_show()` only inside `spawn_blocking`.
15. Window close: `onCloseRequested` + `preventDefault` + `destroy()` needs `core:window:allow-destroy`; WebDriver "close window" **kills** the process (skips exit handlers) → e2e closes via X11 `WM_DELETE_WINDOW` (python ctypes on libX11).
16. e2e under Xvfb: run `tauri-driver` under **`dbus-run-session`**, else every app start waits ~30 s for portals; WebKitWebDriver **mis-aims clicks at fractional scale** (`GDK_DPI_SCALE=1.25`) → click via DOM; test at 125 % (auto-growing fields can loop).
17. `write_atomic`: fsync the parent dir on Unix; Rust `rename` replaces on Windows; temp files are dot-prefixed so listings skip them; stale ones swept after 1 h. Make Syncthing ignore them (`.stignore`).
18. Release builds have **no devtools**; the error boundary shows errors as selectable text.
19. **`panic = "abort"`** — Exit hooks do not run on a panic; children must die with the process by OS mechanism (§7).
20. **ZDR routing kills free models** (verified 404); 404 is not always "no model".
21. **OpenRouter streams** send `: OPENROUTER PROCESSING` keep-alives (often dozens before the first token) and `delta.reasoning` separately; use per-read timeouts.
22. Tauri `async` commands borrowing `State` must return `Result`; top-level args camelCase↔snake_case, nested struct fields not converted.
23. `tauri_build::build()` fails when an `externalBin` file is missing — including `cargo test`/`clippy`; sidecar name must differ from the Cargo package name; deb installs sidecars to `/usr/bin/<name>`.
24. Syncthing GUI on loopback has **no auth** unless a GUI user/password is set; Syncthing v2 forks a **monitor** whose child is in another process group (killpg on the monitor's group does not reach it); `STMONITORED=yes` = single process; exit code **3** = restart requested.
25. The default toolchain on this machine is nightly → pin with `rust-toolchain.toml`.
26. Windows: spawn console programs with `CREATE_NO_WINDOW` (0x0800_0000) or a console window flashes; never pipe a child's stdout/stderr without draining it (the child blocks when the 64 KiB pipe fills) — use `Stdio::null()` + `--log-file`.
27. `PR_SET_PDEATHSIG` fires when the **thread** that forked dies, not the process → spawn from a long-lived supervisor thread (not a `spawn_blocking` worker).

---

## 6. Question 1 — how Trama locates the speech model, and the on-demand design

### 6.1 Trama today
- Build time: `tools/fetch-speech-models.mjs` downloads to `desktop/src-tauri/resources/speech/` (gitignored), each file checked against **size + SHA-256** (`.part` + rename; `TRAMA_SPEECH_MODELS_FROM=<dir>` copies from a local folder instead):
  - `ggml-large-v3-turbo-q5_0.bin` ← `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`, 574 041 195 B, sha256 `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`
  - `ggml-silero-v5.1.2.bin` ← `https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin`, 885 098 B, sha256 `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf`
- Bundling: only release builds pass `--config src-tauri/tauri.speech.conf.json`, which maps `resources/speech/<file>` → `speech/<file>` in the app's resource dir.
- Runtime (`speech::locate`, speech/mod.rs:67-79), called **once in `setup`**: candidates in order — `TRAMA_SPEECH_DIR` (non-empty env), `app.path().resource_dir()?.join("speech")`, and in debug builds `env!("CARGO_MANIFEST_DIR")/resources/speech`; the first directory where **both** files exist as regular files with the **exact byte sizes** wins (`has_models`; hashes are only checked at build time). Result stored immutably in `Speech { dir: Option<PathBuf> }`; `None` ⇒ `speech_info.reason = "NO_MODEL"`, `transcribe_start` local ⇒ `UNAVAILABLE`; the remote engine uses `dir.join(VAD)` if present and the CPU is supported, else loudness cutting.

### 6.2 Tramado: what to change
1. **Directories**: models in `app.path().app_local_data_dir()?.join("models")` — Linux `~/.local/share/<identifier>/models`, macOS `~/Library/Application Support/<identifier>/models`, Windows **`%LOCALAPPDATA%\<identifier>\models`** (not `app_data_dir`, which is *Roaming* on Windows — never roam 0.5 GB; not `app_cache_dir`, which OS cleaners purge and would force re-downloads on campus Wi-Fi). Overrides: `TRAMADO_SPEECH_DIR` (dev/tests/offline), and `TRAMADO_DATA_DIR`-relative when set.
2. **Bundle only the VAD** (0.9 MB) as a resource → `resource_dir()/speech/ggml-silero-v5.1.2.bin`; download only the whisper model.
3. **Resolve per file at call time** (not once per directory at startup): `fn model_path(&self, spec) -> Option<PathBuf>` checks `[env dir, models dir]` for `spec.file` with `len == spec.size`; `fn vad_path()` checks `[env dir, models dir, resource_dir/speech]`. `Speech.dir: Option<PathBuf>` becomes `models_dir: PathBuf` + `resource_vad: Option<PathBuf>`.
4. **Registry** shared by Rust and the build scripts (e.g. `desktop/src-tauri/speech-models.json`, `include_str!` in Rust). Values from HF `HEAD` (`x-linked-size`, `x-linked-etag` = SHA-256):

| id | file | bytes | sha256 | DTW preset |
|---|---|---:|---|---|
| base | ggml-base-q5_1.bin | 59 707 625 | `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` | `Base` |
| small | ggml-small-q5_1.bin | 190 085 487 | `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` | `Small` |
| medium | ggml-medium-q5_0.bin | 539 212 467 | `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f` | `Medium` |
| turbo (default) | ggml-large-v3-turbo-q5_0.bin | 574 041 195 | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` | `LargeV3Turbo` |
| turbo-q8 | ggml-large-v3-turbo-q8_0.bin | 874 188 075 | `317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1` | `LargeV3Turbo` |
| vad | ggml-silero-v5.1.2.bin | 885 098 | `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf` | — |

URL pattern `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<file>` (VAD: `ggml-org/whisper-vad`). They `302` to `https://us.aws.cdn.hf.co/xet-bridge-us/...` (signed query) and support `Range` (206 verified) → resumable.
5. **Download job** (same shape as the transcription job; one at a time; status polled or emitted):
```rust
fn download(agent: &ureq::Agent, spec: &ModelSpec, dir: &Path, job: &Download) -> AppResult<PathBuf> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    std::fs::create_dir_all(dir)?;
    let dest = dir.join(&spec.file);
    let part = dir.join(format!("{}.part", spec.file));
    let mut have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > spec.size { std::fs::remove_file(&part)?; have = 0; }
    let mut req = agent.get(&spec.url)
        .config().timeout_global(None).timeout_per_read(Some(Duration::from_secs(60))).build();
    if have > 0 { req = req.header("Range", &format!("bytes={have}-")); }
    let mut res = req.call().map_err(|e| AppError::Coded("DOWNLOAD_FAILED", e.to_string()))?;
    match res.status().as_u16() {
        206 => {}
        200 => { have = 0; }                       // server ignored Range: start over
        s => return Err(AppError::Coded("DOWNLOAD_FAILED", format!("HTTP {s}"))),
    }
    let mut out = std::fs::OpenOptions::new().create(true).write(true).append(have > 0).truncate(have == 0).open(&part)?;
    let mut r = res.body_mut().as_reader();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if job.cancel.load(Ordering::Relaxed) { return Err(crate::speech::stopped()); }
        let n = r.read(&mut buf)?; if n == 0 { break; }
        out.write_all(&buf[..n])?; have += n as u64;
        job.done.store(have, Ordering::Relaxed);
    }
    out.sync_all()?; drop(out);
    // Verify the whole file (also covers resumed parts).
    let mut h = Sha256::new(); let mut f = std::fs::File::open(&part)?;
    loop { let n = f.read(&mut buf)?; if n == 0 { break; } h.update(&buf[..n]); }
    if have != spec.size || hex_lower(&h.finalize()) != spec.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(AppError::Coded("CHECKSUM_MISMATCH", spec.file.clone()));
    }
    std::fs::rename(&part, &dest)?;
    Ok(dest)
}
```
   (Trama's shared agent has `timeout_global(180 s)` — the per-request override is mandatory for a 574 MB file. Check free disk space first, e.g. `fs4` 1.1. Hold an `Awake` guard while downloading.)
6. `cpu_supported()` stays: on x86-64 without AVX2/FMA/F16C, do not offer the local download at all; offer cloud transcription (OpenRouter audio models) instead.

---

## 7. Question 2 — plugins/permissions, and supervising a bundled Syncthing

### 7.1 Plugins Tramado needs (beyond Trama's `tauri-plugin-dialog`)
| Need | Use | JS permission? |
|---|---|---|
| Only one Tramado per user (one Syncthing per home; deep links reach the running app) | `tauri-plugin-single-instance` 2.5 — register **first**; desktop only; skip when `TRAMADO_DATA_DIR` is set (dev/e2e multi-instance) | none |
| Open a document in the system viewer, reveal in file manager, open an https link (OpenRouter key page, a law's official URL) | `tauri-plugin-opener` 2.7, called **from Rust** behind validated commands (`class_reveal`, `open_external`) | none (preferred) — or scoped `opener:allow-open-url` (`https://*`) / `opener:allow-reveal-item-in-dir` |
| Chat message / "transcription finished" when the window is hidden | `tauri-plugin-notification` 2.8 from Rust (`app.notification().builder().title(..).body(..).show()`) | none if Rust-only; `notification:default` if JS asks permission |
| File changes in class folders | **No Tauri plugin**: `notify` 8.2 + `notify-debouncer-full` 0.7 in Rust → `app.emit("class:changed", {class, paths})`; plus Syncthing `/rest/events/disk` (`LocalChangeDetected`/`RemoteChangeDetected`, verified) and `/rest/events` (`ItemFinished`, `FolderCompletion`, `FolderSummary`, `DeviceConnected`, `PendingDevicesChanged`, `PendingFoldersChanged`) for sync state | none |
| Spawning Syncthing | **No `tauri-plugin-shell`** — `std::process::Command` from Rust (path = `tauri::utils::platform::current_exe()?.parent()` + name; identical to the shell plugin's `relative_command_path`, shell-2.6.0 `process/mod.rs:175-205`) | none (never grant `shell:allow-spawn/execute`) |
| Media/PDF from class folders with Range | `tauri` feature `protocol-asset` + runtime scope | asset protocol config + CSP |
| Optional: invite links `tramado://join/<code>` | `tauri-plugin-deep-link` 2.6 (+single-instance `deep-link` feature) | `deep-link:default` if JS reads it |
| Optional: updates (serverless: static `latest.json` on GitHub Releases) | `tauri-plugin-updater` 2.14 — Trama deliberately has none (no network of its own); make it opt-in | — |
| Optional: background sync with window closed | tauri `tray-icon` feature | — |
Not needed: `tauri-plugin-http` (all HTTP is Rust), `tauri-plugin-fs` (custom confined commands are stricter than fs-plugin scopes), `tauri-plugin-shell`, `tauri-plugin-store` (prefs via `app_file_*`).

### 7.2 Why std::process instead of the shell plugin
The shell plugin is fine from Rust (`app.shell().sidecar("tramado-syncthing")?.args(..).set_process_group(true).kill_on_drop(true).spawn()` exists in 2.6.0, CREATE_NO_WINDOW on Windows, stdout/stderr as events), but: (a) its Windows job object **does not set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`** ("Closing it leaves the processes in the job running", `job_object.rs`), so a crash/kill of Tramado leaves Syncthing running; (b) `kill_on_drop`/`process_group` only help when Rust code runs (not on `panic=abort`, SIGKILL, logout); (c) it brings a JS-callable permission surface we must then keep empty. A ~150-line supervisor with std gives PDEATHSIG (Linux), a kill-on-close Job Object (Windows) and exit-code-aware restarts.

### 7.3 Recommended supervision design (verified pieces marked ✔)
- **Name/packaging**: sidecar `tramado-syncthing` (not `syncthing`: deb would install `/usr/bin/syncthing` and collide with the distro package ✔ tauri-bundler 2.10.4). Files `desktop/src-tauri/binaries/tramado-syncthing-<target-triple>[.exe]`; macOS universal build needs `tramado-syncthing-universal-apple-darwin` (bundler doc ✔). Bundled to: deb/AppImage `usr/bin/`, macOS `Contents/MacOS/`, Windows install dir; dev: copied by tauri-build to `target/<profile>/tramado-syncthing` ✔. macOS: the bundler signs it with the app (hardened runtime OK; no sandbox). Ship Syncthing's `LICENSE.txt` (MPL-2.0) and `AUTHORS.txt` as resources.
- **Home**: `app_local_data_dir()/syncthing` (config.xml, cert/key = device identity, `index-v2` DB, log). Never inside a class folder.
- **Process model**: `STMONITORED=yes` → single process ✔ (no monitor, so the PID we hold *is* Syncthing; no orphaned grandchild). Consequence: we are the monitor → restart on exit code **3** ✔ (`/rest/system/restart`, some config changes), restart with backoff on crash codes, stop on **0** ✔; exit **1** with "Failed to acquire lock" ✔ = another instance owns the home → adopt-or-stop (below).
- **Flags/env**: `serve --home=<home> --no-browser --no-restart --no-upgrade --gui-address=127.0.0.1:<port> --log-file=<home>/syncthing.log --log-max-size=... --log-max-old-files=2`, env `STGUIAPIKEY=<random 32 chars>` (keeps the key off the command line; `/proc/<pid>/environ` is owner-only) ✔, `STNODEFAULTFOLDER=1` ✔ (no `~/Sync`), `STNOUPGRADE=1`, `HOME` untouched. `stdin/stdout/stderr = Stdio::null()` (never an undrained pipe). Port: bind `127.0.0.1:0`, read the port, drop, pass it (persist it in `runtime.json` with the PID). First run: set a random GUI user/password (`PATCH /rest/config/gui {"user":"tramado","password":"<random>"}` — Syncthing hashes it) because the GUI is otherwise open to any local process ✔ (`GET /` → 200 unauthenticated; REST → 403 without key).
- **Kill-with-parent**:
  - Linux ✔: `pre_exec` with `prctl(PR_SET_PDEATHSIG, SIGTERM)` + `getppid()` check, spawned and `wait()`ed on a **dedicated long-lived thread** (prototype `lab/trama-rust/supervisor-proto/src/main.rs`; SIGKILL of the parent → Syncthing exits).
  - Windows (not compiled here — verify): Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, handle intentionally never closed (the OS closes it when Tramado dies → job killed); `CREATE_NO_WINDOW`.
  - macOS: no PDEATHSIG → rely on graceful stop + **adopt-or-stop at startup**: read `runtime.json` `{pid, port, apikey}`; if `GET /rest/noauth/health` = OK and `GET /rest/system/status` with our key = 200 → `POST /rest/system/shutdown` ✔ (or adopt it), wait for exit; if the lock is held but REST does not answer → kill `pid` only if its executable path equals our sidecar path.
- **Graceful stop** (all OSes, in `RunEvent::Exit`): `POST /rest/system/shutdown` (✔ `{"ok":"shutting down"}`, exits 0 in ~1 s) with a 3–5 s wait, then `child.kill()`. SIGTERM also works on Unix ✔ (~1 s).
- **Readiness**: poll `GET /rest/noauth/health` (`{"status":"OK"}`) ✔ every 100 ms up to ~15 s; then start the event pump: `GET /rest/events?since=<last>&timeout=60` and `/rest/events/disk?since=..&timeout=60` on two threads with an agent whose `timeout_per_read` > 60 s; forward to the webview with `app.emit("sync:event", ..)`; never give the webview the port or key.
- **Discovery/relays**: the log shows global discovery (`discovery-*.syncthing.net`), relays (`relays.syncthing.net`), local broadcast `21027`, listeners `tcp/quic :22000` ✔ — list these in Tramado's privacy notes; firewall prompts on macOS/Windows.

Linux/macOS supervisor core (prototype, compiled and run on Linux):
```rust
use std::os::unix::process::CommandExt;
let parent = std::process::id() as libc::pid_t;
let mut cmd = std::process::Command::new(sidecar_path);
cmd.args(["serve", "--no-browser", "--no-restart", "--no-upgrade",
          &format!("--home={}", home.display()),
          &format!("--gui-address=127.0.0.1:{port}"),
          &format!("--log-file={}", home.join("syncthing.log").display())])
   .env("STMONITORED", "yes").env("STNODEFAULTFOLDER", "1").env("STNOUPGRADE", "1")
   .env("STGUIAPIKEY", &api_key)
   .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
#[cfg(target_os = "linux")]
unsafe {
    cmd.pre_exec(move || {
        if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 { return Err(std::io::Error::last_os_error()); }
        if libc::getppid() != parent { libc::raise(libc::SIGTERM); }
        Ok(())
    });
}
// Spawn AND wait on this dedicated thread (PDEATHSIG follows the forking thread).
std::thread::Builder::new().name("tramado-syncthing".into()).spawn(move || loop {
    let mut child = cmd.spawn()?;           // store child.id() + port + key in runtime.json
    let code = child.wait()?.code();
    match code { Some(0) => break, Some(3) => continue /* restart requested */, _ => backoff_or_give_up() }
})?;
```
Windows addition (sketch; windows-sys 0.61 features `Win32_System_JobObjects`, `Win32_System_Threading`, `Win32_Foundation`):
```rust
#[cfg(windows)]
fn tie_to_us(child: &std::process::Child) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() { return Err(std::io::Error::last_os_error()); }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation,
              &info as *const _ as *const core::ffi::c_void, std::mem::size_of_val(&info) as u32) == 0
           || AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0 {
            return Err(std::io::Error::last_os_error());
        }
        // Deliberately never CloseHandle(job): it closes when Tramado exits or is killed.
    }
    Ok(())
}
// and: use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000 /* CREATE_NO_WINDOW */);
```

### 7.4 Build plumbing for the sidecar
- `tools/fetch-syncthing.mjs` (clone of `fetch-speech-models.mjs`: pinned URL + SHA-256, `.part` + rename, `TRAMADO_SYNCTHING_FROM=<dir>` offline) extracts `syncthing`/`syncthing.exe` from the archive into `desktop/src-tauri/binaries/tramado-syncthing-<triple>[.exe]` (chmod 755). v2.1.7 assets (SHA-256 from the release's `sha256sum.txt.asc`; linux-amd64 re-verified locally):

| Tauri triple | asset | sha256 |
|---|---|---|
| x86_64-unknown-linux-gnu | syncthing-linux-amd64-v2.1.7.tar.gz (14 046 697 B; binary 34 MB) | `2edc416e7ed136b7c858ed5f3f02a3b8316589605e54c380228ceea7acbf0142` |
| aarch64-unknown-linux-gnu | syncthing-linux-arm64-v2.1.7.tar.gz | `48e456690cd2b97e7d26b02b5ac35f62a3b36172267b144cfeaf02c993ab955c` |
| x86_64-apple-darwin | syncthing-macos-amd64-v2.1.7.zip | `b8be90176d0f24daebae7b5aaddac52ebfae395df6d99f5e0e54656db00868cb` |
| aarch64-apple-darwin | syncthing-macos-arm64-v2.1.7.zip | `2df075b463231a307c91da657157beaed06383a941ba7ea04d33d536e3c4af38` |
| universal-apple-darwin | syncthing-macos-universal-v2.1.7.zip | `a98fb709c79412e5586c81a1586bfb256b6e5a97b067ddf7447155bcdf6aac3f` |
| x86_64-pc-windows-msvc | syncthing-windows-amd64-v2.1.7.zip | `3ce7da770f546a8d02b65b2e7ee31f2a3b8b7c3f990ede045590cca4172ecfe1` |
| aarch64-pc-windows-msvc | syncthing-windows-arm64-v2.1.7.zip | `d535ffd611b3af223de64bc5dfc60c378881eb13d5c8ecb1431b7407094c15ff` |

- `tauri.sidecar.conf.json`: `{ "bundle": { "externalBin": ["binaries/tramado-syncthing"] } }`, passed to **both** `tauri dev --config ...` and `tauri build --config ...` (scripts run the fetch first). Plain `cargo test`/`clippy` then never need the binary. At runtime, resolve `TRAMADO_SYNCTHING_BIN` env first (dev/e2e), then the sidecar next to the exe; if missing → `SYNC_UNAVAILABLE` (app still works for local classes).

---

## 8. Question 3 — keep "the webview has no network; all HTTP from Rust"? **Yes.**

### 8.1 Reasons
1. **The Syncthing API key is root over the student's files.** With it, a caller can add a folder at any path (e.g. `~/.ssh`, `~/Documents`) and share it with any device ID. Tramado renders a lot of *untrusted* content — classmates' chat messages, synced notes/Markdown, document text, AI output. A single XSS in a webview that can reach `127.0.0.1:<port>` with the key would exfiltrate files through Syncthing itself. Keeping `connect-src` IPC-only and the key in Rust contains that.
2. Same for the **OpenRouter key** (money): never needs to be in JS memory once entered.
3. **Syncthing's GUI port is not a web API for foreign origins**: no CORS for `tauri://localhost`/`http://tauri.localhost`, host-header checks, and mixed-content rules differ between WebKitGTK, WKWebView and WebView2 — fetching it from the webview would need `tauri-plugin-http` anyway (i.e. Rust).
4. **Streaming works fine over IPC**: `tauri::ipc::Channel<T>` delivers ordered messages; token deltas are tiny. Long-polls (`/rest/events?timeout=60`) belong in Rust threads that survive page reloads and can raise OS notifications when the window is hidden.
5. **One place for policy**: allowed hosts, ZDR/data-policy routing, retries/backoff on free-tier 429s, request logging without content, rate limits, and the privacy notes generator (Trama `core/privacy/flows.ts`) stay coherent; the existing e2e "no network" audit keeps passing for the webview processes.
6. Cost is small: thin Rust proxies + serde types; Trama already proves the pattern (service/, speech/remote.rs).
The only things that change versus Trama: the **app process** (not the webview) now talks to OpenRouter, Hugging Face (model download) and runs a networking child (Syncthing). Adapt the e2e socket audit accordingly (§10).

### 8.2 Loopback client to Syncthing (Rust)
Separate `ureq::Agent` (no proxy: `.proxy(None)`), base `http://127.0.0.1:<port>`, header `X-API-Key: <key>` (or `Authorization: Bearer <key>` ✔), `timeout_per_read(70 s)` for `/rest/events` long polls, everything else 10 s. Expose typed commands, never a generic "proxy any path" command (that would hand the webview the key's power).

### 8.3 Streaming chat over a Channel (sketch)
```rust
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatEvent {
    Delta { text: String },
    Reasoning { text: String },
    ToolCall { index: u32, id: Option<String>, name: Option<String>, arguments: String },
    Done { model: String, finish_reason: Option<String>, usage: Option<serde_json::Value> },
    Error { code: String, message: String },
}

#[tauri::command]
pub async fn ai_chat_stream(service: State<'_, Service>, secrets: State<'_, Secrets>,
                            request: ChatRequest, on_event: tauri::ipc::Channel<ChatEvent>) -> AppResult<String> {
    let client = service.client(service.endpoint(&request.base)?, &secrets.openrouter()?);
    let (id, cancel) = service.streams.register();
    std::thread::spawn(move || {
        let r = stream(&client, &request, &cancel, &on_event);
        if let Err(e) = r { let _ = on_event.send(ChatEvent::Error { code: e.code().into(), message: e.to_string() }); }
    });
    Ok(id)
}

fn stream(c: &Client, r: &ChatRequest, cancel: &AtomicBool, ch: &Channel<ChatEvent>) -> AppResult<()> {
    use std::io::BufRead;
    let mut body = r.to_openai_json();            // model or models[], messages, tools, max_tokens, provider (from settings)
    body["stream"] = serde_json::json!(true);
    let mut res = c.agent.post(c.endpoint.url("chat/completions"))
        .header("Authorization", c.auth()).header("Accept", "text/event-stream")
        .config().timeout_global(None).timeout_per_read(Some(Duration::from_secs(90))).build()
        .send_json(&body).map_err(transport)?;
    if !(200..300).contains(&res.status().as_u16()) { return Err(error_from_json(res)); } // same mapping as answer()
    let reader = std::io::BufReader::new(res.body_mut().as_reader());
    for line in reader.lines() {
        if cancel.load(Ordering::Relaxed) { break; }
        let line = line?;
        if line.is_empty() || line.starts_with(':') { continue; }      // ": OPENROUTER PROCESSING"
        let Some(data) = line.strip_prefix("data: ") else { continue };
        if data == "[DONE]" { break; }
        let v: serde_json::Value = serde_json::from_str(data).map_err(|e| AppError::Other(e.to_string()))?;
        if let Some(err) = v.get("error") { return Err(AppError::Coded("SERVICE_ERROR", err.to_string())); }
        let d = &v["choices"][0]["delta"];
        if let Some(t) = d["reasoning"].as_str().filter(|t| !t.is_empty()) { let _ = ch.send(ChatEvent::Reasoning { text: t.into() }); }
        if let Some(t) = d["content"].as_str().filter(|t| !t.is_empty())   { let _ = ch.send(ChatEvent::Delta { text: t.into() }); }
        // tool_calls deltas: accumulate arguments per index, emit ToolCall
        if let Some(f) = v["choices"][0]["finish_reason"].as_str() {
            let _ = ch.send(ChatEvent::Done { model: v["model"].as_str().unwrap_or_default().into(),
                                               finish_reason: Some(f.into()), usage: v.get("usage").cloned() });
        }
    }
    Ok(())
}
```
JS: `const ch = new Channel<ChatEvent>(); ch.onmessage = (e) => ...; const id = await invoke('ai_chat_stream', { request, onEvent: ch });` (top-level arg `on_event` ↔ `onEvent`).

---

## 9. Proposed Tramado `Cargo.toml` (starting point)
```toml
[package]
name = "tramado-desktop"
version = "0.1.0"
description = "Tramado — organise your classes (desktop shell)"
license = "MPL-2.0"
edition = "2021"
rust-version = "1.90"

[lib]
name = "tramado_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.7", features = [] }

[dependencies]
tauri = { version = "2.12", features = ["protocol-asset"] }
tauri-plugin-dialog = "2.8"
tauri-plugin-opener = "2.7"
tauri-plugin-notification = "2.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
percent-encoding = "2"
walkdir = "2.5"
base64 = "0.22"
sha2 = "0.11"                      # model checksums
getrandom = "0.4"                  # Syncthing API key / GUI password (check the 0.4 API)
notify = "8.2"
notify-debouncer-full = "0.7"
whisper-rs = "0.16"
symphonia = { version = "0.6", default-features = false, features = ["all-codecs", "all-formats", "opt-simd"] }
cpal = "0.18"
ureq = { version = "3.5", features = ["json"] }
# optional: rusqlite = { version = "0.40", features = ["bundled"] }  # derived FTS index, app-local only
# optional: keyring-core = "1" + per-OS store crates (or keyring = "4")

[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-single-instance = "2.5"

[target.'cfg(target_os = "linux")'.dependencies]
cpal = { version = "0.18", features = ["pulseaudio"] }
gio = "0.18"                       # keep in step with Tauri's gtk-rs
libc = "0.2"                       # PR_SET_PDEATHSIG

[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "0.6"
objc2-foundation = { version = "0.3", default-features = false, features = ["std", "NSProcessInfo", "NSString"] }
libc = "0.2"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = ["Win32_Foundation", "Win32_System_Power", "Win32_System_Threading", "Win32_System_JobObjects"] }

[dev-dependencies]
tempfile = "3"

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```
Keep `/home/feiteira/Trama/.cargo/config.toml` and `rust-toolchain.toml` verbatim at Tramado's repo root.

---

## 10. Tools

### 10.1 `tools/fetch-speech-models.mjs` — ADAPT
Pattern to keep: `FILES = [{name,url,size,sha256}]`, `good()` = exists && size && SHA-256, download to `.part` with `fetch(..., {redirect:'follow'})` + `Readable.fromWeb` + progress every 5 %, verify, `renameSync`; `*_FROM=<dir>` offline copy; exit 1 with "nothing was kept". Use it for: `fetch-syncthing.mjs` (§7.4, plus archive extraction), the VAD resource, and an optional dev/CI model fetch (tests use `TRAMADO_SPEECH_DIR`). Share the model registry JSON with Rust.

### 10.2 `tools/desktop-e2e/` — ADAPT
Reusable verbatim (run.mjs): `freePort()`, `startDriver()` (tauri-driver `--port/--native-port`, under `dbus-run-session`, detached process group killed as a whole), `wd()` W3C client with timeouts, `js()`/`run()` (async script bridge), `invoke()` via `window.__TAURI_INTERNALS__.invoke` returning `{ok}|{denied}`, `until/present/find/click/type/keys`, `screenshot()`, `startApp()` (session caps `{'tauri:options': {application, args}}`, captures page errors/console.error), **`CLOSE_WINDOWS_PY`** (X11 `WM_DELETE_WINDOW` by `_NET_WM_PID`), `quitApp()`, `waitForExit()`, `appPids()` (`/proc/*/exe`), `externalSockets()` (walk the app's process tree in `/proc`, map socket inodes to `/proc/net/{tcp,tcp6,udp,udp6}`, flag non-loopback), the stand-in OpenAI server (`createHttpServer`, records bodies), `step()` timing, the watchdog, artifacts on failure. Requirements: release build, `WebKitWebDriver` (`webkit2gtk-driver`), `cargo install tauri-driver`, `xvfb-run`, `python3` + `libX11.so.6`, optional `dbus-run-session`.
Changes for Tramado:
- The "no network" step must now (a) still assert `plugin:http|fetch`, `plugin:shell|open`, `plugin:opener|open_url` (if opener is Rust-only) are refused and page `fetch`/XHR/WebSocket/img are CSP-blocked; (b) exclude the **Syncthing child's PID subtree** from the socket audit (or run it with `listenAddresses: ["tcp://127.0.0.1:0"]`, `globalAnnounceEnabled/localAnnounceEnabled/relaysEnabled: false` in tests) and assert the **WebKit processes** hold no external sockets.
- New flagship test: **two Tramado instances** (two `TRAMADO_DATA_DIR`s → two Syncthing homes, ports, device IDs) on one machine; A creates and shares a class, B joins with the invite code, a document and a recording appear on B, a chat message round-trips, the transcription claim lets exactly one transcribe; all over 127.0.0.1 with static device addresses (`tcp://127.0.0.1:<port>`), discovery off.
- Speech step: flite-synthesised sample (ffmpeg) + `TRAMADO_SPEECH_DIR` model; add a model-download step against a local stand-in server serving a small file with a known SHA-256.
- Rename env knobs `TRAMA_*` → `TRAMADO_*` and `window.__TRAMA_E2E_DIALOGS__` → `__TRAMADO_E2E_DIALOGS__`.

---

## 11. Open points / risks to decide
1. Recording format for synced lectures (FLAC vs Vorbis vs Opus vs MP3) — measure size and webview playback on all three OSes.
2. macOS minimum 14.2 excludes Ventura-and-older student laptops; lowering it needs weak-linking of the Core Audio tap APIs in cpal (unknown).
3. Long-lecture memory (§3.9) — implement windowed transcription before shipping local transcription of 2–3 h recordings.
4. Two instances of Syncthing on one machine (the student's own Syncthing + Tramado's): separate homes and ports work by design (port probing on first start), but local-discovery port 21027 sharing should be tested.
5. OpenRouter `/api/v1/audio/transcriptions` request shape in remote.rs was not re-tested here (no free audio model was in scope); routing must not force ZDR.
6. Windows Job Object and macOS adopt-or-stop code were not compiled/run here (Linux machine); the Linux PDEATHSIG path was.
