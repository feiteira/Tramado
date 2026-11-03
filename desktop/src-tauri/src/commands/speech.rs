// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Speech (architecture §6.8 → `tramado-speech`). Long jobs take a `Channel` named `onEvent`
//! and have an `*_attach` command (D-7). **Stubs (M0)**: R-SPEECH implements `Sink` over
//! `tauri::ipc::Channel`, `init` (models dir, VAD path, `SttTransport` = `AiPipe::request_blocking`)
//! and `on_exit` (finalise the journal, cancel the job keeping its partial result).

use tauri::ipc::Channel;
use tauri::AppHandle;
use tramado_base::error::AppResult;
use tramado_speech::{
    AudioDevices, FinishedRecording, ImportAudioRequest, ImportEvent, JobSummary, MarkRequest,
    Marker, MeterEvent, MeterRequest, ModelEvent, ModelId, ModelState, PeaksRequest,
    PublishRequest, PublishedAudio, RecorderEvent, RecorderStartRequest, RecorderStatus,
    SpeechInfo, TranscribeEvent, TranscribeRequest, TranscriptionResult,
};

use crate::state::Shared;
use crate::util::not_implemented;

pub struct SpeechState;

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    use tauri::Manager;
    app.manage(SpeechState);
    Ok(())
}

pub fn on_exit(_app: &AppHandle) {}

#[tauri::command]
pub async fn speech_info() -> AppResult<SpeechInfo> {
    Err(not_implemented("speech_info"))
}

#[tauri::command]
pub async fn speech_models() -> AppResult<Vec<ModelState>> {
    Err(not_implemented("speech_models"))
}

#[tauri::command]
pub async fn speech_model_download(
    model_id: ModelId,
    on_event: Channel<ModelEvent>,
) -> AppResult<()> {
    let _ = (model_id, on_event);
    Err(not_implemented("speech_model_download"))
}

#[tauri::command]
pub async fn speech_model_attach(
    model_id: ModelId,
    on_event: Channel<ModelEvent>,
) -> AppResult<bool> {
    let _ = (model_id, on_event);
    Err(not_implemented("speech_model_attach"))
}

/// Keeps the `.part`.
#[tauri::command]
pub async fn speech_model_cancel(model_id: ModelId) -> AppResult<()> {
    let _ = model_id;
    Err(not_implemented("speech_model_cancel"))
}

#[tauri::command]
pub async fn speech_model_delete(model_id: ModelId) -> AppResult<()> {
    let _ = model_id;
    Err(not_implemented("speech_model_delete"))
}

#[tauri::command]
pub async fn speech_model_import(model_id: ModelId, pick: String) -> AppResult<ModelState> {
    let _ = (model_id, pick);
    Err(not_implemented("speech_model_import"))
}

#[tauri::command]
pub async fn speech_devices() -> AppResult<AudioDevices> {
    Err(not_implemented("speech_devices"))
}

#[tauri::command]
pub async fn speech_meter_start(req: MeterRequest, on_event: Channel<MeterEvent>) -> AppResult<()> {
    let _ = (req, on_event);
    Err(not_implemented("speech_meter_start"))
}

#[tauri::command]
pub async fn speech_meter_stop() -> AppResult<()> {
    Err(not_implemented("speech_meter_stop"))
}

#[tauri::command]
pub async fn speech_recorder_start(
    req: RecorderStartRequest,
    on_event: Channel<RecorderEvent>,
) -> AppResult<RecorderStatus> {
    let _ = (req, on_event);
    Err(not_implemented("speech_recorder_start"))
}

#[tauri::command]
pub async fn speech_recorder_attach(
    on_event: Channel<RecorderEvent>,
) -> AppResult<Option<RecorderStatus>> {
    let _ = on_event;
    Err(not_implemented("speech_recorder_attach"))
}

#[tauri::command]
pub async fn speech_recorder_pause() -> AppResult<RecorderStatus> {
    Err(not_implemented("speech_recorder_pause"))
}

#[tauri::command]
pub async fn speech_recorder_resume() -> AppResult<RecorderStatus> {
    Err(not_implemented("speech_recorder_resume"))
}

#[tauri::command]
pub async fn speech_recorder_mark(m: MarkRequest) -> AppResult<Marker> {
    let _ = m;
    Err(not_implemented("speech_recorder_mark"))
}

#[tauri::command]
pub async fn speech_recorder_stop() -> AppResult<FinishedRecording> {
    Err(not_implemented("speech_recorder_stop"))
}

#[tauri::command]
pub async fn speech_recordings_pending() -> AppResult<Vec<FinishedRecording>> {
    Err(not_implemented("speech_recordings_pending"))
}

#[tauri::command]
pub async fn speech_recording_publish(req: PublishRequest) -> AppResult<PublishedAudio> {
    let _ = req;
    Err(not_implemented("speech_recording_publish"))
}

#[tauri::command]
pub async fn speech_recording_discard(recording_id: String) -> AppResult<()> {
    let _ = recording_id;
    Err(not_implemented("speech_recording_discard"))
}

#[tauri::command]
pub async fn speech_import_audio(
    req: ImportAudioRequest,
    on_event: Channel<ImportEvent>,
) -> AppResult<()> {
    let _ = (req, on_event);
    Err(not_implemented("speech_import_audio"))
}

#[tauri::command]
pub async fn speech_import_attach(
    recording_id: String,
    on_event: Channel<ImportEvent>,
) -> AppResult<bool> {
    let _ = (recording_id, on_event);
    Err(not_implemented("speech_import_attach"))
}

/// Returns the job ID.
#[tauri::command]
pub async fn speech_transcribe_start(
    req: TranscribeRequest,
    on_event: Channel<TranscribeEvent>,
) -> AppResult<String> {
    let _ = (req, on_event);
    Err(not_implemented("speech_transcribe_start"))
}

#[tauri::command]
pub async fn speech_transcribe_attach(
    job_id: String,
    on_event: Channel<TranscribeEvent>,
) -> AppResult<Option<JobSummary>> {
    let _ = (job_id, on_event);
    Err(not_implemented("speech_transcribe_attach"))
}

#[tauri::command]
pub async fn speech_transcribe_cancel(job_id: String, keep_partial: bool) -> AppResult<()> {
    let _ = (job_id, keep_partial);
    Err(not_implemented("speech_transcribe_cancel"))
}

#[tauri::command]
pub async fn speech_jobs() -> AppResult<Vec<JobSummary>> {
    Err(not_implemented("speech_jobs"))
}

#[tauri::command]
pub async fn speech_transcribe_take(job_id: String) -> AppResult<TranscriptionResult> {
    let _ = job_id;
    Err(not_implemented("speech_transcribe_take"))
}

/// Waveform peaks, 0–255 per bucket (`buckets` 100–4000).
#[tauri::command]
pub async fn speech_peaks(req: PeaksRequest) -> AppResult<Vec<u8>> {
    let _ = req;
    Err(not_implemented("speech_peaks"))
}
