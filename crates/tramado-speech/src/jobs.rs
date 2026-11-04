// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Transcription jobs (architecture §5.4, §6.8, D-7): one at a time, on a named thread that
//! holds the computer awake; events go to a channel that a reloaded webview can replace
//! (`*_attach`); the claim heartbeat runs beside it. Local jobs persist each finished window to
//! `data/transcribe/<lectureId>.partial.json` (resume after a crash, a sleep or a lost claim);
//! the finished result goes to `data/transcribe/<lectureId>.result.json`, kept 7 days after
//! it is taken (sync spec §14.5).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::{files, time};

use crate::decode::{self, Channels};
use crate::heartbeat::{Beat, Heartbeat, LectureState};
use crate::samples::Track16;
use crate::types::{
    ChannelMode, EngineKind, JobState, JobSummary, ModelId, ResultEngine, ResultTrack, Segment,
    Speaker, TranscribeEngine, TranscribeEvent, TranscribePhase, TranscribeRequest,
    TranscriptionResult,
};
use crate::vad::{self, Vad};
use crate::{Sink, SttTransport, SAMPLE_RATE};

/// A job's channel, replaceable when the webview reloads.
pub struct SinkSlot<E> {
    inner: Mutex<Arc<dyn Sink<E>>>,
}

impl<E> SinkSlot<E> {
    pub fn new(sink: Arc<dyn Sink<E>>) -> Self {
        SinkSlot {
            inner: Mutex::new(sink),
        }
    }

    /// False when the channel is gone; the job goes on.
    pub fn send(&self, e: E) -> bool {
        let sink = self.inner.lock().unwrap_or_else(|e| e.into_inner()).clone();
        sink.send(e)
    }

    pub fn replace(&self, sink: Arc<dyn Sink<E>>) {
        *self.inner.lock().unwrap_or_else(|e| e.into_inner()) = sink;
    }
}

/// Progress events at most once a second (the claim gets them at each heartbeat).
const PROGRESS_EVERY: Duration = Duration::from_secs(1);
/// Results are kept this long after they were taken.
const KEEP_RESULTS: Duration = Duration::from_secs(7 * 24 * 3600);
pub const PARTIAL_FORMAT: &str = "tramado.transcribe-partial";

pub fn result_path(dir: &Path, lecture_id: &str) -> PathBuf {
    dir.join(format!("{lecture_id}.result.json"))
}

pub fn partial_path(dir: &Path, lecture_id: &str) -> PathBuf {
    dir.join(format!("{lecture_id}.partial.json"))
}

/// What a resumable job has done so far.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Partial {
    pub format: String,
    pub version: u32,
    pub lecture_id: String,
    pub audio_sha256: String,
    /// `local:<modelId>` or `cloud:<model>`.
    pub engine: String,
    pub channels: ChannelMode,
    pub tracks: Vec<PartialTrack>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialTrack {
    pub speaker: Speaker,
    /// Recording samples done (windows ending at or before this are not redone).
    pub until: u64,
    pub done: bool,
    pub segments: Vec<Segment>,
    pub languages: Vec<String>,
}

fn engine_key(e: &TranscribeEngine) -> String {
    match e {
        TranscribeEngine::Local { model } => format!("local:{}", model.as_str()),
        TranscribeEngine::Cloud { model } => format!("cloud:{model}"),
    }
}

/// The local engine a job runs with (resolved before the job starts).
#[derive(Debug, Clone)]
pub struct LocalEngine {
    pub model: ModelId,
    pub path: PathBuf,
}

/// Everything a job needs from the handle.
pub struct JobContext {
    pub transcribe_dir: PathBuf,
    pub stt: Arc<dyn SttTransport>,
    pub vad: Option<PathBuf>,
    pub cpu_ok: bool,
    pub local: Option<LocalEngine>,
    /// Records × real time for a local model.
    pub speed: Box<dyn Fn(ModelId, f64) + Send + Sync>,
}

pub struct TranscribeJob {
    pub job_id: String,
    pub lecture_id: String,
    summary: Mutex<JobSummary>,
    sink: SinkSlot<TranscribeEvent>,
    cancel: Arc<AtomicBool>,
    keep_partial: AtomicBool,
    heartbeat: Mutex<Option<Heartbeat>>,
    thread: Mutex<Option<JoinHandle<()>>>,
    last_progress: Mutex<Option<Instant>>,
    model: Mutex<Option<ModelId>>,
}

impl TranscribeJob {
    pub fn new(job_id: &str, lecture_id: &str, sink: Arc<dyn Sink<TranscribeEvent>>) -> Self {
        TranscribeJob {
            job_id: job_id.to_string(),
            lecture_id: lecture_id.to_string(),
            summary: Mutex::new(JobSummary {
                job_id: job_id.to_string(),
                lecture_id: lecture_id.to_string(),
                state: JobState::Running,
                progress: 0.0,
                eta_ms: None,
                started_at: time::instant(time::now_ms()),
                error: None,
                result_ready: false,
            }),
            sink: SinkSlot::new(sink),
            cancel: Arc::new(AtomicBool::new(false)),
            keep_partial: AtomicBool::new(true),
            heartbeat: Mutex::new(None),
            thread: Mutex::new(None),
            last_progress: Mutex::new(None),
            model: Mutex::new(None),
        }
    }

    /// The local model this job uses (a model in use cannot be deleted).
    pub fn set_model(&self, m: Option<ModelId>) {
        *self.model.lock().unwrap_or_else(|e| e.into_inner()) = m;
    }

    pub fn model(&self) -> Option<ModelId> {
        *self.model.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A finished job found on disk after a restart (its result is still untaken).
    pub fn restored(state: &LectureState) -> Self {
        let j = TranscribeJob::new(&state.job_id, &state.lecture_id, Arc::new(NoSink));
        if let Ok(mut s) = j.summary.lock() {
            s.state = JobState::Done;
            s.progress = 1.0;
            s.eta_ms = Some(0);
            s.started_at = state.started_at.clone();
            s.result_ready = true;
        }
        j
    }

    pub fn summary(&self) -> JobSummary {
        self.summary
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn is_running(&self) -> bool {
        self.summary().state == JobState::Running
    }

    pub fn attach(&self, sink: Arc<dyn Sink<TranscribeEvent>>) {
        self.sink.replace(sink);
    }

    pub fn set_heartbeat(&self, hb: Heartbeat) {
        *self.heartbeat.lock().unwrap_or_else(|e| e.into_inner()) = Some(hb);
    }

    pub fn set_thread(&self, t: JoinHandle<()>) {
        *self.thread.lock().unwrap_or_else(|e| e.into_inner()) = Some(t);
    }

    /// What the heartbeat writes into the claim.
    pub fn beat(&self) -> Beat {
        let s = self.summary();
        match s.state {
            JobState::Done => Beat::Finished,
            JobState::Failed => Beat::Failed(s.error.unwrap_or(Code::IoError)),
            _ => Beat::Working {
                progress: s.progress,
                eta_ms: s.eta_ms,
            },
        }
    }

    /// Stops the job (keeping or dropping its partial result) and its heartbeat.
    pub fn cancel(&self, keep_partial: bool) {
        self.keep_partial.store(keep_partial, Ordering::Relaxed);
        self.cancel.store(true, Ordering::Relaxed);
        self.stop_heartbeat();
    }

    pub fn stop_heartbeat(&self) {
        if let Some(mut hb) = self
            .heartbeat
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            hb.stop();
        }
    }

    /// Waits for the job's thread (shutdown, tests).
    pub fn join(&self) {
        let t = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(t) = t {
            let _ = t.join();
        }
    }

    fn phase(&self, phase: TranscribePhase) {
        self.sink.send(TranscribeEvent::Phase { phase });
    }

    fn progress(&self, progress: f64, eta_ms: Option<u64>) {
        {
            let mut s = self.summary.lock().unwrap_or_else(|e| e.into_inner());
            s.progress = progress.clamp(0.0, 1.0);
            s.eta_ms = eta_ms;
        }
        let mut last = self.last_progress.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_none_or(|t| t.elapsed() >= PROGRESS_EVERY) {
            *last = Some(Instant::now());
            self.sink.send(TranscribeEvent::Progress {
                progress: progress.clamp(0.0, 1.0),
                eta_ms,
            });
        }
    }

    /// Progress over the whole job, with an estimate from the time spent transcribing.
    fn report(&self, overall: f64, since: Option<Instant>) {
        let eta = since.and_then(|s| {
            (overall >= 0.02).then(|| {
                let el = s.elapsed().as_millis() as f64;
                (el * (1.0 - overall) / overall) as u64
            })
        });
        self.progress(overall, eta);
    }

    fn finish(&self, outcome: AppResult<()>, partial: &Path) {
        match outcome {
            Ok(()) => {
                let summary = {
                    let mut s = self.summary.lock().unwrap_or_else(|e| e.into_inner());
                    s.state = JobState::Done;
                    s.progress = 1.0;
                    s.eta_ms = Some(0);
                    s.result_ready = true;
                    s.clone()
                };
                self.sink.send(TranscribeEvent::Done { summary });
            }
            Err(e) if e.code() == Code::Cancelled => {
                if let Ok(mut s) = self.summary.lock() {
                    s.state = JobState::Cancelled;
                    s.eta_ms = None;
                }
                if !self.keep_partial.load(Ordering::Relaxed) {
                    let _ = files::remove_file_if_exists(partial);
                }
                self.stop_heartbeat();
                self.sink.send(TranscribeEvent::Cancelled);
            }
            Err(e) => {
                log::warn!("transcription {} failed: {e}", self.job_id);
                if let Ok(mut s) = self.summary.lock() {
                    s.state = JobState::Failed;
                    s.error = Some(e.code());
                    s.eta_ms = None;
                }
                if let Some(mut hb) = self
                    .heartbeat
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take()
                {
                    hb.fail(e.code());
                }
                self.sink.send(TranscribeEvent::Failed {
                    code: e.code(),
                    message: e.to_string(),
                });
            }
        }
    }
}

/// A sink nobody listens to (a job restored after a restart, until it is attached).
pub struct NoSink;

impl<E> Sink<E> for NoSink {
    fn send(&self, _e: E) -> bool {
        false
    }
}

fn read_partial(path: &Path, req: &TranscribeRequest) -> Option<Partial> {
    let b = files::read_optional(path).ok()??;
    let p: Partial = serde_json::from_slice(&b).ok()?;
    (p.format == PARTIAL_FORMAT
        && p.lecture_id == req.lecture_id
        && p.audio_sha256 == req.expect_sha256
        && p.engine == engine_key(&req.engine)
        && p.channels == req.channels)
        .then_some(p)
}

fn speakers_for(channels: ChannelMode) -> Vec<Speaker> {
    match channels {
        ChannelMode::Mix => vec![Speaker::Lecture],
        ChannelMode::Split => vec![Speaker::Me, Speaker::Class],
    }
}

fn decode_track(bytes: &[u8], channels: Channels, cancel: &AtomicBool) -> AppResult<Track16> {
    let mut t = Track16::new();
    decode::decode_stream(
        decode::bytes_source(bytes.to_vec()),
        Some("webm"),
        channels,
        &|| cancel.load(Ordering::Relaxed),
        &mut |chunk| {
            t.push(&chunk[0]);
            Ok(())
        },
    )?;
    Ok(t)
}

fn most_common(mut v: Vec<String>) -> Option<String> {
    v.sort();
    let mut best: Option<(usize, String)> = None;
    let mut i = 0;
    while i < v.len() {
        let j = v[i..].iter().take_while(|x| **x == v[i]).count();
        if best.as_ref().is_none_or(|(n, _)| j > *n) {
            best = Some((j, v[i].clone()));
        }
        i += j;
    }
    best.map(|(_, l)| l)
}

/// Runs one transcription to its result file. `bytes` is the audio (its SHA-256 was checked).
pub fn run(ctx: &JobContext, req: &TranscribeRequest, job: &Arc<TranscribeJob>, bytes: Vec<u8>) {
    let partial = partial_path(&ctx.transcribe_dir, &req.lecture_id);
    let outcome = run_inner(ctx, req, job, bytes, &partial);
    job.finish(outcome, &partial);
}

fn run_inner(
    ctx: &JobContext,
    req: &TranscribeRequest,
    job: &Arc<TranscribeJob>,
    bytes: Vec<u8>,
    partial_file: &Path,
) -> AppResult<()> {
    let started = Instant::now();
    let cancel = job.cancel.clone();
    let speakers = speakers_for(req.channels);
    let n = speakers.len();
    let mut partial = req
        .resume
        .then(|| read_partial(partial_file, req))
        .flatten()
        .unwrap_or_else(|| Partial {
            format: PARTIAL_FORMAT.into(),
            version: 1,
            lecture_id: req.lecture_id.clone(),
            audio_sha256: req.expect_sha256.clone(),
            engine: engine_key(&req.engine),
            channels: req.channels,
            tracks: speakers
                .iter()
                .map(|s| PartialTrack {
                    speaker: *s,
                    until: 0,
                    done: false,
                    segments: Vec::new(),
                    languages: Vec::new(),
                })
                .collect(),
        });
    let language = crate::langs::request_language(&req.language);
    let vad = match &ctx.vad {
        Some(p) if ctx.cpu_ok && cfg!(feature = "local-whisper") => Vad::Silero(p.clone()),
        _ => Vad::Loudness,
    };
    let channel_of = |i: usize| match req.channels {
        ChannelMode::Mix => Channels::Mix,
        ChannelMode::Split => Channels::One(i),
    };
    let mut duration_ms = 0u64;
    let transcribing_since = Mutex::new(None::<Instant>);
    let report = |overall: f64| {
        let since = *transcribing_since.lock().unwrap_or_else(|e| e.into_inner());
        job.report(overall, since);
    };
    let engine: ResultEngine;
    match &req.engine {
        TranscribeEngine::Local { model } => {
            #[cfg(feature = "local-whisper")]
            {
                let local = ctx
                    .local
                    .as_ref()
                    .ok_or_else(|| AppError::new(Code::ModelNotDownloaded, "no model"))?;
                let spec = crate::registry::spec(*model);
                job.phase(TranscribePhase::Checking);
                let whisper = crate::whisper::Engine::load(&local.path, spec.dtw)?;
                for i in 0..n {
                    if cancel.load(Ordering::Relaxed) {
                        return Err(AppError::new(Code::Cancelled, "stopped"));
                    }
                    job.phase(TranscribePhase::Decoding);
                    let track = decode_track(&bytes, channel_of(i), &cancel)?;
                    duration_ms = duration_ms.max(track.duration_ms());
                    if partial.tracks[i].done {
                        report((i + 1) as f64 / n as f64);
                        continue;
                    }
                    job.phase(TranscribePhase::Vad);
                    let stretches =
                        vad::stretches(&vad, &track, &|| cancel.load(Ordering::Relaxed))?;
                    job.phase(TranscribePhase::Transcribing);
                    transcribing_since
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get_or_insert_with(Instant::now);
                    let tj = crate::whisper::TrackJob {
                        track: &track,
                        stretches: &stretches,
                        language: language.as_deref(),
                        initial_prompt: req.initial_prompt.as_deref(),
                        cancel: &cancel,
                        resume_after: partial.tracks[i].until as usize,
                    };
                    let progress: Arc<dyn Fn(f64) + Send + Sync> = {
                        let base = i as f64;
                        let nn = n as f64;
                        let since = *transcribing_since.lock().unwrap_or_else(|e| e.into_inner());
                        let j = job.clone();
                        Arc::new(move |p: f64| j.report((base + p) / nn, since))
                    };
                    whisper.run(&tj, progress, &mut |w| {
                        let t = &mut partial.tracks[i];
                        t.segments.extend(w.segments);
                        t.until = w.until as u64;
                        t.languages.extend(w.language);
                        files::write_atomic(partial_file, &serde_json::to_vec(&partial)?)
                    })?;
                    partial.tracks[i].done = true;
                    partial.tracks[i].until = track.len() as u64;
                    files::write_atomic(partial_file, &serde_json::to_vec(&partial)?)?;
                }
                let elapsed = started.elapsed().as_millis().max(1) as f64;
                (ctx.speed)(*model, duration_ms as f64 / elapsed);
                engine = ResultEngine {
                    kind: EngineKind::Local,
                    name: "whisper.cpp".into(),
                    version: Some(crate::whisper::VERSION.into()),
                    model: Some(spec.stem().into()),
                    model_sha256: Some(spec.sha256.into()),
                    vad: vad.name().map(str::to_string),
                };
            }
            #[cfg(not(feature = "local-whisper"))]
            {
                let _ = (model, &started, &mut partial);
                return Err(AppError::new(
                    Code::SpeechUnsupportedCpu,
                    "this build has no local speech engine",
                ));
            }
        }
        TranscribeEngine::Cloud { model } => {
            job.phase(TranscribePhase::Decoding);
            let mut tracks = Vec::with_capacity(n);
            for i in 0..n {
                let t = decode_track(&bytes, channel_of(i), &cancel)?;
                duration_ms = duration_ms.max(t.duration_ms());
                tracks.push(t);
            }
            job.phase(TranscribePhase::Vad);
            let mut with_speech = Vec::with_capacity(n);
            for t in &tracks {
                let s = vad::stretches(&vad, t, &|| cancel.load(Ordering::Relaxed))?;
                with_speech.push((t, s));
            }
            job.phase(TranscribePhase::Uploading);
            *transcribing_since.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
            let remote = crate::remote::Remote {
                stt: ctx.stt.as_ref(),
                model,
                prompt: req.initial_prompt.as_deref(),
                backoff: Duration::from_secs(2),
            };
            let out = remote.run(&with_speech, language.as_deref(), &cancel, &report)?;
            for (i, (segs, lang)) in out.into_iter().enumerate() {
                partial.tracks[i].segments = segs;
                partial.tracks[i].languages.extend(lang);
                partial.tracks[i].done = true;
            }
            engine = ResultEngine {
                kind: EngineKind::Cloud,
                name: "openrouter".into(),
                version: None,
                model: Some(model.clone()),
                model_sha256: None,
                vad: vad.name().map(str::to_string),
            };
        }
    }
    let detected = most_common(
        partial
            .tracks
            .iter()
            .flat_map(|t| t.languages.clone())
            .collect(),
    );
    let result = TranscriptionResult {
        lecture_id: req.lecture_id.clone(),
        duration_ms,
        language: if req.language.eq_ignore_ascii_case("auto") {
            detected.unwrap_or_else(|| "und".into())
        } else {
            req.language.clone()
        },
        engine,
        tracks: partial
            .tracks
            .iter()
            .map(|t| {
                let mut segments = t.segments.clone();
                segments.sort_by_key(|s| s.start_ms);
                ResultTrack {
                    speaker: t.speaker,
                    segments,
                }
            })
            .collect(),
    };
    files::write_atomic(
        &result_path(&ctx.transcribe_dir, &req.lecture_id),
        &serde_json::to_vec(&result)?,
    )?;
    let _ = files::remove_file_if_exists(partial_file);
    Ok(())
}

/// Removes result files taken more than 7 days ago (and their state files).
pub fn sweep(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let now = time::now_ms();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        if id.contains('.') {
            continue;
        }
        let Some(st) = crate::heartbeat::read_state(dir, id) else {
            continue;
        };
        if st
            .taken_at_ms
            .is_some_and(|t| now.saturating_sub(t) > KEEP_RESULTS.as_millis() as u64)
        {
            let _ = files::remove_file_if_exists(&result_path(dir, id));
            let _ = files::remove_file_if_exists(&e.path());
        }
    }
}

/// Finished, untaken jobs found on disk (after a restart).
pub fn restore(dir: &Path) -> HashMap<String, Arc<TranscribeJob>> {
    let mut out = HashMap::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        if id.contains('.') {
            continue;
        }
        let Some(st) = crate::heartbeat::read_state(dir, id) else {
            continue;
        };
        if st.taken_at_ms.is_none() && result_path(dir, id).is_file() {
            out.insert(st.job_id.clone(), Arc::new(TranscribeJob::restored(&st)));
        }
    }
    out
}

/// The samples per second everything here runs at (re-exported for callers' arithmetic).
pub const RATE: u32 = SAMPLE_RATE;
