# Tramado audio pipeline: record, store/share, play, transcribe

Research report, 2026-11-03. Everything marked **measured** was run on this machine (Ubuntu 24.04,
8 vCPU (AMD Ryzen 5 5600G), Rust 1.95 nightly toolchain as installed, WebKitGTK 2.52.6 + GStreamer 1.24.2 base/good,
ffmpeg with libopus). Everything marked **docs** comes from the cited documentation or bug trackers.
Trama (`/home/feiteira/Trama`) was only read. The lab code is in
`/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/`
(see section 8).

---

## 0. Decisions in one table

| Question | Recommendation |
|---|---|
| Codec | **Opus** (libopus 1.6.1 through `opusic-c` 1.6.1 / `opusic-sys` 0.7.6, BSD-3, built from bundled source with cmake, which whisper-rs already requires) |
| Bitrate | In-room (mono): **24 kbps VBR, 16 kHz, `Application::Voip`, `Signal::Voice`, 60 ms frames** in WebM (~10.6-11 MB/hour). Online class with my microphone kept apart: **stereo 32 kbps** (~14.5 MB/hour). "Storage saver": 16 kbps mono (~7.3 MB/hour). |
| Container while recording (local, crash-safe) | **Ogg Opus (RFC 7845)** written by Rust (`ogg` 0.9.2): append-only, one page per second, CRC per page, so a crash loses at most ~1 s and recovery is "cut to the last valid page + set EOS". |
| Container shared through Syncthing and played | **WebM (Matroska) Opus**, produced by a lossless **remux** (no re-encode) when the recording stops: Duration + Cues for exact length and seeking. It plays correctly in WebView2, WebKitGTK and WKWebView (macOS 12.3+). Ogg Opus does *not* work reliably on macOS (only 15.4+, and WebKit bug 293310 scales the timeline, so seeks to transcript timestamps land wrong). |
| Decoding for transcription | `symphonia` 0.6.1 as the **demuxer** (Ogg + MKV/WebM give `CODEC_ID_OPUS` packets), **libopus decodes straight to 16 kHz** (no resampler). Apply the pre-skip yourself: symphonia 0.6 does not. The same path makes imported WhatsApp `.opus`, Telegram `.oga` and browser `.webm` files transcribable (Trama's decode.rs: "Opus is not among them"). |
| Whisper model | Downloaded on first use into `app_local_data_dir()/models`. **Default: `ggml-large-v3-turbo-q5_0.bin`** (574 MB, the one Trama ships; 2.7× real time on a Ryzen 5 5600G CPU, so a 90-min lecture takes ~33 min). small-q5_1 (190 MB, 11.6× RT) and base-q5_1 are **draft quality on Portuguese** (measured: skipped passages, garbled words). Offer small only as "Draft", and point weak machines to the cloud path or a classmate's claim. Do not offer medium. Advanced: `ggml-large-v3-q5_0.bin` (1.08 GB). Bundle the 885 KB Silero VAD in the app (it is also needed by the cloud path). |
| Downloader | `ureq` 3.5 with **32 MiB Range chunks** (each chunk re-resolves the HF 302 to a fresh signed CDN URL), `.part` file + resume, `timeout_per_read` 30 s as the stall detector, incremental `sha2` SHA-256, `tauri::ipc::Channel` progress events, `AtomicBool` cancel, atomic rename. Prototyped and tested: crash at 20 MB, resume, hash OK. Wrong hash rejected. |
| Transcript on disk | `transcript.json` (canonical: segments with stable random ids, `start_ms`/`end_ms`, speaker, text, optional words) + generated `transcript.md` and `transcript.vtt`. Annotations anchor with **segment id + char offsets + quote (exact/prefix/suffix) + time range**, which re-attaches after corrections. Corrections from classmates go into **per-member append-only edit logs**: one writer per file, so Syncthing never creates conflict copies. |

---

## 1. What Trama does today (read from source)

### 1.1 Capture: `desktop/src-tauri/src/speech/capture.rs` (528 lines)

* `cpal` 0.18. Linux uses the PulseAudio host (`cpal` feature `pulseaudio`; PipeWire serves the protocol too). The **system audio** is the default sink's monitor source, `"<sink id>.monitor"`, built via `cpal::DeviceId::new(HostId::PulseAudio, …)`. Windows uses WASAPI loopback: the default *output* device opened as input (`default_output_config()`). macOS 14.2+ uses a Core Audio process tap (hence `MACOSX_DEPLOYMENT_TARGET = "14.2"` in `.cargo/config.toml`). If PulseAudio does not answer, it falls back to plain ALSA, microphone only.
* There are two tracks, `MIC = 0` and `SYSTEM = 1`. Each cpal callback down-mixes the device's channels to mono f32 and sends `(track, Vec<f32>)` over an mpsc channel. The streams live on their own thread (`trama-capture`) because some backends cannot move streams between threads.
* A second thread, `trama-mixer`, wakes every ≤100 ms. It resamples each track to 16 kHz (`resample.rs`: 63-tap Hamming-windowed sinc low-pass at 0.45×target, then linear interpolation) and **keeps both tracks in step with the wall clock** (`adjust()`: pad silence when a track falls more than 0.5 s behind, e.g. Windows loopback delivers nothing while nothing plays; drop samples when a device clock runs fast; `SLACK` = 0.25 s). It then interleaves what both tracks have as **16-bit LE stereo, 16 kHz (L = mic, R = system)** into `Shared.out`.
* The level meter: per track, the peak of the last block, rising at once and falling ×0.85 per block, stored as `AtomicU32` f32 bits. `Status { recording, ms, mic: {open, level, device, error}, system: {…} }`.
* `Awake::hold("…")` (`awake.rs`) keeps the machine awake: a logind inhibitor over gio on Linux, `PowerCreateRequest/PowerSetRequest(PowerRequestSystemRequired)` on Windows, `NSProcessInfo.beginActivityWithOptions(UserInitiated)` on macOS (no idle sleep, no App Nap). **Reuse as is.**
* Rust never touches the disk. The UI pulls `recorder_take` (raw PCM bytes via `tauri::ipc::Response`) every 400 ms.

### 1.2 Storage: `app/src/services/recording.ts` + `features/speech/controller.ts`

* `RecordingWriter` writes a **WAV (16-bit stereo 16 kHz, ~230 MB/hour)** into an encrypted project blob in 256 KiB frames (~4 s of audio, the most a crash can lose). The WAV header is written first with length 0 and rewritten at stop.
* The crash marker is the store meta key `recording.open` (JSON `OpenRecording`: blob id, start, name, speakers, language, transcribe flag, engine). `recoverRecording()` runs on the next project open: it keeps whole frames, cuts a torn frame, writes the WAV length and closes the blob.
* `SpeechController`: start (meta first, then the recorder), a 400 ms tick (take + write + status), stop (drain + finish + create the document + enqueue transcription with `channels: 'split'` and speaker names). The transcription queue is persisted. Polling `transcribe_status` gives progress, and a speed estimate is learned per machine.
* `RecordDialog.tsx` asks for a name, two speaker names ("you" / "others"), language, transcribe on/off, engine (local/service), consent, and shows a "use headphones" notice (echo would duplicate the other side on the mic track).

### 1.3 Transcription: `speech/mod.rs`, `decode.rs`, `transcribe.rs`, `remote.rs`

* `decode.rs`: symphonia 0.6 (`all-codecs`, `all-formats`) → mono mix or split L/R → 16 kHz f32. **No Opus.**
* `transcribe.rs`: Silero VAD (`WhisperVadContext`) finds speech; the stretches are joined with 100 ms gaps (200 ms lead-in, 100 ms overlap), then one `state.full()` with greedy decoding, `no_context = true`, `token_timestamps`, DTW word times (`DtwModelPreset::LargeV3Turbo`). Times are mapped back onto the recording, and a segment is cut wherever words cross a ≥1 s real pause. The abort callback is a raw C callback on the job's `AtomicBool` (whisper-rs 0.16's `set_abort_callback_safe` is buggy, per Trama's comment). Threads = cores − 2 (max 8). `use_gpu: false`, `flash_attn: false`.
* `remote.rs`: the same VAD; ≤30 s pieces, 4 in flight, base64 WAV to OpenRouter `audio/transcriptions` (`input_audio: {data, format: "wav"}`, `response_format: verbose_json`, `timestamp_granularities: ["segment"]`).
* The models are **bundled** (`tools/fetch-speech-models.mjs`): `ggml-large-v3-turbo-q5_0.bin` 574,041,195 B sha256 `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` and `ggml-silero-v5.1.2.bin` 885,098 B sha256 `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf`. Only the sizes are checked at startup.
* whisper.cpp is built with `GGML_NATIVE=OFF`, AVX/AVX2/FMA/F16C on (`.cargo/config.toml`), and `cpu_supported()` checks AVX2+FMA+F16C at runtime.

**Reuse in Tramado:** `capture.rs` (mixer, clock alignment, loopback per OS), `resample.rs`, `awake.rs`, `transcribe.rs` (VAD join/place logic), `remote.rs` and the job/queue pattern. **Change:** Rust writes the file itself (no encryption, so the PCM need not cross IPC), encodes Opus, and the model is downloaded, not bundled.

---

## 2. Storage format for sharing

### 2.1 Size per hour (measured)

Source: a 17:41 LibriVox recording (Portuguese literary prose, single reader, public domain: archive.org `familia_ingleza_2012_librivox`, chapter 1) decoded to 16 kHz mono 16-bit. All encodes with ffmpeg 6.1 + libopus/libmp3lame/libvorbis, except where marked "Rust" (the lab prototype using libopus 1.6.1 via opusic-c).

| Format | Size / hour | Bitrate | Encode speed (1 core) | Notes |
|---|---:|---:|---:|---|
| WAV 16 kHz **stereo** (Trama today) | **230.4 MB** | 512 kbps | n/a | ×2 for two tracks |
| WAV 16 kHz mono | 115.2 MB | 256 kbps | n/a | |
| FLAC 16 kHz mono (level 8) | 63.6 MB | 141 kbps | ~1000× RT | lossless; 55% of WAV on speech |
| MP3 32 kbps (LAME, 16 kHz MPEG-2) | 14.4 MB | 32 kbps | ~400× RT | LAME is LGPL |
| MP3 VBR -q 9 | 12.8 MB | 28.5 kbps | ~550× RT | |
| AAC-LC 32 kbps (ffmpeg aac) | 15.0 MB | 33 kbps | ~200× RT | does **not** play in stock WebKitGTK (no gst-libav), see 2.4 |
| Vorbis q0 | 11.4 MB | 25 kbps | ~400× RT | |
| **Opus 12 kbps** Ogg | 5.5 MB | 12.3 kbps | ~90-110× RT | |
| **Opus 16 kbps** Ogg | 7.3 MB | 16.2 kbps | | |
| **Opus 24 kbps** Ogg, 20 ms frames | **10.9 MB** | 24.1 kbps | ~110× RT (Rust) | |
| Opus 24 kbps **WebM**, 20 ms frames | 11.7 MB | 26.0 kbps | | +7.6% container overhead |
| Opus 24 kbps Ogg, **60 ms frames** | 10.3 MB | | | −5% vs 20 ms |
| Opus 24 kbps **WebM, 60 ms frames** | **10.6 MB** | | | −9.5% vs 20 ms WebM |
| Rust prototype, 5-min clip, 24 kbps: Ogg 20 ms / Ogg 60 ms / WebM 20 ms / WebM 60 ms | 10.90 / 10.77 / 11.73 / 11.05 MB | 24.2 / 23.9 kbps | 110× / 84× RT | WebM 60 ms decodes to the same samples (corr 0.9434 vs source, same as Ogg) |
| Opus 32 kbps Ogg | 14.4 MB | 32.0 kbps | | |
| Opus **stereo 32 kbps** (Rust, 2 different speakers L/R) | 14.5 MB | 32.2 kbps | ~59× RT | crosstalk ≈ 0 (see 2.6) |

For a class group's semester (30 lectures × 1.5 h = 45 h), every member syncs **~480 MB with Opus 24 kbps WebM**, against **10.4 GB** as Trama-style stereo WAV and 2.9 GB as FLAC. Encoding 1 hour of mono takes ~33 s of one core, i.e. about 1% of a core while recording live.

### 2.2 Rust Opus crates (crates.io, 2026-11-03)

| Crate | Version (updated) | License | What it is | Build | Measured here |
|---|---|---|---|---|---|
| **`opusic-c`** | 1.6.1 (2026-04) | BSD-3 | High-level encoder/decoder (+ repacketizer, multistream, DRED) over `opusic-sys` | — | ✅ encode+decode. Release build of the lab binary: **10.6 s clean, +290 KB** (stripped, LTO, opt-level s) |
| **`opusic-sys`** | 0.7.6 (2026-10-26) | BSD-3 | Bundles **libopus 1.6.1** source. Feature `bundled` (default) → cmake build with **runtime SIMD detection** (SSE/SSE4.1/AVX2 or NEON). Uses Ninja if present. Android NDK aware. Disables LTO flags it cannot handle. | needs **cmake + C compiler**: already required by `whisper-rs-sys`, so nothing new on any OS | 1.75 M recent downloads |
| `opus` | 0.4.0 (2026-08) | MIT/Apache | SpaceManiac's classic API, **now on `opusic-sys`** | same | — (alternative API over the same lib) |
| `opus2` | 0.4.0 | MIT/Apache | backends: `libopus_sys` (cmake/pkg-config) or `mousiki` | | — |
| `audiopus` / `audiopus_sys` | 0.2.x (**2021**) | ISC | old libopus 1.3 binding | cmake/pkg-config | ❌ unmaintained, skip |
| `opus-rs` (restsend) | 0.1.40 (2026-10) | BSD-3 | **pure Rust** port of libopus 1.6, 0 deps, `no_std` capable | cargo only | ✅ interoperates **bit-identically** with libopus decode on our streams; bitrate on target (24.3 kbps for 24k). +466 KB, 9.9 s build. Young (created 2026-02) but the best pure-Rust fallback |
| `rusty-opus` | 1.0.2 (2026-07) | BSD-3 | pure Rust enc+dec ("Remade-With-Rust"), same API shape as opus-rs | cargo only | ⚠️ works, but **overshoots the bitrate +11%** on speech (27.0 kbps for 24k) and +34-44% on synthetic audio; README carries ads. +544 KB. Not recommended |
| `mousiki` | 0.2.1 (2026-03) | MIT | pure Rust port | cargo only | ❌ **broken at 16 kHz mono**: decoding libopus streams gives garbage (corr 0.08); its encoder's output decodes at SNR 2 dB vs 11 dB for libopus. Reject |
| `opus-decoder` | 0.1.1 (2026-03) | MIT/Apache | pure Rust, **decode only**, `#![forbid(unsafe_code)]`, RFC 8251 vectors pass | cargo only | ✅ decodes everything correctly but its 16 kHz output is **13 samples (0.8 ms) early** vs libopus (harmless). +153 KB, 7.8 s build. Good if "no C in the decoder of untrusted files" becomes a requirement |
| `unsafe-libopus` | 0.2.0 (2024) | BSD-3 | c2rust transpile of libopus | | not tested |
| `moosicbox_opus` | 0.5.0 | MPL-2.0 | symphonia **0.5** decoder over `audiopus` | | wrong symphonia major; skip |

**Muxing:** `ogg` 0.9.2 (BSD-3, pure Rust, 12 M downloads): `PacketWriter::write_packet(data, serial, PacketWriteEndInfo::{NormalPacket, EndPage, EndStream}, granule)` and `PacketReader::read_packet()` (needs `Read + Seek`). WebM: no maintained pure-Rust *muxer* fits well (`webm` 2.2.1 wraps C++ libwebm via cc; `webm-iterable`/`mkv-element` are EBML element libraries). A **~150-line in-memory EBML writer** is enough for one Opus track. It is in the lab (`webm_from_packets`) and validated by ffprobe, ffmpeg, symphonia and WebKitGTK.

**Recommendation:** use `opusic-c` (libopus) for both encode and decode. cmake is already in the build for whisper.cpp; libopus is the reference implementation that browsers and ffmpeg ship; and it gives the exact pre-skip (`get_look_ahead()`, 104 at 16 kHz = **312 at 48 kHz**). Keep `opus-rs` in mind as a pure-Rust drop-in (same packets, same output) if a target ever cannot run cmake.

### 2.3 symphonia and Opus (measured, symphonia 0.6.1)

* symphonia 0.6.1 has **no Opus decoder**. Its features are `aac, adpcm, alac, flac, mp1, mp2, mp3, pcm, vorbis`. There is no `symphonia-codec-opus` on crates.io.
* Its **demuxers do understand Opus**: `symphonia-format-ogg` has `mappings/opus.rs` (parses `OpusHead`), and `symphonia-format-mkv` maps `"A_OPUS"` → `CODEC_ID_OPUS` (`AudioCodecId(0x1001)`). `codec_params.audio().extra_data` = the 19-byte `OpusHead` in both cases (measured).
* **Gotcha 1:** symphonia **does not apply the Opus pre-skip** (`trim_start` was 0 for Ogg and WebM), **ignores WebM `DiscardPadding`/`CodecDelay`**, and its Ogg `trim_end` was a whole packet (960) rather than the exact 648-sample padding. Read the pre-skip from `extra_data[10..12]` (u16 LE, 48 kHz units) and drop `preskip/3` samples at 16 kHz yourself. Take the exact length from the Ogg final granule (`(granule − preskip)/3` at 16 kHz) or from the WebM `Info/Duration`.
* Time bases: Ogg Opus track `time_base = 1/48000`, `num_frames` known. WebM `time_base = 1/1000` (ms), `num_frames = None`.
* Integration options: (a) **special-case** `CODEC_ID_OPUS` in Tramado's `decode.rs`: take `packet.data`, run `opusic_c::Decoder::new(Channels, SampleRate::Hz16000)`, `decode_float_to_slice` (lab `symph_decode`, decodes 300 s in 0.2-0.3 s); or (b) implement `symphonia_core::codecs::audio::AudioDecoder` + `RegisterableAudioDecoder` (`try_registry_new`, `supported_codecs`, `decode_ref`, `finalize`, `reset`, `codec_info`, `codec_params`) and register it in a `CodecRegistry` next to `symphonia::default::register_enabled_codecs`, so every container symphonia demuxes (Ogg, WebM/MKV, MP4, CAF) decodes Opus. (a) is less code; (b) is cleaner if the generic Trama decode loop is kept.

### 2.4 Can the webviews play it?

**WebKitGTK 2.52.6 on Ubuntu 24.04, measured** (headless under Xvfb, `scripts/webkit_audio.py`). `canPlayType`:

| MIME | Result |
|---|---|
| `audio/ogg; codecs=opus` | probably |
| `audio/webm; codecs=opus` | probably |
| `audio/opus` | maybe |
| `audio/ogg; codecs=vorbis` | probably |
| `audio/flac`, `audio/mpeg`, `audio/wav` | maybe |
| `audio/mp4; codecs="mp4a.40.2"`, `audio/x-m4a`, `audio/mp4; codecs=opus` | **"" (no)** |

`decodeAudioData` (full decode through GStreamer): **OK** for Ogg Opus (ffmpeg's and **our Rust-written** file, mono and stereo), **WebM Opus (ffmpeg's and ours)**, MP4 Opus, Ogg Vorbis, FLAC, MP3, WAV, with exact durations (300.000 s for our files). **Failed** for AAC in M4A ("Missing decoder: MPEG-4 AAC": stock Ubuntu has no gst-libav/fdkaac) and Opus in CAF. The `<audio>` element itself stalled at `readyState 0` for *every* format, including WAV, because this headless box has no audio sink ("Failed to change autoaudiosink element state"). That is an environment artefact, not a codec problem. The GStreamer plugins involved: `opusdec`/`oggdemux` in **gst-plugins-base**, `matroskademux` in **gst-plugins-good**. Both are dependencies of WebKitGTK distro packages. For the **AppImage**, Tauri's `bundle.linux.appimage.bundleMediaFramework: true` is needed to ship GStreamer plugins. Flatpak/deb rely on the system/runtime.

**WKWebView (macOS), docs:**
* WebM Opus: Safari 15 added WebM Opus for `<audio>`. On **macOS 12.3 / Safari 15.4, `canPlayType`, `<audio>` and `decodeAudioData` all work** (WebKit bug 238546). Consistent across macOS/iOS by Safari 17.4. WKWebView uses the OS WebKit, so for Tramado (minimum macOS 14.2, as Trama, for the Core Audio tap) **WebM Opus is supported**. The blob: URL failure for WebM Opus (bug 245428) was fixed in WebKit in March 2024 (276136@main). Still prefer a real URL (custom protocol) over blob: on macOS.
* Ogg Opus/Vorbis: only since **Safari 18.4 / macOS 15.4** (WebKit blog, "WebKit Features in Safari 18.4"). **WebKit bug 293310 (open, reproduced through Safari 26.x / macOS 27 betas):** Ogg Opus at 48 kHz gets a **wrong duration and a scaled timeline (plays ~0.887× real time; seeking lands proportionally late)**. Safari seems to estimate from size/bitrate instead of granules. The workaround from the bug: **remux the same Opus into WebM** (stream copy). This alone rules out Ogg as the *shared/playback* container: a "click the transcript line → jump to 47:12" feature would land minutes off on Macs.
* AAC/MP4 plays natively. Opus in CAF works on Apple only.

**WebView2 (Windows), docs/known:** Chromium plays Ogg Opus, WebM Opus, MP3, FLAC, WAV and AAC (Edge has the proprietary codecs).

**Conclusion:** **WebM/Opus is the one format that plays correctly in all three engines and that Rust decodes (symphonia demux + libopus)**. MP3 would also play everywhere, but at 2× the size for the same quality, with an LGPL encoder. Add a **startup self-test**: if `document.createElement('audio').canPlayType('audio/webm; codecs="opus"') === ''` (e.g. an AppImage without the media framework, or a Linux system missing gst-plugins-good), fall back to having Rust decode to a temporary 16 kHz WAV (or FLAC) in the cache dir and play that.

**Serving to the webview:** Tauri's asset protocol supports Range (206) but picks Content-Type by sniffing with the `infer` crate (Ogg Opus → `audio/opus`, WebM → `video/webm`; `tauri-utils` 2.10.2 `mime_type.rs`), and has a reported slow-seek issue on very large files (tauri#6375, multi-GB video, not our 10 MB files). Recommended: a small **custom URI scheme** (`register_asynchronous_uri_scheme_protocol("media", …)`) that serves only files inside known class folders, with an explicit `Content-Type: audio/webm`, `Accept-Ranges: bytes` and proper 206/416 handling. Add it to the CSP `media-src`. Lecture files are ~10 MB/hour, so a Blob URL from `tauri::ipc::Response` bytes also works on Linux/Windows. On macOS use the URL scheme.

**Online-class stereo playback:** a hard-panned stereo file (me left, lecturer right) is unpleasant on headphones. Down-mix in the player:

```ts
const ctx = new AudioContext();
const src = ctx.createMediaElementSource(audioEl);       // the <audio> playing audio.webm
const mono = ctx.createGain();
mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
src.connect(mono).connect(ctx.destination);               // (L+R)/2 in both ears
```

### 2.5 Does Opus hurt the transcript? (measured)

Model: `ggml-large-v3-turbo-q5_0` (Trama's file), whisper.cpp v1.9.5 `whisper-cli`, 8 threads, CPU.
Clip: the first 5 min of the Portuguese recording.

Settings like Trama's: Silero VAD v5.1.2 (`--vad`), greedy (`-bs 1 -bo 1`), no context (`-mc 0`), `-l pt`.
Each variant was transcribed and compared word by word (lowercased, punctuation stripped) with the transcript
of the **WAV original** (691 words). There is no human reference, so this measures *disagreement with the WAV
transcript*, not absolute accuracy. The disagreement is split into whole phrases skipped or added by whisper
(runs of ≥4 words) and word-level differences:

| Input to whisper | Size/h | Words | Total diff | Phrase skips/adds | **Word-level diff** |
|---|---:|---:|---:|---:|---:|
| WAV + 1-LSB dither (control: run-to-run noise) | 115 MB | 691 | 0.87% | 0.00% | **0.87%** |
| Opus 12 kbps | 5.6 MB | 703 | 7.96% | 3.33% | **4.63%** |
| Opus 16 kbps | 7.3 MB | 713 | 9.70% | 4.92% | **4.78%** |
| **Opus 24 kbps** | 10.9 MB | 715 | 7.81% | 5.35% | **2.46%** |
| Opus 32 kbps | 14.4 MB | 704 | 7.67% | 4.63% | **3.04%** |
| MP3 VBR -q 9 (~28 kbps) | 12.8 MB | 719 | 10.71% | 5.93% | **4.78%** |

Reading it:
* The phrase-level part is mostly **whisper's own instability, and it cuts both ways**. The WAV run *dropped* a 25-word phrase ("se me admitem a frase … por bocas alheias") that every coded version transcribed, which is why all of them have *more* words than the WAV. Spot checks show the Opus 24 kbps transcript is sometimes the more correct one ("com digno" vs WAV's "conigno", "avultados" vs "avolutores dos", "limpidez" vs "limpeza").
* Word-level differences fall with bitrate: **~4.7% at 12-16 kbps vs ~2.5-3% at 24-32 kbps**. MP3 at ~28 kbps behaves like Opus 16 kbps. **24 kbps is the knee**, so it is the default. 16 kbps is acceptable as a "storage saver".
* With whisper-cli's default long-form beam search (beam 5, no VAD) the same comparison was noisier (total 3.7-15%, with no trend), so **keep Trama's VAD + greedy + no-context pipeline**. It is more stable and faster.
* Caveat: this is close-mic studio speech. Far-field lecture-hall audio has less headroom, which is one more reason not to go below 24 kbps by default.
* Separate observation: even on the WAV, turbo with VAD-joined pieces skipped a ~25-word phrase (~3.5% of the text). Worth an issue in Tramado (and Trama): compare against per-piece decoding, and look at the temperature fallback and `entropy_thold`.

### 2.6 Online class: are the two sides kept apart? (measured)

L = 5 min of one speaker, R = a *different* 5 min, encoded as Opus stereo by the Rust prototype.

* Correlation of the decoded channel with its own source vs. with the other side (cross-talk): 24 kbps: own 0.91, other **0.015**. 32 kbps: own 0.92, other **0.002**. 48 kbps: own 0.93, other **0.000**.
* With R silenced for the second half, the decoded R in that half is **exact digital silence (−inf dBFS)** at both 24 and 32 kbps. So Silero VAD on the "lecturer" track never sees "me", and vice versa.
* `set_force_channels(Some(Stereo))` changed nothing at 16 kHz input (libopus did not fold to mono even at 24 kbps). Set it anyway as a guard.
* So **channel mapping family 0 stereo (L = me/mic, R = the class/system) is enough**. Multistream (family 1/255) is not needed and is less widely playable.

### 2.7 Recommended encoder settings and file shape

```rust
use opusic_c::{Application, Bitrate, Channels, Encoder, SampleRate, Signal};
let mut enc = Encoder::new(ch, SampleRate::Hz16000, Application::Voip)?; // 16 kHz in: wideband SILK
enc.set_bitrate(Bitrate::Value(if stereo { 32_000 } else { 24_000 }))?;
enc.set_vbr(true)?;                    // VBR averages to the target (measured 24.2 kbps)
enc.set_signal(Signal::Voice)?;
enc.set_complexity(10)?;               // ~110x real time on one core: no reason to go lower
if stereo { enc.set_force_channels(Some(Channels::Stereo))?; }
// 60 ms packets: just pass 960 samples/channel per encode call (libopus takes the frame size from
// the input length; 2.5-120 ms are valid). Measured in Rust: same quality, -5.8% WebM size.
let preskip48 = (enc.get_look_ahead()? * 3) as u16;   // 104 @16k -> 312 @48k for OpusHead
```

* Keep **16 kHz**: it is what whisper wants, and decoding at 16 kHz is free in libopus. Lecture intelligibility does not need more than 8 kHz bandwidth. A future "high-quality playback" option could record at 24/48 kHz; the transcriber still decodes at 16 kHz.
* `OpusHead`: version 1, channels, pre-skip (48 kHz units), input rate 16000 (informational), gain 0, **mapping family 0**. `OpusTags`: vendor + `TITLE=…`, `TRAMADO_RECORDING_ID=…`, `DATE=…` (seen by ffprobe as tags, measured).
* **Gotcha 2 (measured):** the encoder runs `look_ahead` samples behind. **Feed one extra frame of silence at stop**, or the last ~6.5 ms never come out (the decoded file was 104 samples short until fixed). The end-trim granule (Ogg) / Duration + `DiscardPadding` (WebM) removes the padding again.
* **Ogg granules:** for each packet, `granule = preskip + samples_so_far_16k × 3`. The last packet gets `preskip + real_samples × 3` (end trimming), with `EndStream`. Force `EndPage` every 50 packets (1 s) for crash safety; there is ~77 B/s of Ogg overhead.
* **WebM:** `EBML{DocType "webm", DocTypeVersion 4, DocTypeReadVersion 2}` → `Segment{ SeekHead(Info, Tracks, Cues; 8-byte positions) · Info{TimestampScale 1000000, Duration (ms, f64), MuxingApp, WritingApp} · Tracks{TrackEntry{TrackNumber 1, TrackUID, TrackType 2, FlagLacing 0, CodecID "A_OPUS", CodecPrivate = OpusHead, CodecDelay = preskip ns (6 500 000), SeekPreRoll 80 000 000, Audio{SamplingFrequency 48000.0, Channels}}} · Cluster{Timestamp, SimpleBlock…} every ~5 s · Cues{CuePoint{CueTime, CueTrackPositions{CueTrack 1, CueClusterPosition}}} }`. The last packet goes in a `BlockGroup{Block, DiscardPadding (ns)}`.
* **Gotcha 3 (measured):** WebM **block timestamps count from 0 with the codec delay included**. Demuxers subtract `CodecDelay` themselves. Writing `(samples − preskip)/48` (as I first did) shifts everything by 6.5 ms (ffprobe showed the first packet at −13 ms instead of ffmpeg's own −7 ms). With raw timestamps, ffprobe reports the same `pts=-7, 13, …` as ffmpeg's own WebM, `initial_padding=312`, `duration=300.000000`.
* Remuxing 5 min (15 001 packets) Ogg → WebM takes **0.016 s** in memory. A 2-hour lecture is ~22 MB, so in-memory is fine.

### 2.8 Rejected alternatives (and why)

* **WAV/FLAC for sharing:** 115 / 64 MB per hour mono, ×N members × 45 h. FLAC is attractive only as a lossless *local* archive. Not needed: at 24 kbps the transcript's word-level difference from the WAV transcript is 2.5% (control 0.9%), and the differences go both ways (2.5).
* **MP3:** plays everywhere and symphonia decodes it, but it is ~2× the bytes of Opus for comparable speech quality. Encoding means LAME (`mp3lame-encoder` 0.3.0 is LGPL-3.0; static LGPL in an MPL app needs relinking provisions) or immature pure-Rust ports.
* **AAC/M4A:** does not play in stock WebKitGTK (measured); encoding needs fdk-aac (licence issues) or ffmpeg's encoder.
* **Ogg Opus as the shared file:** WebKit bug 293310 on macOS (timeline scaled), macOS ≥15.4 only. It is used only as the local recording/journal format.
* **Recording with the webview's MediaRecorder:** cannot capture system loopback, differs per engine (WebM in Chromium, MP4 in Safari) and duplicates what `cpal` already does in Trama.

---

## 3. Whisper model on demand

### 3.1 Files (Hugging Face API, `https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main?expand=true`, repo commit `5359861c739e955e79d9a303bcbc70fb988958b1`, MIT)

URL pattern (pin the commit so the bytes behind a URL never change):
`https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/<file>`
(`…/resolve/main/<file>` also works.)

| File | Bytes | SHA-256 | Notes |
|---|---:|---|---|
| ggml-tiny-q5_1.bin | 32,152,673 | 818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7 | not for PT/ES |
| ggml-tiny-q8_0.bin | 43,537,433 | c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca | |
| ggml-tiny.bin | 77,691,713 | be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21 | |
| ggml-base-q5_1.bin | 59,707,625 | 422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898 | downloaded+verified here |
| ggml-base-q8_0.bin | 81,768,585 | c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9 | |
| ggml-base.bin | 147,951,465 | 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe | |
| **ggml-small-q5_1.bin** | **190,085,487** | **ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb** | "Light"; downloaded+verified here |
| ggml-small-q8_0.bin | 264,464,607 | 49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f | |
| ggml-small.bin | 487,601,967 | 1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b | |
| ggml-medium-q5_0.bin | 539,212,467 | 19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f | dominated by turbo |
| ggml-medium-q8_0.bin | 823,369,779 | 42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502 | |
| ggml-medium.bin | 1,533,763,059 | 6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208 | |
| **ggml-large-v3-turbo-q5_0.bin** | **574,041,195** | **394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2** | **default** (= Trama) |
| ggml-large-v3-turbo-q8_0.bin | 874,188,075 | 317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1 | |
| ggml-large-v3-turbo.bin | 1,624,555,275 | 1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69 | |
| ggml-large-v3-q5_0.bin | 1,081,140,203 | d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1 | "Best (slow)" |
| ggml-large-v3.bin | 3,095,033,483 | 64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2 | |
| ggml-large-v2-q5_0.bin | 1,080,732,091 | 3a214837221e4530dbc1fe8d734f302af393eb30bd0ed046042ebf4baf70f6f2 | |
| (`*.en*` English-only and `*-encoder.mlmodelc.zip` Core ML files exist too, not useful here) | | | |

Silero VAD (`https://huggingface.co/api/models/ggml-org/whisper-vad`, commit `9ffd54a1e1ee413ddf265af9913beaf518d1639b`, MIT):

| File | Bytes | SHA-256 |
|---|---:|---|
| **ggml-silero-v5.1.2.bin** (Trama's) | 885,098 | 29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf |
| ggml-silero-v6.2.0.bin (2025-11-17) | 885,098 | 2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987 |

Keep v5.1.2 (proven with whisper-rs 0.16 / whisper.cpp 1.8.3, bundled by `whisper-rs-sys` 0.15.0). Try v6.2.0 later. **Bundle the VAD in the installer** (885 KB). Only the whisper model is downloaded.

HTTP behaviour (measured with curl): `GET …/resolve/<rev>/<file>` → **302** to a **signed, expiring** `https://us.aws.cdn.hf.co/xet-bridge-us/…?Expires=…&Signature=…` URL. The 302 already carries `x-linked-size`, `x-linked-etag: "<sha256>"`, `x-repo-commit` and `accept-ranges: bytes`. A `Range: bytes=1000-1999` request through the redirect returns **206** with `content-range: bytes 1000-1999/32152673`. ureq 3.5.1 keeps the Range header across the redirect (verified by the downloader's Content-Range check). **Never cache the CDN URL**: re-request the huggingface.co URL for each chunk/resume.

### 3.2 Which model for students (multilingual PT-PT / ES / EN)

Measured on this machine (AMD Ryzen 5 5600G VM, 8 vCPU, AVX2/FMA/F16C, whisper.cpp v1.9.5 CPU-only, 8 threads,
Trama-like settings: VAD + greedy + no context) on the same 5-min Portuguese clip. "Diff vs turbo" uses the same split as 2.5:

| Model | Download | Time for 300 s | Speed | 90-min lecture | Words (turbo: 691) | Diff vs turbo (phrase / word-level) |
|---|---:|---:|---:|---:|---:|---|
| **large-v3-turbo q5_0** | 574 MB | **112 s** (encode 103 s, decode 7 s) | **2.7× RT** | ~33 min | 691 | — |
| small q5_1 | 190 MB | 26 s | 11.6× RT | ~8 min | **437 / 583** (2 runs) | **35% / 14%** and 8% / 30%: skipped whole passages, mangled words ("gréber-tenha" for "Grã-Bretanha") |
| base q5_1 | 60 MB | 9 s | 34× RT | ~3 min | 605 / 603 | 15% / 33% and 1% / 47%: "rei em a" for "rainha", "Senas" for "Cenas" |
| (turbo, beam 5, no VAD: whisper-cli defaults) | | 140 s | 2.1× RT | | 677 | |

On CPU the **encoder dominates** (103 of 112 s for turbo). So large-v3 q5_0 (same encoder, 32-layer decoder)
should be only ~1.5-2× slower than turbo with greedy decoding, and medium (smaller encoder, 24-layer decoder)
about turbo's speed. Neither was measured.

* **Default: large-v3-turbo q5_0 (574 MB).** It is the large-v3 encoder with a 4-layer decoder: near large-v3 accuracy for PT/ES, and much faster than medium. Trama already tuned VAD/DTW/segmenting for it (`DtwModelPreset::LargeV3Turbo`). Students record 1-2 h lectures, and transcription runs in the background after class.
* **small q5_1 (190 MB) is draft quality on Portuguese** (measured above: skipped passages, garbled words). Offer it only as "Draft (fast, rough)". For weak machines, the better answer is **the cloud path** (OpenRouter audio model, VAD-trimmed pieces as in Trama's `remote.rs`) or **letting a classmate with a capable machine take the transcription claim**.
* **Do not offer medium q5_0**: 539 MB, about the same download as turbo, not more accurate, and about the same CPU speed (estimate: smaller encoder, 6× deeper decoder).
* **base/tiny** only as a hidden "draft" option, not for PT.
* **Advanced: large-v3 q5_0 (1.08 GB)**, the most accurate, est. ~1.5-2× slower than turbo on CPU (same encoder).
* **Gotcha 4:** the DTW preset must match the model (`whisper_rs::DtwModelPreset::{Small, Base, Medium, LargeV3, LargeV3Turbo, …}`), or word times are garbage. Store the preset in the model registry.
* **Gotcha 5:** keep Trama's CPU gate (AVX2+FMA+F16C on x86-64, with `GGML_NATIVE=OFF` and AVX2 on in `.cargo/config.toml`). Offer the cloud path when the CPU cannot run the engine. Consider the `metal` feature of whisper-rs on Apple Silicon (large speed-up; Trama runs CPU only).
* The **one transcriber per class** rule makes the big model affordable: only one member's machine spends the CPU, and everyone gets the transcript through Syncthing. When claiming, prefer the member who has the default model and a supported CPU (advertise `{model, cpu_ok, speed}` in the member's presence file).

### 3.3 Downloader design (prototype: `lab/audio/proj/modeldl/src/main.rs`, tested)

Registry (compiled into the app, never from the network):

```rust
pub struct ModelSpec { id: &'static str, file: &'static str, size: u64, sha256: &'static str,
                       dtw: DtwModelPreset, label_key: &'static str /* i18n */ }
const REV: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";
pub const MODELS: &[ModelSpec] = &[
  ModelSpec { id: "turbo", file: "ggml-large-v3-turbo-q5_0.bin", size: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    dtw: DtwModelPreset::LargeV3Turbo, label_key: "model.turbo" },
  ModelSpec { id: "small", file: "ggml-small-q5_1.bin", size: 190_085_487,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    dtw: DtwModelPreset::Small, label_key: "model.small" },
  ModelSpec { id: "large-v3", file: "ggml-large-v3-q5_0.bin", size: 1_081_140_203,
    sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1",
    dtw: DtwModelPreset::LargeV3, label_key: "model.large" },
];
```

Algorithm (what the prototype does; all steps tested):
1. `dest = app_local_data_dir()/models/<file>`. If it exists with the right size (and, once per app version or on load failure, the right hash), it is ready.
2. Check free space (`fs4::available_space` or `sysinfo`): needs `size − part_len` + 5% margin. Otherwise return the code `DISK_FULL`.
3. `part = <file>.part`. `have = len(part)` (truncate to 0 if > size). Re-hash the existing `have` bytes into a `Sha256` (measured: **20 MB in 0.11 s**, so ~3 s for the 574 MB turbo).
4. Loop while `have < size`: `GET https://huggingface.co/…/resolve/<REV>/<file>` with `Range: bytes=have-min(have+32MiB, size)-1`. Accept **206** only if `Content-Range` starts with `bytes {have}-`. Accept **200** only when `have == 0`. Anything else is an error. Stream with a 256 KiB buffer: `write_all` + `hasher.update` + `have += n`, checking the cancel `AtomicBool` per read, and emitting progress every 250 ms (`{done, total, bytes_per_sec, eta}`).
5. Transient errors (connect, `timeout_per_read`, 5xx, truncated body): retry the chunk with exponential backoff (2, 4, 8, 16, 32 s, up to 5 times in a row; the counter resets after a good chunk). The `.part` always holds a contiguous prefix, so resuming after a crash/kill/reboot just works.
6. At the end: `sync_all`, compare size + hex SHA-256 with the registry. On mismatch, **delete the .part** and report `INTEGRITY`. On success, `rename(part, dest)` (atomic, same dir).
7. Before use: size check at startup (as Trama does). If `WhisperContext::new_with_params` fails, re-hash; on mismatch, delete and offer to re-download.

ureq agent (ureq 3.5.1 API):

```rust
let agent: ureq::Agent = ureq::Agent::config_builder()
    .timeout_connect(Some(Duration::from_secs(15)))
    .timeout_recv_response(Some(Duration::from_secs(30)))
    .timeout_per_read(Some(Duration::from_secs(30)))   // stall detector, not a total limit
    .user_agent("Tramado/<version> (model download)")
    .build().into();
let mut res = agent.get(&url).header("Range", &format!("bytes={have}-{end}")).call()?;
let mut body = res.body_mut().as_reader();   // as_reader(): no size limit (read_to_vec has 10 MB)
```

Measured: base-q5_1 (59.7 MB) killed after 20 MB, resumed, **SHA-256 OK**. small-q5_1 (190 MB) in one go, OK. The wrong-hash test was rejected and the `.part` deleted. Throughput here was ~2.2-2.7 MB/s (at that rate turbo takes ~4 min). The release binary (ureq+rustls+sha2) was 1.7 MB stripped, but Tramado already links ureq (Trama does), so the marginal cost is ~0.

Tauri surface:

```rust
#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ModelEvent { Started { total: u64, resumed_from: u64 },
                      Progress { done: u64, total: u64, bytes_per_sec: f64 },
                      Verifying, Done, Failed { code: String, message: String }, Cancelled }

#[tauri::command]
async fn model_download(app: AppHandle, id: String, on_event: tauri::ipc::Channel<ModelEvent>) -> AppResult<()>;
#[tauri::command] async fn model_cancel(id: String) -> AppResult<()>;   // sets the AtomicBool
#[tauri::command] async fn model_status() -> AppResult<Vec<ModelState>>; // installed / partial(bytes) / absent
#[tauri::command] async fn model_import(path: String) -> AppResult<()>; // offline: copy + verify hash
#[tauri::command] async fn model_delete(id: String) -> AppResult<()>;
```

* Storage: **`app.path().app_local_data_dir()?.join("models")`**. That is `~/.local/share/<id>/models` on Linux, `~/Library/Application Support/<id>/models` on macOS, and **`%LOCALAPPDATA%\<id>\models` on Windows** (not `app_data_dir`, which is *Roaming* on Windows: a 574 MB file must not roam). Not the cache dir either (OS cleaners may purge it), and **never the Syncthing class folder**.
* Run the download on a `std::thread` (blocking ureq), one per model, with a lock file so a second app instance does not download in parallel.
* UI: show the size and estimated time before starting, a "Pause" button (= cancel, keeps the .part), resume on next start, and "Import model file…" for offline classrooms (a USB stick from a classmate, verified by hash).

---

## 4. Recording

### 4.1 Modes

| Mode | Sources | File | Transcription |
|---|---|---|---|
| **In the room** (default) | microphone only | mono Opus 24 kbps | `channels: mix`, one speaker "Lecture" (no diarization) |
| **Online class** | system audio (loopback) **+ optional microphone** | system only: **mono** 24 kbps. With "also record me (for my questions)": **stereo 32 kbps, L = me, R = class** | stereo: `split` like Trama → speakers "Me" / "Class" |

* For online classes, default the microphone **off**: the student is mostly listening, and the mic would capture their room (privacy, and that file is shared with classmates). Keep Trama's headphones notice (speaker echo duplicates the lecturer on the mic track).
* Only open the devices the mode needs (Trama always opens both). The mixer stays as is (`Mixer::new([Some(rate), None])` already makes an absent track silence). Add a mono output path: in room mode, write only the mic track. In online-without-me mode, write only the system track.
* Device choice: default devices, plus a picker (`host.input_devices()`) and a 3 s mic test with the level meter before the first recording.

### 4.2 Threads and data flow (Rust writes the file; nothing goes over IPC)

```
cpal callbacks ──(track, Vec<f32>)──▶ mixer thread (Trama's: resample 16 kHz, clock-align, pad/drop)
                                           │ 20 ms frames (f32, mono or L/R)
                                           ▼
                                  writer thread: libopus encode (60 ms packets)
                                           │ Ogg pages, EndPage every 1 s, fsync every 5 s
                                           ▼
                staging: <app_local_data_dir>/recordings/<rec-id>.ogg + <rec-id>.json (journal)
                                           │ on stop (or recovery after a crash)
                                           ▼
       remux Ogg→WebM (in memory) ─▶ <class>/.tramado/tmp/<rec-id>.webm.part ─▶ rename to
       <class>/recordings/<date>_<slug>/audio.webm + recording.json ─▶ Syncthing ─▶ classmates
```

* **Stage outside the synced folder.** Syncthing would otherwise sync a growing file many times. Its own temp files are named `.syncthing.<name>.tmp` (`~syncthing~<name>.tmp` on Windows), so a classmate never sees a partial file. Still, write ours as `*.part` under `.tramado/tmp/` and list that in `.stignore` (`.tramado/tmp`) before renaming into place.
* Peers may receive `recording.json` before `audio.webm` (Syncthing does not order files). Put the audio's `size` and `sha256` in `recording.json`, and have the transcriber claim the job only once the audio file matches.

### 4.3 Crash safety (append + finalize)

* The journal `<rec-id>.json` (written atomically via tmp+rename) holds `{state: "recording", started_at, mode, class_id, title, language, channels, markers[], pauses[], encoder: {rate, bitrate, preskip}}`. It is updated on every marker and every ~10 s.
* The Ogg file is append-only. A page is forced every 50 packets (1 s); fsync every 5 s (or `sync_data` on a dedicated thread). **Worst case: ~1 s lost on a crash, ~5 s on power loss.** Trama's WAV frames lost up to ~4 s.
* Recovery at startup, for each journal still in `recording`: `whole_pages()` scans from the start and verifies each page's CRC (Ogg CRC-32, poly 0x04C11DB7, init 0, unreflected, CRC field zeroed). Cut the file after the last good page, set its header-type flag `|= 0x04` (EOS), recompute that page's CRC, and continue with the normal stop path (remux, publish). **Tested:** a file torn at an arbitrary byte (500 123 of 908 499) recovered to 165.0 s with 167 whole pages, decoded by ffmpeg without warnings, and remuxed to WebM with `duration=165.000000`.
* Disk full or write error: stop recording, keep what is written, show a clear error. Disk space is checked at start (warn below 200 MB free ≈ 18 h of audio).
* Keep `awake.rs` (no sleep / App Nap while recording). Also warn when on battery below 15%.

### 4.4 Pause / resume

* Keep the devices open (re-opening is slow and may re-prompt for permission on macOS). Keep feeding the level meter, but **stop feeding the encoder**. The file's timeline has no gap, so transcript and player times stay consistent.
* The mixer's clock must exclude paused time: Trama computes `expected = started.elapsed() × RATE`. Make it `(started.elapsed() − paused_total) × RATE`, and on resume reset each track's `produced` to `expected` and drop pending samples.
* Record each pause in the journal as `{at_ms (audio time), wall_from, wall_to}`, so the UI can show "paused 10:15-10:25" and the Markdown can say "[pause]".

### 4.5 Bookmarks / markers ("important!")

* A big **★ button and a global shortcut** while recording (a Tauri global-shortcut plugin, e.g. Ctrl+Shift+B / ⌘⇧B, so it works while the student takes notes in another app). Quick kinds: `important`, `exam` ("this will be on the test"), `question`, `confused`, `todo`, plus an optional one-line note typed in the dock.
* Rust stamps markers with **audio time** (`frames_written × 1000 / 16000` at the moment of the call), not wall time, so they stay aligned across pauses. Rule: `at_ms = max(0, audio_ms − 3000)` for the "it was just said" reflex (configurable; most students tap *after* the important sentence). Keep `raw_ms` too.
* The markers are saved in the journal, then in `recording.json`. After transcription each marker is mapped to the segment covering `at_ms` (then shown as a highlight, fed to the AI as "the student flagged this", and used for exam prep / flashcards).
* Markers are personal by default, kept in the member's own `markers/<member>.json` (single writer). An option "share my markers with the class" turns on a group heat-map of where everybody tapped "important", a cheap and very useful crowd signal.

### 4.6 Live elapsed time and level meter

* Use a `tauri::ipc::Channel<RecorderEvent>` passed to `recorder_start` (push, 10 Hz) instead of Trama's 400 ms polling: `{ms, paused, tracks: [{level_peak, level_rms_db, clipping, device, error}], bytes_written, disk_free}`.
* Meter: Trama's fast-rise / ×0.85 decay peak, plus RMS dBFS. A **"no sound" warning** when the mic RMS stays under −55 dBFS for 15 s (muted mic or wrong device, the classic student disaster), and a clipping indicator.
* Elapsed time comes from audio frames (not a JS timer), so it stays truthful under load.

---

## 5. Transcript on disk (shared)

### 5.1 Layout inside a class folder

```
<Class>/recordings/2026-11-03_1015_aula-07/
  audio.webm                 # Opus, immutable once published
  recording.json             # metadata (single writer: the recorder)
  transcript.json            # canonical transcript (single writer: the claim holder)
  transcript.md              # generated, human-readable
  transcript.vtt             # generated, WebVTT (subtitles; cue ids = segment ids)
  edits/<member-id>.jsonl    # corrections, one append-only file per member
  notes/<member-id>.json     # shared annotations/highlights, one file per member (optional)
```

Every file has **exactly one writer**, so Syncthing never produces `*.sync-conflict-*` copies. Readers merge.

### 5.2 `recording.json`

```json
{
  "format": "tramado.recording", "version": 1,
  "id": "01JBX4Q7Z5W8M2E3C9R6T0YH2K",
  "title": "Aula 7 — Responsabilidade civil",
  "class_id": "…", "recorded_by": { "member_id": "…", "name": "Ana" },
  "started_at": "2026-11-03T10:15:02Z", "duration_ms": 5402320,
  "mode": "room",
  "audio": { "file": "audio.webm", "codec": "opus", "container": "webm", "sample_rate": 16000,
             "channels": 1, "bitrate": 24000, "size": 7148032, "sha256": "…" },
  "channels": [ { "index": 0, "speaker": "lecture" } ],
  "language": "pt",
  "pauses": [ { "at_ms": 2701000, "wall_from": "…", "wall_to": "…" } ],
  "markers": [ { "id": "mk_3f9a", "at_ms": 1834000, "raw_ms": 1837000, "kind": "exam", "note": "artigo 483" } ]
}
```

### 5.3 `transcript.json`

```json
{
  "format": "tramado.transcript", "version": 1,
  "recording_id": "01JBX4Q7Z5W8M2E3C9R6T0YH2K",
  "audio_sha256": "…",
  "revision": 1,
  "language": "pt",
  "engine": { "kind": "local", "name": "whisper.cpp", "version": "1.8.3", "model": "ggml-large-v3-turbo-q5_0",
              "model_sha256": "3942…a7e2", "vad": "silero-v5.1.2" },
  "transcribed_by": { "member_id": "…", "at": "2026-11-03T12:01:44Z" },
  "speakers": [ { "id": "lecture", "label": "Professor" }, { "id": "me", "label": "Ana" } ],
  "segments": [
    { "id": "s_8k2Lq", "start_ms": 12340, "end_ms": 17810, "speaker": "lecture",
      "text": "Vamos ver o artigo 483.º do Código Civil.",
      "words": [ { "start_ms": 12340, "end_ms": 12610, "text": "Vamos", "p": 0.97 } ] }
  ]
}
```

* `id`: a random 5-8 char base62, unique within the file, **never reused**, never an index. Splits keep the id on the first part and mint a new one for the second. Merges keep the first id and record `"merged": ["s_x"]` so old anchors can be redirected (with a char offset).
* `words` is optional (DTW word times exist locally; the cloud path gives only segments). It is ~3× the JSON size, so keep it only when it exists. Store integers in ms. A 90-min lecture comes to ~1,000 segments, ~150 KB without words.
* `audio_sha256` binds the transcript to the exact audio. If someone re-publishes the audio, the transcript is stale.

### 5.4 Companions (generated, never edited)

`transcript.md`:

```markdown
# Aula 7 — Responsabilidade civil
*2026-11-03 · 1:30:02 · gravado por Ana · whisper.cpp large-v3-turbo*

**[00:00:12] Professor:** Vamos ver o artigo 483.º do Código Civil. …
> ★ 00:30:34 (exam) artigo 483
```

`transcript.vtt`:

```
WEBVTT

s_8k2Lq
00:00:12.340 --> 00:00:17.810
<v Professor>Vamos ver o artigo 483.º do Código Civil.
```

The VTT cue identifier = segment id, which gives deep links (`#s_8k2Lq`) and lets the `<track>` element show captions in the player. Both files are regenerated by the claim holder when `transcript.json` or the edit logs change (debounced), and are for humans/other tools only. The app reads the JSON.

### 5.5 Corrections and robust anchors

Correction log `edits/<member>.jsonl` (append-only):

```json
{"op":"set_text","segment":"s_8k2Lq","base":"<sha1 of the text being replaced>","text":"Vamos ver o artigo 483.º do Código Civil.","at":"2026-11-03T13:02:11Z","by":"<member>"}
{"op":"set_speaker","segment":"s_8k2Lq","speaker":"me","at":"…"}
{"op":"split","segment":"s_8k2Lq","at_char":24,"new_id":"s_Q1x9","at_ms":15020}
```

Merge rule: apply all members' ops in `(at, member_id)` order. A `set_text` whose `base` does not match the current text is still applied (last writer wins per segment) but flagged for review. Every few minutes the claim holder may fold the ops into `transcript.json` (`revision+1`). The logs stay, so anchors can be replayed.

Annotation / highlight anchor (W3C Web Annotation style, multiple selectors):

```json
{
  "id": "an_x81", "recording_id": "01JBX…", "kind": "highlight", "color": "yellow", "note": "Pressupostos",
  "target": {
    "segment": "s_8k2Lq", "start": 10, "end": 41,
    "quote": { "exact": "artigo 483.º do Código Civil", "prefix": "Vamos ver o ", "suffix": "." },
    "time": { "start_ms": 13100, "end_ms": 15200 },
    "revision": 1
  }
}
```

Re-anchoring, in order:
1. The segment exists and `text[start..end] == exact` → done.
2. `exact` occurs in the segment → take the occurrence nearest the old offset, disambiguated by prefix/suffix.
3. Fuzzy match (diff-match-patch `match_main` / bitap) inside the segment, then in the segments that overlap `time`, then across `merged` redirects.
4. Fall back to `time` (always valid for playback, since the audio is immutable) and mark the annotation "approximate" for the student to confirm.

When the user edits a segment **in Tramado**, the editor knows the diff and moves the offsets of anchors in that segment immediately (simple position mapping through the diff). Steps 2-4 are only for edits arriving from other members.

Citations from the AI (exam answers pointing at the lecture) use the same anchor object (`segment` + `time` + `quote`), so a click opens the transcript at the line and plays from `start_ms`.

---

## 6. Tauri command sketch (audio side)

```rust
recorder_start({ class_id, title, mode: "room"|"online", include_mic, language, on_event: Channel<RecorderEvent> }) -> RecId
recorder_pause() / recorder_resume()
recorder_mark({ kind, note? }) -> Marker            // stamped with audio time
recorder_stop() -> PublishedRecording               // remux + move into class folder
recorder_recover() -> Vec<PublishedRecording>       // at startup, for journals left in "recording"
media_url(path) -> String                           // custom-scheme URL for <audio>
transcribe_start({ recording_path, engine: "local"|"openrouter", language, channels: "mix"|"split" })
model_download / model_cancel / model_status / model_import / model_delete
```

---

## 7. Open items to verify on real macOS / Windows machines

1. WKWebView (macOS 14.x and 15.x) playing our WebM Opus over a **custom URI scheme with Range**: seeking to 47:12 lands correctly, and the duration is right. (Expected yes: WebM Opus has been supported since macOS 12.3. Bug 293310 is Ogg-only.)
2. WebView2: the same (expected yes).
3. AppImage with `bundleMediaFramework: true`: `canPlayType('audio/webm; codecs="opus"')` is "probably".
4. Lecture-hall audio (far-field, reverberant, noisy) at 24 vs 16 kbps. The LibriVox sample is close-mic studio speech, so 24 kbps is the safe default and 16 kbps the "saver" option.
5. Silero v6.2.0 with whisper.cpp 1.8.3 (whisper-rs-sys 0.15.0).
6. OpenRouter audio models: whether `input_audio.format` accepts `"ogg"`/`"webm"`. Sending the VAD-trimmed 30 s pieces as Opus instead of WAV would cut uploads ~20×. Trama sends WAV. Out of scope here.

---

## 8. Lab artefacts

All under `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/`:

* `audio/proj/opuslab/` — Opus/Ogg/WebM prototype. Features `libopus`, `opusrs`, `rusty`, `opusdec`, `mousiki`, `symph`. Subcommands: `gen`, `enc BACKEND in.wav out.opus BPS [force-stereo]`, `dec BACKEND in.opus out.wav`, `cmp ref.wav test.wav`, `recover torn.opus out.opus`, `webm in.opus out.webm`, `sdec in.(opus|webm) out.wav` (symphonia demux + libopus).
* `audio/proj/modeldl/` — the resumable, verified HF model downloader.
* `audio/variants.txt`, `audio/build-*.log` — build time / size per backend.
* `audio/enc/` — ffmpeg size comparisons. `audio/rt/` — round-trip, stereo and crash tests. `audio/wer/` — whisper transcripts, logs, timings.
* `scripts/webkit_audio.py` — WebKitGTK `canPlayType` + `decodeAudioData` test (run with `xvfb-run -a python3 -I …`). `scripts/wer.py`, `scripts/wer_run*.sh`.
* `audio/whisper-build/bin/whisper-cli` — whisper.cpp v1.9.5 (CPU, native).

Build times / sizes (clean `cargo build --release`, Trama's profile: LTO, opt-level s, strip, panic abort; lab binary with `ogg` + `hound` = 395,768 B baseline):

| Variant | Clean build | Stripped size | Δ vs baseline |
|---|---:|---:|---:|
| baseline (ogg + hound) | 3.5 s | 395,768 | — |
| + libopus (opusic-c, cmake) | 10.6 s | 692,544 | **+290 KB** |
| + opus-rs | 9.9 s | 873,336 | +466 KB |
| + rusty-opus | 11.0 s | 952,328 | +544 KB |
| + opus-decoder (decode only) | 7.8 s | 552,312 | +153 KB |
| + mousiki | 13.0 s | 938,688 | +530 KB |
| + libopus + symphonia (ogg, mkv) + WebM writer | 23.6 s | 1,045,304 | +650 KB |

Sources: [WebKit Features in Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) · [WebKit bug 293310 (Ogg Opus timeline)](https://bugs.webkit.org/show_bug.cgi?id=293310) · [WebKit bug 238546 (WebM Opus in Safari 15.4)](https://bugs.webkit.org/show_bug.cgi?id=238546) · [WebKit bug 226922](https://bugs.webkit.org/show_bug.cgi?id=226922) · [WebKit bug 245428 (WebM Opus blob: URL, fixed 2024-03)](https://bugs.webkit.org/show_bug.cgi?id=245428) · [frequal.com: Ogg Opus still not working in Safari 18.4](https://frequal.com/java/OggOpusStillNotWorkingInSafari18_4.html) · [Tauri PathResolver docs](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html) · [Tauri asset protocol source (Range)](https://docs.rs/crate/tauri/2.0.0/source/src/protocol/asset.rs) · [tauri#6375 (slow seek on huge files)](https://github.com/tauri-apps/tauri/issues/6375) · [HF whisper.cpp tree API](https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main?expand=true) · [HF whisper-vad](https://huggingface.co/ggml-org/whisper-vad) · RFC 7845 (Ogg Opus) · RFC 6716 §3.1 (Opus TOC) · Matroska/WebM Opus codec mapping (CodecDelay/SeekPreRoll).
