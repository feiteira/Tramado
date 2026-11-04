// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! A recording in progress (audio-pipeline §4): devices (capture.rs) → mixer (16 kHz, pause-
//! aware clock) → Opus (60 ms packets) → the Ogg journal in `data/recordings/` (a page a
//! second, synced every 5 s). Nothing crosses IPC but status (10 Hz), warnings and markers.
//! Markers are stamped with **audio** time, so they stay right across pauses; the reflex offset
//! moves them back ("it was just said", audio-pipeline §4.5).

use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::{ids, time};

use crate::awake::Awake;
use crate::capture::{Capture, CaptureSpec, TrackLive, MIC, SYSTEM};
use crate::encode::{self, FrameEncoder};
use crate::jobs::SinkSlot;
use crate::journal::{self, Journal, JournalKind, JournalPaths, JournalState, OggWriter};
use crate::mixer::{Clock, Layout, Mixer};
use crate::types::{
    FinishedRecording, Marker, MarkerKind, Pause, RecordMode, RecorderEvent, RecorderStartRequest,
    RecorderState, RecorderStatus, RecorderWarning, Speaker, SpeakerTrack, StopReason, Tracks,
};
use crate::{Sink, SAMPLE_RATE};

/// Status events: 10 Hz.
const STATUS_EVERY: Duration = Duration::from_millis(100);
/// The journal's metadata and the free space: every 10 s.
const JOURNAL_EVERY: Duration = Duration::from_secs(10);
/// The Ogg file is synced to disk this often (a power cut loses about this much).
const SYNC_EVERY: Duration = Duration::from_secs(5);
/// "No sound" after this much silence on the microphone.
const SILENT_WARN_MS: u64 = 15_000;
/// Warn below this much free disk (about 18 h of audio).
const LOW_DISK: u64 = 200 * 1024 * 1024;
/// Stop below this much (the journal must still be closed properly).
const STOP_DISK: u64 = 20 * 1024 * 1024;
/// Refuse to start below this much.
const START_DISK: u64 = 50 * 1024 * 1024;

/// What recording mode and microphone choice record.
pub fn layout(mode: RecordMode, include_mic: bool) -> Layout {
    match (mode, include_mic) {
        (RecordMode::Room, _) => Layout::Mic,
        (RecordMode::Online, true) => Layout::Stereo,
        (RecordMode::Online, false) => Layout::System,
    }
}

/// `lecture.json` `channels` for a layout (folder spec §8.6).
pub fn speakers(l: Layout) -> Vec<SpeakerTrack> {
    match l {
        Layout::Stereo => vec![
            SpeakerTrack {
                index: 0,
                speaker: Speaker::Me,
            },
            SpeakerTrack {
                index: 1,
                speaker: Speaker::Class,
            },
        ],
        _ => vec![SpeakerTrack {
            index: 0,
            speaker: Speaker::Lecture,
        }],
    }
}

fn free_space(dir: &std::path::Path) -> Option<u64> {
    fs4::available_space(dir).ok()
}

#[derive(Default)]
struct Control {
    paused: bool,
    stop: bool,
    /// The pause in progress: audio ms and wall time it began.
    pause_from: Option<(u64, u64)>,
}

struct Shared {
    req: RecorderStartRequest,
    layout: Layout,
    live: Arc<[TrackLive; 2]>,
    sink: SinkSlot<RecorderEvent>,
    control: Mutex<Control>,
    /// Real samples per channel handed to the encoder: the audio time.
    frames: AtomicU64,
    bytes: Arc<AtomicU64>,
    disk_free: AtomicU64,
    journal: Mutex<Journal>,
    journals: JournalPaths,
    stopping: AtomicBool,
}

impl Shared {
    fn audio_ms(&self) -> u64 {
        self.frames.load(Ordering::Relaxed) * 1000 / SAMPLE_RATE as u64
    }

    fn state(&self) -> RecorderState {
        if self.stopping.load(Ordering::Relaxed) {
            return RecorderState::Stopping;
        }
        let c = self.control.lock().unwrap_or_else(|e| e.into_inner());
        if c.paused {
            RecorderState::Paused
        } else {
            RecorderState::Recording
        }
    }

    fn status(&self) -> RecorderStatus {
        let level = |t: usize| {
            let used = match self.layout {
                Layout::Mic => t == MIC,
                Layout::System => t == SYSTEM,
                Layout::Stereo => true,
            };
            used.then(|| self.live[t].level())
        };
        let disk = self.disk_free.load(Ordering::Relaxed);
        RecorderStatus {
            recording_id: self.req.recording_id.clone(),
            class_id: self.req.class_id.clone(),
            state: self.state(),
            ms: self.audio_ms(),
            tracks: Tracks {
                mic: level(MIC),
                system: level(SYSTEM),
            },
            bytes_written: self.bytes.load(Ordering::Relaxed),
            disk_free: (disk != u64::MAX).then_some(disk),
            markers: self
                .journal
                .lock()
                .map(|j| j.markers.len() as u32)
                .unwrap_or(0),
        }
    }

    fn write_journal(&self, f: impl FnOnce(&mut Journal)) -> AppResult<()> {
        let mut j = self.journal.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut j);
        self.journals.write(&j)
    }
}

pub struct Recorder {
    shared: Arc<Shared>,
    capture: Option<Capture>,
    thread: Option<JoinHandle<AppResult<FinishedRecording>>>,
    sync_stop: Arc<AtomicBool>,
    sync_thread: Option<JoinHandle<()>>,
    finished: Option<AppResult<FinishedRecording>>,
    _awake: Awake,
}

impl Recorder {
    pub fn start(
        req: RecorderStartRequest,
        journals: JournalPaths,
        sink: Arc<dyn Sink<RecorderEvent>>,
    ) -> AppResult<Recorder> {
        if !ids::is_ulid(&req.recording_id) {
            return Err(AppError::invalid("recordingId is not a ULID"));
        }
        if !ids::is_class_id(&req.class_id) {
            return Err(AppError::invalid("not a class ID"));
        }
        if !encode::valid_bitrate(req.bitrate) {
            return Err(AppError::invalid("bitrate must be 16000, 24000 or 32000"));
        }
        let ogg_path = journals.ogg(&req.recording_id)?;
        if ogg_path.exists() || journals.json(&req.recording_id)?.exists() {
            return Err(AppError::conflict("a recording with this ID exists"));
        }
        std::fs::create_dir_all(&journals.dir)?;
        let free = free_space(&journals.dir);
        if free.is_some_and(|f| f < START_DISK) {
            return Err(AppError::new(Code::DiskFull, "not enough free space to record")
                .with_data(serde_json::json!({ "needBytes": START_DISK })));
        }
        let layout = layout(req.mode, req.include_mic);
        let spec = match req.mode {
            RecordMode::Room => CaptureSpec {
                mic: Some(req.input_device_id.clone()),
                system: false,
            },
            RecordMode::Online => CaptureSpec {
                mic: req.include_mic.then(|| req.input_device_id.clone()),
                system: true,
            },
        };
        let (mut capture, rx) = Capture::open(&spec)?;
        // In an online class without me the system track is the recording: without it there is
        // nothing to record.
        if layout == Layout::System && capture.rates()[SYSTEM].is_none() {
            capture.stop();
            return Err(AppError::new(
                Code::SpeechNoSystemAudio,
                "what the computer plays cannot be recorded here",
            ));
        }
        let channels = layout.channels();
        let enc = FrameEncoder::new(channels, req.bitrate)?;
        let now_ms = time::now_ms();
        let started_at = time::instant(now_ms);
        let tags = vec![
            format!("TITLE={}", req.title),
            format!("TRAMADO_RECORDING_ID={}", req.recording_id),
            format!("DATE={started_at}"),
        ];
        let ogg = OggWriter::create(
            &ogg_path,
            encode::opus_head(channels as u8, enc.preskip48()),
            encode::opus_tags(&tags),
        )?;
        let journal = Journal {
            format: journal::JOURNAL_FORMAT.into(),
            version: 1,
            kind: JournalKind::Recording,
            recording_id: req.recording_id.clone(),
            class_id: req.class_id.clone(),
            title: req.title.clone(),
            mode: req.mode,
            language: req.language.clone(),
            started_at,
            started_at_ms: now_ms,
            channels: channels as u8,
            bitrate: req.bitrate,
            preskip: enc.preskip48(),
            marker_offset_ms: req.marker_offset_ms,
            speakers: speakers(layout),
            pauses: Vec::new(),
            markers: Vec::new(),
            state: JournalState::Recording,
            ms: 0,
            duration_ms: None,
            recovered_lost_ms: None,
            lecture_dir: None,
            audio: None,
            import: None,
        };
        journals.write(&journal)?;
        let shared = Arc::new(Shared {
            req,
            layout,
            live: capture.live(),
            sink: SinkSlot::new(sink),
            control: Mutex::new(Control::default()),
            frames: AtomicU64::new(0),
            bytes: ogg.written(),
            disk_free: AtomicU64::new(free.unwrap_or(u64::MAX)),
            journal: Mutex::new(journal),
            journals,
            stopping: AtomicBool::new(false),
        });
        let sync_stop = Arc::new(AtomicBool::new(false));
        let sync_file = ogg.sync_handle()?;
        let ss = sync_stop.clone();
        let sync_thread = std::thread::Builder::new()
            .name("tramado-fsync".into())
            .spawn(move || sync_loop(sync_file, ss))?;
        let sh = shared.clone();
        let rates = capture.rates();
        let thread = std::thread::Builder::new()
            .name("tramado-recorder".into())
            .spawn(move || run(sh, rx, rates, enc, ogg, ogg_path))?;
        Ok(Recorder {
            shared,
            capture: Some(capture),
            thread: Some(thread),
            sync_stop,
            sync_thread: Some(sync_thread),
            finished: None,
            _awake: Awake::hold("Tramado is recording a lecture"),
        })
    }

    pub fn recording_id(&self) -> &str {
        &self.shared.req.recording_id
    }

    pub fn status(&self) -> RecorderStatus {
        self.shared.status()
    }

    /// Replaces the event channel (the webview reloaded, D-7).
    pub fn attach(&self, sink: Arc<dyn Sink<RecorderEvent>>) {
        self.shared.sink.replace(sink);
    }

    /// True once the recording stopped by itself (an error or a full disk).
    pub fn has_stopped(&self) -> bool {
        self.thread.as_ref().is_some_and(|t| t.is_finished())
    }

    pub fn pause(&self) -> AppResult<RecorderStatus> {
        {
            let mut c = self.shared.control.lock().unwrap_or_else(|e| e.into_inner());
            if !c.paused {
                c.paused = true;
                c.pause_from = Some((self.shared.audio_ms(), time::now_ms()));
            }
        }
        Ok(self.status())
    }

    pub fn resume(&self) -> AppResult<RecorderStatus> {
        let pause = {
            let mut c = self.shared.control.lock().unwrap_or_else(|e| e.into_inner());
            c.paused = false;
            c.pause_from.take()
        };
        if let Some((at_ms, from)) = pause {
            self.shared.write_journal(|j| {
                j.pauses.push(Pause {
                    at_ms,
                    wall_from: time::instant(from),
                    wall_to: time::instant(time::now_ms()),
                })
            })?;
        }
        Ok(self.status())
    }

    pub fn mark(&self, kind: MarkerKind, note: Option<String>) -> AppResult<Marker> {
        let raw_ms = self.shared.audio_ms();
        let note = note
            .map(|n| n.trim().chars().take(500).collect::<String>())
            .filter(|n| !n.is_empty());
        let m = Marker {
            id: ids::new_ulid(time::now_ms()),
            at_ms: raw_ms.saturating_sub(self.shared.req.marker_offset_ms),
            raw_ms,
            kind,
            note,
        };
        let mm = m.clone();
        self.shared.write_journal(|j| j.markers.push(mm))?;
        self.shared
            .sink
            .send(RecorderEvent::Marker { marker: m.clone() });
        Ok(m)
    }

    fn finish(&mut self) -> AppResult<FinishedRecording> {
        if let Some(done) = &self.finished {
            return done.clone_result();
        }
        self.shared.stopping.store(true, Ordering::Relaxed);
        {
            let mut c = self.shared.control.lock().unwrap_or_else(|e| e.into_inner());
            c.stop = true;
        }
        if let Some(mut cap) = self.capture.take() {
            cap.stop();
        }
        let result = match self.thread.take() {
            Some(t) => t
                .join()
                .unwrap_or_else(|_| Err(AppError::new(Code::IoError, "the recorder stopped"))),
            None => Err(AppError::not_found("no recording")),
        };
        self.sync_stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.sync_thread.take() {
            let _ = t.join();
        }
        self.finished = Some(result.clone_result());
        result
    }

    /// Stops recording: the journal is closed (end of stream) and kept until published or
    /// discarded.
    pub fn stop(&mut self) -> AppResult<FinishedRecording> {
        let stopped_by_itself = self.has_stopped();
        let r = self.finish();
        if !stopped_by_itself && r.is_ok() {
            self.shared.sink.send(RecorderEvent::Stopped {
                reason: StopReason::User,
                code: None,
            });
        }
        r
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

trait CloneResult {
    fn clone_result(&self) -> AppResult<FinishedRecording>;
}

impl CloneResult for AppResult<FinishedRecording> {
    fn clone_result(&self) -> AppResult<FinishedRecording> {
        match self {
            Ok(f) => Ok(f.clone()),
            Err(e) => Err(AppError::new(e.code(), e.to_string())),
        }
    }
}

fn sync_loop(file: File, stop: Arc<AtomicBool>) {
    let mut last = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(200));
        if last.elapsed() >= SYNC_EVERY {
            last = Instant::now();
            if let Err(e) = file.sync_data() {
                log::warn!("recording journal sync failed: {e}");
            }
        }
    }
    let _ = file.sync_data();
}

/// Which warnings were already sent (each once until its cause goes away).
#[derive(Default)]
struct Warned {
    silent: bool,
    lost: bool,
    disk: bool,
    battery: bool,
}

fn run(
    sh: Arc<Shared>,
    rx: mpsc::Receiver<(usize, Vec<f32>)>,
    rates: [Option<u32>; 2],
    mut enc: FrameEncoder,
    mut ogg: OggWriter,
    ogg_path: PathBuf,
) -> AppResult<FinishedRecording> {
    let mut mixer = Mixer::new(rates, sh.layout);
    let mut clock = Clock::start(Instant::now());
    let mut out: Vec<f32> = Vec::new();
    let mut last_status = Instant::now();
    let mut last_journal = Instant::now();
    let mut warned = Warned::default();
    let mut failure: Option<(StopReason, Code, String)> = None;
    loop {
        let first = rx.recv_timeout(STATUS_EVERY);
        let disconnected = matches!(first, Err(mpsc::RecvTimeoutError::Disconnected));
        let now_ms = sh.audio_ms();
        if let Ok((t, b)) = first {
            mixer.push(t, &b, &sh.live[t], now_ms);
        }
        while let Ok((t, b)) = rx.try_recv() {
            mixer.push(t, &b, &sh.live[t], now_ms);
        }
        let now = Instant::now();
        let paused = sh
            .control
            .lock()
            .map(|c| c.paused)
            .unwrap_or(false);
        if paused && !clock.is_paused() {
            clock.pause(now);
        } else if !paused && clock.is_paused() {
            clock.resume(now);
        }
        if clock.is_paused() {
            mixer.hold(clock.expected(now));
        } else {
            out.clear();
            mixer.mix(clock.expected(now), &mut out);
            if !out.is_empty() {
                let written = enc.push(&out).and_then(|packets| {
                    for (p, g) in packets {
                        ogg.write(p, g)?;
                    }
                    Ok(())
                });
                if let Err(e) = written {
                    let reason = if e.code() == Code::DiskFull {
                        StopReason::DiskFull
                    } else {
                        StopReason::Error
                    };
                    failure = Some((reason, e.code(), e.to_string()));
                    break;
                }
                sh.frames.store(enc.samples_in(), Ordering::Relaxed);
            }
        }
        for t in [MIC, SYSTEM] {
            if rates[t].is_none() {
                sh.live[t].quiet(sh.audio_ms());
            }
        }
        if last_status.elapsed() >= STATUS_EVERY {
            last_status = Instant::now();
            sh.sink.send(RecorderEvent::Status { status: sh.status() });
            warnings(&sh, &mut warned);
        }
        if last_journal.elapsed() >= JOURNAL_EVERY {
            last_journal = Instant::now();
            let ms = sh.audio_ms();
            if let Err(e) = sh.write_journal(|j| j.ms = ms) {
                log::warn!("recording journal not updated: {e}");
            }
            if let Some(free) = free_space(&sh.journals.dir) {
                sh.disk_free.store(free, Ordering::Relaxed);
                if free < STOP_DISK {
                    failure = Some((StopReason::DiskFull, Code::DiskFull, "the disk is full".into()));
                    break;
                }
            }
        }
        let stop = sh.control.lock().map(|c| c.stop).unwrap_or(true);
        if disconnected || stop {
            break;
        }
    }
    // Close the pause in progress, if any.
    let pause = sh
        .control
        .lock()
        .ok()
        .and_then(|mut c| c.pause_from.take());
    let now = time::now_ms();
    if let Some((at_ms, from)) = pause {
        let _ = sh.write_journal(|j| {
            j.pauses.push(Pause {
                at_ms,
                wall_from: time::instant(from),
                wall_to: time::instant(now),
            })
        });
    }
    let duration_ms = match &failure {
        None => {
            let samples = enc.samples_in();
            let closed = enc
                .finish()
                .and_then(|(last, _end)| ogg.finish(last));
            match closed {
                Ok(()) => samples * 1000 / SAMPLE_RATE as u64,
                Err(e) => {
                    log::warn!("recording journal not closed cleanly: {e}");
                    recovered_ms(&ogg_path, sh.journal.lock().map(|j| j.preskip).unwrap_or(312))
                }
            }
        }
        Some(_) => {
            drop(ogg);
            recovered_ms(&ogg_path, sh.journal.lock().map(|j| j.preskip).unwrap_or(312))
        }
    };
    sh.frames
        .store(duration_ms * SAMPLE_RATE as u64 / 1000, Ordering::Relaxed);
    sh.write_journal(|j| {
        j.state = JournalState::Stopped;
        j.ms = duration_ms;
        j.duration_ms = Some(duration_ms);
    })?;
    if let Some((reason, code, message)) = &failure {
        log::warn!("recording stopped: {message}");
        sh.sink.send(RecorderEvent::Stopped {
            reason: *reason,
            code: Some(*code),
        });
    }
    let j = sh.journal.lock().unwrap_or_else(|e| e.into_inner());
    Ok(j.finished())
}

/// After a failed write: cut the journal to its last whole page and read its length.
fn recovered_ms(path: &std::path::Path, preskip: u16) -> u64 {
    match journal::recover(path) {
        Ok(r) => r.end_granule.saturating_sub(preskip as u64) / 48,
        Err(_) => 0,
    }
}

fn warnings(sh: &Shared, w: &mut Warned) {
    if sh.layout != Layout::System && sh.live[MIC].is_open() {
        let silent = sh.live[MIC].silent_for_ms() >= SILENT_WARN_MS;
        if silent && !w.silent {
            sh.sink.send(RecorderEvent::Warning {
                code: RecorderWarning::SilentMic,
            });
        }
        w.silent = silent;
    }
    let lost = [MIC, SYSTEM].iter().any(|&t| sh.live[t].is_lost());
    if lost && !w.lost {
        sh.sink.send(RecorderEvent::Warning {
            code: RecorderWarning::DeviceLost,
        });
    }
    w.lost = lost;
    let disk = sh.disk_free.load(Ordering::Relaxed);
    let low = disk != u64::MAX && disk < LOW_DISK;
    if low && !w.disk {
        sh.sink.send(RecorderEvent::Warning {
            code: RecorderWarning::LowDisk,
        });
    }
    w.disk = low;
    let p = tramado_base::power::system_power();
    let low_battery = p.source == tramado_base::power::PowerSource::Battery
        && p.percent.is_some_and(|x| x < 15);
    if low_battery && !w.battery {
        sh.sink.send(RecorderEvent::Warning {
            code: RecorderWarning::LowBattery,
        });
    }
    w.battery = low_battery;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_choose_tracks_and_speakers() {
        assert_eq!(layout(RecordMode::Room, true), Layout::Mic);
        assert_eq!(layout(RecordMode::Online, false), Layout::System);
        assert_eq!(layout(RecordMode::Online, true), Layout::Stereo);
        assert_eq!(speakers(Layout::Mic)[0].speaker, Speaker::Lecture);
        let s = speakers(Layout::Stereo);
        assert_eq!((s[0].speaker, s[1].speaker), (Speaker::Me, Speaker::Class));
    }
}
