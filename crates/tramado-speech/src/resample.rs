// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/resample.rs), MPL-2.0, same author.

//! Converts a device's or a file's rate (often 44.1 or 48 kHz) to the 16 kHz recordings are
//! kept at and the speech model expects: a low-pass filter below 8 kHz, so higher sounds do not
//! fold back into speech, then linear interpolation between the filtered samples.

use std::f64::consts::PI;

const TAPS: usize = 63;

pub struct Resampler {
    /// Input samples per output sample.
    step: f64,
    taps: Vec<f32>,
    ring: Vec<f32>,
    at: usize,
    /// Filtered input not yet passed, and where the next output falls in it.
    pending: Vec<f32>,
    pos: f64,
}

impl Resampler {
    pub fn new(from: u32, to: u32) -> Self {
        let step = from as f64 / to as f64;
        // Down-sampling needs the filter; at or below the target rate there is nothing to fold.
        let taps = if from > to {
            let cutoff = 0.45 * to as f64 / from as f64; // cycles per input sample
            let mid = (TAPS - 1) as f64 / 2.0;
            let raw: Vec<f64> = (0..TAPS)
                .map(|i| {
                    let x = i as f64 - mid;
                    let sinc = if x == 0.0 {
                        2.0 * cutoff
                    } else {
                        (2.0 * PI * cutoff * x).sin() / (PI * x)
                    };
                    let window = 0.54 - 0.46 * (2.0 * PI * i as f64 / (TAPS - 1) as f64).cos();
                    sinc * window
                })
                .collect();
            let sum: f64 = raw.iter().sum();
            raw.iter().map(|v| (v / sum) as f32).collect()
        } else {
            vec![1.0]
        };
        let n = taps.len();
        Resampler {
            step,
            taps,
            ring: vec![0.0; n],
            at: 0,
            pending: Vec::new(),
            pos: 0.0,
        }
    }

    /// Takes input samples and appends the output samples they complete.
    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let n = self.taps.len();
        for &x in input {
            self.ring[self.at] = x;
            self.at = (self.at + 1) % n;
            let mut y = 0.0f32;
            for (k, t) in self.taps.iter().enumerate() {
                y += t * self.ring[(self.at + k) % n];
            }
            self.pending.push(y);
        }
        while self.pos + 1.0 < self.pending.len() as f64 {
            let i = self.pos as usize;
            let frac = (self.pos - i as f64) as f32;
            out.push(self.pending[i] * (1.0 - frac) + self.pending[i + 1] * frac);
            self.pos += self.step;
        }
        let used = (self.pos as usize).min(self.pending.len());
        self.pending.drain(..used);
        self.pos -= used as f64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, hz: f64, secs: f64) -> Vec<f32> {
        (0..(rate as f64 * secs) as usize)
            .map(|i| (2.0 * PI * hz * i as f64 / rate as f64).sin() as f32 * 0.5)
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn resample_keeps_the_length_and_speech_band() {
        for from in [44_100, 48_000] {
            let mut r = Resampler::new(from, 16_000);
            let mut out = Vec::new();
            // Fed in uneven blocks, as a sound device delivers them.
            for block in tone(from, 440.0, 2.0).chunks(1013) {
                r.push(block, &mut out);
            }
            assert!(
                (out.len() as i64 - 32_000).abs() < 4,
                "{from}: {}",
                out.len()
            );
            assert!((rms(&out[1000..]) - 0.3536).abs() < 0.01);
        }
    }

    #[test]
    fn resample_removes_sound_above_eight_kilohertz() {
        let mut r = Resampler::new(48_000, 16_000);
        let mut out = Vec::new();
        r.push(&tone(48_000, 11_000.0, 1.0), &mut out);
        assert!(rms(&out[1000..]) < 0.02);
    }

    #[test]
    fn resample_passes_sixteen_kilohertz_through() {
        let mut r = Resampler::new(16_000, 16_000);
        let mut out = Vec::new();
        let x = tone(16_000, 300.0, 0.5);
        r.push(&x, &mut out);
        assert_eq!(out.len(), x.len() - 1);
        assert_eq!(out[10], x[10]);
    }
}
