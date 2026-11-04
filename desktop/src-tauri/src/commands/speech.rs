// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Speech (architecture §6.8 → `tramado-speech`). Long jobs take a `Channel` named `onEvent`
//! and have an `*_attach` command (D-7): the channel is wrapped as a `Sink`, and a job whose
//! webview went away keeps running until the next `*_attach` hands it a new one. Paths never
//! come from the webview: models and imported files arrive as pick tokens (D-4); audio is a
//! class path or a private recording ID.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tramado_base::error::AppResult;
use tramado_base::picks::{PickKind, PickRegistry};
use tramado_net::ai::{ActivityTag, AiAction, AiBase, AiBody, AiPipe, AiRequest, Method};
use tramado_speech::{
    AudioDevices, FinishedRecording, ImportAudioRequest, ImportEvent, JobSummary, MarkRequest,
    Marker, MeterEvent, MeterRequest, ModelEvent, ModelId, ModelState, PeaksRequest,
    PublishRequest, PublishedAudio, RecorderEvent, RecorderStartRequest, RecorderStatus, Sink,
    Speech, SpeechConfig, SpeechInfo, SttTransport, TranscribeEvent, TranscribeRequest,
    TranscriptionResult,
};

use crate::state::Shared;
use crate::util::{blocking, not_implemented};

pub struct SpeechState {
    pub speech: Arc<Speech>,
    picks: Arc<PickRegistry>,
}

/// A Tauri channel as a job's sink: `false` once the webview that made it is gone.
struct ChannelSink<E: Serialize + Clone + Send + Sync + 'static>(Channel<E>);

impl<E: Serialize + Clone + Send + Sync + 'static> Sink<E> for ChannelSink<E> {
    fn send(&self, e: E) -> bool {
        self.0.send(e).is_ok()
    }
}

fn sink<E: Serialize + Clone + Send + Sync + 'static>(c: Channel<E>) -> Arc<dyn Sink<E>> {
    Arc::new(ChannelSink(c))
}

/// Cloud transcription through the AI pipe (D-12): `audio/transcriptions` on OpenRouter, as an
/// internal request (the pipe injects the key and overwrites `provider` from the privacy
/// level), logged in the activity log as `cloudSpeech`.
pub struct PipeStt {
    pipe: Arc<AiPipe>,
}

impl PipeStt {
    pub fn new(pipe: Arc<AiPipe>) -> Self {
        PipeStt { pipe }
    }
}

impl SttTransport for PipeStt {
    fn post(&self, path: &str, body: AiBody, timeout: Duration) -> AppResult<(u16, Vec<u8>)> {
        let req = AiRequest {
            request_id: format!("stt-{}", tramado_base::ids::random_lower_alnum(12)),
            base: AiBase::OpenRouter,
            method: Method::Post,
            path: path.to_string(),
            body: Some(body),
            stream: false,
            privacy_override: None,
            busy_fallback: false,
            activity: Some(ActivityTag {
                class_id: None,
                action: AiAction::CloudSpeech,
                passages: 0,
            }),
            internal: true,
        };
        self.pipe.request_blocking(req, timeout)
    }
}

/// Used only when the AI domain did not manage an `Arc<AiPipe>` (it always does, since G1:
/// `commands::ai::init` runs before `speech::init`); cloud transcription then answers
/// `NOT_IMPLEMENTED`.
struct PipeNotWired;

impl SttTransport for PipeNotWired {
    fn post(&self, _path: &str, _body: AiBody, _t: Duration) -> AppResult<(u16, Vec<u8>)> {
        Err(not_implemented(
            "cloud transcription (AiPipe wiring, gate G2)",
        ))
    }
}

pub fn init(app: &AppHandle, shared: &Shared) -> AppResult<()> {
    let stt: Arc<dyn SttTransport> = match app.try_state::<Arc<AiPipe>>() {
        Some(pipe) => Arc::new(PipeStt::new(pipe.inner().clone())),
        None => Arc::new(PipeNotWired),
    };
    let speech = Arc::new(Speech::new(SpeechConfig {
        paths: shared.paths.clone(),
        fs: shared.fs.clone(),
        stt,
        version: shared.version.clone(),
    }));
    // `diag_collect` (commands/app.rs) reads the engine through its own handle.
    app.manage(speech.clone());
    app.manage(SpeechState {
        speech,
        picks: shared.picks.clone(),
    });
    Ok(())
}

/// Finalises the recording journal and cancels the job (keeping its partial result).
pub fn on_exit(app: &AppHandle) {
    if let Some(s) = app.try_state::<SpeechState>() {
        s.speech.shutdown();
    }
}

fn speech(s: &State<'_, SpeechState>) -> Arc<Speech> {
    s.speech.clone()
}

#[tauri::command]
pub async fn speech_info(state: State<'_, SpeechState>) -> AppResult<SpeechInfo> {
    let sp = speech(&state);
    blocking(move || Ok(sp.info())).await
}

#[tauri::command]
pub async fn speech_models(state: State<'_, SpeechState>) -> AppResult<Vec<ModelState>> {
    let sp = speech(&state);
    blocking(move || Ok(sp.models())).await
}

#[tauri::command]
pub async fn speech_model_download(
    state: State<'_, SpeechState>,
    model_id: ModelId,
    on_event: Channel<ModelEvent>,
) -> AppResult<()> {
    let sp = speech(&state);
    blocking(move || sp.download(model_id.as_str(), sink(on_event))).await
}

#[tauri::command]
pub async fn speech_model_attach(
    state: State<'_, SpeechState>,
    model_id: ModelId,
    on_event: Channel<ModelEvent>,
) -> AppResult<bool> {
    Ok(state
        .speech
        .attach_download(model_id.as_str(), sink(on_event)))
}

/// Keeps the `.part`.
#[tauri::command]
pub async fn speech_model_cancel(
    state: State<'_, SpeechState>,
    model_id: ModelId,
) -> AppResult<()> {
    state.speech.cancel_download(model_id.as_str());
    Ok(())
}

#[tauri::command]
pub async fn speech_model_delete(
    state: State<'_, SpeechState>,
    model_id: ModelId,
) -> AppResult<()> {
    let sp = speech(&state);
    blocking(move || sp.delete_model(model_id.as_str())).await
}

#[tauri::command]
pub async fn speech_model_import(
    state: State<'_, SpeechState>,
    model_id: ModelId,
    pick: String,
) -> AppResult<ModelState> {
    let file = state.picks.resolve(&pick, PickKind::Open)?;
    let sp = speech(&state);
    blocking(move || sp.import_model(model_id.as_str(), &file)).await
}

#[tauri::command]
pub async fn speech_devices(state: State<'_, SpeechState>) -> AppResult<AudioDevices> {
    let sp = speech(&state);
    blocking(move || Ok(sp.devices())).await
}

#[tauri::command]
pub async fn speech_meter_start(
    state: State<'_, SpeechState>,
    req: MeterRequest,
    on_event: Channel<MeterEvent>,
) -> AppResult<()> {
    let sp = speech(&state);
    blocking(move || sp.meter_start(req, sink(on_event))).await
}

#[tauri::command]
pub async fn speech_meter_stop(state: State<'_, SpeechState>) -> AppResult<()> {
    let sp = speech(&state);
    blocking(move || {
        sp.meter_stop();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn speech_recorder_start(
    state: State<'_, SpeechState>,
    req: RecorderStartRequest,
    on_event: Channel<RecorderEvent>,
) -> AppResult<RecorderStatus> {
    let sp = speech(&state);
    blocking(move || sp.recorder_start(req, sink(on_event))).await
}

#[tauri::command]
pub async fn speech_recorder_attach(
    state: State<'_, SpeechState>,
    on_event: Channel<RecorderEvent>,
) -> AppResult<Option<RecorderStatus>> {
    Ok(state.speech.recorder_attach(sink(on_event)))
}

#[tauri::command]
pub async fn speech_recorder_pause(state: State<'_, SpeechState>) -> AppResult<RecorderStatus> {
    let sp = speech(&state);
    blocking(move || sp.recorder_pause()).await
}

#[tauri::command]
pub async fn speech_recorder_resume(state: State<'_, SpeechState>) -> AppResult<RecorderStatus> {
    let sp = speech(&state);
    blocking(move || sp.recorder_resume()).await
}

#[tauri::command]
pub async fn speech_recorder_mark(
    state: State<'_, SpeechState>,
    m: MarkRequest,
) -> AppResult<Marker> {
    let sp = speech(&state);
    blocking(move || sp.recorder_mark(m.kind, m.note)).await
}

#[tauri::command]
pub async fn speech_recorder_stop(state: State<'_, SpeechState>) -> AppResult<FinishedRecording> {
    let sp = speech(&state);
    blocking(move || sp.recorder_stop()).await
}

#[tauri::command]
pub async fn speech_recordings_pending(
    state: State<'_, SpeechState>,
) -> AppResult<Vec<FinishedRecording>> {
    let sp = speech(&state);
    blocking(move || sp.pending_recordings()).await
}

#[tauri::command]
pub async fn speech_recording_publish(
    state: State<'_, SpeechState>,
    req: PublishRequest,
) -> AppResult<PublishedAudio> {
    let sp = speech(&state);
    blocking(move || sp.publish(req)).await
}

#[tauri::command]
pub async fn speech_recording_discard(
    state: State<'_, SpeechState>,
    recording_id: String,
) -> AppResult<()> {
    let sp = speech(&state);
    blocking(move || sp.discard(&recording_id)).await
}

#[tauri::command]
pub async fn speech_import_audio(
    state: State<'_, SpeechState>,
    req: ImportAudioRequest,
    on_event: Channel<ImportEvent>,
) -> AppResult<()> {
    let file = state.picks.resolve(&req.pick, PickKind::Open)?;
    let sp = speech(&state);
    blocking(move || sp.import_audio(req, &file, sink(on_event))).await
}

#[tauri::command]
pub async fn speech_import_attach(
    state: State<'_, SpeechState>,
    recording_id: String,
    on_event: Channel<ImportEvent>,
) -> AppResult<bool> {
    Ok(state.speech.attach_import(&recording_id, sink(on_event)))
}

/// Returns the job ID.
#[tauri::command]
pub async fn speech_transcribe_start(
    state: State<'_, SpeechState>,
    req: TranscribeRequest,
    on_event: Channel<TranscribeEvent>,
) -> AppResult<String> {
    let sp = speech(&state);
    blocking(move || sp.transcribe_start(req, sink(on_event))).await
}

#[tauri::command]
pub async fn speech_transcribe_attach(
    state: State<'_, SpeechState>,
    job_id: String,
    on_event: Channel<TranscribeEvent>,
) -> AppResult<Option<JobSummary>> {
    Ok(state.speech.transcribe_attach(&job_id, sink(on_event)))
}

#[tauri::command]
pub async fn speech_transcribe_cancel(
    state: State<'_, SpeechState>,
    job_id: String,
    keep_partial: bool,
) -> AppResult<()> {
    let sp = speech(&state);
    blocking(move || {
        sp.transcribe_cancel(&job_id, keep_partial);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn speech_jobs(state: State<'_, SpeechState>) -> AppResult<Vec<JobSummary>> {
    Ok(state.speech.jobs())
}

#[tauri::command]
pub async fn speech_transcribe_take(
    state: State<'_, SpeechState>,
    job_id: String,
) -> AppResult<TranscriptionResult> {
    let sp = speech(&state);
    blocking(move || sp.take_result(&job_id)).await
}

/// Waveform peaks, 0–255 per bucket (`buckets` 100–4000).
#[tauri::command]
pub async fn speech_peaks(state: State<'_, SpeechState>, req: PeaksRequest) -> AppResult<Vec<u8>> {
    let sp = speech(&state);
    blocking(move || sp.peaks(&req.source, req.buckets)).await
}

#[cfg(test)]
mod live_tests {
    //! G2: the live cloud speech-to-text check through the **real** `PipeStt` → `AiPipe::request_blocking`
    //! (key from the secret store, `provider` from the privacy level, the activity log), not a stand-in
    //! transport (`crates/tramado-speech/tests/live.rs` has that one). Ignored and **paid** (about US$0.0001
    //! for the 9 s clip with `openai/whisper-large-v3-turbo`); the cost is measured with `GET /key` (through
    //! the pipe too) before and after. The key is read at run time from `OPENROUTER_API_KEY` or
    //! `~/.openrouter.key` into a throw-away secret store and never printed.
    //!
    //! ```text
    //! cargo test -p tramado-desktop --lib live_tests -- --ignored --nocapture
    //! ```
    use super::*;
    use crate::commands::app::tests::TempDir;
    use std::sync::{Condvar, Mutex};
    use tramado_base::classfs::ClassFs;
    use tramado_base::error::Code;
    use tramado_base::paths::Paths;
    use tramado_base::registry::{ClassEntry, ClassRegistry};
    use tramado_net::activity::ActivityLog;
    use tramado_net::hosts::HostList;
    use tramado_net::privacy::PrivacyStore;
    use tramado_net::secrets::Secrets;
    use tramado_speech::{AudioSource, ChannelMode, TranscribeEngine};

    const CLASS: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ME: &str = "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";

    fn key() -> Option<String> {
        if let Some(k) = std::env::var("OPENROUTER_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
        {
            return Some(k.trim().to_string());
        }
        let home = std::env::var_os("HOME")?;
        let k =
            std::fs::read_to_string(std::path::Path::new(&home).join(".openrouter.key")).ok()?;
        let k: String = k.chars().filter(|c| !c.is_whitespace()).collect();
        (!k.is_empty()).then_some(k)
    }

    struct Collect {
        events: Mutex<Vec<TranscribeEvent>>,
        cv: Condvar,
    }

    impl Sink<TranscribeEvent> for Collect {
        fn send(&self, e: TranscribeEvent) -> bool {
            self.events.lock().unwrap().push(e);
            self.cv.notify_all();
            true
        }
    }

    /// `data.usage` of `GET /key`, through the pipe (it strips `user_id`).
    fn usage(pipe: &AiPipe) -> Option<f64> {
        let req = AiRequest {
            request_id: format!("usage-{}", tramado_base::ids::random_lower_alnum(8)),
            base: AiBase::OpenRouter,
            method: Method::Get,
            path: "key".into(),
            body: None,
            stream: false,
            privacy_override: None,
            busy_fallback: false,
            activity: None,
            internal: true,
        };
        let (status, body) = pipe.request_blocking(req, Duration::from_secs(30)).ok()?;
        if status != 200 {
            return None;
        }
        let v: serde_json::Value = serde_json::from_slice(&body).ok()?;
        v.pointer("/data/usage").and_then(serde_json::Value::as_f64)
    }

    #[test]
    #[ignore]
    fn transcribes_through_pipe_stt_live() {
        let Some(key) = key() else {
            println!("not run: no OpenRouter key");
            return;
        };
        let dir = TempDir::new();
        let (config, data) = (dir.path().join("config"), dir.path().join("data"));
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        let secrets = Arc::new(Secrets::new(&config, true));
        secrets.set("openrouter", &key).unwrap();
        drop(key);
        let pipe = Arc::new(AiPipe::new(
            secrets,
            Arc::new(HostList::load(&config)),
            Arc::new(PrivacyStore::new(&config)),
            Arc::new(ActivityLog::new(&data)),
            "live-test".into(),
        ));
        let before = usage(&pipe);

        let paths = Arc::new(Paths::resolve_with(
            |_| None,
            config.clone(),
            data.clone(),
            dir.path().join("cache"),
            dir.path().join("home"),
            None,
        ));
        let reg = Arc::new(ClassRegistry::load(&paths.config).unwrap());
        let root = dir.path().join("classes").join("Direito Constitucional");
        std::fs::create_dir_all(root.join(".tramado")).unwrap();
        reg.insert(ClassEntry::new(CLASS, root.clone())).unwrap();
        let fs = Arc::new(ClassFs::new(paths.clone(), reg));
        fs.set_device(ME);
        let speech = Speech::new(SpeechConfig {
            paths,
            fs,
            stt: Arc::new(PipeStt::new(pipe.clone())),
            version: "live-test".into(),
        });

        let bytes = std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../app/test-fixtures/tramado/audio/speech-en.webm"),
        )
        .unwrap();
        std::fs::create_dir_all(root.join("Lectures/Week 1")).unwrap();
        std::fs::write(root.join("Lectures/Week 1/audio.webm"), &bytes).unwrap();
        let model = std::env::var("TRAMADO_STT_MODEL")
            .unwrap_or_else(|_| "openai/whisper-large-v3-turbo".into());
        let sink = Arc::new(Collect {
            events: Mutex::new(Vec::new()),
            cv: Condvar::new(),
        });
        speech
            .transcribe_start(
                TranscribeRequest {
                    job_id: "job-live".into(),
                    lecture_id: tramado_base::ids::new_ulid(tramado_base::time::now_ms()),
                    source: AudioSource::Class {
                        class_id: CLASS.into(),
                        path: "Lectures/Week 1/audio.webm".into(),
                    },
                    expect_sha256: tramado_base::ids::sha256_hex(&bytes),
                    engine: TranscribeEngine::Cloud {
                        model: model.clone(),
                    },
                    language: "en".into(),
                    channels: ChannelMode::Mix,
                    initial_prompt: Some("separation of powers".into()),
                    claim: None,
                    resume: false,
                },
                sink.clone(),
            )
            .unwrap();
        let end = {
            let deadline = std::time::Instant::now() + Duration::from_secs(300);
            let mut ev = sink.events.lock().unwrap();
            loop {
                if let Some(e) = ev.iter().find(|e| {
                    matches!(
                        e,
                        TranscribeEvent::Done { .. } | TranscribeEvent::Failed { .. }
                    )
                }) {
                    break e.clone();
                }
                let now = std::time::Instant::now();
                assert!(now < deadline, "the cloud job did not finish in 5 min");
                ev = sink.cv.wait_timeout(ev, deadline - now).unwrap().0;
            }
        };
        if let TranscribeEvent::Failed { code, message } = &end {
            if *code == Code::AiNoCredit {
                println!("not run: no credit ({message})");
                return;
            }
            panic!("{code}: {message}");
        }
        let r = speech.take_result("job-live").unwrap();
        let text = r.tracks[0]
            .segments
            .iter()
            .map(|s| s.text.to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");
        println!(
            "model {model} through PipeStt, language {}: {text}",
            r.language
        );
        assert!(text.contains("class") || text.contains("powers"), "{text}");
        // Usage is booked a little later.
        let mut after = None;
        for _ in 0..10 {
            std::thread::sleep(Duration::from_secs(3));
            after = usage(&pipe);
            if after.is_some() && after != before {
                break;
            }
        }
        match (before, after) {
            (Some(b), Some(a)) => {
                // Only the difference: the key's running totals are never printed or committed.
                println!("cost: US${:.6}", a - b);
                assert!(a - b <= 0.05, "over the US$0.05 budget");
            }
            _ => println!("cost: usage not readable"),
        }
    }
}
