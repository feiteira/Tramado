// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `tramado-speech` (HEAVY: cpal, libopus, whisper.cpp, symphonia): recording, Opus/WebM,
//! decoding, local and cloud transcription, the model registry and downloads, jobs and claim
//! heartbeats, waveform peaks (architecture §5.4). `Speech` is the handle the desktop crate's
//! `commands/speech.rs` wraps, one method per command of architecture §6.8.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use tramado_base::classfs::ClassFs;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::paths::Paths;
use tramado_base::{files, ids, time};
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
pub mod langs;
pub mod mixer;
pub mod peaks;
pub mod pieces;
pub mod publish;
pub mod recorder;
pub mod registry;
pub mod remote;
pub mod resample;
pub mod samples;
pub mod types;
pub mod vad;
pub mod webm;
#[cfg(feature = "local-whisper")]
pub mod whisper;

pub use types::*;

use jobs::{SinkSlot, TranscribeJob};
use journal::{Journal, JournalKind, JournalPaths, JournalState};

/// Every sample handled internally is 16 kHz.
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

/// The engine version shown in Settings and written to transcripts.
pub fn engine_version() -> String {
    if cfg!(feature = "local-whisper") {
        "whisper.cpp 1.8.3".into()
    } else {
        String::new()
    }
}

struct DownloadJob {
    sink: SinkSlot<ModelEvent>,
    cancel: AtomicBool,
    status: Mutex<ModelStatus>,
    bytes: AtomicU64,
    error: Mutex<Option<Code>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

struct ImportJob {
    sink: SinkSlot<ImportEvent>,
    cancel: AtomicBool,
    done: AtomicBool,
    thread: Mutex<Option<JoinHandle<()>>>,
}

struct Meter {
    capture: capture::Capture,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Meter {
    fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.capture.stop();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct Speech {
    cfg: SpeechConfig,
    journals: JournalPaths,
    recorder: Mutex<Option<recorder::Recorder>>,
    meter: Mutex<Option<Meter>>,
    downloads: Mutex<HashMap<ModelId, Arc<DownloadJob>>>,
    jobs: Mutex<HashMap<String, Arc<TranscribeJob>>>,
    imports: Mutex<HashMap<String, Arc<ImportJob>>>,
    speeds: Arc<Mutex<HashMap<ModelId, f64>>>,
}

fn speeds_path(paths: &Paths) -> PathBuf {
    paths.transcribe_dir().join("speed.json")
}

fn load_speeds(paths: &Paths) -> HashMap<ModelId, f64> {
    files::read_optional(&speeds_path(paths))
        .ok()
        .flatten()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn safe_job_id(id: &str) -> AppResult<()> {
    let ok = !id.is_empty()
        && id.len() <= 100
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if ok {
        Ok(())
    } else {
        Err(AppError::invalid("not a job ID"))
    }
}

impl Speech {
    /// Installs whisper.cpp's logging hooks once, restores finished jobs and sweeps old
    /// results.
    pub fn new(cfg: SpeechConfig) -> Self {
        #[cfg(feature = "local-whisper")]
        whisper::install_logging_hooks();
        let dir = cfg.paths.transcribe_dir();
        jobs::sweep(&dir);
        let restored = jobs::restore(&dir);
        let speeds = load_speeds(&cfg.paths);
        Speech {
            journals: JournalPaths::new(cfg.paths.recordings_dir()),
            cfg,
            recorder: Mutex::new(None),
            meter: Mutex::new(None),
            downloads: Mutex::new(HashMap::new()),
            jobs: Mutex::new(restored),
            imports: Mutex::new(HashMap::new()),
            speeds: Arc::new(Mutex::new(speeds)),
        }
    }

    pub fn info(&self) -> SpeechInfo {
        SpeechInfo {
            cpu_ok: cpu::cpu_supported(),
            local_whisper: cfg!(feature = "local-whisper"),
            vad: self.cfg.paths.vad_path().is_some(),
            engine_version: engine_version(),
            default_model: registry::DEFAULT_MODEL,
            models: self.models(),
            system_audio: capture::system_audio(),
            recorder: lock(&self.recorder)
                .as_ref()
                .filter(|r| !r.has_stopped())
                .map(|r| r.status()),
            jobs: self.jobs(),
        }
    }

    fn model_path(&self, spec: &registry::ModelSpec) -> PathBuf {
        self.cfg.paths.models_dir().join(spec.file)
    }

    fn model_ready(&self, spec: &registry::ModelSpec) -> bool {
        std::fs::metadata(self.model_path(spec)).is_ok_and(|m| m.is_file() && m.len() == spec.size)
    }

    fn model_state(&self, spec: &registry::ModelSpec) -> ModelState {
        let speed = lock(&self.speeds).get(&spec.id).copied();
        let mut st = ModelState {
            id: spec.id,
            file: spec.file.to_string(),
            size: spec.size,
            sha256: spec.sha256.to_string(),
            tier: spec.tier,
            recommended: spec.id == registry::DEFAULT_MODEL,
            state: ModelStatus::Absent,
            bytes: 0,
            error: None,
            speed_rt: speed,
        };
        if self.model_ready(spec) {
            st.state = ModelStatus::Ready;
            st.bytes = spec.size;
            return st;
        }
        if let Some(d) = lock(&self.downloads).get(&spec.id) {
            st.state = *lock(&d.status);
            st.bytes = d.bytes.load(Ordering::Relaxed);
            st.error = *lock(&d.error);
            if st.state != ModelStatus::Failed {
                return st;
            }
        }
        let part = self
            .cfg
            .paths
            .models_dir()
            .join(format!("{}.part", spec.file));
        if let Ok(m) = std::fs::metadata(part) {
            if st.state != ModelStatus::Failed {
                st.state = ModelStatus::Partial;
            }
            st.bytes = m.len();
        }
        st
    }

    pub fn models(&self) -> Vec<ModelState> {
        registry::MODELS
            .iter()
            .map(|m| self.model_state(m))
            .collect()
    }

    fn model_by_name(id: &str) -> AppResult<&'static registry::ModelSpec> {
        let id = ModelId::parse(id).ok_or_else(|| AppError::invalid("unknown model"))?;
        Ok(registry::spec(id))
    }

    pub fn download(&self, id: &str, sink: Arc<dyn Sink<ModelEvent>>) -> AppResult<()> {
        let spec = Self::model_by_name(id)?;
        if !cpu::cpu_supported() {
            return Err(AppError::new(
                Code::SpeechUnsupportedCpu,
                "this processor cannot run the local speech engine",
            ));
        }
        if self.model_ready(spec) {
            sink.send(ModelEvent::Done {
                model: self.model_state(spec),
            });
            return Ok(());
        }
        let mut downloads = lock(&self.downloads);
        if downloads.values().any(|d| {
            matches!(
                *lock(&d.status),
                ModelStatus::Downloading | ModelStatus::Verifying
            )
        }) {
            return Err(AppError::new(Code::JobBusy, "a model is downloading"));
        }
        let dir = self.cfg.paths.models_dir();
        std::fs::create_dir_all(&dir)?;
        let have = std::fs::metadata(dir.join(format!("{}.part", spec.file)))
            .map(|m| m.len())
            .unwrap_or(0)
            .min(spec.size);
        download::check_space(&dir, spec.size - have)?;
        let job = Arc::new(DownloadJob {
            sink: SinkSlot::new(sink),
            cancel: AtomicBool::new(false),
            status: Mutex::new(ModelStatus::Downloading),
            bytes: AtomicU64::new(have),
            error: Mutex::new(None),
            thread: Mutex::new(None),
        });
        downloads.insert(spec.id, job.clone());
        drop(downloads);
        let fetch = download::Fetch {
            url: spec.url(),
            file: spec.file.to_string(),
            size: spec.size,
            sha256: spec.sha256.to_string(),
            dir,
            backoff: Duration::from_secs(2),
        };
        let agent = tramado_net::http::download_agent(&self.cfg.version);
        let j = job.clone();
        let speeds = self.speeds.clone();
        let t = std::thread::Builder::new()
            .name("tramado-model-download".into())
            .spawn(move || {
                let _awake = awake::Awake::hold("Tramado is downloading a speech model");
                let r = download::fetch(&agent, &fetch, &j.cancel, &|e| {
                    match &e {
                        ModelEvent::Progress { done, .. } => {
                            j.bytes.store(*done, Ordering::Relaxed)
                        }
                        ModelEvent::Verifying => *lock(&j.status) = ModelStatus::Verifying,
                        _ => {}
                    }
                    j.sink.send(e);
                });
                match r {
                    Ok(_) => {
                        *lock(&j.status) = ModelStatus::Ready;
                        j.bytes.store(spec.size, Ordering::Relaxed);
                        j.sink.send(ModelEvent::Done {
                            model: ModelState {
                                id: spec.id,
                                file: spec.file.to_string(),
                                size: spec.size,
                                sha256: spec.sha256.to_string(),
                                tier: spec.tier,
                                recommended: spec.id == registry::DEFAULT_MODEL,
                                state: ModelStatus::Ready,
                                bytes: spec.size,
                                error: None,
                                speed_rt: lock(&speeds).get(&spec.id).copied(),
                            },
                        });
                    }
                    Err(e) if e.code() == Code::Cancelled => {
                        *lock(&j.status) = ModelStatus::Partial;
                        j.sink.send(ModelEvent::Cancelled);
                    }
                    Err(e) => {
                        *lock(&j.status) = ModelStatus::Failed;
                        *lock(&j.error) = Some(e.code());
                        j.sink.send(ModelEvent::Failed {
                            code: e.code(),
                            message: e.to_string(),
                        });
                    }
                }
            })?;
        *lock(&job.thread) = Some(t);
        Ok(())
    }

    pub fn attach_download(&self, id: &str, sink: Arc<dyn Sink<ModelEvent>>) -> bool {
        let Some(id) = ModelId::parse(id) else {
            return false;
        };
        match lock(&self.downloads).get(&id) {
            Some(d)
                if matches!(
                    *lock(&d.status),
                    ModelStatus::Downloading | ModelStatus::Verifying
                ) =>
            {
                d.sink.replace(sink);
                true
            }
            _ => false,
        }
    }

    /// Stops a download; the `.part` stays for next time.
    pub fn cancel_download(&self, id: &str) {
        if let Some(id) = ModelId::parse(id) {
            if let Some(d) = lock(&self.downloads).get(&id) {
                d.cancel.store(true, Ordering::Relaxed);
            }
        }
    }

    fn model_in_use(&self, id: ModelId) -> bool {
        lock(&self.jobs)
            .values()
            .any(|j| j.is_running() && j.model() == Some(id))
    }

    pub fn delete_model(&self, id: &str) -> AppResult<()> {
        let spec = Self::model_by_name(id)?;
        if self.model_in_use(spec.id) {
            return Err(AppError::new(
                Code::JobBusy,
                "a transcription uses this model",
            ));
        }
        if let Some(d) = lock(&self.downloads).remove(&spec.id) {
            d.cancel.store(true, Ordering::Relaxed);
            if let Some(t) = lock(&d.thread).take() {
                let _ = t.join();
            }
        }
        let dir = self.cfg.paths.models_dir();
        files::remove_file_if_exists(&dir.join(spec.file))?;
        files::remove_file_if_exists(&dir.join(format!("{}.part", spec.file)))?;
        Ok(())
    }

    /// Installs a model file the person picked (offline: a USB stick), verified by hash.
    pub fn import_model(&self, id: &str, file: &Path) -> AppResult<ModelState> {
        let spec = Self::model_by_name(id)?;
        download::import(
            file,
            &download::Fetch {
                url: String::new(),
                file: spec.file.to_string(),
                size: spec.size,
                sha256: spec.sha256.to_string(),
                dir: self.cfg.paths.models_dir(),
                backoff: Duration::ZERO,
            },
        )?;
        Ok(self.model_state(spec))
    }

    pub fn devices(&self) -> AudioDevices {
        capture::devices()
    }

    fn recording_active(&self) -> bool {
        lock(&self.recorder)
            .as_ref()
            .is_some_and(|r| !r.has_stopped())
    }

    /// The live input level outside a recording (the microphone test, 10 Hz). `JOB_BUSY` while
    /// recording.
    pub fn meter_start(&self, req: MeterRequest, sink: Arc<dyn Sink<MeterEvent>>) -> AppResult<()> {
        if self.recording_active() {
            return Err(AppError::new(Code::JobBusy, "recording"));
        }
        self.meter_stop();
        let spec = capture::CaptureSpec {
            mic: Some(req.input_device_id.clone()),
            system: req.mode == RecordMode::Online,
        };
        let (cap, rx) = capture::Capture::open(&spec)?;
        let live = cap.live();
        let rates = cap.rates();
        let stop = Arc::new(AtomicBool::new(false));
        let st = stop.clone();
        let online = req.mode == RecordMode::Online;
        let thread = std::thread::Builder::new()
            .name("tramado-meter".into())
            .spawn(move || {
                let mut m = mixer::Mixer::new(rates, mixer::Layout::Mic);
                let started = std::time::Instant::now();
                let mut last = std::time::Instant::now();
                while !st.load(Ordering::Relaxed) {
                    let now_ms = started.elapsed().as_millis() as u64;
                    match rx.recv_timeout(Duration::from_millis(50)) {
                        Ok((t, b)) => m.push(t, &b, &live[t], now_ms),
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(_) => {}
                    }
                    m.hold(0);
                    if last.elapsed() >= Duration::from_millis(100) {
                        last = std::time::Instant::now();
                        for t in [capture::MIC, capture::SYSTEM] {
                            if rates[t].is_none() {
                                live[t].quiet(now_ms);
                            }
                        }
                        sink.send(MeterEvent::Level {
                            mic: Some(live[capture::MIC].level()),
                            system: online.then(|| live[capture::SYSTEM].level()),
                        });
                    }
                }
            })?;
        *lock(&self.meter) = Some(Meter {
            capture: cap,
            stop,
            thread: Some(thread),
        });
        Ok(())
    }

    pub fn meter_stop(&self) {
        let m = lock(&self.meter).take();
        if let Some(m) = m {
            m.stop();
        }
    }

    pub fn recorder_start(
        &self,
        req: RecorderStartRequest,
        sink: Arc<dyn Sink<RecorderEvent>>,
    ) -> AppResult<RecorderStatus> {
        let mut slot = lock(&self.recorder);
        if slot.as_ref().is_some_and(|r| !r.has_stopped()) {
            return Err(AppError::new(Code::JobBusy, "already recording"));
        }
        // A recording that stopped by itself (a full disk) is closed; its journal is pending.
        if let Some(mut old) = slot.take() {
            let _ = old.stop();
        }
        self.meter_stop();
        let r = recorder::Recorder::start(req, self.journals.clone(), sink)?;
        let status = r.status();
        *slot = Some(r);
        Ok(status)
    }

    pub fn recorder_attach(&self, sink: Arc<dyn Sink<RecorderEvent>>) -> Option<RecorderStatus> {
        let slot = lock(&self.recorder);
        let r = slot.as_ref()?;
        r.attach(sink);
        Some(r.status())
    }

    fn with_recorder<T>(
        &self,
        f: impl FnOnce(&recorder::Recorder) -> AppResult<T>,
    ) -> AppResult<T> {
        let slot = lock(&self.recorder);
        match slot.as_ref() {
            Some(r) if !r.has_stopped() => f(r),
            _ => Err(AppError::not_found("not recording")),
        }
    }

    pub fn recorder_pause(&self) -> AppResult<RecorderStatus> {
        self.with_recorder(|r| r.pause())
    }

    pub fn recorder_resume(&self) -> AppResult<RecorderStatus> {
        self.with_recorder(|r| r.resume())
    }

    pub fn recorder_mark(&self, kind: MarkerKind, note: Option<String>) -> AppResult<Marker> {
        self.with_recorder(|r| r.mark(kind, note))
    }

    pub fn recorder_stop(&self) -> AppResult<FinishedRecording> {
        let r = lock(&self.recorder).take();
        match r {
            Some(mut r) => r.stop(),
            None => Err(AppError::not_found("not recording")),
        }
    }

    fn lecture_written(&self, class_id: &str, lecture_dir: &str) -> bool {
        let p = format!("{}/lecture.json", lecture_dir.trim_end_matches('/'));
        matches!(self.cfg.fs.stat(class_id, &p), Ok(Some(_)))
    }

    /// Recordings not yet published (torn journals are recovered first), and published or
    /// imported audio whose `lecture.json` was not written yet.
    pub fn pending_recordings(&self) -> AppResult<Vec<FinishedRecording>> {
        let active = lock(&self.recorder)
            .as_ref()
            .filter(|r| !r.has_stopped())
            .map(|r| r.recording_id().to_string());
        let running_imports: Vec<String> = lock(&self.imports)
            .iter()
            .filter(|(_, j)| !j.done.load(Ordering::Relaxed))
            .map(|(id, _)| id.clone())
            .collect();
        let mut out = Vec::new();
        for mut j in self.journals.all() {
            if active.as_deref() == Some(j.recording_id.as_str())
                || running_imports.contains(&j.recording_id)
            {
                continue;
            }
            match j.state {
                JournalState::Recording => match self.recover(&mut j) {
                    Ok(()) => out.push(j.finished()),
                    Err(e) => log::warn!("recording {} not recovered: {e}", j.recording_id),
                },
                JournalState::Stopped | JournalState::Recovered => out.push(j.finished()),
                JournalState::Published => {
                    let dir = j.lecture_dir.clone().unwrap_or_default();
                    if self.lecture_written(&j.class_id, &dir) {
                        let private = j
                            .audio
                            .as_ref()
                            .is_some_and(|a| matches!(a.source, AudioSource::Private { .. }));
                        if private {
                            // "Transcript only": the private WebM stays (it is the audio).
                            files::remove_file_if_exists(&self.journals.ogg(&j.recording_id)?)?;
                            files::remove_file_if_exists(&self.journals.json(&j.recording_id)?)?;
                        } else {
                            self.journals.remove(&j.recording_id)?;
                        }
                    } else {
                        out.push(j.finished());
                    }
                }
            }
        }
        Ok(out)
    }

    /// A journal torn by a crash: cut to its last whole page, marked end of stream.
    fn recover(&self, j: &mut Journal) -> AppResult<()> {
        let r = journal::recover(&self.journals.ogg(&j.recording_id)?)?;
        let ms = r.end_granule.saturating_sub(j.preskip as u64) / 48;
        j.recovered_lost_ms = Some(j.ms.saturating_sub(ms));
        j.state = JournalState::Recovered;
        j.ms = ms;
        j.duration_ms = Some(ms);
        self.journals.write(j)
    }

    pub fn publish(&self, req: PublishRequest) -> AppResult<PublishedAudio> {
        if lock(&self.recorder)
            .as_ref()
            .is_some_and(|r| !r.has_stopped() && r.recording_id() == req.recording_id)
        {
            return Err(AppError::new(
                Code::JobBusy,
                "the recording is still running",
            ));
        }
        publish::publish(&self.journals, &self.cfg.fs, &req)
    }

    pub fn discard(&self, recording_id: &str) -> AppResult<()> {
        if !ids::is_ulid(recording_id) {
            return Err(AppError::invalid("not a recording ID"));
        }
        let active = {
            let mut slot = lock(&self.recorder);
            if slot
                .as_ref()
                .is_some_and(|r| r.recording_id() == recording_id)
            {
                slot.take()
            } else {
                None
            }
        };
        if let Some(mut r) = active {
            let _ = r.stop();
        }
        if let Some(j) = lock(&self.imports).get(recording_id) {
            j.cancel.store(true, Ordering::Relaxed);
        }
        let private_audio = self
            .journals
            .read(recording_id)?
            .and_then(|j| j.audio)
            .is_some_and(|a| matches!(a.source, AudioSource::Private { .. }))
            && self
                .journals
                .read(recording_id)?
                .is_some_and(|j| j.state == JournalState::Published);
        if private_audio {
            // A "transcript only" lecture's audio is its private WebM: keep it.
            files::remove_file_if_exists(&self.journals.ogg(recording_id)?)?;
            files::remove_file_if_exists(&self.journals.json(recording_id)?)?;
            return Ok(());
        }
        self.journals.remove(recording_id)
    }

    pub fn import_audio(
        &self,
        req: ImportAudioRequest,
        file: &Path,
        sink: Arc<dyn Sink<ImportEvent>>,
    ) -> AppResult<()> {
        if !ids::is_ulid(&req.recording_id) {
            return Err(AppError::invalid("recordingId is not a ULID"));
        }
        if self.cfg.fs.registry().get(&req.class_id).is_none() {
            return Err(AppError::not_found("no such class"));
        }
        let mut imports = lock(&self.imports);
        if imports.values().any(|j| !j.done.load(Ordering::Relaxed)) {
            return Err(AppError::new(Code::JobBusy, "an import is running"));
        }
        let ext = file
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase());
        // Refuse what cannot be read at once (HE-AAC, not media at all).
        decode::probe(decode::file_source(file)?, ext.as_deref())?;
        let job = Arc::new(ImportJob {
            sink: SinkSlot::new(sink),
            cancel: AtomicBool::new(false),
            done: AtomicBool::new(false),
            thread: Mutex::new(None),
        });
        imports.insert(req.recording_id.clone(), job.clone());
        drop(imports);
        let fs = self.cfg.fs.clone();
        let journals = self.journals.clone();
        let file = file.to_path_buf();
        let j = job.clone();
        let t = std::thread::Builder::new()
            .name("tramado-import".into())
            .spawn(move || {
                let r = run_import(&fs, &journals, &req, &file, &j);
                // Mark the job finished before telling anyone: a caller that reacts to `Done`
                // with `pending_recordings()` must already see this import as pending.
                j.done.store(true, Ordering::SeqCst);
                match r {
                    Ok(audio) => {
                        j.sink.send(ImportEvent::Done { audio });
                    }
                    Err(e) => {
                        j.sink.send(ImportEvent::Failed {
                            code: e.code(),
                            message: e.to_string(),
                        });
                    }
                }
            })?;
        *lock(&job.thread) = Some(t);
        Ok(())
    }

    /// Finished imports whose `lecture.json` was not written yet are also reported by
    /// `pending_recordings()`.
    pub fn attach_import(&self, recording_id: &str, sink: Arc<dyn Sink<ImportEvent>>) -> bool {
        match lock(&self.imports).get(recording_id) {
            Some(j) if !j.done.load(Ordering::Relaxed) => {
                j.sink.replace(sink);
                true
            }
            _ => false,
        }
    }

    /// The bytes of an audio source (class files are confined; private ones are recordings).
    fn source_bytes(&self, source: &AudioSource) -> AppResult<Vec<u8>> {
        match source {
            AudioSource::Class { class_id, path } => self.cfg.fs.read(class_id, path),
            AudioSource::Private { recording_id } => {
                let p = self.journals.webm(recording_id)?;
                files::read_optional(&p)?.ok_or_else(|| AppError::not_found("no such recording"))
            }
        }
    }

    pub fn transcribe_start(
        &self,
        req: TranscribeRequest,
        sink: Arc<dyn Sink<TranscribeEvent>>,
    ) -> AppResult<String> {
        safe_job_id(&req.job_id)?;
        if !ids::is_ulid(&req.lecture_id) {
            return Err(AppError::invalid("lectureId is not a ULID"));
        }
        {
            let mut jobs = lock(&self.jobs);
            if jobs.values().any(|j| j.is_running()) {
                return Err(AppError::new(Code::JobBusy, "a transcription is running"));
            }
            jobs.retain(|_, j| j.summary().state == JobState::Done);
            if jobs.contains_key(&req.job_id) {
                return Err(AppError::conflict("a job with this ID exists"));
            }
        }
        let cpu_ok = cpu::cpu_supported();
        let local = match &req.engine {
            TranscribeEngine::Local { model } => {
                if !cfg!(feature = "local-whisper") || !cpu_ok {
                    return Err(AppError::new(
                        Code::SpeechUnsupportedCpu,
                        "this computer cannot run the local speech engine",
                    ));
                }
                let spec = registry::spec(*model);
                if !self.model_ready(spec) {
                    return Err(AppError::new(
                        Code::ModelNotDownloaded,
                        "download the model first",
                    )
                    .with_data(serde_json::json!({ "modelId": model.as_str() })));
                }
                Some(jobs::LocalEngine {
                    model: *model,
                    path: self.model_path(spec),
                })
            }
            TranscribeEngine::Cloud { model } => {
                if model.trim().is_empty() {
                    return Err(AppError::invalid("no cloud model"));
                }
                None
            }
        };
        let bytes = self.source_bytes(&req.source)?;
        let sha = ids::sha256_hex(&bytes);
        if sha != req.expect_sha256 {
            return Err(AppError::conflict("the audio is not the expected file")
                .with_data(serde_json::json!({ "sha256": sha })));
        }
        let dir = self.cfg.paths.transcribe_dir();
        std::fs::create_dir_all(&dir)?;
        let job = Arc::new(TranscribeJob::new(&req.job_id, &req.lecture_id, sink));
        job.set_model(local.as_ref().map(|l| l.model));
        let state = heartbeat::LectureState {
            lecture_id: req.lecture_id.clone(),
            job_id: req.job_id.clone(),
            started_at: time::instant(time::now_ms()),
            class_id: req.claim.as_ref().map(|c| c.class_id.clone()),
            claim_path: req.claim.as_ref().map(|c| c.path.clone()),
            last_heartbeat_wall_ms: None,
            taken_at_ms: None,
        };
        heartbeat::write_state(&dir, &state)?;
        // A result of an earlier run is replaced.
        files::remove_file_if_exists(&jobs::result_path(&dir, &req.lecture_id))?;
        if let Some(claim) = req.claim.clone() {
            let j = job.clone();
            let hb = heartbeat::Heartbeat::start(
                self.cfg.fs.clone(),
                dir.clone(),
                state,
                claim,
                heartbeat::EVERY,
                Arc::new(move || j.beat()),
            )?;
            job.set_heartbeat(hb);
        }
        let speeds = self.speeds.clone();
        let paths = self.cfg.paths.clone();
        let ctx = jobs::JobContext {
            transcribe_dir: dir,
            stt: self.cfg.stt.clone(),
            vad: self.cfg.paths.vad_path(),
            cpu_ok,
            local,
            speed: Box::new(move |model, rt| {
                let mut s = lock(&speeds);
                s.insert(model, (rt * 100.0).round() / 100.0);
                if let Ok(b) = serde_json::to_vec(&*s) {
                    let _ = files::write_atomic(&speeds_path(&paths), &b);
                }
            }),
        };
        lock(&self.jobs).insert(req.job_id.clone(), job.clone());
        let j = job.clone();
        let id = req.job_id.clone();
        let t = std::thread::Builder::new()
            .name("tramado-transcribe".into())
            .spawn(move || {
                let _awake = awake::Awake::hold("Tramado is transcribing a lecture");
                jobs::run(&ctx, &req, &j, bytes);
            })?;
        job.set_thread(t);
        Ok(id)
    }

    pub fn transcribe_attach(
        &self,
        job_id: &str,
        sink: Arc<dyn Sink<TranscribeEvent>>,
    ) -> Option<JobSummary> {
        let jobs = lock(&self.jobs);
        let j = jobs.get(job_id)?;
        j.attach(sink);
        Some(j.summary())
    }

    pub fn transcribe_cancel(&self, job_id: &str, keep_partial: bool) {
        let j = lock(&self.jobs).get(job_id).cloned();
        if let Some(j) = j {
            j.cancel(keep_partial);
            if !j.is_running() {
                // A finished, untaken result is dropped too (the claim was lost).
                lock(&self.jobs).remove(job_id);
            }
        }
    }

    pub fn jobs(&self) -> Vec<JobSummary> {
        let mut v: Vec<JobSummary> = lock(&self.jobs).values().map(|j| j.summary()).collect();
        v.sort_by(|a, b| a.started_at.cmp(&b.started_at));
        v
    }

    /// The finished result, once; the claim is TS's again (it writes `transcript.*`, then the
    /// claim `done`). The result file is kept 7 days (sync spec §14.5).
    pub fn take_result(&self, job_id: &str) -> AppResult<TranscriptionResult> {
        let j = lock(&self.jobs)
            .get(job_id)
            .cloned()
            .ok_or_else(|| AppError::not_found("no such job"))?;
        let s = j.summary();
        if s.state != JobState::Done || !s.result_ready {
            return Err(AppError::not_found("the result is not ready"));
        }
        let dir = self.cfg.paths.transcribe_dir();
        let b = files::read_optional(&jobs::result_path(&dir, &j.lecture_id))?
            .ok_or_else(|| AppError::not_found("the result file is gone"))?;
        let r: TranscriptionResult = serde_json::from_slice(&b)?;
        j.stop_heartbeat();
        if let Some(mut st) = heartbeat::read_state(&dir, &j.lecture_id) {
            st.taken_at_ms = Some(time::now_ms());
            heartbeat::write_state(&dir, &st)?;
        }
        lock(&self.jobs).remove(job_id);
        Ok(r)
    }

    pub fn peaks(&self, source: &AudioSource, buckets: u32) -> AppResult<Vec<u8>> {
        peaks::check_buckets(buckets)?;
        let bytes = self.source_bytes(source)?;
        let sha = ids::sha256_hex(&bytes);
        let cache = peaks::cache_path(&self.cfg.paths.cache, &sha, buckets);
        if let Some(p) = peaks::read_cached(&cache) {
            if p.len() == buckets as usize {
                return Ok(p);
            }
        }
        let p = peaks::compute(decode::bytes_source(bytes), Some("webm"), buckets, &|| {
            false
        })?;
        if let Err(e) = peaks::write_cached(&cache, &p) {
            log::warn!("peaks not cached: {e}");
        }
        Ok(p)
    }

    /// Cancels the job (keeping its partial result) and stops the recorder (finalising the
    /// journal), the meter, downloads and imports.
    pub fn shutdown(&self) {
        let jobs: Vec<Arc<TranscribeJob>> = lock(&self.jobs).values().cloned().collect();
        for j in &jobs {
            if j.is_running() {
                j.cancel(true);
            } else {
                j.stop_heartbeat();
            }
        }
        for j in &jobs {
            j.join();
        }
        let r = lock(&self.recorder).take();
        if let Some(mut r) = r {
            let _ = r.stop();
        }
        self.meter_stop();
        for d in lock(&self.downloads).values() {
            d.cancel.store(true, Ordering::Relaxed);
        }
        for i in lock(&self.imports).values() {
            i.cancel.store(true, Ordering::Relaxed);
        }
    }
}

fn run_import(
    fs: &ClassFs,
    journals: &JournalPaths,
    req: &ImportAudioRequest,
    file: &Path,
    job: &ImportJob,
) -> AppResult<PublishedAudio> {
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "audio".into());
    let im = import::to_webm(file, &|| job.cancel.load(Ordering::Relaxed), &|f| {
        job.sink.send(ImportEvent::Progress { done: f * 0.95 });
    })?;
    let dir = req.lecture_dir.trim_end_matches('/').to_string();
    let dest = publish::audio_path(&dir);
    let stamp = fs.stage_and_place(
        &req.class_id,
        &dest,
        |f| {
            use std::io::Write;
            f.write_all(&im.webm)?;
            Ok(())
        },
        true,
    )?;
    if req.keep_video && im.had_video {
        let video = format!("{dir}/{name}");
        fs.stage_and_place(
            &req.class_id,
            &video,
            |f| {
                let mut src = std::fs::File::open(file)?;
                std::io::copy(&mut src, f)?;
                Ok(())
            },
            false,
        )?;
    }
    let audio = PublishedAudio {
        source: AudioSource::Class {
            class_id: req.class_id.clone(),
            path: dest,
        },
        size: stamp.size,
        sha256: stamp.sha256.unwrap_or_else(|| ids::sha256_hex(&im.webm)),
        duration_ms: im.duration_ms,
        channels: 1,
        bitrate: import::BITRATE,
        sample_rate: SAMPLE_RATE,
    };
    let now = time::now_ms();
    let title = Path::new(&name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.clone());
    journals.write(&Journal {
        format: journal::JOURNAL_FORMAT.into(),
        version: 1,
        kind: JournalKind::Import,
        recording_id: req.recording_id.clone(),
        class_id: req.class_id.clone(),
        title,
        mode: RecordMode::Room,
        language: "auto".into(),
        started_at: time::instant(now),
        started_at_ms: now,
        channels: 1,
        bitrate: import::BITRATE,
        preskip: 312,
        marker_offset_ms: 0,
        speakers: recorder::speakers(mixer::Layout::Mic),
        pauses: Vec::new(),
        markers: Vec::new(),
        state: JournalState::Published,
        ms: im.duration_ms,
        duration_ms: Some(im.duration_ms),
        recovered_lost_ms: None,
        lecture_dir: Some(dir.clone()),
        audio: Some(audio.clone()),
        import: Some(ImportInfo {
            file_name: name.clone(),
            mime: import::mime_for(&name).into(),
            had_video: im.had_video,
            lecture_dir: dir,
        }),
    })?;
    Ok(audio)
}
