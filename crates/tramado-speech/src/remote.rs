// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/remote.rs), MPL-2.0, same author.

//! Cloud transcription (paid, off by default, critique C13): the same steps as on this
//! computer — the speech found, the stretches joined with short pauses — but the speech goes to
//! OpenRouter's `audio/transcriptions` in pieces of at most 30 s of joined audio (providers
//! time out on long requests), four at a time, and the times it gives back are mapped onto the
//! recording. Only stretches with speech are sent. In an online class recorded in stereo a piece
//! ends where the other side speaks, so turns keep their order.
//!
//! Requests go through `SttTransport` (the desktop crate passes `AiPipe::request_blocking`,
//! which injects the key and overwrites `provider` from the privacy level; D-12). This module
//! never sets `provider` itself.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine as _;
use serde_json::{json, Value};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_net::ai::AiBody;

use crate::pieces::{self, join_at, place, Piece, LEAD, OVERLAP, SECOND};
use crate::samples::Track16;
use crate::types::Segment;
use crate::{SttTransport, SAMPLE_RATE};

/// The longest piece of joined audio sent at once.
pub const MAX_PIECE: usize = 30 * SECOND;
/// A stretch longer than this is cut at its quietest moment before the limit.
const MAX_STRETCH: usize = 27 * SECOND;
/// Where to look for that quiet moment: the last seconds before the limit.
const CUT_WINDOW: usize = 7 * SECOND;
/// Requests in flight at once.
pub const WORKERS: usize = 4;
/// How long one request may take (providers stop at 60 s of processing).
const TIMEOUT: Duration = Duration::from_secs(120);
pub const PATH: &str = "audio/transcriptions";

/// 16-bit mono WAV at 16 kHz.
pub fn wav(samples: &[f32]) -> Vec<u8> {
    let data = samples.len() * 2;
    let mut out = Vec::with_capacity(44 + data);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + data) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data as u32).to_le_bytes());
    for s in samples {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

/// What the service said about one piece: its text and, when it gives them, timed segments.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Heard {
    pub text: String,
    /// (start, end, text), seconds from the start of the piece.
    pub segments: Vec<(f64, f64, String)>,
    pub language: Option<String>,
}

pub fn read_answer(v: &Value) -> Heard {
    let segments = v
        .get("segments")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    let start = s.get("start")?.as_f64()?;
                    let end = s.get("end")?.as_f64()?;
                    let text = s.get("text")?.as_str()?.trim().to_string();
                    (!text.is_empty()).then_some((start, end.max(start), text))
                })
                .collect()
        })
        .unwrap_or_default();
    Heard {
        text: v
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        segments,
        language: v
            .get("language")
            .and_then(Value::as_str)
            .and_then(crate::langs::code),
    }
}

/// A piece's text back on the recording: each timed segment where it was said, or the whole
/// text over the piece's speech when the service gives no times.
pub fn place_heard(heard: &Heard, pieces: &[Piece], audio_len: usize) -> Vec<Segment> {
    let ms = |samples: usize| (samples * 1000 / SAMPLE_RATE as usize) as u64;
    let at = |secs: f64| ((secs.max(0.0) * SAMPLE_RATE as f64) as usize).min(audio_len);
    if heard.segments.is_empty() {
        let (Some(first), Some(last)) = (pieces.first(), pieces.last()) else {
            return Vec::new();
        };
        if heard.text.is_empty() {
            return Vec::new();
        }
        return vec![Segment {
            start_ms: ms(first.original),
            end_ms: ms(last.original + last.len),
            text: heard.text.clone(),
            words: None,
        }];
    }
    heard
        .segments
        .iter()
        .map(|(s, e, text)| {
            let start = place(at(*s), pieces, true);
            Segment {
                start_ms: ms(start),
                end_ms: ms(place(at(*e), pieces, false).max(start)),
                text: text.clone(),
                words: None,
            }
        })
        .collect()
}

/// The error of a non-2xx answer.
pub fn status_error(status: u16, body: &[u8], model: &str) -> AppError {
    let text = String::from_utf8_lossy(body);
    let message = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| format!("HTTP {status}"));
    let code = match status {
        401 => Code::AiAuth,
        402 => Code::AiNoCredit,
        403 => Code::AiModelGated,
        404 if text.contains("data policy") => {
            return AppError::new(Code::AiPrivacyBlocks, message)
                .with_data(json!({ "stt": true }));
        }
        404 => {
            return AppError::new(Code::AiModelUnknown, message).with_data(json!({ "model": model }));
        }
        408 => Code::AiTimeout,
        413 => {
            return AppError::new(Code::AiTooLong, message).with_data(json!({ "model": model }));
        }
        400 | 422 => Code::AiBadRequest,
        429 => {
            return AppError::new(Code::AiBusy, message).with_data(json!({ "model": model }));
        }
        502 | 503 => Code::AiUnavailable,
        _ => Code::AiUpstream,
    };
    AppError::new(code, message)
}

fn transient(e: &AppError) -> bool {
    matches!(
        e.code(),
        Code::AiBusy | Code::AiTimeout | Code::AiUpstream | Code::AiUnavailable | Code::AiOffline
    )
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

/// One piece of a track, ready to send.
struct Task {
    track: usize,
    audio: Vec<f32>,
    pieces: Vec<Piece>,
}

/// What a service is asked to transcribe with.
pub struct Remote<'a> {
    pub stt: &'a dyn SttTransport,
    pub model: &'a str,
    /// The class vocabulary, sent as `prompt`.
    pub prompt: Option<&'a str>,
    /// Retries wait 2, 4, 8 s (tests make it shorter).
    pub backoff: Duration,
}

/// A track's result: its segments and the language the service heard most.
pub type TrackText = (Vec<Segment>, Option<String>);

impl Remote<'_> {
    /// Transcribes every track (with the speech stretches of each); `progress` gets 0..1 over
    /// all their pieces together.
    pub fn run(
        &self,
        tracks: &[(&Track16, Vec<(usize, usize)>)],
        language: Option<&str>,
        cancel: &AtomicBool,
        progress: &(dyn Fn(f64) + Sync),
    ) -> AppResult<Vec<TrackText>> {
        let mut tasks = Vec::new();
        let cut: Vec<Vec<(usize, usize)>> = tracks
            .iter()
            .map(|(t, s)| {
                let all = t.to_f32(0, t.len());
                pieces::split_long(&all, 0, s, MAX_STRETCH, CUT_WINDOW)
            })
            .collect();
        for (i, (track, _)) in tracks.iter().enumerate() {
            let other: &[(usize, usize)] = if tracks.len() == 2 { &cut[1 - i] } else { &[] };
            for group in pieces::pack(&cut[i], other, MAX_PIECE) {
                let (Some(first), Some(last)) = (group.first(), group.last()) else {
                    continue;
                };
                let lo = first.0.saturating_sub(LEAD);
                let hi = (last.1 + OVERLAP).min(track.len());
                let (audio, pieces) = join_at(&track.to_f32(lo, hi), lo, &group);
                if !pieces.is_empty() {
                    tasks.push(Task {
                        track: i,
                        audio,
                        pieces,
                    });
                }
            }
        }
        let results = self.send_all(&tasks, language, cancel, progress)?;
        let mut out: Vec<Vec<Segment>> = tracks.iter().map(|_| Vec::new()).collect();
        let mut heard_languages: Vec<Vec<String>> = vec![Vec::new(); tracks.len()];
        for (task, heard) in tasks.iter().zip(results) {
            out[task.track].extend(place_heard(&heard, &task.pieces, task.audio.len()));
            heard_languages[task.track].extend(heard.language);
        }
        Ok(out
            .into_iter()
            .zip(heard_languages)
            .map(|(mut segs, langs)| {
                segs.sort_by_key(|s| s.start_ms);
                (segs, most_common(langs))
            })
            .collect())
    }

    fn send_all(
        &self,
        tasks: &[Task],
        language: Option<&str>,
        cancel: &AtomicBool,
        progress: &(dyn Fn(f64) + Sync),
    ) -> AppResult<Vec<Heard>> {
        let next = AtomicUsize::new(0);
        let done = AtomicUsize::new(0);
        let failed: Mutex<Option<AppError>> = Mutex::new(None);
        // Some models refuse verbose_json: plain json from there on.
        let plain = AtomicBool::new(false);
        let results: Vec<Mutex<Option<Heard>>> = tasks.iter().map(|_| Mutex::new(None)).collect();
        let total = tasks.len().max(1);
        let has_failed = || {
            failed
                .lock()
                .map(|f| f.is_some())
                .unwrap_or(true)
        };
        std::thread::scope(|scope| {
            for n in 0..WORKERS.min(tasks.len()) {
                let worker = || loop {
                    if cancel.load(Ordering::Relaxed) || has_failed() {
                        return;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(task) = tasks.get(i) else {
                        return;
                    };
                    match self.send(task, language, &plain, cancel) {
                        Ok(heard) => {
                            if let Ok(mut r) = results[i].lock() {
                                *r = Some(heard);
                            }
                            let k = done.fetch_add(1, Ordering::Relaxed) + 1;
                            progress(k as f64 / total as f64);
                        }
                        Err(e) => {
                            if let Ok(mut f) = failed.lock() {
                                f.get_or_insert(e);
                            }
                            return;
                        }
                    }
                };
                let spawned = std::thread::Builder::new()
                    .name(format!("tramado-stt-{n}"))
                    .spawn_scoped(scope, worker);
                if let Err(e) = spawned {
                    if let Ok(mut f) = failed.lock() {
                        f.get_or_insert(e.into());
                    }
                }
            }
        });
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::new(Code::Cancelled, "stopped"));
        }
        if let Some(e) = failed.into_inner().unwrap_or_else(|e| e.into_inner()) {
            return Err(e);
        }
        Ok(results
            .into_iter()
            .map(|r| {
                r.into_inner()
                    .unwrap_or_else(|e| e.into_inner())
                    .unwrap_or_default()
            })
            .collect())
    }

    /// One piece, retried a few times when the service is busy or the network hiccups.
    fn send(
        &self,
        task: &Task,
        language: Option<&str>,
        plain: &AtomicBool,
        cancel: &AtomicBool,
    ) -> AppResult<Heard> {
        let audio = base64::engine::general_purpose::STANDARD.encode(wav(&task.audio));
        let mut attempt = 0u32;
        loop {
            let verbose = !plain.load(Ordering::Relaxed);
            match self.request(&audio, language, verbose) {
                Ok(v) => return Ok(read_answer(&v)),
                Err(e) if verbose && e.code() == Code::AiBadRequest => {
                    plain.store(true, Ordering::Relaxed);
                }
                Err(e) if transient(&e) && attempt < 3 => {
                    attempt += 1;
                    let until = std::time::Instant::now() + self.backoff * 2u32.pow(attempt - 1);
                    while std::time::Instant::now() < until {
                        if cancel.load(Ordering::Relaxed) {
                            return Err(AppError::new(Code::Cancelled, "stopped"));
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
                Err(e) => return Err(e),
            }
        }
    }

    /// The request body (OpenRouter's JSON form, as Trama sends it).
    pub fn body(&self, audio_b64: &str, language: Option<&str>, verbose: bool) -> Value {
        let mut body = json!({
            "model": self.model,
            "input_audio": { "data": audio_b64, "format": "wav" },
            "response_format": if verbose { "verbose_json" } else { "json" },
            "temperature": 0,
        });
        if verbose {
            body["timestamp_granularities"] = json!(["segment"]);
        }
        if let Some(l) = language {
            body["language"] = json!(l);
        }
        if let Some(p) = self.prompt.filter(|p| !p.trim().is_empty()) {
            body["prompt"] = json!(p);
        }
        body
    }

    fn request(&self, audio_b64: &str, language: Option<&str>, verbose: bool) -> AppResult<Value> {
        let body = self.body(audio_b64, language, verbose);
        let (status, bytes) = self.stt.post(PATH, AiBody::Json(body), TIMEOUT)?;
        if !(200..300).contains(&status) {
            return Err(status_error(status, &bytes, self.model));
        }
        serde_json::from_slice(&bytes)
            .map_err(|e| AppError::new(Code::AiUpstream, format!("unreadable answer: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    const S: usize = SECOND;

    #[test]
    fn places_timed_segments_on_the_recording() {
        let samples = vec![0.1f32; 50 * S];
        let (audio, pieces) = pieces::join(&samples, &[(10 * S, 13 * S), (40 * S, 42 * S)]);
        let heard = Heard {
            text: "Olá. Boa tarde.".into(),
            segments: vec![(0.7, 3.5, "Olá.".into()), (4.0, 5.5, "Boa tarde.".into())],
            language: Some("pt".into()),
        };
        let segs = place_heard(&heard, &pieces, audio.len());
        assert_eq!(segs.len(), 2);
        assert!(segs[0].start_ms >= 9_800 && segs[0].start_ms <= 10_600, "{segs:?}");
        assert!(segs[1].start_ms >= 39_800 && segs[1].start_ms <= 40_200, "{segs:?}");
        let whole = place_heard(
            &Heard {
                text: "Olá.".into(),
                ..Default::default()
            },
            &pieces,
            audio.len(),
        );
        assert_eq!(whole.len(), 1);
        assert_eq!(whole[0].start_ms, (pieces[0].original * 1000 / S) as u64);
    }

    #[test]
    fn reads_what_services_answer() {
        let v: Value = serde_json::from_str(r#"{"text":" Olá ","language":"portuguese","segments":[{"start":0.0,"end":1.2,"text":" Olá "},{"start":1,"end":2,"text":"  "}]}"#).unwrap();
        let h = read_answer(&v);
        assert_eq!(h.text, "Olá");
        assert_eq!(h.segments, vec![(0.0, 1.2, "Olá".to_string())]);
        assert_eq!(h.language.as_deref(), Some("pt"));
        assert_eq!(
            most_common(vec!["pt".into(), "es".into(), "pt".into()]).as_deref(),
            Some("pt")
        );
    }

    #[test]
    fn writes_a_wav_header() {
        let w = wav(&[0.0, 0.5, -1.0]);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), SAMPLE_RATE);
        assert_eq!(u32::from_le_bytes(w[40..44].try_into().unwrap()), 6);
        assert_eq!(w.len(), 50);
    }

    #[test]
    fn maps_statuses_to_codes() {
        assert_eq!(status_error(402, b"{}", "m").code(), Code::AiNoCredit);
        assert_eq!(status_error(429, b"{}", "m").code(), Code::AiBusy);
        let e = status_error(
            404,
            br#"{"error":{"message":"No endpoints found matching your data policy"}}"#,
            "m",
        );
        assert_eq!(e.code(), Code::AiPrivacyBlocks);
        assert_eq!(e.data(), Some(&json!({"stt": true})));
        assert_eq!(status_error(404, b"{}", "m").code(), Code::AiModelUnknown);
        assert_eq!(status_error(500, b"oops", "m").code(), Code::AiUpstream);
    }

    /// Answers in order; records each request's body.
    struct Canned {
        answers: StdMutex<Vec<(u16, String)>>,
        seen: StdMutex<Vec<(String, Value)>>,
    }

    impl SttTransport for Canned {
        fn post(&self, path: &str, body: AiBody, _t: Duration) -> AppResult<(u16, Vec<u8>)> {
            let AiBody::Json(v) = body else {
                return Err(AppError::invalid("multipart"));
            };
            self.seen.lock().unwrap().push((path.to_string(), v));
            let mut a = self.answers.lock().unwrap();
            let (s, b) = if a.is_empty() {
                (200, r#"{"text":"mais"}"#.to_string())
            } else {
                a.remove(0)
            };
            Ok((s, b.into_bytes()))
        }
    }

    #[test]
    fn sends_each_piece_and_falls_back_to_plain_json() {
        // 40 s of tone in one stretch → two pieces.
        let samples: Vec<f32> = (0..40 * S).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        let t = Track16::from_f32(&samples);
        let stt = Canned {
            answers: StdMutex::new(vec![
                (400, r#"{"error":{"message":"verbose_json not supported"}}"#.into()),
                (200, r#"{"text":"primeira parte"}"#.into()),
                (200, r#"{"text":"segunda parte"}"#.into()),
            ]),
            seen: StdMutex::new(Vec::new()),
        };
        let remote = Remote {
            stt: &stt,
            model: "openai/whisper-large-v3-turbo",
            prompt: Some("Código Civil"),
            backoff: Duration::from_millis(1),
        };
        let cancel = AtomicBool::new(false);
        let last = StdMutex::new(0.0);
        let out = remote
            .run(&[(&t, vec![(0, 40 * S)])], Some("pt"), &cancel, &|p| {
                *last.lock().unwrap() = p
            })
            .unwrap();
        let texts: Vec<_> = out[0].0.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts.len(), 2);
        assert!(texts.contains(&"primeira parte") && texts.contains(&"segunda parte"));
        assert_eq!(*last.lock().unwrap(), 1.0);
        let seen = stt.seen.lock().unwrap();
        assert_eq!(seen.len(), 3);
        assert_eq!(seen[0].0, "audio/transcriptions");
        assert_eq!(seen[0].1["response_format"], "verbose_json");
        assert_eq!(seen[0].1["language"], "pt");
        assert_eq!(seen[0].1["prompt"], "Código Civil");
        assert!(seen[0].1.get("provider").is_none());
        assert!(seen[1..].iter().all(|(_, b)| b["response_format"] == "json"));
    }

    #[test]
    fn stops_at_the_first_lasting_error_and_retries_busy() {
        let samples: Vec<f32> = (0..20 * S).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        let t = Track16::from_f32(&samples);
        let stt = Canned {
            answers: StdMutex::new(vec![(402, r#"{"error":{"message":"no credit"}}"#.into())]),
            seen: StdMutex::new(Vec::new()),
        };
        let remote = Remote {
            stt: &stt,
            model: "m",
            prompt: None,
            backoff: Duration::from_millis(1),
        };
        let e = remote
            .run(&[(&t, vec![(0, 20 * S)])], None, &AtomicBool::new(false), &|_| {})
            .unwrap_err();
        assert_eq!(e.code(), Code::AiNoCredit);
        let stt = Canned {
            answers: StdMutex::new(vec![
                (429, "{}".into()),
                (200, r#"{"text":"ok","language":"english"}"#.into()),
            ]),
            seen: StdMutex::new(Vec::new()),
        };
        let remote = Remote {
            stt: &stt,
            model: "m",
            prompt: None,
            backoff: Duration::from_millis(1),
        };
        let out = remote
            .run(&[(&t, vec![(0, 20 * S)])], None, &AtomicBool::new(false), &|_| {})
            .unwrap();
        assert_eq!(out[0].0[0].text, "ok");
        assert_eq!(out[0].1.as_deref(), Some("en"));
    }
}
