// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/transcribe.rs), MPL-2.0, same author.

//! Local transcription with whisper.cpp (whisper-rs 0.16, whisper.cpp 1.8.3), CPU only.
//!
//! The speech stretches of a track (vad.rs) are grouped into windows of about ten minutes of
//! joined audio; each window is one `state.full()` with greedy decoding, `no_context`, token
//! timestamps and DTW word times (the preset must match the model, gotcha 4; DTW rules out
//! flash attention, gotcha 3). After every window its segments are handed to the caller, which
//! persists them (`data/transcribe/<lectureId>.partial.json`): a crash, a sleep or a lost
//! claim costs at most one window, and memory stays bounded on a three-hour lecture.

use std::ffi::c_void;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tramado_base::error::{AppError, AppResult, Code};
use whisper_rs::{
    DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext,
    WhisperContextParameters,
};

use crate::pieces::{self, join_at, place_words, Token, LEAD, MS, OVERLAP};
use crate::registry::DtwPreset;
use crate::types::Segment;

/// About ten minutes of joined audio per window.
pub const WINDOW: usize = 10 * 60 * pieces::SECOND;

/// The engine string of `transcript.json` (`engine.version`).
pub const VERSION: &str = "1.8.3";

fn stopped() -> AppError {
    AppError::new(Code::Cancelled, "stopped")
}

unsafe extern "C" fn abort_if_cancelled(flag: *mut c_void) -> bool {
    // SAFETY: the flag is the job's, which outlives the transcription it was handed to.
    unsafe { (*(flag as *const AtomicBool)).load(Ordering::Relaxed) }
}

fn preset(p: DtwPreset) -> DtwModelPreset {
    match p {
        DtwPreset::Small => DtwModelPreset::Small,
        DtwPreset::LargeV3 => DtwModelPreset::LargeV3,
        DtwPreset::LargeV3Turbo => DtwModelPreset::LargeV3Turbo,
    }
}

/// Installs whisper.cpp's and ggml's logging hooks (they would print to stderr otherwise).
pub fn install_logging_hooks() {
    whisper_rs::install_logging_hooks();
}

/// The whisper language code of a BCP 47 tag (`pt-PT` → `pt`), if whisper knows it.
pub fn language_code(tag: &str) -> Option<String> {
    let primary = tag.split(['-', '_']).next()?.to_ascii_lowercase();
    whisper_rs::get_lang_id(&primary).map(|_| primary)
}

/// One window done: its segments (recording times) and where the window ends (samples).
#[derive(Debug, Clone)]
pub struct WindowDone {
    pub segments: Vec<Segment>,
    pub until: usize,
    pub language: Option<String>,
}

/// The most recording time one window may span (with sparse speech, ten minutes of joined
/// speech could otherwise span the whole lecture, and its samples are held at once).
pub const MAX_SPAN: usize = 30 * 60 * pieces::SECOND;

/// One window of a track: its speech stretches and the recording samples it needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    pub stretches: Vec<(usize, usize)>,
    /// Recording samples `lo..until` hold everything the window joins.
    pub lo: usize,
    pub until: usize,
    /// Its share of the work (joined samples).
    pub cost: usize,
}

/// The windows of a track of `len` samples: about ten minutes of joined speech each, spanning
/// at most `MAX_SPAN` of the recording.
pub fn windows(stretches: &[(usize, usize)], len: usize) -> Vec<Window> {
    let mut groups: Vec<Vec<(usize, usize)>> = Vec::new();
    let mut cur: Vec<(usize, usize)> = Vec::new();
    let mut size = pieces::START;
    for s in stretches {
        let too_wide = cur
            .first()
            .is_some_and(|f| s.1.saturating_sub(f.0) > MAX_SPAN);
        if !cur.is_empty() && (size + pieces::cost(s) > WINDOW || too_wide) {
            groups.push(std::mem::take(&mut cur));
            size = pieces::START;
        }
        size += pieces::cost(s);
        cur.push(*s);
    }
    if !cur.is_empty() {
        groups.push(cur);
    }
    groups
        .into_iter()
        .filter_map(|g| {
            let (first, last) = (*g.first()?, *g.last()?);
            Some(Window {
                lo: first.0.saturating_sub(LEAD),
                until: (last.1 + OVERLAP).min(len).max(first.0),
                cost: g.iter().map(pieces::cost).sum(),
                stretches: g,
            })
        })
        .collect()
}

pub struct Engine {
    ctx: WhisperContext,
}

/// Transcribes windows one after the other with one whisper state.
pub struct Runner<'a> {
    state: whisper_rs::WhisperState,
    eot: i32,
    prompt: Option<String>,
    /// A whisper language code, or `None` to let the model tell.
    language: Option<&'a str>,
    cancel: &'a AtomicBool,
}

impl Engine {
    pub fn load(model: &Path, dtw: DtwPreset) -> AppResult<Self> {
        let params = WhisperContextParameters {
            use_gpu: false,
            // Slower than plain attention on the processor, and it would rule out DTW.
            flash_attn: false,
            dtw_parameters: DtwParameters {
                mode: DtwMode::ModelPreset {
                    model_preset: preset(dtw),
                },
                ..Default::default()
            },
            ..Default::default()
        };
        let ctx = WhisperContext::new_with_params(model, params)
            .map_err(|e| AppError::new(Code::ModelUnreadable, e.to_string()))?;
        Ok(Engine { ctx })
    }

    /// `initial_prompt`: the class vocabulary (meta `vocabulary`).
    pub fn runner<'a>(
        &self,
        language: Option<&'a str>,
        initial_prompt: Option<&str>,
        cancel: &'a AtomicBool,
    ) -> AppResult<Runner<'a>> {
        let state = self
            .ctx
            .create_state()
            .map_err(|e| AppError::new(Code::ModelUnreadable, e.to_string()))?;
        Ok(Runner {
            state,
            eot: self.ctx.token_eot(),
            prompt: initial_prompt
                .map(|p| p.replace('\0', " "))
                .filter(|p| !p.trim().is_empty()),
            language,
            cancel,
        })
    }
}

impl Runner<'_> {
    /// Transcribes one window; `audio` holds recording samples `w.lo..w.until`. `progress`
    /// gets 0..1 within the window. Returns the window's segments (recording times) and, when
    /// the model was left to tell, the language it heard.
    pub fn window(
        &mut self,
        w: &Window,
        audio: &[f32],
        progress: Arc<dyn Fn(f64) + Send + Sync>,
    ) -> AppResult<WindowDone> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(stopped());
        }
        let (joined, pieces) = join_at(audio, w.lo, &w.stretches);
        if pieces.is_empty() {
            return Ok(WindowDone {
                segments: Vec::new(),
                until: w.until,
                language: None,
            });
        }
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(crate::cpu::whisper_threads());
        params.set_language(Some(self.language.unwrap_or("auto")));
        params.set_translate(false);
        // Each window on its own: a misheard phrase is not carried into the next one.
        params.set_no_context(true);
        params.set_suppress_blank(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_token_timestamps(true);
        if let Some(p) = &self.prompt {
            params.set_initial_prompt(p);
        }
        params.set_progress_callback_safe(move |pct: i32| {
            progress(pct.clamp(0, 100) as f64 / 100.0);
        });
        // Not whisper-rs's set_abort_callback_safe: in 0.16 its trampoline reads the closure
        // as the wrong type (gotcha 1).
        // SAFETY: the flag lives in the job, which outlives `full` below.
        unsafe {
            params.set_abort_callback(Some(abort_if_cancelled));
            params.set_abort_callback_user_data(self.cancel.as_ptr() as *mut c_void);
        }
        let result = self.state.full(params, &joined);
        if self.cancel.load(Ordering::Relaxed) {
            return Err(stopped());
        }
        result.map_err(|e| AppError::new(Code::IoError, format!("transcription failed: {e}")))?;

        // whisper.cpp counts in hundredths of a second.
        let at = |cs: i64| cs.max(0) as usize * 10 * MS;
        let mut segments = Vec::new();
        for seg in self.state.as_iter() {
            let mut tokens = Vec::new();
            for k in 0..seg.n_tokens() {
                let Some(tok) = seg.get_token(k) else {
                    continue;
                };
                // Timestamps, the start of a transcript and the like are not words.
                if tok.token_id() >= self.eot {
                    continue;
                }
                let data = tok.token_data();
                // DTW gives the moment each word is said; t0/t1 are only the fallback.
                let t = if data.t_dtw >= 0 { data.t_dtw } else { data.t0 };
                tokens.push(Token {
                    t0: at(t),
                    t1: at(data.t1.max(t)),
                    text: tok
                        .to_str_lossy()
                        .map(|t| t.into_owned())
                        .unwrap_or_default(),
                    p: data.p,
                });
            }
            segments.extend(place_words(&tokens, &pieces));
        }
        let language = if self.language.is_some() {
            None
        } else {
            whisper_rs::get_lang_str(self.state.full_lang_id_from_state()).map(str::to_string)
        };
        Ok(WindowDone {
            segments,
            until: w.until,
            language,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_codes_from_tags() {
        assert_eq!(language_code("pt-PT").as_deref(), Some("pt"));
        assert_eq!(language_code("es-ES").as_deref(), Some("es"));
        assert_eq!(language_code("en").as_deref(), Some("en"));
        assert_eq!(language_code("auto"), None);
        assert_eq!(language_code("xx"), None);
    }

    #[test]
    fn windows_hold_about_ten_minutes() {
        let s = pieces::SECOND;
        let speech: Vec<_> = (0..200)
            .map(|i| (i * 12 * s, i * 12 * s + 10 * s))
            .collect();
        let w = windows(&speech, 2400 * s);
        assert!(w.len() >= 4);
        for g in &w {
            assert!(pieces::START + g.cost <= WINDOW);
            assert_eq!(g.lo, g.stretches[0].0.saturating_sub(LEAD));
            assert!(g.until <= 2400 * s);
        }
        assert_eq!(w.iter().map(|g| g.stretches.len()).sum::<usize>(), 200);
        // Sparse speech: a window never spans more than 30 minutes of the recording.
        let sparse: Vec<_> = (0..20)
            .map(|i| (i * 600 * s, i * 600 * s + 5 * s))
            .collect();
        for g in windows(&sparse, 12_000 * s) {
            assert!(g.until - g.lo <= MAX_SPAN + LEAD + OVERLAP);
        }
    }
}
