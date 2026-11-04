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

/// Until the desktop crate hands the AI pipe to speech (gate G2: R-SHELL's `AiState` owns the
/// `AiPipe`; `init` then passes `PipeStt::new(pipe)`), cloud transcription answers
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
    let stt: Arc<dyn SttTransport> = Arc::new(PipeNotWired);
    let speech = Arc::new(Speech::new(SpeechConfig {
        paths: shared.paths.clone(),
        fs: shared.fs.clone(),
        stt,
        version: shared.version.clone(),
    }));
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
