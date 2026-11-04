// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/capture.rs `Mixer`), MPL-2.0, same author.

//! Brings the blocks of the open tracks to 16 kHz, keeps them in step with a **pause-aware**
//! clock (audio-pipeline §4.4: paused time is not audio time) and interleaves what the
//! recording needs: the microphone alone (in the room), what the computer plays alone (an
//! online class), or both as stereo (L = me, R = the class). A track whose device delivers
//! nothing (Windows loopback while nothing plays, an unplugged microphone) is padded with
//! silence by the clock; a device whose clock runs fast is trimmed.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crate::capture::{TrackLive, MIC, SYSTEM};
use crate::resample::Resampler;
use crate::SAMPLE_RATE;

/// How far a track may fall behind the clock or run ahead of it before it is put back in step.
const TOLERANCE: u64 = SAMPLE_RATE as u64 / 2;
/// Where a track that fell behind is padded to: just short of the clock, so audio that was only
/// late is not pushed ahead of it.
const SLACK: u64 = SAMPLE_RATE as u64 / 4;

/// Where a track stands against the clock, and what to do about it.
#[derive(Debug, PartialEq, Eq)]
pub enum Adjust {
    Keep,
    Pad(u64),
    Drop(u64),
}

pub fn adjust(produced: u64, expected: u64) -> Adjust {
    if produced + TOLERANCE < expected {
        Adjust::Pad(expected - SLACK - produced)
    } else if produced > expected + TOLERANCE {
        Adjust::Drop(produced - expected - SLACK)
    } else {
        Adjust::Keep
    }
}

/// What goes into the recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    /// Mono: the microphone (in the room).
    Mic,
    /// Mono: what the computer plays (an online class, without me).
    System,
    /// Stereo: L = the microphone (me), R = what the computer plays (the class).
    Stereo,
}

impl Layout {
    pub fn channels(self) -> usize {
        match self {
            Layout::Stereo => 2,
            _ => 1,
        }
    }

    fn tracks(self) -> &'static [usize] {
        match self {
            Layout::Mic => &[MIC],
            Layout::System => &[SYSTEM],
            Layout::Stereo => &[MIC, SYSTEM],
        }
    }
}

/// Audio time: wall time since the start, less every pause.
#[derive(Debug, Clone)]
pub struct Clock {
    started: Instant,
    paused_total: Duration,
    paused_since: Option<Instant>,
}

impl Clock {
    pub fn start(now: Instant) -> Self {
        Clock {
            started: now,
            paused_total: Duration::ZERO,
            paused_since: None,
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused_since.is_some()
    }

    pub fn pause(&mut self, now: Instant) {
        if self.paused_since.is_none() {
            self.paused_since = Some(now);
        }
    }

    pub fn resume(&mut self, now: Instant) {
        if let Some(since) = self.paused_since.take() {
            self.paused_total += now.saturating_duration_since(since);
        }
    }

    /// 16 kHz samples of audio time at `now`.
    pub fn expected(&self, now: Instant) -> u64 {
        let until = self.paused_since.unwrap_or(now);
        let active = until
            .saturating_duration_since(self.started)
            .saturating_sub(self.paused_total);
        (active.as_secs_f64() * SAMPLE_RATE as f64) as u64
    }
}

pub struct Mixer {
    layout: Layout,
    resamplers: [Option<Resampler>; 2],
    pending: [VecDeque<f32>; 2],
    /// 16 kHz samples each track delivered (or was padded with) since the start.
    produced: [u64; 2],
    scratch: Vec<f32>,
}

impl Mixer {
    /// `rates`: the device rate of each opened track (`None`: not open).
    pub fn new(rates: [Option<u32>; 2], layout: Layout) -> Self {
        Mixer {
            layout,
            resamplers: rates.map(|r| r.map(|r| Resampler::new(r, SAMPLE_RATE))),
            pending: Default::default(),
            produced: [0, 0],
            scratch: Vec::new(),
        }
    }

    pub fn layout(&self) -> Layout {
        self.layout
    }

    /// Takes a device block of `track`; the meter sees it at 16 kHz.
    pub fn push(&mut self, track: usize, block: &[f32], live: &TrackLive, now_ms: u64) {
        let Some(rs) = self.resamplers.get_mut(track).and_then(Option::as_mut) else {
            return;
        };
        self.scratch.clear();
        rs.push(block, &mut self.scratch);
        live.observe(&self.scratch, now_ms);
        if self.layout.tracks().contains(&track) {
            self.produced[track] += self.scratch.len() as u64;
            self.pending[track].extend(self.scratch.iter().copied());
        }
    }

    /// While paused: what the devices deliver is metered but not kept, and every track is held
    /// at `expected` so the recording resumes without a jump.
    pub fn hold(&mut self, expected: u64) {
        for t in [MIC, SYSTEM] {
            self.pending[t].clear();
            self.produced[t] = expected;
        }
    }

    /// Puts each track back in step with `expected` samples, then moves what every track of the
    /// layout has into `out` (interleaved). Returns the frames added.
    pub fn mix(&mut self, expected: u64, out: &mut Vec<f32>) -> usize {
        for &t in self.layout.tracks() {
            if self.resamplers[t].is_none() {
                let missing = expected.saturating_sub(self.produced[t]);
                self.pending[t].extend(std::iter::repeat_n(0.0, missing as usize));
                self.produced[t] = self.produced[t].max(expected);
                continue;
            }
            match adjust(self.produced[t], expected) {
                Adjust::Keep => {}
                Adjust::Pad(n) => {
                    self.pending[t].extend(std::iter::repeat_n(0.0, n as usize));
                    self.produced[t] += n;
                }
                Adjust::Drop(n) => {
                    let n = (n as usize).min(self.pending[t].len());
                    self.pending[t].drain(..n);
                    self.produced[t] -= n as u64;
                }
            }
        }
        match self.layout {
            Layout::Mic | Layout::System => {
                let t = self.layout.tracks()[0];
                let n = self.pending[t].len();
                out.extend(self.pending[t].drain(..));
                n
            }
            Layout::Stereo => {
                let n = self.pending[MIC].len().min(self.pending[SYSTEM].len());
                out.reserve(n * 2);
                let [mic, system] = &mut self.pending;
                for (l, r) in mic.drain(..n).zip(system.drain(..n)) {
                    out.push(l);
                    out.push(r);
                }
                n
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_track_that_is_roughly_on_time() {
        assert_eq!(adjust(16_000, 16_000), Adjust::Keep);
        assert_eq!(adjust(16_000 - TOLERANCE, 16_000), Adjust::Keep);
        assert_eq!(adjust(16_000 + TOLERANCE, 16_000), Adjust::Keep);
        assert_eq!(adjust(0, 32_000), Adjust::Pad(32_000 - SLACK));
        assert_eq!(adjust(41_000, 32_000), Adjust::Drop(9_000 - SLACK));
    }

    #[test]
    fn interleaves_both_tracks_in_step() {
        let live: [TrackLive; 2] = Default::default();
        let mut m = Mixer::new([Some(16_000), Some(16_000)], Layout::Stereo);
        // The microphone delivers a second; the computer's sound nothing at all.
        m.push(MIC, &vec![0.5; 16_000], &live[MIC], 1000);
        let mut out = Vec::new();
        let n = m.mix(16_000, &mut out);
        assert_eq!(n as u64, 16_000 - SLACK);
        assert_eq!(out.len(), n * 2);
        assert!(out[400] > 0.4);
        assert_eq!(out[401], 0.0);
    }

    #[test]
    fn records_only_the_tracks_of_the_layout() {
        let live: [TrackLive; 2] = Default::default();
        // An online class without me: the microphone is metered, not recorded.
        let mut m = Mixer::new([Some(16_000), Some(48_000)], Layout::System);
        m.push(MIC, &vec![0.5; 16_000], &live[MIC], 1000);
        m.push(SYSTEM, &vec![0.25; 48_000], &live[SYSTEM], 1000);
        let mut out = Vec::new();
        let n = m.mix(16_000, &mut out);
        assert!((n as i64 - 16_000).abs() < 4);
        assert!(out[8000] > 0.2 && out[8000] < 0.3);
        assert!(live[MIC].level().peak > 0.4);
    }

    #[test]
    fn a_missing_device_is_silence() {
        let live: [TrackLive; 2] = Default::default();
        let mut m = Mixer::new([Some(16_000), None], Layout::Stereo);
        m.push(MIC, &vec![0.25; 8_000], &live[MIC], 500);
        let mut out = Vec::new();
        assert_eq!(m.mix(8_000, &mut out), 7_999);
    }

    #[test]
    fn the_clock_leaves_out_paused_time() {
        let t0 = Instant::now();
        let mut c = Clock::start(t0);
        assert_eq!(c.expected(t0 + Duration::from_secs(2)), 32_000);
        c.pause(t0 + Duration::from_secs(2));
        assert!(c.is_paused());
        assert_eq!(c.expected(t0 + Duration::from_secs(10)), 32_000);
        c.resume(t0 + Duration::from_secs(10));
        assert_eq!(c.expected(t0 + Duration::from_secs(11)), 48_000);
        // Paused and held: what arrives meanwhile is not recorded.
        let live: [TrackLive; 2] = Default::default();
        let mut m = Mixer::new([Some(16_000), None], Layout::Mic);
        m.push(MIC, &vec![0.5; 16_000], &live[MIC], 1000);
        m.hold(16_000);
        let mut out = Vec::new();
        assert_eq!(m.mix(16_000, &mut out), 0);
    }
}
