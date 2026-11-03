// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `tramado-speech` (HEAVY: cpal, libopus, whisper.cpp, symphonia): recording, Opus/WebM,
//! decoding, local and cloud transcription, the model registry and downloads, jobs and claim
//! heartbeats, waveform peaks (architecture §5.4).
//!
//! **M0**: the public handle with its exact signatures, the IPC types and the registry data;
//! every method that can fail returns `NOT_IMPLEMENTED`. R-SPEECH implements the modules below.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tramado_base::classfs::ClassFs;
use tramado_base::error::{AppError, AppResult};
use tramado_base::paths::Paths;
use tramado_net::ai::AiBody;

pub mod awake;
pub mod capture;
pub mod cpu;
pub mod decode;
pub mod download;
pub mod encode;
pub mod heartbeat;
pub mod import;
pub mod jobs;
pub mod journal;
pub mod mixer;
pub mod peaks;
pub mod publish;
pub mod registry;
pub mod remote;
pub mod resample;
pub mod types;
pub mod vad;
pub mod webm;
#[cfg(feature = "local-whisper")]
pub mod whisper;

pub use types::*;

/// Every sample handled internally is 16 kHz mono f32.
pub const SAMPLE_RATE: u32 = 16_000;

/// How cloud speech-to-text reaches the network: the desktop crate passes
/// `AiPipe::request_blocking`; tests pass a double.
pub trait SttTransport: Send + Sync {
    fn post(&self, path: &str, body: AiBody, timeout: Duration) -> AppResult<(u16, Vec<u8>)>;
}

/// A job's channel; `send` returns false when the channel is gone (webview reloaded): the job
/// continues and the next `*_attach` replaces the sink (architecture D-7).
pub trait Sink<E>: Send + Sync {
    fn send(&self, e: E) -> bool;
}

pub struct SpeechConfig {
    pub paths: Arc<Paths>,
    pub fs: Arc<ClassFs>,
    pub stt: Arc<dyn SttTransport>,
    pub version: String,
}

pub struct Speech {
    _cfg: SpeechConfig,
}

fn todo<T>(what: &str) -> AppResult<T> {
    Err(AppError::not_implemented(what))
}

impl Speech {
    /// Installs whisper.cpp's logging hooks once (R-SPEECH).
    pub fn new(cfg: SpeechConfig) -> Self {
        Speech { _cfg: cfg }
    }

    /// **Stub**: nothing available yet.
    pub fn info(&self) -> SpeechInfo {
        SpeechInfo {
            cpu_ok: false,
            local_whisper: cfg!(feature = "local-whisper"),
            vad: false,
            engine_version: String::new(),
            default_model: registry::DEFAULT_MODEL,
            models: self.models(),
            system_audio: SystemAudio {
                supported: false,
                reason: None,
            },
            recorder: None,
            jobs: Vec::new(),
        }
    }

    /// **Stub**: every registry model, absent.
    pub fn models(&self) -> Vec<ModelState> {
        registry::MODELS
            .iter()
            .map(|m| ModelState {
                id: m.id,
                file: m.file.to_string(),
                size: m.size,
                sha256: m.sha256.to_string(),
                tier: m.tier,
                recommended: m.id == registry::DEFAULT_MODEL,
                state: ModelStatus::Absent,
                bytes: 0,
                error: None,
                speed_rt: None,
            })
            .collect()
    }

    pub fn download(&self, _id: &str, _sink: Arc<dyn Sink<ModelEvent>>) -> AppResult<()> {
        todo("speech_model_download")
    }

    pub fn attach_download(&self, _id: &str, _sink: Arc<dyn Sink<ModelEvent>>) -> bool {
        false
    }

    pub fn cancel_download(&self, _id: &str) {}

    pub fn delete_model(&self, _id: &str) -> AppResult<()> {
        todo("speech_model_delete")
    }

    pub fn import_model(&self, _id: &str, _file: &Path) -> AppResult<ModelState> {
        todo("speech_model_import")
    }

    /// **Stub**: no devices.
    pub fn devices(&self) -> AudioDevices {
        AudioDevices {
            inputs: Vec::new(),
            system_audio: SystemAudio {
                supported: false,
                reason: None,
            },
        }
    }

    /// `JOB_BUSY` while recording.
    pub fn meter_start(
        &self,
        _req: MeterRequest,
        _sink: Arc<dyn Sink<MeterEvent>>,
    ) -> AppResult<()> {
        todo("speech_meter_start")
    }

    pub fn meter_stop(&self) {}

    pub fn recorder_start(
        &self,
        _req: RecorderStartRequest,
        _sink: Arc<dyn Sink<RecorderEvent>>,
    ) -> AppResult<RecorderStatus> {
        todo("speech_recorder_start")
    }

    pub fn recorder_attach(&self, _sink: Arc<dyn Sink<RecorderEvent>>) -> Option<RecorderStatus> {
        None
    }

    pub fn recorder_pause(&self) -> AppResult<RecorderStatus> {
        todo("speech_recorder_pause")
    }

    pub fn recorder_resume(&self) -> AppResult<RecorderStatus> {
        todo("speech_recorder_resume")
    }

    pub fn recorder_mark(&self, _kind: MarkerKind, _note: Option<String>) -> AppResult<Marker> {
        todo("speech_recorder_mark")
    }

    pub fn recorder_stop(&self) -> AppResult<FinishedRecording> {
        todo("speech_recorder_stop")
    }

    /// Recovers torn journals first.
    pub fn pending_recordings(&self) -> AppResult<Vec<FinishedRecording>> {
        todo("speech_recordings_pending")
    }

    pub fn publish(&self, _req: PublishRequest) -> AppResult<PublishedAudio> {
        todo("speech_recording_publish")
    }

    pub fn discard(&self, _recording_id: &str) -> AppResult<()> {
        todo("speech_recording_discard")
    }

    pub fn import_audio(
        &self,
        _req: ImportAudioRequest,
        _file: &Path,
        _sink: Arc<dyn Sink<ImportEvent>>,
    ) -> AppResult<()> {
        todo("speech_import_audio")
    }

    /// Finished imports whose `lecture.json` was not written yet are also reported by
    /// `pending_recordings()`.
    pub fn attach_import(&self, _recording_id: &str, _sink: Arc<dyn Sink<ImportEvent>>) -> bool {
        false
    }

    pub fn transcribe_start(
        &self,
        _req: TranscribeRequest,
        _sink: Arc<dyn Sink<TranscribeEvent>>,
    ) -> AppResult<String> {
        todo("speech_transcribe_start")
    }

    pub fn transcribe_attach(
        &self,
        _job_id: &str,
        _sink: Arc<dyn Sink<TranscribeEvent>>,
    ) -> Option<JobSummary> {
        None
    }

    pub fn transcribe_cancel(&self, _job_id: &str, _keep_partial: bool) {}

    pub fn jobs(&self) -> Vec<JobSummary> {
        Vec::new()
    }

    pub fn take_result(&self, _job_id: &str) -> AppResult<TranscriptionResult> {
        todo("speech_transcribe_take")
    }

    pub fn peaks(&self, _source: &AudioSource, _buckets: u32) -> AppResult<Vec<u8>> {
        todo("speech_peaks")
    }

    /// Cancels the job (keeping its partial result) and stops the recorder (finalising the
    /// journal).
    pub fn shutdown(&self) {}
}
