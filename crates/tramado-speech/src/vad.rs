// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/transcribe.rs `detect_speech`), MPL-2.0,
// same author.

//! Where the speech is: the Silero VAD v5.1.2 model through whisper.cpp
//! (`WhisperVadContext`; whisper.cpp's own VAD runs only in `whisper_full`, not in the
//! `whisper_full_with_state` that whisper-rs calls, gotcha 2), or, without it, a loudness cut.
//! Long tracks are scanned in 30-minute windows so no more than one window is ever held as
//! `f32` (critique G22).

use std::path::PathBuf;

use tramado_base::error::AppResult;

use crate::pieces;
use crate::samples::Track16;

/// A window of the track handed to the detector at once.
const WINDOW: usize = 30 * 60 * pieces::SECOND;
/// Stretches closer than this across a window boundary are one stretch.
const BRIDGE: usize = 100 * pieces::MS;
/// Without the voice model, a stretch this quiet (RMS) is not speech.
pub const SILENT_RMS: f32 = 0.004;

/// How speech is found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Vad {
    /// The Silero model file (only with the `local-whisper` feature and a supported CPU).
    Silero(PathBuf),
    /// Frames louder than `SILENT_RMS`, short pauses bridged.
    Loudness,
}

impl Vad {
    /// The name recorded in `transcript.json` `engine.vad`.
    pub fn name(&self) -> Option<&'static str> {
        match self {
            Vad::Silero(_) => Some("silero-v5.1.2"),
            Vad::Loudness => None,
        }
    }
}

/// A stretch of continuous speech longer than this is cut at its quietest moment (local
/// windows hold whole stretches).
const MAX_STRETCH: usize = 5 * 60 * pieces::SECOND;
const CUT_WINDOW: usize = 20 * pieces::SECOND;

/// Finds speech while a track is decoded: samples are buffered up to one window, so no more
/// than 30 minutes of `f32` are held at once, whatever the length of the lecture.
pub struct StreamVad {
    detector: Detector,
    buf: Vec<f32>,
    /// Recording sample of `buf[0]`.
    at: usize,
    out: Vec<(usize, usize)>,
}

impl StreamVad {
    pub fn new(vad: &Vad) -> AppResult<Self> {
        Ok(StreamVad {
            detector: Detector::new(vad)?,
            buf: Vec::new(),
            at: 0,
            out: Vec::new(),
        })
    }

    pub fn push(&mut self, x: &[f32]) -> AppResult<()> {
        let mut x = x;
        while !x.is_empty() {
            let room = WINDOW - self.buf.len();
            let take = room.min(x.len());
            self.buf.extend_from_slice(&x[..take]);
            x = &x[take..];
            if self.buf.len() == WINDOW {
                self.flush()?;
            }
        }
        Ok(())
    }

    fn flush(&mut self) -> AppResult<()> {
        let end = self.at + self.buf.len();
        let found: Vec<(usize, usize)> = self
            .detector
            .find(&self.buf)?
            .into_iter()
            .map(|(a, b)| (a + self.at, (b + self.at).min(end)))
            .collect();
        let found = pieces::split_long(&self.buf, self.at, &found, MAX_STRETCH, CUT_WINDOW);
        for (a, b) in found {
            match self.out.last_mut() {
                Some(last) if a <= last.1 + BRIDGE && b.saturating_sub(last.0) <= MAX_STRETCH => {
                    last.1 = last.1.max(b)
                }
                _ => self.out.push((a, b)),
            }
        }
        self.at = end;
        self.buf.clear();
        Ok(())
    }

    /// The stretches found, and the track's length in samples.
    pub fn finish(mut self) -> AppResult<(Vec<(usize, usize)>, usize)> {
        if !self.buf.is_empty() {
            self.flush()?;
        }
        Ok((self.out, self.at))
    }
}

/// The stretches of speech of a whole track (sample ranges), found window by window.
pub fn stretches(
    vad: &Vad,
    track: &Track16,
    stop: &dyn Fn() -> bool,
) -> AppResult<Vec<(usize, usize)>> {
    let mut sv = StreamVad::new(vad)?;
    let mut at = 0;
    while at < track.len() {
        if stop() {
            return Err(tramado_base::error::AppError::new(
                tramado_base::error::Code::Cancelled,
                "stopped",
            ));
        }
        let end = (at + WINDOW).min(track.len());
        sv.push(&track.to_f32(at, end))?;
        at = end;
    }
    Ok(sv.finish()?.0)
}

enum Detector {
    #[cfg(feature = "local-whisper")]
    Silero(whisper_rs::WhisperVadContext),
    Loudness,
}

impl Detector {
    fn new(vad: &Vad) -> AppResult<Self> {
        match vad {
            #[cfg(feature = "local-whisper")]
            Vad::Silero(path) => {
                let mut params = whisper_rs::WhisperVadContextParams::new();
                params.set_n_threads(crate::cpu::whisper_threads());
                params.set_use_gpu(false);
                let ctx = whisper_rs::WhisperVadContext::new(&path.to_string_lossy(), params)
                    .map_err(|e| {
                        tramado_base::error::AppError::new(
                            tramado_base::error::Code::ModelUnreadable,
                            format!("voice model: {e}"),
                        )
                    })?;
                Ok(Detector::Silero(ctx))
            }
            #[cfg(not(feature = "local-whisper"))]
            Vad::Silero(_) => Ok(Detector::Loudness),
            Vad::Loudness => Ok(Detector::Loudness),
        }
    }

    fn find(&mut self, samples: &[f32]) -> AppResult<Vec<(usize, usize)>> {
        match self {
            #[cfg(feature = "local-whisper")]
            Detector::Silero(ctx) => {
                if samples.len() < pieces::SECOND / 10 {
                    return Ok(Vec::new());
                }
                let found = ctx
                    .segments_from_samples(whisper_rs::WhisperVadParams::default(), samples)
                    .map_err(|e| {
                        tramado_base::error::AppError::new(
                            tramado_base::error::Code::IoError,
                            format!("voice detection failed: {e}"),
                        )
                    })?;
                // Hundredths of a second.
                let cs = crate::SAMPLE_RATE as f32 / 100.0;
                Ok(found
                    .map(|s| {
                        (
                            ((s.start.max(0.0) * cs) as usize).min(samples.len()),
                            ((s.end.max(0.0) * cs) as usize).min(samples.len()),
                        )
                    })
                    .filter(|(a, b)| b > a)
                    .collect())
            }
            Detector::Loudness => Ok(pieces::loud_stretches(
                samples,
                SILENT_RMS,
                pieces::SECOND / 2,
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loudness_finds_the_noise_across_windows() {
        let s = pieces::SECOND;
        let mut x = vec![0.0f32; 12 * s];
        for v in &mut x[3 * s..5 * s] {
            *v = 0.3;
        }
        let t = Track16::from_f32(&x);
        let found = stretches(&Vad::Loudness, &t, &|| false).unwrap();
        assert_eq!(found.len(), 1);
        assert!((found[0].0 as i64 - (3 * s) as i64).abs() <= (s / 20) as i64);
        assert!((found[0].1 as i64 - (5 * s) as i64).abs() <= (s / 20) as i64);
        assert_eq!(Vad::Loudness.name(), None);
    }

    #[test]
    fn streaming_finds_the_same_speech_in_any_block_size() {
        let s = pieces::SECOND;
        let mut x = vec![0.0f32; 20 * s];
        for v in &mut x[2 * s..4 * s] {
            *v = 0.3;
        }
        for v in &mut x[15 * s..16 * s] {
            *v = 0.3;
        }
        let mut sv = StreamVad::new(&Vad::Loudness).unwrap();
        for block in x.chunks(1013) {
            sv.push(block).unwrap();
        }
        let (found, len) = sv.finish().unwrap();
        assert_eq!(len, 20 * s);
        assert_eq!(found.len(), 2);
        assert_eq!(
            found,
            stretches(&Vad::Loudness, &Track16::from_f32(&x), &|| false).unwrap()
        );
    }
}
