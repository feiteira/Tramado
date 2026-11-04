# Desktop end-to-end tests

`run.mjs` drives the **real Tramado desktop app** (WebKitGTK) through W3C WebDriver on Linux: `tauri-driver` +
`WebKitWebDriver`, one driver and one private D-Bus session per app instance, all on a private Xvfb display that the
run starts and stops itself. Each instance runs in its own throwaway `TRAMADO_DATA_DIR` with `TRAMADO_E2E=1`, so
Syncthing stays on loopback (no discovery, relays or LAN broadcasts), secrets go to a file in that folder, the webview
keeps its storage there too, and nothing touches the person's own Tramado, Syncthing, keychain or autostart.
Native dialogs are answered from a queue (`TRAMADO_E2E_DIALOGS`, architecture §6.3).

```bash
npm run build:desktop                                   # release build: target/release/tramado-desktop + AppImage + deb
npm run e2e:desktop                                     # --suite=smoke       (~10 s)
npm run e2e:sync                                        # --suite=sync-two    (~1 min, needs a turbo model)
node tools/desktop-e2e/run.mjs --suite=sync-three       # three instances      (~1 min)
npm run e2e:media                                       # --suite=media       (~1 min, PulseAudio, a turbo model)
node tools/desktop-e2e/run.mjs --suite=model            # downloads "small" (190 MB) from Hugging Face (~2 min)
node tools/desktop-e2e/run.mjs --suite=hidden           # the 15-minute hidden-window measurement (architecture Q6)
node tools/desktop-e2e/run.mjs --suite=smoke --bin=target/release/bundle/appimage/Tramado_0.1.0-rc.1_amd64.AppImage
TRAMADO_AI_LIVE=1 npm run e2e:desktop                   # + one real Ask over free models (key in ~/.openrouter.key)
```

Speech suites (`sync-two`, `media`, `hidden`) transcribe with the turbo model: set `TRAMADO_SPEECH_FROM` (or
`TRAMADO_E2E_SPEECH_DIR`) to a folder holding `ggml-large-v3-turbo-q5_0.bin`, or fetch it into `.tramado-dev/models`
(`node tools/fetch-speech-assets.mjs --model=turbo --dest=.tramado-dev/models`). The run links it into its own models
folder; it never downloads it.

## Suites

| Suite | What it proves |
|---|---|
| `smoke` | Onboarding (window title "Tramado"); every kind of style applies in the real webview (stylesheet, `<style>`, `style=""`, CSSOM: the CSP `style-src` probe); Figtree, Bricolage Grotesque and Source Serif 4 load from the app; plugin commands (`http`, `opener`, `shell`, `dialog`, `notification`) are refused to the webview, fetch/XHR/WebSocket/image to the internet are blocked by the CSP; a class; a PDF through Add › Documents… (dialog queue); extraction and indexing in the webview workers; the palette finds "época de recurso" in Artigo 3.º and opens the PDF with the passage marked; Settings › About's audio self-test; the socket audit (below); closing the window runs the exit handlers ("Tramado exiting") and the app exits; a restart finds the class. With `TRAMADO_AI_LIVE=1`: the key is tested in onboarding, one real Ask in the class answers (the answering model is printed, from the AI activity log), and afterwards the key is in no file of the data folder except `config/secrets.json`, and in no log. |
| `sync-two` | A shares a class (Syncthing starts, loopback only), B joins with the code and is admitted, a PDF crosses and is indexed at B, chat lines cross both ways and A's line shows ✓ Sent, A imports a recording and exactly one `transcript.json` (identical bytes, no conflict copy) reaches both, A quits (its Syncthing stops, B sees A offline), then B quits. |
| `sync-three` | Sync spec §24's unverified flows: C forges B's member file and deletes A's member file, the owners heal them (every copy returns to the owner's mirror); A removes C (soft ban): on A, which still shares a study group with C, C leaves the class's folder and gets an `ignoredFolders` entry; on B, where every folder C was in bans C, C becomes a device-wide "tramado-ban" ignore; what C writes afterwards reaches nobody while the study group still syncs; B leaves while the others are offline and finishes (folder removed, a local fork in B's rail) only once A is back. |
| `media` | A PulseAudio null sink (its monitor remapped as a microphone, both unloaded at the end): Settings › About's self-test (300 s file, seek to 252 s within 0.25 s, on the Blob path WebKitGTK needs); a speech clip played into the sink is recorded through the Record dialog, saved as a lecture, plays in the lecture's player (duration, seek) and is transcribed on this computer. |
| `model` | Settings › Transcription downloads "small" from Hugging Face into the run's folder; the window is closed in the middle; after a restart Resume continues from the `.part` (the `started` event's `resumedFrom`); size and SHA-256 checked here; a Portuguese recording is transcribed with it; Remove deletes it. The app process reaches only Hugging Face and its CDN; WebKit nothing. |
| `hidden` | Architecture Q6: A (a volunteer with a local model) hides its window (a shared class: closing hides) for `--minutes` (15); B joins meanwhile and imports a recording for a classmate to transcribe; A's volunteer delay (a webview timer) must fire within its deadline + 60 s; A's presence heartbeats are counted. A is observed through its files only. |

**Socket audit (critique C38).** Every socket of the app process, of its WebKit helpers and of the Syncthing subtree
is read from `/proc/<pid>/fd` and `/proc/<pid>/net/{tcp,tcp6,udp,udp6}` (each process's own network namespace).
WebKit processes may have nothing beyond loopback; the app process only addresses of `openrouter.ai`, `huggingface.co`
and its CDN (`*.hf.co`) and `discovery-lookup.syncthing.net` (resolved at check time); Syncthing (in tests) only
loopback.

## Requirements

- A build: `target/release/tramado-desktop` (`npm run build:desktop`), or `--bin=`/`TRAMADO_BIN=` (a debug build with
  the frontend embedded: `cargo build -p tramado-desktop --features tauri/custom-protocol`; an `.AppImage`, which is
  extracted and run through its `AppRun`, no FUSE needed).
- `tauri-driver` (`cargo install tauri-driver`), `WebKitWebDriver` (package `webkit2gtk-driver`), `Xvfb`, `python3`
  with `libX11.so.6` (the window close a person makes: an X11 `WM_DELETE_WINDOW`, so the exit handlers run), and
  `dbus-run-session` (optional, recommended).
- `media`: `pactl`, `paplay`, `ffmpeg`, a PulseAudio (or PipeWire-Pulse) server (`pulseaudio --start` is run if none
  answers, and stopped again).
- The pinned Syncthing sidecar (`npm run fetch:syncthing`) when the build is not a bundle.

## Output and failures

Each step prints its name, a note and its time; a summary of timings ends the run; exit code 0 when all passed. When
a step fails, every running instance prints a WebDriver screenshot (in the artifacts folder), the crash screen, page
errors, the page's text and the tail of its app log. Lines are redacted: the OpenRouter key of a live run never
appears.

| Variable | Meaning |
|---|---|
| `TRAMADO_BIN` | the app to test (default `target/release/tramado-desktop`) |
| `TRAMADO_E2E_KEEP=1` / `--keep` | keep the data folders |
| `TRAMADO_E2E_SHOTS=1` / `--shots` | a screenshot of every visible instance after each step, in the artifacts folder |
| `TRAMADO_E2E_ARTIFACTS` | where screenshots go (default: inside the run's temporary folder, kept only on failure) |
| `TRAMADO_E2E_TIMEOUT_MS` | watchdog for the whole run (25 min; 40 for `hidden`) |
| `TRAMADO_SPEECH_FROM`, `TRAMADO_E2E_SPEECH_DIR` | a folder with the turbo model |
| `TRAMADO_AI_LIVE=1` | the live Ask in `smoke` (free models only; the key is read from `~/.openrouter.key` at run time) |

Every process a run starts (Xvfb, drivers, apps, Syncthing, PulseAudio modules) is stopped at the end, also on a
failure or Ctrl+C.
