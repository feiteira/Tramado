// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/capture.rs), MPL-2.0, same author.

//! The sound devices: the microphone (track 0) and what the computer plays (track 1, for an
//! online class), opened only when the mode needs them (audio-pipeline §4.1). Works with any
//! call app, since it records the computer's output rather than the app:
//! - Linux: the default sink's monitor source, over the PulseAudio protocol (PipeWire serves
//!   it too); without a sound server, plain ALSA and the microphone only;
//! - Windows: WASAPI loopback of the default output (it sends nothing during silence: the mixer
//!   pads by the clock);
//! - macOS 14.2+: a Core Audio process tap of the default output.
//!
//! The streams live on their own thread (on some systems they may not move between threads);
//! each callback down-mixes its device's channels to mono and sends `(track, block)` on. The
//! level meter of each track is kept here (`TrackLive`), fed by the mixer.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};
use tramado_base::error::{AppError, AppResult, Code};

use crate::types::{AudioDevices, InputDevice, SystemAudio, TrackLevel};

pub const MIC: usize = 0;
pub const SYSTEM: usize = 1;

/// Below this RMS (dBFS) a track counts as silent ("no sound" warning after 15 s).
pub const SILENT_DB: f32 = -55.0;
/// A sample this loud counts as clipping.
const CLIP: f32 = 0.99;
/// How long the clipping light stays on.
const CLIP_HOLD_MS: u64 = 1000;

/// One device's live state: what the meter shows and why it may not be recording.
#[derive(Default)]
pub struct TrackLive {
    /// The loudest sample lately, 0–1, as f32 bits: rises at once, falls gently.
    peak: AtomicU32,
    /// RMS of the last block in dBFS, as f32 bits.
    rms_db: AtomicU32,
    /// Audio time (ms) of the last clipped sample, + 1 (0 = never).
    clipped_at: AtomicU64,
    /// Audio time (ms) the track was last louder than `SILENT_DB`.
    loud_at: AtomicU64,
    /// Audio time (ms) of the last block seen.
    now: AtomicU64,
    device: Mutex<Option<String>>,
    error: Mutex<Option<Code>>,
    open: AtomicBool,
    /// The device went away while recording (unplugged).
    lost: AtomicBool,
}

fn db(rms: f32) -> f32 {
    if rms <= 1e-5 {
        -100.0
    } else {
        (20.0 * rms.log10()).max(-100.0)
    }
}

impl TrackLive {
    /// Updates the meter with a 16 kHz block that ends at audio time `now_ms`.
    pub fn observe(&self, block: &[f32], now_ms: u64) {
        if block.is_empty() {
            return;
        }
        let peak = block.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        let shown = f32::from_bits(self.peak.load(Ordering::Relaxed));
        self.peak
            .store(peak.max(shown * 0.85).min(1.0).to_bits(), Ordering::Relaxed);
        let rms = (block.iter().map(|v| v * v).sum::<f32>() / block.len() as f32).sqrt();
        let d = db(rms);
        self.rms_db.store(d.to_bits(), Ordering::Relaxed);
        if peak >= CLIP {
            self.clipped_at.store(now_ms + 1, Ordering::Relaxed);
        }
        if d > SILENT_DB {
            self.loud_at.store(now_ms, Ordering::Relaxed);
        }
        self.now.store(now_ms, Ordering::Relaxed);
    }

    /// A track without a device: no level.
    pub fn quiet(&self, now_ms: u64) {
        self.peak.store(0f32.to_bits(), Ordering::Relaxed);
        self.rms_db.store((-100f32).to_bits(), Ordering::Relaxed);
        self.now.store(now_ms, Ordering::Relaxed);
    }

    pub fn fail(&self, code: Code) {
        let mut slot = self.error.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            *slot = Some(code);
        }
    }

    pub fn error(&self) -> Option<Code> {
        *self.error.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn is_open(&self) -> bool {
        self.open.load(Ordering::Relaxed)
    }

    pub fn is_lost(&self) -> bool {
        self.lost.load(Ordering::Relaxed)
    }

    pub fn silent_for_ms(&self) -> u64 {
        let now = self.now.load(Ordering::Relaxed);
        now.saturating_sub(self.loud_at.load(Ordering::Relaxed))
    }

    pub fn level(&self) -> TrackLevel {
        let now = self.now.load(Ordering::Relaxed);
        let clipped = self.clipped_at.load(Ordering::Relaxed);
        TrackLevel {
            peak: f32::from_bits(self.peak.load(Ordering::Relaxed)),
            rms_db: f32::from_bits(self.rms_db.load(Ordering::Relaxed)),
            clipping: clipped > 0 && now + 1 < clipped + CLIP_HOLD_MS,
            device: self
                .device
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            error: self.error(),
            silent_for_ms: self.silent_for_ms(),
        }
    }
}

/// Which devices to open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureSpec {
    /// `None`: no microphone; `Some(None)`: the default one; `Some(Some(id))`: a picked one.
    pub mic: Option<Option<String>>,
    /// What the computer plays.
    pub system: bool,
}

type Block = (usize, Vec<f32>);

/// Open streams on their own thread.
pub struct Capture {
    live: Arc<[TrackLive; 2]>,
    stop: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
    rates: [Option<u32>; 2],
}

fn cpal_code(e: &cpal::Error) -> Code {
    match e.kind() {
        cpal::ErrorKind::PermissionDenied => Code::SpeechPermission,
        _ => Code::SpeechNoDevice,
    }
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    track: usize,
    tx: mpsc::Sender<Block>,
    live: Arc<[TrackLive; 2]>,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    device.build_input_stream::<T, _, _>(
        *config,
        move |data: &[T], _| {
            let mono: Vec<f32> = data
                .chunks(channels)
                .map(|frame| {
                    frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / frame.len() as f32
                })
                .collect();
            let _ = tx.send((track, mono));
        },
        move |e| match e.kind() {
            // A glitch, a new default device or no real-time priority: the stream goes on.
            cpal::ErrorKind::Xrun
            | cpal::ErrorKind::DeviceChanged
            | cpal::ErrorKind::RealtimeDenied => {}
            cpal::ErrorKind::DeviceNotAvailable | cpal::ErrorKind::StreamInvalidated => {
                live[track].lost.store(true, Ordering::Relaxed);
                live[track].fail(Code::SpeechNoDevice);
            }
            _ => live[track].fail(cpal_code(&e)),
        },
        None,
    )
}

fn open_on(
    device: &cpal::Device,
    loopback: bool,
    track: usize,
    tx: mpsc::Sender<Block>,
    live: &Arc<[TrackLive; 2]>,
) -> Result<(cpal::Stream, u32), Code> {
    let supported = if loopback {
        device.default_output_config()
    } else {
        device.default_input_config()
    }
    .map_err(|e| cpal_code(&e))?;
    let config = supported.config();
    let rate = config.sample_rate;
    let l = live.clone();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(device, &config, track, tx, l),
        SampleFormat::I16 => build::<i16>(device, &config, track, tx, l),
        SampleFormat::U16 => build::<u16>(device, &config, track, tx, l),
        SampleFormat::I32 => build::<i32>(device, &config, track, tx, l),
        SampleFormat::I8 => build::<i8>(device, &config, track, tx, l),
        SampleFormat::U8 => build::<u8>(device, &config, track, tx, l),
        SampleFormat::F64 => build::<f64>(device, &config, track, tx, l),
        _ => return Err(Code::SpeechNoDevice),
    }
    .map_err(|e| cpal_code(&e))?;
    stream.play().map_err(|e| cpal_code(&e))?;
    if let Ok(d) = device.description() {
        *live[track]
            .device
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(d.name().to_string());
    }
    Ok((stream, rate))
}

/// The host whose devices are used (PulseAudio on Linux when a sound server answers).
fn host() -> cpal::Host {
    #[cfg(target_os = "linux")]
    {
        if let Ok(h) = cpal::host_from_id(cpal::HostId::PulseAudio) {
            return h;
        }
    }
    cpal::default_host()
}

fn is_pulse(host: &cpal::Host) -> bool {
    #[cfg(target_os = "linux")]
    {
        host.id() == cpal::HostId::PulseAudio
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = host;
        false
    }
}

fn device_id(d: &cpal::Device) -> Option<String> {
    d.id().ok().map(|id| id.to_string())
}

fn mic_device(host: &cpal::Host, id: Option<&str>) -> Option<cpal::Device> {
    match id {
        Some(id) => {
            let parsed = cpal::DeviceId::from_str(id).ok()?;
            host.device_by_id(&parsed)
        }
        None => host.default_input_device(),
    }
}

/// The device that hears what the computer plays, and whether it is an output used as an
/// input (WASAPI and Core Audio loopback).
fn system_device(host: &cpal::Host) -> Option<(cpal::Device, bool)> {
    if is_pulse(host) {
        // Every output (a sink) has a monitor source named after it.
        #[cfg(target_os = "linux")]
        {
            let sink = host.default_output_device()?;
            let id = sink.id().ok()?;
            let monitor = cpal::DeviceId::new(cpal::HostId::PulseAudio, format!("{}.monitor", id.id()));
            return host.device_by_id(&monitor).map(|d| (d, false));
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Plain ALSA: no loopback.
        None
    }
    #[cfg(not(target_os = "linux"))]
    {
        host.default_output_device().map(|d| (d, true))
    }
}

/// Whether "online class" recording can hear the computer here.
pub fn system_audio() -> SystemAudio {
    let h = host();
    let supported = system_device(&h).is_some();
    SystemAudio {
        supported,
        reason: (!supported).then_some(Code::SpeechNoSystemAudio),
    }
}

/// The microphones (and other inputs) for the picker; monitors of outputs are left out.
pub fn devices() -> AudioDevices {
    let h = host();
    let default = h.default_input_device().and_then(|d| device_id(&d));
    let mut inputs = Vec::new();
    if let Ok(list) = h.input_devices() {
        for d in list {
            let Some(id) = device_id(&d) else {
                continue;
            };
            if id.ends_with(".monitor") {
                continue;
            }
            let name = d
                .description()
                .map(|x| x.name().to_string())
                .unwrap_or_else(|_| id.clone());
            inputs.push(InputDevice {
                is_default: default.as_deref() == Some(id.as_str()),
                id,
                name,
            });
        }
    }
    let supported = system_device(&h).is_some();
    AudioDevices {
        inputs,
        system_audio: SystemAudio {
            supported,
            reason: (!supported).then_some(Code::SpeechNoSystemAudio),
        },
    }
}

impl Capture {
    /// Opens what `spec` asks for. Fails only when nothing requested opens; a track that
    /// cannot is silence, and its level says why.
    pub fn open(spec: &CaptureSpec) -> AppResult<(Capture, mpsc::Receiver<Block>)> {
        let live: Arc<[TrackLive; 2]> = Arc::new(Default::default());
        let (audio_tx, audio_rx) = mpsc::channel::<Block>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<[Option<u32>; 2]>();
        let l = live.clone();
        let spec2 = spec.clone();
        let thread = std::thread::Builder::new()
            .name("tramado-capture".into())
            .spawn(move || {
                let h = host();
                let mut streams = Vec::new();
                let mut rates = [None, None];
                if let Some(id) = &spec2.mic {
                    match mic_device(&h, id.as_deref()) {
                        Some(d) => match open_on(&d, false, MIC, audio_tx.clone(), &l) {
                            Ok((s, r)) => {
                                streams.push(s);
                                rates[MIC] = Some(r);
                            }
                            Err(c) => l[MIC].fail(c),
                        },
                        None => l[MIC].fail(Code::SpeechNoDevice),
                    }
                }
                if spec2.system {
                    match system_device(&h) {
                        Some((d, loopback)) => {
                            match open_on(&d, loopback, SYSTEM, audio_tx.clone(), &l) {
                                Ok((s, r)) => {
                                    streams.push(s);
                                    rates[SYSTEM] = Some(r);
                                }
                                Err(c) => l[SYSTEM].fail(if c == Code::SpeechNoDevice {
                                    Code::SpeechNoSystemAudio
                                } else {
                                    c
                                }),
                            }
                        }
                        None => l[SYSTEM].fail(Code::SpeechNoSystemAudio),
                    }
                }
                drop(audio_tx);
                for (t, r) in rates.iter().enumerate() {
                    l[t].open.store(r.is_some(), Ordering::Relaxed);
                }
                let _ = ready_tx.send(rates);
                let _ = stop_rx.recv();
                drop(streams);
            })?;
        let rates = ready_rx
            .recv()
            .map_err(|_| AppError::new(Code::SpeechNoDevice, "the capture thread stopped"))?;
        let mut cap = Capture {
            live,
            stop: stop_tx,
            thread: Some(thread),
            rates,
        };
        if rates.iter().all(Option::is_none) {
            let code = [MIC, SYSTEM]
                .iter()
                .filter_map(|&t| cap.live[t].error())
                .find(|c| *c == Code::SpeechPermission)
                .or_else(|| {
                    (spec.system && spec.mic.is_none()).then_some(Code::SpeechNoSystemAudio)
                })
                .unwrap_or(Code::SpeechNoDevice);
            cap.stop();
            return Err(AppError::new(code, "no sound device could be opened"));
        }
        Ok((cap, audio_rx))
    }

    pub fn live(&self) -> Arc<[TrackLive; 2]> {
        self.live.clone()
    }

    /// The device rate of each opened track.
    pub fn rates(&self) -> [Option<u32>; 2] {
        self.rates
    }

    /// Closes the devices (the block channel then ends).
    pub fn stop(&mut self) {
        let _ = self.stop.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_meter_rises_at_once_and_falls_gently() {
        let t = TrackLive::default();
        t.observe(&[0.5; 1600], 100);
        let l = t.level();
        assert!((l.peak - 0.5).abs() < 1e-6);
        assert!((l.rms_db - (-6.02)).abs() < 0.1);
        assert!(!l.clipping);
        assert_eq!(l.silent_for_ms, 0);
        t.observe(&[0.0; 1600], 200);
        let l = t.level();
        assert!((l.peak - 0.425).abs() < 1e-3);
        assert_eq!(l.rms_db, -100.0);
        assert_eq!(l.silent_for_ms, 100);
        t.observe(&[1.0; 16], 300);
        assert!(t.level().clipping);
        t.observe(&[0.0; 16], 1500);
        assert!(!t.level().clipping);
        t.fail(Code::SpeechPermission);
        t.fail(Code::SpeechNoDevice);
        assert_eq!(t.level().error, Some(Code::SpeechPermission));
    }
}

#[cfg(test)]
mod device_tests {
    use super::*;
    use std::time::Duration;

    /// Opens the real devices for a few seconds and prints their levels, when asked for:
    /// `cargo test -p tramado-speech record_from_devices -- --ignored --nocapture` (play
    /// something meanwhile; on Linux a PulseAudio null sink is enough).
    #[test]
    #[ignore]
    fn record_from_devices() {
        let d = devices();
        println!("inputs: {:?}", d.inputs);
        println!("system audio: {:?}", d.system_audio);
        let (mut cap, rx) = Capture::open(&CaptureSpec {
            mic: Some(None),
            system: true,
        })
        .unwrap();
        println!("rates: {:?}", cap.rates());
        let live = cap.live();
        let mut got = [0usize; 2];
        let started = std::time::Instant::now();
        while started.elapsed() < Duration::from_secs(4) {
            if let Ok((t, b)) = rx.recv_timeout(Duration::from_millis(100)) {
                live[t].observe(&b, started.elapsed().as_millis() as u64);
                got[t] += b.len();
            }
        }
        cap.stop();
        println!(
            "mic {:?} {} samples; system {:?} {} samples",
            live[MIC].level(),
            got[MIC],
            live[SYSTEM].level(),
            got[SYSTEM]
        );
        assert!(got.iter().any(|n| *n > 0));
    }
}
