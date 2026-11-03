# Tramado research phase: completeness critique

Date: 2026-11-03. Critic pass over every report in
`/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/research/`
(`trama-rust.md`, `trama-ts.md`, `trama-ui.md`, `syncthing-lab.md`, `openrouter-lab.md`, `audio-pipeline.md`, `product-ux.md`)
and the lab scripts under `…/scratchpad/lab/`. My own checks live in
`/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/critique/` (§1).

How to read this report:
- §1 lists what I verified myself.
- §2 lists contradictions between reports, each with a resolution.
- §3 lists gaps: questions a designer must answer that no report answered, each with a recommended answer.
- §4 lists risky assumptions and how to de-risk them.
- §5 is the consolidated **DECISIONS** list (one line each).
- §6–§8 are the merged reference artefacts the decisions point to: class-folder layout, identity model, and error codes.

Report citations use the report name and section, e.g. `syncthing-lab §6.5`.

---

## 0. Top findings (read this if nothing else)

1. **The reports disagree on where AI HTTP runs.** `trama-ts` puts it in TypeScript, using plugin-http or CSP `connect-src`, and puts the key in `ChatRequest.key`. Three other reports keep the key and all HTTP in Rust. **Resolution:** Rust is an authenticated pipe that holds the key and enforces the privacy level. TypeScript owns one SSE parser plus the prompt/tool/retry logic, and that parser is reused by the browser demo and by Vitest (C1).
2. **Verified: Syncthing ignores `--log-file` when `STMONITORED=yes`.** Logs go to stdout. `trama-rust`'s supervisor (`--log-file` + `Stdio::null()`) would silently lose every Syncthing log. Redirect the child's stdout/stderr to a file handle instead (C2).
3. **Verified: "single-writer files" are a convention, not an enforcement.** I had device Y overwrite device X's `chat/<X>.jsonl`. The forgery synced to X, with `global.modifiedBy` = Y's short ID, and the original survived only in X's trashcan. Every per-device file must be authorship-checked through `modifiedBy` (G3).
4. **Verified: free vision models read a photographed exam perfectly.** Both `nvidia/nemotron-3.5-super-vl:free` (2.8 s) and, under the "No training" privacy level, `dots-studio/dots-3-note-preview:free` (20 s, about 1.2k reasoning tokens) gave 0 character errors on a tilted, blurred, shaded synthetic photo, even at 720 px wide. Going straight from image to JSON did **not** split sub-questions II.a–c, so use two steps: OCR first, then extraction plus the mandatory review screen (G10).
5. **Verified: a large PDF is cheap to index.** An 800-page, 3.5 M-char law PDF extracts in 2.1 s with Trama's `extractPdfText` (Node, synthetic PDF), builds the `PassageIndex` in 256 ms, and answers a query in 17 ms. The running header appeared on all 800 pages, so header stripping is required (G9).
6. **The default exam-answer strategy breaks the free quota.** `openrouter-lab`'s tool loop costs 4–8 requests per question, so a 10-question exam needs 40–80 requests. Accounts that never bought credit get **50 free requests per day**. Default to single-shot retrieval (about 12 requests per exam) and offer the tool loop as "Deep answer" (C17, G11).
7. **The reports disagree on the default privacy level.** `openrouter-lab` says no filter; `product-ux` says `data_collection: deny`. Today the deny chain answered every time, but only through `dots-3-note-preview` (a "preview" model), because Gemma was 429. Adopt "No training" as the default, ship the chains per level as data, and relax the level only with explicit consent (C14).
8. **The class-folder layouts in four reports conflict, and several of them have multi-writer files** (`.tramado/claims/<lectureId>.json`, `class.json`, `ai-answers.json`, `questions.json`). §6 gives one merged layout in which every machine file has one writer.
9. **Nobody designed what happens when the app is closed.** Then there is no sync, no admission of joiners and no transcript delivery. Small classes will often have "nobody online". The fix is a tray/background mode plus opt-in autostart (G12).
10. **Unverified everywhere: playback from a custom URI scheme with Range and seek, in all three webviews.** The audio lab and my own attempt both failed on this VM because it has no audio sink. Make it a week-1 spike, add a built-in media self-test, and keep a Blob-URL fallback (R3).

---

## 1. Verification log (what I ran)

| # | Check | How | Result |
|---|---|---|---|
| V1 | `--log-file` with `STMONITORED=yes` (contradiction C2) | `lab/critique/scripts/st_checks.sh` (two v2.1.7 instances X, Y) | **No log file was created.** Everything went to stdout (`X.stdout.out`, 43 lines). There was one process per instance. |
| V2 | Can a pending device's `name` carry an invite token? | Y PATCHed its own name to `"Bruno · tk:7Q2M-K9XD"`, then dialled X | X's `GET /rest/cluster/pending/devices` showed `"name": "Bruno · tk:7Q2M-K9XD"`. After acceptance X **stored that name** (`overwriteRemoteDeviceNamesOnConnect` defaults to false). |
| V3 | Can another member overwrite a "single-writer" file? | X wrote `.tramado/chat/<X>.jsonl` and scanned. Y overwrote the same path and scanned. | X's copy became `FORGED by Y`. `/rest/db/file` on X: `global.modifiedBy:"LGTQI2N"` (Y), `version:["AB4Z76W:…","LGTQI2N:…"]`. X's trashcan kept the original at `.stversions/.tramado/chat/<X>.jsonl`. `modifiedBy` is the 7-char short device ID. |
| V4 | Graceful shutdown time | Same lab; `POST /rest/system/shutdown` | **Both instances shut down at once while connected to each other: about 10 s** (each waited on the other's secondary connection). One instance alone while its peer stays up: 54–62 ms (API or SIGTERM). Instance with no peers: 742 ms. |
| V5 | Exam photo OCR with free vision models | `lab/critique/scripts/ocr_test.py` on `lab/critique/ocr/exam_photo.jpg` (1100 px, perspective, 2.5° tilt, blur, noise, shading, JPEG q70) and `exam_photo_small.jpg` (720 px, q55) | nemotron-3.5-super-vl:free, reasoning off: **CER 0**, 2.8 s (1100 px), 12.3 s (720 px). Chain `[gemma-31b, gemma-26b, dots-3-note-preview]` + `provider.data_collection: "deny"`: answered by **dots via AtlasCloud**, **CER 0**, 19.9 s / 23.8 s, 1,162 / 1,366 reasoning tokens. |
| V6 | Image → question JSON in one step | `ocr_test.py … super_json` | Valid JSON; kinds `case`/`choose_n`/`comment` correct; points 8/6/4 correct; rules captured. **II.a/b/c were not split** (kept inside II's text). 25 s, 2,682 reasoning tokens. |
| V7 | Large-PDF extraction and indexing cost | `lab/critique/scripts/bigpdf.mjs` (800 pages, 3,200 "articles", running header on each page) + `pdfperf.ts` (Trama `extractPdfText`, pdfjs-dist 6.3.289 legacy, `PassageIndex` from `lab/trama-ts/subset`) | 800 pages, 3,476,058 chars: **extract 2,087 ms (2.6 ms/page), +77 MB RSS**; index build 256 ms; query 17 ms; **header line present on 800/800 pages**. |
| V8 | OpenRouter age requirement claimed by `product-ux` | `curl https://openrouter.ai/terms` | Confirmed: "Updated: August 31, 2026 … You must be at least 18 years of age to use the Service." |
| V9 | Custom URI scheme URL forms (C10) | `~/.cargo/registry/.../tauri-2.12.0/src/app.rs:2263-2264` | macOS/Linux `<scheme>://localhost/<path>`; Windows/Android `http://<scheme>.localhost/<path>`. Tauri's own `protocol/asset.rs` handles Range with `http_range`, so it is a template for our handler. |
| V10 | Crate versions cited | crates.io API | opusic-c 1.6.1 (2026-04-27), opusic-sys 0.7.6 (2026-10-26), ogg 0.9.2, keyring 4.2.0, tauri 2.12.5, whisper-rs 0.16.0 / -sys 0.15.0 (2026-03-12, still latest), symphonia 0.6.1, cpal 0.18.2, tauri-plugin-autostart 2.7.0, tauri-plugin-global-shortcut 2.4.1, single-instance 2.5.5, deep-link 2.6.3, fs4 1.1.0, ulid 3.0.0. **ureq 3.5.1 was published 2026-11-02 (1 day old)**; pin 3.5.0 until it ages. |
| V11 | WebKitGTK `<audio>` from a custom scheme | Attempted | **Blocked**: this VM has no audio sink. Only `libgstpulseaudio` is installed; there is no ALSA GStreamer plugin, no `fakeaudiosink`, and no PulseAudio/PipeWire server. Same failure as `audio-pipeline §2.4`. Still unverified (R3). |

All Syncthing instances were stopped (`pgrep syncthing` is empty). OpenRouter requests sent: 5 (free models, no credit used).

---

## 2. Contradictions between reports, and resolutions

### C1. Where AI HTTP runs, and whether the webview ever sees the key
- **trama-ts §5(c), §8.2:** AI lives in TS on `platform.net.fetch` (plugin-http, or CSP `connect-src https://openrouter.ai`). `ChatRequest` has a `key` field, and `platform.secrets.get('openrouter.key' | 'syncthing.apikey')` returns secrets to JS. npm adds `@tauri-apps/plugin-http`.
- **trama-rust §8, openrouter-lab §0/§11.1, trama-ui §4.6:** all HTTP is in Rust and the key never enters the webview. Reason: an XSS in rendered classmate content (chat, notes, Markdown) could spend the user's money and, with the Syncthing key, share any folder of the user's disk.
- **Resolution:**
  - Rust holds the keys. It exposes a narrow `ai_send({ base_id, path, body, stream }, on_event: Channel)`.
  - `path` must be one of `chat/completions`, `embeddings`, `key`, `models`, `models/{id}/endpoints`. `base_id` is OpenRouter or a user-confirmed host from `service/hosts.rs`.
  - Rust injects `Authorization` and the attribution headers. It **overwrites `provider`** from the stored privacy level, so TypeScript cannot downgrade privacy.
  - For streams, Rust sends the raw `data:` payloads plus `{heartbeat}` markers. A non-2xx answer comes back as `{ status, headers: {retry-after, x-ratelimit-*, x-openrouter-error-origin}, body }`, with `user_id` stripped.
  - TypeScript owns `openrouter-lab §11.6`'s SSE parser, the request builder, the error classifier, retries, the 18 req/min throttle and the tool loop. The demo uses `window.fetch` with a session-only key (CORS `*` verified). Vitest uses a fake fetch. **One parser, three hosts.**
  - Remove `key` from every TypeScript type. `secrets` becomes `set / status → {set, last4} / clear`, with no `get`. Drop plugin-http. CSP `connect-src` stays IPC plus the media scheme.

### C2. Syncthing logging under `STMONITORED=yes`
- **trama-rust §7.3:** `--log-file=<home>/syncthing.log` with `Stdio::null()`.
- **syncthing-lab §2:** `--log-file` is ignored in that mode. The lab sketch (§13) uses piped stdout/stderr, which must be drained.
- **Verified (V1):** the log file is ignored and output goes to stdout.
- **Resolution:** open `<home>/syncthing.log` in append mode and pass it as `Stdio::from(file)` for both stdout and stderr. Rotate on spawn when it exceeds 5 MB, keeping 2 old files. Never use a pipe. Drop the `--log-file*` flags.

### C3. How the Syncthing API key reaches the child
- **syncthing-lab §3.2/§13:** `--gui-apikey=$KEY` on the command line.
- **trama-rust §7.3:** `STGUIAPIKEY` env, because `/proc/<pid>/environ` is owner-only while `/proc/<pid>/cmdline` is world-readable.
- **Resolution:** pass it through the environment, never on argv. Pre-seed the same key into `config.xml` (Syncthing keeps that file 0600) so orphan clean-up after a crash can reach the old instance (`syncthing-lab §3.4`). Never give the key to the webview: it is not in `SecretName`.

### C4. Sidecar name
- `syncthing-lab §13` uses `binaries/syncthing`. `trama-rust §7.3` uses `tramado-syncthing`, because deb packages install sidecars to `/usr/bin/<name>`, which would collide with the distro's `syncthing`.
- **Resolution:** `tramado-syncthing`, configured in `tauri.sidecar.conf.json` so `cargo test` and `clippy` don't need the binary.

### C5. Rust async and HTTP stack
- `syncthing-lab §13` uses `tokio::process`, `reqwest` and a tokio broadcast. `openrouter-lab §11.6` uses `reqwest::bytes_stream()`, or ureq. `trama-rust` uses std threads + `ureq` 3.5 (Trama's proven code). `PR_SET_PDEATHSIG` also needs a long-lived *thread* (`trama-rust` gotcha 27).
- **Resolution:** `ureq` 3.5 + std threads everywhere. That covers the supervisor, two event long-poll threads, the AI stream thread per request and the model downloader. Streams go to the webview over `tauri::ipc::Channel`. No reqwest, no tokio.

### C6. When Syncthing starts
- **trama-rust §3.2** starts `SyncState::start` in `setup` on every launch.
- **product-ux §4.1/§6.5:** "no network until you share or join".
- **Resolution:** start it lazily on the first share or join. After that, start it at launch whenever at least one shared class exists. A local-only user never starts it.

### C7. Ports
- **syncthing-lab §3.2/§4:** a persisted sync port P in 22100–22199 (check that both TCP and UDP are free; never 22000), and a GUI on a free loopback port.
- **trama-rust §7.3:** GUI port from binding `127.0.0.1:0`, persisted in `runtime.json`. Its e2e uses loopback listeners.
- These are compatible. **Merged rule:**
  - GUI port: fresh each start. A bind failure exits with code 1, so retry with a new port up to 3 times. Persist `{pid, port}` in `runtime.json` only for orphan clean-up.
  - Sync port: persisted, re-probed only when binding fails.
  - e2e: each instance gets its own `tcp://127.0.0.1:P`, discovery, relays and NAT off, static addresses.

### C8. Admission policy for joiners
- **syncthing-lab §6.5:** auto-accept a knocking device that proves the folder ID; no introducers (verified de-introduction cascade); an app roster.
- **product-ux §4.3/§4.4:** manual "Let in / Not now / Decline" with check words, a "random invite secret", optional "let people in without asking for 24 h" (default off), and "other members can let people in". `product-ux §11.1` also mentions "introducer semantics".
- **Problem:** an invite secret cannot be verified because there is no channel before acceptance. Manual approval also means a member must be online *and* click, which hurts "simple to set up".
- **Resolution:**
  - Default: **auto-accept by folder-ID proof** on every member's app. Then notify: "Bruno Costa joined ⚖️ TGDC · check words amber-otter · [Remove]".
  - A per-class setting, "Ask before letting people in", makes any online member's app queue joiners for a click.
  - Never use Syncthing introducers.
  - Expiring or revocable invites are a v1.1 option through the **device-name token**, verified feasible in V2: the joiner temporarily sets its device name to `<name> · tk:<token>`, and members check the token against `.tramado/invites/<deviceId>.json` (hash + expiry). The app must then rename the stored device from the roster, because peers keep the token-bearing name.
  - Kicking for real = rotate the folder ID (`syncthing-lab §6.5`).

### C9. Recording codec, bitrate and container
- `syncthing-lab §10.3`: Opus 32 kbps mono, about 14 MB/h.
- `product-ux §3.11`: `audio.opus` at 24–32 kbps.
- `trama-rust §3.8`: undecided between FLAC, Vorbis, Opus and MP3.
- `trama-ts §7`: Opus or FLAC.
- `audio-pipeline §0`: measured. Opus 24 kbps mono / 32 kbps stereo, a 16 kHz VoIP voice signal, 60 ms frames. Ogg journal while recording, **WebM for sharing and playback**, because Ogg Opus scales the timeline in Safari/WKWebView (WebKit bug 293310).
- **Resolution:** follow `audio-pipeline`. The shared file is `audio.webm`, never `.opus` or `.ogg`.

### C10. How media and PDFs reach the webview
- `trama-rust §2.3` and `trama-ts §8.1`: Tauri asset protocol (`protocol-asset`, `convertFileSrc`, runtime scope).
- `audio-pipeline §2.4`: a custom URI scheme with explicit `Content-Type` and Range, because the asset protocol sniffs WebM as `video/webm` and has a reported slow-seek issue; it suggests Blob URLs elsewhere.
- **Resolution:**
  - One custom async scheme, `tramado-media`, registered with `register_asynchronous_uri_scheme_protocol`. It serves only `(classId, relPath)` that pass the class-path confinement (no symlinks).
  - It sets an explicit MIME type and handles `Range`/206/416, copying the logic of Tauri's `protocol/asset.rs` (`http_range`).
  - CSP adds `tramado-media://localhost http://tramado-media.localhost` to `media-src`, `img-src` and `connect-src`. `connect-src` is needed for pdf.js range loading. The Windows form was verified (V9).
  - No `protocol-asset` feature.
  - If `<audio>` raises `MEDIA_ERR_SRC_NOT_SUPPORTED`, fall back to a Blob URL built from `class_file_read` bytes. Files are about 10 MB per hour, so this is cheap.

### C11. Whisper model registry
- `trama-rust §6.2`: base, small, medium, turbo, turbo-q8 from `resolve/main`.
- `audio-pipeline §3.2`: turbo (default), small as "Draft", large-v3 q5_0 as "Advanced". No medium (no more accurate than turbo, about the same size). Pin the Hugging Face commit `5359861c739e955e79d9a303bcbc70fb988958b1`.
- `product-ux §3.10/§4.6`: "Fast 190 MB, for older computers" / "Best 575 MB".
- **Resolution:** follow `audio-pipeline`. Label small "Draft (rough, 190 MB)", not "Fast", because it skipped whole passages of Portuguese. Point weak machines to a classmate's claim or to cloud transcription. Store the DTW preset per model.

### C12. Model downloader
- `trama-rust §6.2`: one Range GET with `timeout_global(None)`.
- `audio-pipeline §3.3`: 32 MiB Range chunks, each re-requesting the huggingface.co URL, because the `302` goes to a **signed, expiring** CDN URL. It also hashes the existing `.part` bytes on resume and emits Channel progress.
- **Resolution:** follow `audio-pipeline`. Use the error code `MODEL_INTEGRITY`, not `CHECKSUM_MISMATCH` (see §8).

### C13. Default cloud speech-to-text model, and calling it "free"
- `trama-ts §6`: `openai/whisper-large-v3`.
- `openrouter-lab §6b`: `openai/whisper-large-v3-turbo` (about $0.018 per 90-min lecture). There is **no free STT model**.
- `product-ux §4.5`: "With OpenRouter: a few minutes", without saying it is paid.
- **Resolution:**
  - Default `openai/whisper-large-v3-turbo`, configurable, **off by default**, labelled "paid, about 2 cents per lecture".
  - The claim protocol ensures only one member pays.
  - The free omni model is used only for spoken questions of 30 s or less.
  - `verbose_json` segments depend on the provider. Keep Trama's `REFUSED` → plain `json` downgrade and its one-segment-per-piece placement.

### C14. Default privacy level (and so the fallback chain)
- `openrouter-lab §0/§9`: "Free mode" (no `provider` filter) by default. Chain `[gemma-31b, gemma-26b, nemotron-3.5-super-vl]`.
- `product-ux §0.8/§6.3/§8`: "No training" (`data_collection: "deny"`) by default. Chain `[gemma-31b, gemma-26b, dots-3-note-preview]`.
- Today's evidence:
  - The deny chain answered in all of `product-ux`'s tests and both of my image tests (V5), always through dots, because Gemma was 429.
  - NVIDIA free models are blocked by deny.
  - dots is slow (20 s, over 1k reasoning tokens for one OCR page) and is a "preview".
- **Resolution:**
  - Default level **"No training"** with the chain `[google/gemma-4-31b-it:free, google/gemma-4-26b-a4b-it:free, dots-studio/dots-3-note-preview:free]`. The user's requested default model stays first and visible.
  - Ship one chain per level as data (`ai-defaults.json`).
  - When the whole chain is busy, show a one-click, explicit choice: "Use NVIDIA free models for this request / always — they may use what you send to train". Never relax privacy silently.
  - Strict (ZDR) means paid models only.

### C15. Error-code names
There are four incompatible sets:
- `trama-rust §3.3`: `UNAUTHORIZED, NO_MODEL, RATE_LIMITED, DATA_POLICY, CHECKSUM_MISMATCH…`
- `openrouter-lab §8/§11.2`: `AUTH, MODEL_UNKNOWN, PRIVACY_BLOCKS, BUSY, FREE_LIMIT, LENGTH…`
- `product-ux §8.2`: `BAD_KEY, FREE_BUSY, DAILY_QUOTA, PRIVACY_BLOCKED…`
- `trama-ts §5`: `EMPTY`; `audio-pipeline`: `INTEGRITY, DISK_FULL`.

There is also a real collision: `BUSY` means "one local job at a time" in Trama but "upstream 429" in `openrouter-lab`. **Resolution:** the single taxonomy in §8. Trama's `404 → NO_MODEL` mapping is wrong (an unknown model id comes back as 400) and is replaced.

### C16. Tool-loop limits vs Trama's answer flow
- `trama-ts §5(c)`: Trama's single "draft" prompt with numbered passages, `DRAFT_MAX_TOKENS = 900` (too low).
- `openrouter-lab §4`: `search_materials` / `read_passage` tool loop, `MAX_TURNS = 8`, final `tool_choice: "none"` nudge.
- Covered by C17.

### C17. Exam-answering strategy and request budget
- `openrouter-lab §11.7/§11.9`: tool loop per question (4–8 requests), which it admits is "a large share of a 50/day free account".
- `trama-ts §5(a)`: retrieval first (BM25 → top 8–12 passages → one answer request).
- **Resolution:**
  - **Default "Quick answer":** one request per exam for cross-language keyword expansion of *all* questions (JSON), then local BM25 per question, then one answer request per question with `[S#]` sources. A 10-question exam costs about 12 requests: 1 OCR (if a photo) + 1 extraction + 1 expansion + 10 answers.
  - **"Deep answer"** (the tool loop) is per question, opt-in. It is suggested only when the quick answer says the sources are insufficient, and offered by default only when `/key` reports `limit >= 1000`.
  - Always show the request estimate and the remaining free quota before a batch.

### C18. Citation markers
- `trama-ts §5(a)`: `[1]` with the `citations()` parser.
- `openrouter-lab §4`: `[S1]` with pin-point text (`[S4, n.º 3]`).
- `product-ux §8.2`: `[S1]` in the prompt, `[1]` chips in the UI.
- **Resolution:** prompt and parse **`[S#]`**, because PDFs and law texts contain literal footnote markers like `[1]`. Use `openrouter-lab`'s regex, which accepts lists and pin-points. Render chips numbered 1..n. A ref never returned by retrieval or a tool is a hallucinated citation: render it struck through.

### C19. Search engine
The candidates were Trama's indexed BM25 `PassageIndex` in a Web Worker (`trama-ts §4.3`, verified identical ranking), tantivy or MiniSearch (`openrouter-lab §7`), MiniSearch/FlexSearch/SQLite FTS5 (`product-ux §10`), and optional rusqlite FTS5 (`trama-rust §3.5`).

**Resolution:** `PassageIndex` in a Worker. V7 measured a 3.5 M-char PDF at 256 ms to build and 17 ms per query. Persist it as JSON in the cache dir, keyed by file SHA-256. No SQLite. Fix the false comment in `rank.ts`: 6-letter stems do not match across languages, which is why query expansion exists.

### C20. Class-folder layout and file naming
The proposals:
- `syncthing-lab`: `.tramado/{chat,claims,members}/…`
- `product-ux §3.11`: `Lectures/<date> <title>/audio.opus`, `Chat/<deviceId>/YYYY-MM.jsonl` (visible), `.tramado/claims/<lectureId>.json` (**one multi-writer file**), `.tramado/class.json` (multi-writer), `Exams/…/ai-answers.json` (multi-writer)
- `audio-pipeline §5.1`: `recordings/<date>_<slug>/{audio.webm, recording.json, transcript.*, edits/<member>.jsonl, notes/<member>.json}`
- `trama-ts §6/§7`: `transcripts/<recordingId>.json`, `.tramado/claims/<id>/<deviceId>.json`
- `trama-rust §3.4`: `claims/<recording>/<deviceId>.json`

**Resolution:** the merged layout in §6, with these rules:
- Every machine-written file has exactly one writer device.
- Machine data lives under `.tramado/`, keyed by object id and device id.
- Lecture and exam folders stay human-readable.
- Content type is discovered **by manifest** (`lecture.json`, `exam.json`), not by folder name, so folder names can be localised or renamed.

### C21. Transcript schema
- `trama-ts §6`: Trama's `Transcription { tracks[{segments{start,end,text}}], duration, engine }`.
- `audio-pipeline §5.3`: `tramado.transcript` v1 with stable segment ids, ms times, speakers, optional words, `audio_sha256` and `revision`.
- **Resolution:** `audio-pipeline`'s schema on disk. A Rust or TS adapter converts the transcription job's Trama-shaped output: track 0 → speaker `me`, track 1 → `lecture`/`class`, plus segment ids.

### C22. Who sees the markers
- `audio-pipeline §4.5/§5.2` puts markers in `recording.json`, which syncs to everyone, as well as in personal `markers/<member>.json`.
- `product-ux §6.2` says markers are private in the MVP.
- **Resolution:** keep markers private (app data `private/<classId>/markers/<lectureId>.json`). The opt-in "share my markers" writes `.tramado/markers/<lectureId>/<deviceId>.json`. `lecture.json` carries none.

### C23. Where per-device private data lives
- `syncthing-lab §10.1`: under the ignored `/.tramado/local`.
- `product-ux §3.11`: the app data dir, never relying on `.stignore`, because a mistake there leaks silently.
- **Resolution:** the app data dir. Nothing private ever goes inside a class folder.

### C24. Identity
- Device ID: `syncthing-lab`, `trama-ts`.
- `member_id`: `audio-pipeline`.
- "People, then their devices": `product-ux §3.5/§4.4`.
- **Resolution:** the identity model in §7. Person = `memberId`, device = Syncthing device ID. Files are keyed by device. Device-to-person binding is vouched for by the person's existing device.

### C25. Managing `.stignore`
- `trama-rust §3.4`: a synced `#include .tramado-ignore`.
- `syncthing-lab §10.1`: `POST /rest/db/ignores` on every device, plus `/rest/config/defaults/ignores`.
- **Resolution:** REST, per device, re-applied at every start (idempotent). No synced include file, because any member could edit it and make everyone ignore files. Anchor app paths with a leading `/`.

### C26. Class icon
- `product-ux §4.2`: emoji suggested from the class name.
- `trama-ui §2.4`: lucide icons, verified in lucide 1.67.0.
- **Resolution:** lucide icons. They render the same on every OS (Linux may lack a colour-emoji font), take the class colour, and suit the visual identity. Port `product-ux`'s keyword table to lucide names (Direito → `scale`, Estatística → `sigma`, …). Emoji is a possible v1.1 option.

### C27. PT-PT vocabulary
- "cadeira" (`trama-ts`, `trama-ui`) vs **"Disciplina"** (`product-ux §3.1`, which works for both school and university).
- **Resolution:** "Disciplina" in the UI, with "cadeira" and "UC" as search keywords. "Turma" means the class group. Keep Trama's PT register ("você") in every new string.

### C28. Opening the Syncthing web UI
- `product-ux §3.10` lists "Advanced: open the Syncthing web UI".
- `trama-rust §7.3` sets a random GUI password, because the GUI is otherwise unauthenticated on loopback.
- **Resolution:** do not offer it in v1. Offer a "Sharing diagnostics" panel instead: status, version, ports, peers, last errors, and log tail with a copy button.

### C29. Using the user's existing Syncthing
- `product-ux §3.10/§7.2` offers "Use it".
- `syncthing-lab §4` recommends a managed, private instance (port and IPv4 discovery coexistence verified).
- **Resolution:** never adopt it in v1 (see G1).

### C30. Watching for file changes
- `trama-rust §7.1`: `notify` + `notify-debouncer-full` *and* Syncthing events.
- `syncthing-lab §8.3`: Syncthing events only.
- **Resolution:**
  - `notify` watches every class folder, local-only ones included, since Syncthing may not be running. It drives UI refresh through `ReloadGate`.
  - Syncthing's two event loops drive sync status, admission and **authorship checks** (`RemoteChangeDetected.data.modifiedBy`).
  - Ignore `.syncthing.*.tmp`, `~syncthing~*.tmp` and our `.*.tmp`.

### C31. Graceful-stop budget
`trama-rust` and `syncthing-lab` say the process exits in about 1 s. V4 measured 54–742 ms, **but about 10 s when two connected instances stop at the same moment**.

**Resolution:** `POST /rest/system/shutdown`, wait 3 s, send SIGTERM (Unix) or skip it, then kill at 5 s. The e2e test stops instances one after another. Never block window close on Syncthing; the exit hook runs in the background with a deadline.

### C32. Keyboard shortcuts
- `trama-ui §5.1`: Ctrl+R record (in dev it also reloads the webview).
- `product-ux §3.2`: Ctrl/⌘+Shift+R.
- `audio-pipeline §4.5`: a global Ctrl+Shift+B marker shortcut. `product-ux` uses keys 1–4 for markers.
- **Resolution:**
  - Ctrl/⌘+Shift+R toggles recording inside the app.
  - Markers 1–4 and N fire only while focus is **not** in a text field, so a student typing "1" in a note doesn't drop markers.
  - An opt-in OS-global marker shortcut through `tauri-plugin-global-shortcut` 2.4.

### C33. Trama's HLC
`trama-ts §0` drops `core/hlc.ts`, but chat ordering, edit-log merge and class-metadata last-writer-wins all need clock-skew-tolerant ordering.

**Resolution:** keep `core/hlc.ts` + test, verbatim. Its fixed-width string format sorts correctly.

### C34. Attribution headers
`trama-rust §3.14` sends `X-Title`. `openrouter-lab §9` says `X-OpenRouter-Title` (`X-Title` is legacy).

**Resolution:** `HTTP-Referer: https://github.com/<org>/tramado` and `X-OpenRouter-Title: Tramado`.

### C35. Stream timeouts
`trama-rust §8.3` uses `timeout_per_read(90 s)`. `openrouter-lab §2/§11.5` uses a 30 s idle watchdog, relying on heartbeats every ~0.42 s, and a 120 s wait for the first byte.

**Resolution:** ureq `timeout_recv_response(120 s)` + `timeout_per_read(30 s)` + `timeout_global(None)`. Heartbeats keep the per-read timer alive.

### C36. Where a recording is written while it runs
- `trama-rust §3.8`: Rust appends WAV and patches the header (location unspecified).
- `trama-ts §7`: `app_data/recordings/<id>.wav.part`, then move.
- `audio-pipeline §4.2`: an Ogg journal staged in `app_local_data_dir/recordings/`, remuxed to `<class>/.tramado/tmp/<id>.webm.part`, then renamed into the lecture folder.
- **Resolution:** follow `audio-pipeline`. `lecture.json` carries `audio.size` and `audio.sha256`, so a peer starts transcribing only when the bytes match (files arrive in no particular order).

### C37. Speech job API: polling or events
`trama-rust §3.7` keeps the poll API and optionally emits events. `audio-pipeline §4.6/§3.3` uses Channels.

**Resolution:** use a Channel for live progress, plus `*_status()` so a reloaded webview can re-attach. Rust also writes the claim heartbeat and progress itself, so the claim stays alive while the webview is reloading.

### C38. e2e "no network" allow-list
`trama-ui §4.5` allows only `openrouter.ai + 127.0.0.1:<syncthing>`. That misses the app process's own calls: `huggingface.co` + `*.cdn.hf.co` (model download) and `discovery-lookup.syncthing.net` (the app-side lookup from `syncthing-lab §11`).

**Resolution:** WebKit processes get **no** external sockets. The app process may reach openrouter.ai, huggingface.co/*.hf.co and discovery-lookup.syncthing.net. The Syncthing subtree is audited separately (in tests: loopback only).

---

## 3. Gaps, with recommended answers

### G1. Discovering and handling a Syncthing the user already runs
No report covers detection. `product-ux` wants "Use it?"; `syncthing-lab` proved coexistence works when we avoid ports 22000 and 8384.

**Recommendation:**
1. **Detect, don't adopt.** Look for:
   - (a) a `syncthing` process owned by this user (Linux `/proc/*/exe`, macOS `pgrep`, Windows `tasklist`);
   - (b) a config at the default homes: Linux `~/.local/state/syncthing/config.xml` (v1.27+) or `~/.config/syncthing/config.xml`, macOS `~/Library/Application Support/Syncthing/`, Windows `%LOCALAPPDATA%\Syncthing\`.

   Never read its API key and never touch its config.
2. Use the result for three things:
   - (a) one informational line in Settings → Sharing: "Your own Syncthing is running. Tramado uses a separate copy on port {P}; your folders are untouched";
   - (b) expectations for IPv4 LAN discovery, since only the first process receives broadcasts on 21027 (`syncthing-lab §4`). Invites therefore always carry LAN addresses;
   - (c) an offer: **"Add my Syncthing as one of my computers"**. This is the normal second-device pairing (G2), pointed at the user's own device ID. The user sees Tramado classes in their Syncthing (a NAS backup, for example) without Tramado managing it.
3. Reasons not to adopt: we'd need its key, it may be v1.x, its own `autoAcceptFolders` and introducer settings would interfere with our admission policy, and a misstep could unshare the user's other folders.

### G2. Identity: one student, several devices
No report says how "Ana" is one person on a laptop and a desktop, while every protocol keys files by device.

**Recommendation:** the identity model in §7, in short:
- `memberId` is a 128-bit random base32 created at onboarding.
- Each device publishes `members/<deviceId>.json` with `memberId` and `vouches`.
- Second-device pairing is a QR or code that carries `{memberId, deviceId, addresses, class folder ids}`. The existing device adds the new one to `vouches` and auto-accepts it.
- The UI shows people and lists their devices underneath.
- Private data does not follow the person in v1. v1.1 adds an unshared `private-<memberId>` Syncthing folder held only by the member's own devices.

### G3. Who wrote a "single-writer" file (forgery is possible; verified in V3)
**Recommendation:**
- For every per-device file under `.tramado/` (members, presence, chat, claims, edits, answers, meta, consent, mod), accept content only if Syncthing's `modifiedBy` equals the first 7 characters of the device ID in the file name.
- Check this from `RemoteChangeDetected.data.modifiedBy` on the `/rest/events/disk` loop. At start-up, check identity-bearing files with `GET /rest/db/file?folder=&file=` → `global.modifiedBy`.
- On a mismatch, ignore the content, show "a classmate's computer changed {name}'s file" in diagnostics, and **let the owner self-heal**. Each device keeps a private mirror of its own files (chat log, members file) in app data and rewrites the canonical copy when it sees a foreign modification. Trashcan versioning also keeps the original (verified).
- Limits to state honestly:
  - The short ID is 35 bits, so a determined attacker could grind a colliding device ID.
  - Ordinary files (documents, lectures) can be changed or deleted by any member. Roles are social, not security.
  - Strong guarantees would need per-member Ed25519 signatures on log lines. Defer that, but keep a `sig` field reserved in the line schema.

### G4. Compacting per-device files
**Recommendation:**

| File | Growth | Policy |
|---|---|---|
| `chat/<dev>/<YYYY-MM>.jsonl` | Append only. About 300 B per message. Syncthing re-sends only changed 128 KiB blocks. | Monthly rotation (`syncthing-lab §7.1`). Past months are immutable. Load the last 2 months, older ones lazily. Deletes and edits are tombstone or edit lines in the author's own file. No compaction needed. |
| `presence/<dev>.json` | Overwritten in place | Heartbeat every 60 s **only while** recording, transcribing or online-active; otherwise write on change. That keeps index churn at O(active devices). |
| `claims/<obj>/<dev>.json` | One small file per claimant | Losers delete their own file at once. The winner keeps `done` for 7 days, then deletes it, because `transcript.json` is the durable record. |
| `edits/<lecture>/<dev>.jsonl` | Append only | Folded into `transcript.json` (`revision+1`) by the fold-claim holder (G26). Logs are kept so anchors can replay. Trim by a `foldedThrough` HLC watermark in `transcript.json`. |
| Orphans from devices that left | — | When `members/<dev>.json` has been gone for more than 30 days, **any** member may delete that device's presence, claims and stale non-chat files. This is a documented exception to single-writer, safe because the writer is gone. Chat logs stay for history. |
| Syncthing's own tombstones | Index DB | Purged after `--db-delete-retention-interval` (default 10,920 h). Nothing to do. |

### G5. How deletions propagate (and how to undo them)
**Recommendation:**
1. Syncthing propagates deletes to every member. **Trashcan versioning** (30 days) on every member keeps a local copy in `.stversions` (not synced). `POST /rest/folder/versions` restores the file and re-syncs it to everyone (verified in `syncthing-lab §10.4`). Build "Recently deleted (class)" from `GET /rest/folder/versions`.
2. In-app delete of a document, lecture or exam: the dialog says "Delete for everyone in TGDC?". Then an Undo toast that calls the versions API. Offer "Remove from this computer only" as a per-device `.stignore` entry with `(?d)`, never as a delete.
3. "Keep private" on a shared file is a **move out of the class**, so it deletes the file for everyone. Say so in the dialog.
4. Recordings: "Delete audio, keep transcript" removes `audio.webm` for everyone. `lecture.json` gets `audio: null` plus `audioDeletedAt`, written by its single writer, the recorder. If the recorder has left, use a per-device `mod/<dev>.jsonl` "audio-removed" note that readers honour.
5. Mass deletion outside the app (a user empties the folder in a file manager while `.stfolder` remains). It propagates and there is no built-in guard. The app watches `LocalChangeDetected` with `action:"deleted"`. If there are more than 20 deletions in 10 s that it did not make, it **pauses the folder** (`PATCH {"paused":true}`) and asks: "Did you mean to delete 143 files from TGDC for everyone? [Restore] [Yes, delete]". Peers may already have pulled some deletions; trashcan covers that. If `.stfolder` is gone, Syncthing stops the folder by itself (`syncthing-lab §10.2`), so offer "Relocate".
6. Leaving a class:
   - Delete your own members file.
   - `DELETE /rest/config/folders/<id>`.
   - Remove devices that no longer share any folder.
   - The files stay on disk (verified).
   - The dialog offers "Also delete my copy from this computer".

### G6. When the class creator (or every organiser) leaves
**Recommendation:**
- No member is technically special. Every member's app runs admission (C8), roster sync and the claim rules, so the class keeps working with any subset of members online.
- "Organiser" is a social role, recorded in each organiser's `meta/<dev>.json` as `organisers: [memberId…]` and merged as a set by HLC.
- When no organiser has a members file left, the UI offers "Become an organiser" to anyone. Moderation entries (pins, hidden messages) from non-organisers are shown as suggestions only.
- State plainly in the docs that Syncthing gives every member write access, so roles cannot be enforced.

### G7. Removing someone (kick or ban)
`syncthing-lab §6.5` has the mechanics. **Recommendation:**
1. **Soft removal:** an organiser writes `bans/<dev>.json` listing `{deviceId, memberId, at}`. Every member's app un-shares the folder from those devices and adds them to `remoteIgnoredDevices`. The banned device still has the folder ID and can re-knock, but every policy refuses it.
2. **Hard removal, "Start a fresh class without X":** create a new folder ID, copy the files, invite everyone except X. X keeps what it had (say so).

### G8. Shared, mutable class metadata (name, colour, icon, lecturer, term, language, consents)
`product-ux`'s single `class.json` would conflict when two members edit it.

**Recommendation:**
- Each device writes `meta/<dev>.json` as `{field: {value, hlc}}`. Readers take the highest HLC per field (LWW register). Sets such as organisers merge by add/remove with HLC.
- Consent records are append-only lines in `consent/<dev>.jsonl` (`{kind: record|share, lectureId?|class, confirmedBy memberId, at, text-version}`), which also gives an audit trail.
- The invite payload carries name, colour and icon, so the join preview works before anything syncs.

### G9. Building the AI index for large PDFs
**Recommendation** (measured in V7):
1. **Extract in a Web Worker** with pdf.js (Trama's `extractPdfText`), one page at a time, with progress and cancel.
   - The synthetic 800-page code took 2.1 s. Real gazette PDFs with embedded or CID fonts can be 10–50× slower per page, so budget for minutes and run in the background.
   - Read the bytes once over IPC (or through `tramado-media` with Range).
2. **Cache per file by SHA-256** (Rust `fs.hash`) in `app_cache_dir/text/<sha256>.json`: `{text, pageStarts, pageLabels, imagePages, slideStarts, units[{start,end,locator}], warnings, extractor version}`. Never in the class folder. Each device extracts its own copy (deterministic).
3. **Strip running headers and footers** before building units: the first or last line of a page that appears on at least 50% of pages (all 800/800 in V7) (`trama-ts §5(b).4`).
4. Build units:
   - Article units for law texts (`trama-ts articles.ts`: at least 2 headings matched by `^(Artigo|Art\.|Artículo|Article) N`, windowed past about 1,500 chars, label `art. N.º (pp. a–b)`).
   - Otherwise paragraph units of 600 chars or fewer.
   - Transcripts: segments grouped by pause, with the time locator taken from the first hit (`trama-ts §5(a)`).
5. **One `PassageIndex` per class** in the worker: build about 0.3 s per 3.5 M chars, query about 17 ms. Optionally persist it as JSON in `app_cache_dir/index/<classId>.json`, keyed by the set of `(sha256, extractor version)`.
   - "Search all classes" builds the other classes' indexes lazily at idle priority after start-up.
   - Memory: about 80 MB RSS while extracting 800 pages. Extract files one after another, never in parallel.
6. Scanned pages (`imagePages`): show the "Scan, no text" chip (`product-ux §4.7`). OCR is on demand (G10).
7. Embeddings stay an opt-in re-ranker (`openrouter-lab §7`), cached per `(model, chunk sha256)` in app data.

### G10. Exam image OCR (and scanned documents)
**Recommendation** (measured in V5 and V6):
1. **Two-step pipeline:** image → verbatim text (reasoning **off** where possible, `max_tokens` about 4,000, temperature 0) → the same text-extraction path as PDFs (`openrouter-lab §5` schema-in-prompt + tolerant parse + **deterministic pre-split** of `^[IVX]+\b`, `^\d+[.)]`, `^[a-z]\)` and "Responda a duas" → choose-N) → **mandatory review screen**.
   - The one-step image→JSON merged II.a–c (V6). `product-ux §8.4` saw kinds mislabelled from text too.
2. **Which model:** whatever the privacy chain gives.
   - With "No training", OCR runs on dots (20–24 s, about 1.2–1.4k reasoning tokens per page, so set `max_tokens` of at least 4,000).
   - With "Allow", nemotron-3.5-super-vl (3–12 s).
   - Gemma 4 (image input) was 429 every time and is untested.
3. **Image prep in the webview:** EXIF rotate, downscale to 1,100–1,400 px on the long side, JPEG q≈70. The 720 px q55 variant was still perfect for printed type, so this is not tight.
4. **Multi-page scanned exam PDFs:** render each page with pdf.js to canvas → JPEG → one OCR request per page. Several images per request were not tested. Show the request cost first.
5. **Scanned *course documents* (books, slides):** one request per page means a 300-page book takes 6 days of a 50/day account. So in v1, offer AI OCR only for exams and short documents (≤ 20 pages) with a quota preview. Add **local OCR** in v1.1: Windows `Windows.Media.Ocr`, macOS Vision `VNRecognizeTextRequest`, Linux tesseract when installed.
6. **Not tested:** handwriting, real phone photos with glare or curvature, two-column layouts, maths. Treat these as risk R12.

### G11. AI request budget per feature (the 50/day reality)
**Recommendation:** a cost model shown in the UI ("This will use about 12 of your 38 remaining free requests today"):

| Action | Requests |
|---|---|
| Ask / @AI / Explain | 1 (2 with query expansion) |
| Exam: OCR (photo) + extraction | 1 per page + 1 |
| Exam: Quick answers, N questions | 1 expansion + N |
| Deep answer (tool loop) | 4–8 per question |
| Lecture summary / key terms (chunked) | ⌈transcript chars / 40k⌉ + 1 |
| Flashcards for one lecture | 1–2 |

Throttle to 18/min with at most 3 in flight (`openrouter-lab §8`). Queue bulk jobs at low priority. Share exam answers with the class (`product-ux §6.2`) so classmates don't spend their own quota re-answering, and show "Answers already exist (by Ana, Gemma)" before offering to answer again.

### G12. When the app is closed (sync, admission and transcript delivery all stop)
Nobody addressed this, yet the whole group model depends on members' apps being online.

**Recommendation:**
1. **Close to tray** (Windows/Linux; tauri `tray-icon` feature) and stay in the Dock on macOS, while the user has at least one shared class. Show this once at first share: "Keep sharing when you close the window? Your classmates get recordings and transcripts from you faster." Default **on**, with a toggle.
2. **Start at login** (`tauri-plugin-autostart` 2.7), offered at first share, default **off**, starting hidden in the tray.
3. Background work while hidden: Syncthing, admission policy, claim heartbeats, transcription and model download. Notifications for @mentions, joins and finished transcripts come from Rust.
4. Quit from the tray stops everything. Mention the CPU and battery cost while hidden: Syncthing idles at about 0.5% CPU (`syncthing-lab §3.4`).

### G13. Stable references when files are renamed or moved
Citations, notes and transcripts point at documents, and a user can rename or move files in a file manager. Syncthing then sees delete + add (or detects the rename from identical blocks), and path-based references break.

**Recommendation:**
- Every reference stores `{docSha256, relPath, locator, quote{exact,prefix,suffix}}`.
- Resolve by `relPath` first, then by `sha256` through the cache's sha→path map, then by quote search in the class index.
- Lectures and exams are referenced by their manifest `id` (ULID), never by folder name.
- If a document's content changed (same path, new sha256), re-anchor by quote and flag "the source changed since this answer".

### G14. On-disk format versions and older apps
Classmates will run different Tramado versions.

**Recommendation:**
- Every JSON or JSONL record carries `format` + `version` (as `audio-pipeline` does).
- Readers accept a version they know or an older one. For a **newer** major version they show the item read-only, with the banner "Made with a newer Tramado — update to edit" (Trama's `NewerSchemaError` idea), and never rewrite it.
- Additive fields are minor versions and must be preserved on rewrite: keep unknown keys.
- Syncthing protocol compatibility across Syncthing versions is not a concern (BEP is stable). The bundled binary is updated only with app releases.

### G15. Cross-platform file names and cloud-drive roots
- A Linux or macOS member can create `aula: resumo?.md`. Syncthing on Windows then cannot write it and reports a folder error.
- Case-only differences (`Aula.pdf` vs `aula.pdf`) collide on Windows and macOS.
- A classes root inside OneDrive, Dropbox or iCloud double-syncs and conflicts.

**Recommendation:**
- Name every file the app creates or imports in a Windows-safe way: replace `<>:"/\|?*` and control characters, trim trailing dots and spaces, avoid reserved names (`CON`, `NUL`, …), and keep paths ≤ 200 chars relative to the class.
- Surface Syncthing's per-file errors (`/rest/folder/errors`, event `FolderErrors`) as "1 file can't be saved on Windows computers: rename it".
- Warn when the chosen root is under a known cloud-sync folder (path contains `OneDrive`, `Dropbox`, `iCloud Drive`/`Mobile Documents`, `Google Drive`).

### G16. Metered networks, bandwidth and "Local network only"
Syncthing has no metered-network detection.

**Recommendation:**
- v1: a global "Pause sharing" toggle in the sync pill (pauses all folders), plus send/receive limits (`options.maxSendKbps/maxRecvKbps`), plus "Skip audio files" per class (per-device ignore `(?d)/**/audio.webm`).
- "Local network only" sets `globalAnnounceEnabled=false`, `relaysEnabled=false`, `natEnabled=false`. Say that it fails on eduroam, which isolates clients.
- v1.1: OS metered detection (NetworkManager `Metered` over D-Bus, Windows `NetworkCostType`, macOS `NWPath.isExpensive`).

### G17. Invite transport: deep links, QR codes, static page
- `tramado://` deep links need OS registration. Linux AppImage does **not** register a URL handler without desktop integration.
- `product-ux` proposes a static page at `https://tramado.app/join#…`, which needs a domain and hosting decision.

**Recommendation:**
- Paste-the-code always works. The code is base64url of a compact JSON: `{v, f: folderId, l: label, c: colour, i: icon, d: [≤3 dashless device IDs], a: [addresses incl. relay URIs], n: inviterName}`, about 300–600 chars, so QR version ~15–25, which scans fine on screen.
- Use `tauri-plugin-deep-link` 2.6 where registration works (Windows, macOS, deb, rpm).
- The static join page is optional (GitHub Pages under the project, keeping the payload in the URL fragment). It is not a dependency.
- Re-validate each device ID with `/rest/svc/deviceid` before use.

### G18. Large classes
- Every member connects to every other member, so connections grow as O(n²).
- Presence heartbeats multiply index updates.
- Relays cap throughput at about 6 Mbit/s.

**Recommendation:**
- A soft warning above 30 members and a hard advisory above 50: "Large classes sync slowly. Consider study groups."
- Presence only while active (G4). Invites name the 3 members most likely to be online.
- Test with 8+ instances (the lab already ran 8).

### G19. AI for under-18s (the custom endpoint path)
OpenRouter requires users to be 18 or older (V8).

**Recommendation:**
- Keep Trama's custom OpenAI-compatible host (`service/hosts.rs`, plain `http` allowed only to localhost/LAN), e.g. Ollama `http://localhost:11434/v1` or LM Studio.
- This path is **untested** with tool calls and streaming. Before v0.1, add an e2e test against a local stand-in server and a manual test against Ollama with a small multilingual model.
- The privacy `provider` field is never sent to custom hosts.

### G20. Diagnostics without telemetry
**Recommendation:**
- A "Copy diagnostics" button (Settings → Help). It produces app version, OS, webview version, CPU flags, Syncthing version/state/ports/last errors (log tail with device IDs truncated), model status, the last 20 AI error codes (no content), and the media self-test result (R3).
- Never upload it automatically.

### G21. Keeping free-model defaults alive
**Recommendation:**
- `ai-defaults.json` (chains per privacy level, per-task profiles) is bundled.
- At start-up, validate it against `/models` (cached 24 h). If the first model is missing, fall back to the first catalog model with tools and context of at least 128k under the user's privacy level.
- Add a **GitHub Actions canary** (serverless): a daily run with a repository secret key sends 3 tiny requests per privacy level and opens an issue when a chain fails 3 days in a row. Releases update the JSON.

### G22. Long-lecture local transcription (memory, resume)
`trama-rust §3.9` warned that a 3 h stereo lecture needs more than 1.3 GB of peak memory with whole-file decoding. `audio-pipeline` measured only a 5-minute clip.

**Recommendation:**
- Stream-decode (symphonia demux + libopus at 16 kHz). Run VAD over the whole file at 16 kHz mono f32, about 690 MB for 3 h; or run it in 30-minute windows with overlap.
- Transcribe groups of stretches of about 10 minutes, reusing the `Piece`/`place` mapping.
- After each window, persist partial segments to `app_local_data/transcribe/<lectureId>.partial.json`, which gives resume after a crash or sleep.
- Advertise `progress` in the claim heartbeat.
- Accept only if a 3 h synthetic file stays under 1.5 GB RSS (R9).

### G23. Imported recordings (Zoom/Teams M4A, MP4 video, WhatsApp OGG)
**Recommendation:**
- Import decodes with symphonia (AAC-LC, MP3, FLAC, Vorbis, WAV; Opus through libopus, per `audio-pipeline §2.3`) and transcodes to WebM Opus 24 kbps.
- The original video is **not** copied into the class by default ("Keep the video too?" off).
- **HE-AAC (AAC+) is not decoded by symphonia 0.6** (LC only). Detect it and show "This file's audio format isn't supported. Convert it to MP3 or M4A (AAC-LC)." Add a test fixture.
- Import Teams/Zoom VTT with Trama's `vtt.ts` as a ready transcript.

### G24. Ordering across clocks
**Recommendation:**
- Chat lines, edit ops, meta fields and consent records carry an HLC (C33) generated from the device's clock and the maximum HLC seen.
- Sort by HLC. Display wall time from `ms`.
- A device whose clock is more than 5 minutes off relative to peers' HLCs gets a diagnostic hint.

### G25. Class notes edited by two people at once
`Notes/*.md` is multi-writer by design.

**Recommendation:**
- The editor autosaves with a 2 s debounce through `write_atomic` and scans right away.
- On a `*.sync-conflict-*` sibling, show `product-ux §7.2`'s compare/keep dialog with a line diff.
- Soft presence ("Bruno is editing this note") comes from `presence/<dev>.json` `{editing: path}`, which reduces conflicts without locks.

### G26. Who maintains the transcript after the transcriber leaves
`audio-pipeline` says the claim holder folds edit logs and regenerates `.md`/`.vtt`.

**Recommendation:**
- "Transcript owner" = the device that last wrote `transcript.json`.
- When the owner's members file is gone, or its presence is stale for more than 7 days while unfolded edits exist, run a **fold claim** using the same claim protocol (`claims/<lectureId>.fold/<dev>.json`). The winner becomes the new single writer of `transcript.json` and its companions.

### G27. Security of rendered classmate content
- Chat, class notes, transcripts and AI answers are untrusted Markdown.
- Trama's `core/text/markdown.ts` is reused, but no report checked whether it lets raw HTML through.

**Recommendation:**
- Render Markdown with no raw HTML and no `javascript:`/`data:` links (except images from the media scheme).
- External links go through Rust `open_external` (https only) with a confirmation that shows the host.
- Add a Vitest XSS corpus test for the renderer.
- CSP stays strict.

### G28. Updates
**Recommendation:**
- `tauri-plugin-updater` 2.14, **opt-in**, with a static `latest.json` on GitHub Releases. The app checks only if the user enabled it, because Trama's ethos is "no network of its own".
- The bundled Syncthing changes only with app releases (pinned SHA-256 + GPG-verified `sha256sum.txt.asc` in the fetch script).
- Syncthing config migrations happen by themselves (`config.xml.v0` archive, `syncthing-lab` gotcha 17). After an update, re-run the idempotent "managed options + ignores" step on start.

### G29. Running two "students" on one machine for development
Partly covered by `trama-rust §3.2/§10.2`. Make it explicit: `TRAMADO_DATA_DIR` relocates prefs, secrets (file fallback only), models (or `TRAMADO_SPEECH_DIR`), the Syncthing home, ports, the private dir and the cache. Setting it disables single-instance. The e2e uses two such dirs plus `TRAMADO_SYNCTHING_BIN`.

---

## 4. Risky assumptions and how to de-risk them

| # | Assumption | Why risky | De-risk (tests / fallbacks) |
|---|---|---|---|
| R1 | The default free model works | Gemma-4-31b:free answered **0 of 7** in `openrouter-lab` and was 429 in every test today. The "No training" chain relies on `dots-3-note-preview`, a preview. | Chains as data per privacy level (G21). Validate the catalog at start-up. Daily canary Action. UI explains busy states and shows the model that actually answered. Unit tests for chain building per privacy level and capability filtering (tools, vision). |
| R2 | Students have enough free quota | 50/day for accounts that never bought credit; 20/min. | Cost model and estimates (G11). Single-shot answers by default (C17). Shared answers. A `GET /key` quota readout. Throttle test with fake timers. |
| R3 | WebM Opus plays and **seeks accurately** from a custom scheme in WebKitGTK, WKWebView and WebView2 | Not verified anywhere (V11; `audio-pipeline §7`). tauri-driver cannot drive macOS. AppImage needs `bundleMediaFramework`. | **Week-1 spike** on the three OSes. A **built-in media self-test** (Settings → Help → Diagnostics, also run once after install) plays a bundled 5-minute WebM through `tramado-media://`, seeks to 4:12 and checks `currentTime ± 0.25 s` and `duration`, then reports. Automatic Blob-URL fallback. A linux e2e step under Xvfb **with** a PulseAudio null sink in CI (`pulseaudio --start` + `module-null-sink`) to assert `seeked`. |
| R4 | Peers connect on real networks | eduroam client isolation, CGNAT, campus firewalls, relays at about 6 Mbit/s, the 35–40 min discovery negative cache. | Invites with concrete LAN + relay addresses. App-side discovery lookup when a peer has been disconnected for more than 30 s (unit-tested against a stand-in lookup server). Roster carries fresh addresses. A **field test plan** on eduroam and on a phone hotspot before 0.1. Show "Connected via relay (slow)". |
| R5 | The Syncthing child dies with Tramado on every OS | Only Linux PDEATHSIG was run. The Windows Job Object and macOS adopt-or-stop are uncompiled. | CI on `windows-latest` and `macos-latest`: an integration test spawns a tiny parent that spawns the sidecar, kills the parent with SIGKILL / TerminateProcess, and asserts the child is gone within 5 s (macOS: asserts the next start cleans up via `runtime.json`). |
| R6 | The claim protocol converges | Partitions, clock skew, sleep, a crash in `working`. | Vitest `createMemoryMesh()` property tests with random partitions, skew ±10 min, crashes and heals, asserting at most one `working` per connected component and eventual exactly-one transcript. Plus the 3-instance real e2e (`syncthing-lab claim.sh` scenarios). |
| R7 | Per-device files are authentic | Forgery verified (V3). | Authorship check (G3), with a unit test that feeds a `RemoteChangeDetected` whose `modifiedBy` doesn't match, and an e2e where instance B overwrites A's members file and A ignores it and self-heals. |
| R8 | Speed and accuracy measured with whisper.cpp **1.9.5** carry over to whisper-rs 0.16 (**1.8.3**) | Different versions. The VAD-joined turbo run dropped a 25-word phrase (3.5%). | An ignored Rust test with 3 reference clips (PT, ES, EN; fictional or public domain) that reports WER against human references and real-time factor. Compare joined vs per-piece decoding before release. |
| R9 | A 3 h lecture transcribes locally | Memory (G22). | Ignored test: synthetic 3 h WebM, assert peak RSS < 1.5 GB and that resume after kill continues from the last window. |
| R10 | System-audio capture works on macOS 14.2–14.5 and with Windows silent loopback | Header says 14.6+ while config says 14.2 (`trama-rust §2.8`). WASAPI sends nothing during silence. | A manual test matrix (macOS 14.2/14.6/15, Windows 10/11, Ubuntu PipeWire/Pulse). Keep Trama's padding logic. Online mode falls back to "mic only" with a clear message. |
| R11 | PDF extraction stays fast on real law gazettes | V7 used a synthetic PDF (2.6 ms/page). | A perf test on 3 real public-domain PDFs (a DRE Código Civil consolidation, a BOE Código Civil, an EUR-Lex text) with an extraction budget and progress. A worker keeps the UI responsive. |
| R12 | Vision OCR handles real exam photos | V5 used rendered type. | A fixture set of about 10 photographed fictional exams (printed, phone camera, glare, curvature, two columns, one handwritten) with a CER report. The review screen is mandatory. Local OCR in v1.1. |
| R13 | An OS keychain exists | Linux setups without Secret Service, Flatpak portals. | Fallback to `app_config_dir/secrets.json` (0600) with a visible note. Test under `dbus-run-session` without a keyring daemon. |
| R14 | Free models follow structured-output schemas | Gemma ignored `json_schema`; NVIDIA produced corrupted fields; dots mislabelled kinds; II.a–c not split (V6). | Schema in the prompt, tolerant parse, deterministic pre-split and normalisation, one repair call, and the **review screen** (`openrouter-lab §5`, `product-ux §8.4`). Golden tests over saved model outputs from `lab/openrouter/out` and `lab/critique/ocr/out`. |
| R15 | The custom endpoint covers under-18s | Untested (G19). | A stand-in server e2e plus a manual Ollama test. |
| R16 | Consent microcopy is legally adequate | Not legal advice (`product-ux §11.8`). | Review by a PT/ES law student or lecturer before release. Keep the consent text versioned in records. |
| R17 | Inline styles render in the packaged app | Tauri CSP nonce + WebKit (`trama-rust` gotcha 11). | Keep `dangerousDisableAssetCspModification: ["style-src"]` and Trama's e2e "real-app styles" probe. The class colours depend on it. |
| R18 | Syncthing v2's REST behaviour stays put | Quirks: POST replaces folders; PATCH `/rest/config` returns 405; event ids are per mask; unknown event names are silently ignored. | **Contract tests** against the pinned binary in Linux CI (spawn two instances, run join, claim and chat with assertions), run on every Syncthing bump. Event-name constants checked against a recorded list. |
| R19 | The bundle size is acceptable | Syncthing 34 MB + VAD + AppImage GStreamer. | Measure installer sizes in CI per target and set a budget. The model is never bundled. |
| R20 | Supply chain stays clean | Many fresh versions (ureq 3.5.1 is 1 day old; opusic-sys 0.7.6 is 8 days old). | Pin exact versions in `Cargo.lock`/`package-lock.json`. Use versions at least 2 weeks old at release. Syncthing pinned by SHA-256 + GPG. Hugging Face pinned by commit + SHA-256. `cargo deny` + `npm audit` in CI. |
| R21 | Syncthing's own disk use is negligible | `.stversions` keeps 30 days of deleted audio (about 10 MB/h). The index DB grows with the number of files. | A Storage settings screen: per-class size including `.stversions`, plus "Empty class trash". |
| R22 | One recording per lecture | Several students may record the same lecture. | A presence warning (`product-ux §4.5`). The claim protocol works per recording, so two recordings get two transcripts. Offer "Mark as duplicate of …", stored in the recorder's own `lecture.json`. |

---

## 5. DECISIONS for the design phase (one line each)

**Stack and process**
1. Use Tauri 2.12 + React 18.3.1 + TS 5.9.3 + Rust stable (copy `rust-toolchain.toml` and `.cargo/config.toml` verbatim); identifier `eu.thehumanloop.tramado`, licence MPL-2.0, with a NOTICE crediting Trama.
2. The webview has no network: CSP `connect-src` allows IPC and `tramado-media` only, and `tauri-plugin-http`, `-shell` and `-fs` are never granted.
3. All HTTP runs in Rust on `ureq` 3.5 with std threads (no reqwest/tokio); long-lived work runs on named threads, and streams reach the webview over `ipc::Channel`.
4. The OpenRouter key and the Syncthing key never reach the webview; `secrets` exposes only set / status(last4) / clear, backed by the OS keychain with a 0600 file fallback.
5. Rust's `ai_send` accepts only allow-listed paths, injects the key and attribution headers (`X-OpenRouter-Title`), and overwrites `provider` from the stored privacy level.
6. TypeScript owns the single SSE parser, the request builder, retries, the 18 req/min throttle, the tool loop and the error classifier, all shared by desktop, demo and Vitest.

**AI**
7. The default model is `google/gemma-4-31b-it:free` and the default privacy level is "No training" (`data_collection: deny`), with chain `[gemma-31b, gemma-26b-a4b, dots-3-note-preview]`.
8. Chains and task profiles ship per privacy level as data (`ai-defaults.json`), are validated against `/models` at start-up, and are guarded by a daily GitHub Actions canary.
9. When the whole chain is busy, offer an explicit opt-in to NVIDIA free models ("may train"); never relax privacy silently.
10. The UI always shows the model that answered and the remaining free quota (`GET /key` → `free_model_daily_requests`).
11. Exam answering defaults to single-shot retrieval (one batched query-expansion request, then BM25, then one request per question); the tool loop is the opt-in "Deep answer".
12. Citations are `[S#]` in prompts and parsing (pin-points allowed), rendered as numbered chips; refs that retrieval never returned are shown as hallucinated.
13. `max_tokens` is at least 4,000 for reasoning tasks (8,000 for exam answers); empty content with `finish_reason: length` triggers one retry with a larger budget or lower effort.
14. The exam pipeline is OCR (vision model, verbatim) → deterministic pre-split → LLM extraction with the schema in the prompt → tolerant parse → mandatory review → answers.
15. AI OCR is offered for exams and short documents (≤ 20 pages) with a request-cost preview; local OS OCR follows in v1.1.
16. Search uses Trama's `PassageIndex` (BM25) in a Web Worker, with article, page, slide and time locators; embeddings are an opt-in re-ranker only.
17. Extracted text and indexes are cached by file SHA-256 in `app_cache_dir`, never in class folders; running headers and footers are stripped before indexing.
18. A custom OpenAI-compatible endpoint (localhost/LAN may be http) is the documented AI path for under-18s; the `provider` field is never sent to custom hosts.

**Audio and transcription**
19. Recording: Rust writes an Ogg Opus journal in `app_local_data/recordings`, then remuxes to `audio.webm` (Opus 24 kbps mono, or 32 kbps stereo with L = me and R = class) when the recording stops.
20. Decoding uses symphonia for demuxing plus libopus (`opusic-c` 1.6.1) at 16 kHz, applying the pre-skip by hand.
21. Media is served through the `tramado-media` custom scheme (class-confined, explicit MIME, Range/206), with a Blob-URL fallback and a built-in media self-test.
22. Whisper models download on demand from Hugging Face pinned at commit `5359861c…`, in 32 MiB Range chunks with SHA-256 checks, into `app_local_data_dir/models`.
23. The model list is turbo-q5_0 (default), small-q5_1 ("Draft"), and large-v3-q5_0 (Advanced); medium is not offered, and the DTW preset is stored per model.
24. The Silero VAD v5.1.2 (885 KB) is bundled; the whisper model never is.
25. Cloud transcription uses `openai/whisper-large-v3-turbo`: paid, off by default, labelled with its cost, in ≤30 s VAD pieces sent as WAV.
26. Transcription is windowed and resumable, with partial results persisted locally and progress written to the claim heartbeat.
27. The transcript is stored as `tramado.transcript` v1 (segment ids, ms, speakers, optional words, `audio_sha256`), with generated `.md`/`.vtt`.
28. Markers are private by default and shared only on opt-in; in-app shortcuts never fire while a text field has focus.

**Syncthing and classes**
29. A class is one folder; a shared class is one Syncthing folder with ID `tramado-<26 base32 chars>` (128-bit), and the folder ID is the capability.
30. Tramado runs its own managed, private Syncthing instance as the sidecar `tramado-syncthing`, started lazily on the first share or join, and never adopts the user's own Syncthing.
31. Syncthing runs with `STMONITORED=yes` as a single process; the API key goes through `STGUIAPIKEY` (never argv), and stdout/stderr go to a rotated log file.
32. The supervisor restarts on exit code 3, backs off on 1, uses PDEATHSIG on Linux, a kill-on-close Job Object on Windows, and adopt-or-stop on macOS; shutdown is API, then 5 s, then kill.
33. `config.xml` is pre-seeded before the first start: own sync port in 22100–22199 (TCP and UDP free), `urAccepted -1`, `crashReporting off`, `autoUpgrade 0`, `overwriteRemoteDeviceNamesOnConnect true`, and a random GUI password.
34. The GUI/REST API binds to a fresh 127.0.0.1 port at each start, with retries when the bind fails; Unix sockets are a later hardening.
35. Class folders use `pullerDelayS 0`, trashcan versioning for 30 days, managed ignores set over REST on every start, and an explicit `/rest/db/scan?sub=` after every app write.
36. Joiners are admitted automatically when they prove the folder ID, by any member's app; there are no introducers, and an app-level roster lists the members; "Ask before letting people in" is a per-class option.
37. Invites carry the folder ID, label, colour, icon, up to 3 dashless device IDs and concrete addresses (LAN plus relay); they can be pasted as a code, shown as a QR, or opened through `tramado://` where registered.
38. The app looks up a peer in global discovery and injects its addresses whenever the peer has been disconnected for more than 30 s.
39. Every machine file has exactly one writer device and is authorship-checked through Syncthing `modifiedBy`; owners self-heal from a private mirror.
40. Chat is `.tramado/chat/<deviceId>/<YYYY-MM>.jsonl`, append-only, ordered by HLC; deletes and edits are tombstone lines in the author's own file.
41. Transcription claims are `.tramado/claims/<lectureId>/<deviceId>.json`, ranked done > working > claimed, then by `claimedAt` and `deviceId`, with heartbeats and staleness judged on the local clock.
42. Class metadata is a per-device LWW-by-HLC file (`meta/<deviceId>.json`), and consents are append-only per-device logs.
43. Content type is discovered by manifest (`lecture.json`, `exam.json`); folder names are cosmetic and localised at creation.
44. Private data (my notes, highlights, marks, FSRS state, Ask history, private markers) lives in `app_local_data/private/<classId>/` and is never synced in v1.
45. Identity: a person is a random `memberId` and a device is its Syncthing device ID; a second device is bound by pairing and vouched for by an existing device.
46. Roles (organiser) are social; kicking someone means rotating the class to a new folder ID, with a soft ban list honoured by every member's policy.
47. Destructive actions say "for everyone", offer Undo through the Syncthing versions API, and a mass delete made outside the app pauses the folder and asks.
48. While at least one class is shared, Tramado runs in the tray (or Dock) after the window closes (default on), and starting at login is offered (default off).

**UI and product**
49. Port Trama's UI layer, shell, router, command palette, i18n machinery, demo and screenshot pipeline as `trama-ui §6` describes; never use StrictMode.
50. The visual identity is "caderno" (`trama-ui §2`): the token file, the 12 class colours using `color-mix` derivations, lucide class icons, and Figtree, Bricolage Grotesque and Source Serif 4.
51. Vocabulary: EN Class / Lecture / Exam; PT-PT Disciplina / Aula / Exame / Turma (keeping Trama's register); ES Asignatura / Clase / Examen.
52. The MVP scope is `product-ux §5.1`; FSRS flashcards, timetable, live captions, shared markers and local OCR come in v1.1.
53. Try-first is on by default in exam practice; AI text is always labelled with violet, Sparkles and the model, and never mixed into the student's own answer.
54. Recording has two consents, one to record and one to share, stored in the class consent log; "Transcript only" keeps the audio local.
55. A "What leaves this computer" page and a local AI activity log are included; there is no telemetry, and diagnostics are copied by hand.

**Testing**
56. Vitest gets `createMemoryMesh()` (claims, chat, roster, admission, partitions), `createFakeAi()` (SSE and errors) and fake speech, the model download and sync.
57. Rust gets contract tests against the pinned Syncthing binary in Linux CI, plus a two-instance e2e (invite → join → document, recording and chat cross → exactly one transcript).
58. Linux CI runs the media self-test with a PulseAudio null sink; macOS and Windows have manual or self-test checks before each release.
59. Versions are pinned and at least 2 weeks old at release (hold ureq at 3.5.0 until 3.5.1 ages); Syncthing and Hugging Face artefacts are pinned by SHA-256.

---

## 6. Merged class-folder layout (resolves C20, C22, C23, G4, G8)

```
~/Tramado/<Class name>/                        # user-visible; one Syncthing folder (id tramado-<26 b32>) when shared
  <Lectures dir>/<YYYY-MM-DD HHmm> <title>/   # dir name localised at creation ("Aulas", "Clases", "Lectures"); cosmetic
    lecture.json          # manifest "tramado.lecture" v1, single writer = recorder device:
                          #   {id: ULID, title, startedAt, durationMs, mode, language, recordedBy {memberId, deviceId},
                          #    audio: {file:"audio.webm", codec, channels, bitrate, size, sha256} | null, audioDeletedAt?,
                          #    speakers[], consentRef, duplicateOf?}
    audio.webm            # immutable once published; absent for "transcript only"
    transcript.json       # "tramado.transcript" v1, single writer = transcript owner (claim/fold winner)
    transcript.md         # generated by the same writer
    transcript.vtt        # generated by the same writer (cue id = segment id)
  <Documents dir>/…       # the students' files as-is; any names (sanitised on import, G15)
  <Exams dir>/<title>/
    exam.json             # manifest "tramado.exam" v1 (+questions), single writer = importer device
    <original files>      # pdf / docx / jpg
  <Notes dir>/*.md        # class notes: multi-writer by design → conflict UI (G25)
  .tramado/               # machine data; one writer per file = the device named in the path
    members/<deviceId>.json                  # roster: memberId, name, deviceName, addresses, caps, vouches, joinedAt
    presence/<deviceId>.json                 # recording / transcribing / editing; heartbeat only while active
    meta/<deviceId>.json                     # class metadata LWW-by-HLC: name, colour, icon, lecturer, term, language, dirs, organisers
    consent/<deviceId>.jsonl                 # recording/sharing consent records (append-only)
    chat/<deviceId>/<YYYY-MM>.jsonl          # chat (append-only; tombstones/edits as lines)
    claims/<lectureId>/<deviceId>.json       # transcription claim
    claims/<lectureId>.fold/<deviceId>.json  # transcript-owner hand-over claim (G26)
    edits/<lectureId>/<deviceId>.jsonl       # transcript corrections (folded by the owner)
    markers/<lectureId>/<deviceId>.json      # ONLY if the student opted in to share markers
    answers/<examId>/<deviceId>.json         # shared AI answers {question n, text, citations[], model, askedBy, at}
    exam-edits/<examId>/<deviceId>.jsonl     # question corrections by non-importers
    mod/<deviceId>.jsonl                     # pins, hide-message, audio-removed notes (honoured from organisers)
    bans/<deviceId>.json                     # soft ban list (honoured from organisers)
    invites/<deviceId>.json                  # (v1.1) hashed expiring invite tokens
    tmp/                                     # ignored: *.part staging before rename
<app_config_dir>/       prefs.json, identity.json {memberId, name}, classes.json (classId → path, shared, archived), service-hosts.json, secrets.json (0600 fallback only)
<app_local_data_dir>/   models/, syncthing/ (config.xml, cert/key, index-v2/, syncthing.log*, runtime.json),
                        recordings/ (Ogg journals + journal.json), transcribe/ (partial results),
                        private/<classId>/ (my notes, highlights, marks, FSRS, Ask history, private markers, own-file mirrors)
<app_cache_dir>/        text/<sha256>.json, index/<classId>.json, models-catalog.json (24 h)
OS keychain:            openrouter key (and custom-host keys)
```

Managed ignores, set over REST on every device at every start:

```json
{"ignore":["// Tramado managed ignores (v1)","(?d).DS_Store","(?d)Thumbs.db","(?d)desktop.ini","(?d)._*",
 "/.tramado/tmp","*.tmp","*.part","*.crdownload","(?d)~$*","(?d).~lock.*#","(?d)*.swp"]}
```

"Skip audio" adds `(?d)/**/audio.webm` on that device only.

---

## 7. Identity model (resolves C24, G2, G3)

- **Device** = Syncthing device ID (TLS certificate). It names every per-device file and is the unit of authorship checks (`modifiedBy` = first 7 chars).
- **Person** = `memberId`: 26 lowercase base32 chars (128 random bits), created at onboarding in `identity.json`. It is not a secret.
- `members/<deviceId>.json`:
  ```json
  {"format":"tramado.member","version":1,"deviceId":"AB4Z76W-…","memberId":"k3…","name":"Ana Ribeiro",
   "deviceName":"Ana's laptop","joinedAt":"…","addresses":["tcp://192.168.1.20:22117","relay://…?id=…"],
   "caps":{"model":"turbo","cpuOk":true,"speedRT":2.7,"ac":true,"volunteer":"plugged"},
   "vouches":["LGTQI2N-…"],"hlc":"…"}
  ```
- **Binding rule:** device D is shown under person M when D's own file says `memberId: M` **and** either (a) D is the first device seen with M, or (b) a device already bound to M lists D in `vouches`. A later device claiming M without a vouch is shown as "Unverified device claiming to be Ana".
- **Pairing a second computer** (Settings → Your computers):
  1. Device 1 shows a QR or code `{memberId, deviceId1, addresses, folders:[{id,label,colour,icon}]}`.
  2. Device 2 adopts `memberId`, adds device 1 and creates every folder.
  3. Device 1 auto-accepts device 2 (a pending device matching the open pairing session), shares all folders with it and adds it to `vouches`.
  4. Classmates admit device 2 by the normal folder-ID proof and see it under Ana.
- Display names come from the newest member file of the person, by HLC.

---

## 8. One error-code taxonomy (resolves C15)

Rust `AppError::Coded(code, msg)` and TS `PlatformError(code)` share these strings. The UI translates codes; messages go to logs only.

| Domain | Codes |
|---|---|
| Common | `INVALID`, `NOT_FOUND`, `PERMISSION_DENIED`, `IO_ERROR`, `DISK_FULL`, `CANCELLED`, `JOB_BUSY` (one job at a time; was Trama `BUSY`), `PATH_OUTSIDE_CLASS`, `SYMLINK_REFUSED`, `CONFLICT`, `NEWER_FORMAT`, `UNSUPPORTED_FILE` |
| AI | `AI_NO_KEY`, `AI_AUTH` (401), `AI_NO_CREDIT` (402), `AI_MODEL_GATED` (403 "agentic harness"), `AI_FLAGGED` (403 moderation), `AI_PRIVACY_BLOCKS` (404 "data policy"), `AI_UNSUPPORTED` (404 "Filter by Parameters", so retry without strict params), `AI_MODEL_UNKNOWN` (400 "not a valid model ID", other 404), `AI_TOO_LONG` (400 context), `AI_BAD_REQUEST` (400/422), `AI_BUSY` (429 with `limit_source` or origin provider), `AI_FREE_LIMIT` (429 platform, `resetAt`), `AI_UPSTREAM` (5xx, mid-stream `finish_reason:"error"`), `AI_UNAVAILABLE` (503, `retryAfter`), `AI_TIMEOUT`, `AI_OFFLINE`, `AI_LENGTH` (empty content, `finish_reason:"length"`), `AI_HOST_NOT_ALLOWED`, `AI_BAD_ADDRESS` |
| Speech | `SPEECH_NO_DEVICE`, `SPEECH_PERMISSION`, `SPEECH_NO_SYSTEM_AUDIO`, `SPEECH_UNSUPPORTED_AUDIO` (includes HE-AAC), `SPEECH_NO_SPEECH`, `SPEECH_UNSUPPORTED_CPU`, `MODEL_NOT_DOWNLOADED`, `MODEL_UNREADABLE`, `MODEL_DOWNLOAD_FAILED`, `MODEL_INTEGRITY` |
| Sync | `SYNC_UNAVAILABLE` (no sidecar or failed to start), `SYNC_LOCKED` (another instance holds the home), `SYNC_PORT`, `SYNC_FOLDER_MARKER_MISSING`, `SYNC_INVITE_INVALID`, `SYNC_FOREIGN_WRITE` (authorship mismatch, diagnostics only) |

Never log or show OpenRouter `user_id` or `metadata.raw` (`openrouter-lab §8`).

---

## 9. Lab artefacts from this critique

All paths are under `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/critique/`:
- `scripts/st_checks.sh`: two-instance Syncthing checks for log-file, device-name token, foreign write and `modifiedBy`. Output in `st_checks.out`; homes and stdout logs in `st/`.
- `scripts/ocr_test.py` (run with `python3 -I`): vision-OCR and image→JSON tests. Images and ground truth in `ocr/` (`exam.txt`, `exam_photo.jpg`, `exam_photo_small.jpg`); raw request/response JSON (images elided) in `ocr/out/*.json`.
- `scripts/bigpdf.mjs` + `scripts/pdfperf.ts`: an 800-page synthetic law PDF (`pdf/code800.pdf`) plus extraction and index timing. Run it with `lab/trama-ts/subset/node_modules/.bin/vite-node` from `lab/trama-ts/subset`.
- `dl/terms.html`: OpenRouter terms as fetched (18+ clause).
