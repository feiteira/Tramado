// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Every IPC type of the speech domain (architecture §6.8, §7.2, §9 `platform/types/speech.ts`),
//! as serde structs whose JSON is exactly the TypeScript shape. `T | null` fields serialise
//! `null`; optional (`?`) fields are omitted when absent.

use serde::{Deserialize, Serialize};
use tramado_base::error::Code;

/// A local speech model of the registry (folder spec §2 `ModelId`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ModelId {
    #[serde(rename = "turbo")]
    Turbo,
    #[serde(rename = "small")]
    Small,
    #[serde(rename = "large-v3")]
    LargeV3,
}

impl ModelId {
    pub fn as_str(self) -> &'static str {
        match self {
            ModelId::Turbo => "turbo",
            ModelId::Small => "small",
            ModelId::LargeV3 => "large-v3",
        }
    }

    pub fn parse(s: &str) -> Option<ModelId> {
        match s {
            "turbo" => Some(ModelId::Turbo),
            "small" => Some(ModelId::Small),
            "large-v3" => Some(ModelId::LargeV3),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelTier {
    Default,
    Draft,
    Advanced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelStatus {
    Absent,
    Partial,
    Downloading,
    Verifying,
    Ready,
    Failed,
}

/// TS `ModelState`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelState {
    pub id: ModelId,
    pub file: String,
    pub size: u64,
    pub sha256: String,
    pub tier: ModelTier,
    pub recommended: bool,
    pub state: ModelStatus,
    pub bytes: u64,
    pub error: Option<Code>,
    /// × real time measured by the last local job (member file `caps.localModel.speedRT`)
    #[serde(rename = "speedRT")]
    pub speed_rt: Option<f64>,
}

/// `{ supported, reason }` of system-audio capture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudio {
    pub supported: bool,
    pub reason: Option<Code>,
}

/// TS `SpeechInfo`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechInfo {
    pub cpu_ok: bool,
    pub local_whisper: bool,
    pub vad: bool,
    /// e.g. "whisper.cpp 1.8.3"
    pub engine_version: String,
    pub default_model: ModelId,
    pub models: Vec<ModelState>,
    pub system_audio: SystemAudio,
    pub recorder: Option<RecorderStatus>,
    pub jobs: Vec<JobSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// TS `AudioDevices`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevices {
    pub inputs: Vec<InputDevice>,
    pub system_audio: SystemAudio,
}

/// Folder spec / architecture §1.2: `important`, `confused`, `exam`, `todo`, `note`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkerKind {
    Important,
    Confused,
    Exam,
    Todo,
    Note,
}

/// TS `Marker`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: String,
    pub at_ms: u64,
    pub raw_ms: u64,
    pub kind: MarkerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// The argument of `speech_recorder_mark` (`m: { kind, note? }`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkRequest {
    pub kind: MarkerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// INT (wave 3): the raw audio time to stamp (default: now).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordMode {
    Room,
    Online,
}

/// TS `MeterRequest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterRequest {
    pub input_device_id: Option<String>,
    pub mode: RecordMode,
}

/// TS `RecorderStartRequest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStartRequest {
    /// becomes the lecture id (draftId in presence)
    pub recording_id: String,
    pub class_id: String,
    pub title: String,
    pub mode: RecordMode,
    pub include_mic: bool,
    pub input_device_id: Option<String>,
    /// a `Lang` or `"auto"`
    pub language: String,
    /// 16000 | 24000 | 32000
    pub bitrate: u32,
    /// reflex offset, default 3000 (at = raw − offset)
    pub marker_offset_ms: u64,
}

/// TS `TrackLevel`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackLevel {
    pub peak: f32,
    pub rms_db: f32,
    pub clipping: bool,
    pub device: Option<String>,
    pub error: Option<Code>,
    pub silent_for_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracks {
    pub mic: Option<TrackLevel>,
    pub system: Option<TrackLevel>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecorderState {
    Recording,
    Paused,
    Stopping,
}

/// TS `RecorderStatus`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStatus {
    pub recording_id: String,
    pub class_id: String,
    pub state: RecorderState,
    pub ms: u64,
    pub tracks: Tracks,
    pub bytes_written: u64,
    pub disk_free: Option<u64>,
    pub markers: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Speaker {
    Lecture,
    Me,
    Class,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerTrack {
    pub index: u32,
    pub speaker: Speaker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pause {
    pub at_ms: u64,
    pub wall_from: String,
    pub wall_to: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FinishedState {
    Stopped,
    Recovered,
}

/// TS `FinishedRecording`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishedRecording {
    pub recording_id: String,
    pub class_id: String,
    pub title: String,
    pub mode: RecordMode,
    pub language: String,
    pub started_at: String,
    pub duration_ms: u64,
    /// 1 | 2
    pub channels: u8,
    pub bitrate: u32,
    pub speakers: Vec<SpeakerTrack>,
    pub pauses: Vec<Pause>,
    pub markers: Vec<Marker>,
    pub state: FinishedState,
    pub recovered_lost_ms: Option<u64>,
    /// Additive (R-SPEECH): set when the audio was already published (or imported) but no
    /// `lecture.json` exists yet in its lecture directory (the webview went away in between):
    /// TS writes the manifest from it instead of publishing again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<PublishedAudio>,
    /// Additive (R-SPEECH): an imported file (`lecture.json` `mode: "import"`, `import`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import: Option<ImportInfo>,
}

/// Additive (R-SPEECH): `lecture.json` `import` (folder spec §8.6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInfo {
    pub file_name: String,
    pub mime: String,
    pub had_video: bool,
    /// The lecture directory the audio was placed in.
    pub lecture_dir: String,
}

/// TS `AudioSource`: `{"kind":"class",classId,path}` | `{"kind":"private",recordingId}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AudioSource {
    Class { class_id: String, path: String },
    Private { recording_id: String },
}

/// TS `ShareMode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShareMode {
    #[serde(rename = "audio+transcript")]
    AudioAndTranscript,
    TranscriptOnly,
    None,
}

/// TS `PublishRequest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    pub recording_id: String,
    pub class_id: String,
    pub lecture_dir: String,
    pub share: ShareMode,
}

/// TS `PublishedAudio`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedAudio {
    pub source: AudioSource,
    pub size: u64,
    pub sha256: String,
    pub duration_ms: u64,
    pub channels: u8,
    pub bitrate: u32,
    /// always 16000
    pub sample_rate: u32,
}

/// TS `ImportAudioRequest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAudioRequest {
    pub recording_id: String,
    pub pick: String,
    pub class_id: String,
    pub lecture_dir: String,
    pub keep_video: bool,
}

/// TS `TranscribeRequest.engine`: `{"kind":"local","model":"turbo"}` | `{"kind":"cloud","model":"…"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TranscribeEngine {
    Local { model: ModelId },
    Cloud { model: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelMode {
    Mix,
    Split,
}

/// The claim Rust rewrites every 60 s while the job runs (sync spec §14.5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRef {
    pub class_id: String,
    pub path: String,
    /// The claim file (folder spec §8.10), unknown fields included.
    pub file: serde_json::Value,
}

/// TS `TranscribeRequest`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    pub job_id: String,
    pub lecture_id: String,
    pub source: AudioSource,
    pub expect_sha256: String,
    pub engine: TranscribeEngine,
    /// a `Lang` or `"auto"`
    pub language: String,
    pub channels: ChannelMode,
    /// class vocabulary (meta `vocabulary`, ≤ 500 chars)
    pub initial_prompt: Option<String>,
    pub claim: Option<ClaimRef>,
    /// continue from data/transcribe/<lectureId>.partial.json
    pub resume: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Running,
    Done,
    Failed,
    Cancelled,
}

/// TS `JobSummary`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub job_id: String,
    pub lecture_id: String,
    pub state: JobState,
    pub progress: f64,
    pub eta_ms: Option<u64>,
    pub started_at: String,
    pub error: Option<Code>,
    pub result_ready: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineKind {
    Local,
    Cloud,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultEngine {
    pub kind: EngineKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vad: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub p: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<Word>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultTrack {
    pub speaker: Speaker,
    pub segments: Vec<Segment>,
}

/// TS `TranscriptionResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub lecture_id: String,
    pub duration_ms: u64,
    pub language: String,
    pub engine: ResultEngine,
    pub tracks: Vec<ResultTrack>,
}

/// The argument of `speech_peaks` (`req: { source, buckets }`, 100–4000).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeaksRequest {
    pub source: AudioSource,
    pub buckets: u32,
}

/// Channel of `speech_model_download` / `speech_model_attach`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModelEvent {
    Started {
        total: u64,
        resumed_from: u64,
    },
    /// ≤ 4 Hz
    Progress {
        done: u64,
        total: u64,
        bytes_per_sec: u64,
    },
    Verifying,
    Done {
        model: ModelState,
    },
    Failed {
        code: Code,
        message: String,
    },
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecorderWarning {
    SilentMic,
    LowDisk,
    LowBattery,
    DeviceLost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
    User,
    Error,
    DiskFull,
}

/// Channel of the recorder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RecorderEvent {
    /// 10 Hz
    Status {
        status: RecorderStatus,
    },
    Warning {
        code: RecorderWarning,
    },
    /// also from the global shortcut
    Marker {
        marker: Marker,
    },
    Stopped {
        reason: StopReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        code: Option<Code>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscribePhase {
    Checking,
    Decoding,
    Vad,
    Transcribing,
    Uploading,
}

/// Channel of a transcription job.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TranscribeEvent {
    Phase {
        phase: TranscribePhase,
    },
    /// ≤ 1 Hz; also written to the claim
    Progress {
        progress: f64,
        eta_ms: Option<u64>,
    },
    /// result ready: `speech_transcribe_take`
    Done {
        summary: JobSummary,
    },
    Failed {
        code: Code,
        message: String,
    },
    Cancelled,
}

/// Channel of an audio import.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportEvent {
    /// 0..1
    Progress {
        done: f64,
    },
    Done {
        audio: PublishedAudio,
    },
    Failed {
        code: Code,
        message: String,
    },
}

/// Channel of the input meter (10 Hz).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MeterEvent {
    Level {
        mic: Option<TrackLevel>,
        system: Option<TrackLevel>,
    },
}
