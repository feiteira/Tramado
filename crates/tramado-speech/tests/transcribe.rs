// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Local transcription with the real whisper.cpp model (all ignored: they need a model file
//! and a release build). The model files come from `TRAMADO_SPEECH_DIR` (the folder
//! `tools/fetch-speech-assets.mjs --model=…` fills, or any folder that holds them):
//!
//! ```text
//! TRAMADO_SPEECH_DIR=.tramado-dev/models TRAMADO_SPEECH_MODEL=small \
//!   TRAMADO_SPEECH_SAMPLE=app/test-fixtures/tramado/audio/speech-pt.webm \
//!   cargo test -p tramado-speech --release transcribes_a_sample -- --ignored --nocapture
//! ```

#![cfg(feature = "local-whisper")]

mod common;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tramado_base::ids;
use tramado_speech::{
    AudioSource, ChannelMode, JobState, ModelId, TranscribeEngine, TranscribeEvent,
    TranscribeRequest, TranscriptionResult,
};

use common::*;

fn speech_dir() -> PathBuf {
    env_path("TRAMADO_SPEECH_DIR").expect("TRAMADO_SPEECH_DIR (a folder with the model files)")
}

fn model() -> ModelId {
    std::env::var("TRAMADO_SPEECH_MODEL")
        .ok()
        .and_then(|m| ModelId::parse(&m))
        .unwrap_or(ModelId::Turbo)
}

fn request(
    path: &str,
    sha: &str,
    job: &str,
    lecture: &str,
    language: &str,
    channels: ChannelMode,
) -> TranscribeRequest {
    TranscribeRequest {
        job_id: job.into(),
        lecture_id: lecture.into(),
        source: AudioSource::Class {
            class_id: CLASS.into(),
            path: path.into(),
        },
        expect_sha256: sha.into(),
        engine: TranscribeEngine::Local { model: model() },
        language: language.into(),
        channels,
        initial_prompt: std::env::var("TRAMADO_SPEECH_PROMPT").ok(),
        claim: None,
        resume: false,
    }
}

/// Places `bytes` in the class and transcribes them; prints the segments.
fn transcribe(
    e: &Env,
    bytes: &[u8],
    language: &str,
    channels: ChannelMode,
) -> (TranscriptionResult, f64) {
    std::fs::create_dir_all(e.root.join("Aulas/Amostra")).unwrap();
    std::fs::write(e.root.join("Aulas/Amostra/audio.webm"), bytes).unwrap();
    let sha = ids::sha256_hex(bytes);
    let lecture = ids::new_ulid(tramado_base::time::now_ms());
    let job = format!("job-{lecture}");
    let sink = Collect::<TranscribeEvent>::new();
    let started = Instant::now();
    e.speech
        .transcribe_start(
            request(
                "Aulas/Amostra/audio.webm",
                &sha,
                &job,
                &lecture,
                language,
                channels,
            ),
            sink.clone(),
        )
        .unwrap();
    let end = sink
        .wait(Duration::from_secs(3600), |ev| {
            matches!(
                ev,
                TranscribeEvent::Done { .. } | TranscribeEvent::Failed { .. }
            )
        })
        .expect("the job finished");
    if let TranscribeEvent::Failed { code, message } = end {
        panic!("{code}: {message}");
    }
    let secs = started.elapsed().as_secs_f64();
    let phases: Vec<_> = sink
        .all()
        .into_iter()
        .filter_map(|ev| match ev {
            TranscribeEvent::Phase { phase } => Some(phase),
            _ => None,
        })
        .collect();
    println!("phases: {phases:?}");
    let r = e.speech.take_result(&job).unwrap();
    (r, secs)
}

fn fmt(ms: u64) -> String {
    format!("{:02}:{:02}.{:03}", ms / 60_000, ms / 1000 % 60, ms % 1000)
}

fn print(r: &TranscriptionResult, secs: f64) {
    println!(
        "engine {} {} {} (vad {:?}), language {}, {} ms of audio in {secs:.1} s ({:.2}× real time)",
        r.engine.name,
        r.engine.version.as_deref().unwrap_or(""),
        r.engine.model.as_deref().unwrap_or(""),
        r.engine.vad,
        r.language,
        r.duration_ms,
        r.duration_ms as f64 / 1000.0 / secs
    );
    for t in &r.tracks {
        println!("track {:?}:", t.speaker);
        for s in &t.segments {
            println!("  [{} – {}] {}", fmt(s.start_ms), fmt(s.end_ms), s.text);
            if std::env::var_os("TRAMADO_SPEECH_WORDS").is_some() {
                for w in s.words.iter().flatten() {
                    println!(
                        "      {} – {}  {:<20} p={:.2}",
                        fmt(w.start_ms),
                        fmt(w.end_ms),
                        w.text,
                        w.p
                    );
                }
            }
        }
    }
}

#[test]
#[ignore]
fn transcribes_a_sample() {
    let sample =
        env_path("TRAMADO_SPEECH_SAMPLE").unwrap_or_else(|| fixture_audio("speech-pt.webm"));
    let channels = match std::env::var("TRAMADO_SPEECH_CHANNELS").as_deref() {
        Ok("split") => ChannelMode::Split,
        _ => ChannelMode::Mix,
    };
    let language = std::env::var("TRAMADO_SPEECH_LANGUAGE").unwrap_or_else(|_| "auto".into());
    let e = env(Some(&speech_dir()), Arc::new(NoCloud));
    let bytes = std::fs::read(&sample).unwrap();
    let (r, secs) = transcribe(&e, &bytes, &language, channels);
    print(&r, secs);
    let segs: Vec<_> = r.tracks.iter().flat_map(|t| t.segments.iter()).collect();
    assert!(!segs.is_empty(), "no text");
    assert!(segs.iter().all(|s| !s.text.trim().is_empty()));
    // Sensible timings: inside the recording, ordered, each end after its start.
    for t in &r.tracks {
        assert!(t
            .segments
            .windows(2)
            .all(|w| w[0].start_ms <= w[1].start_ms));
    }
    assert!(segs
        .iter()
        .all(|s| s.start_ms <= s.end_ms && s.end_ms <= r.duration_ms + 500));
    if sample.ends_with("speech-pt.webm") {
        let text = segs
            .iter()
            .map(|s| s.text.to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            text.contains("constitucional") || text.contains("direito"),
            "{text}"
        );
        assert_eq!(r.language, "pt");
        assert!(segs[0].start_ms < 2_000);
    }
    // The speed is remembered for the model (member file caps.localModel.speedRT).
    let m = e
        .speech
        .models()
        .into_iter()
        .find(|m| m.id == model())
        .unwrap();
    assert!(m.speed_rt.is_some());
}

/// Word error rate (words lower-cased, punctuation dropped).
fn wer(reference: &str, hypothesis: &str) -> f64 {
    let words = |s: &str| -> Vec<String> {
        s.to_lowercase()
            .split(|c: char| !c.is_alphanumeric() && c != 'º' && c != 'ª')
            .filter(|w| !w.is_empty())
            .map(str::to_string)
            .collect()
    };
    let (r, h) = (words(reference), words(hypothesis));
    let mut d: Vec<Vec<usize>> = vec![vec![0; h.len() + 1]; r.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=r.len() {
        for j in 1..=h.len() {
            let sub = d[i - 1][j - 1] + usize::from(r[i - 1] != h[j - 1]);
            d[i][j] = sub.min(d[i - 1][j] + 1).min(d[i][j - 1] + 1);
        }
    }
    d[r.len()][h.len()] as f64 / r.len().max(1) as f64
}

const PT: &str = "Aula 5 de Direito Constitucional. Hoje vamos estudar o artigo 18.º. As restrições aos direitos, liberdades e garantias têm de respeitar o princípio da proporcionalidade e nunca podem afetar o conteúdo essencial do direito.";
const EN: &str = "Hello class. Today we discuss the separation of powers: legislative, executive and judicial branches.";

/// Word error rate and speed on the fixtures, against their reference texts (critique R8).
#[test]
#[ignore]
fn wer_report() {
    let e = env(Some(&speech_dir()), Arc::new(NoCloud));
    println!("| clip | language | WER | × real time |");
    println!("|---|---|---|---|");
    for (file, reference, language) in [
        ("speech-pt.webm", PT, "pt-PT"),
        ("speech-en.webm", EN, "en"),
    ] {
        let bytes = std::fs::read(fixture_audio(file)).unwrap();
        let (r, secs) = transcribe(&e, &bytes, language, ChannelMode::Mix);
        let text = r.tracks[0]
            .segments
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let w = wer(reference, &text);
        println!(
            "| {file} | {language} | {:.1}% | {:.2} |",
            w * 100.0,
            r.duration_ms as f64 / 1000.0 / secs
        );
        println!("  heard: {text}");
        assert!(w < 0.5, "{file}: WER {w}");
    }
}

fn peak_rss_mb() -> Option<f64> {
    let s = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = s.lines().find(|l| l.starts_with("VmHWM:"))?;
    let kb: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb / 1024.0)
}

/// A three-hour lecture (critique G22, R9): peak memory below 1.5 GB through decode, voice
/// detection and the first window; a cancelled job resumes from its partial file without
/// redoing the windows it finished.
#[test]
#[ignore]
fn long_lecture_memory() {
    let e = env(Some(&speech_dir()), Arc::new(NoCloud));
    // Three hours: the two speech clips over and over, with pauses between them.
    let mut clip = Vec::new();
    for f in ["speech-pt.webm", "speech-en.webm"] {
        let (t, _) = tramado_speech::decode::decode(
            tramado_speech::decode::file_source(&fixture_audio(f)).unwrap(),
            Some("webm"),
            tramado_speech::decode::Channels::Mix,
            &|| false,
        )
        .unwrap();
        clip.extend_from_slice(&t[0]);
        clip.extend(std::iter::repeat_n(0.0, 2 * 16_000));
    }
    let hours = std::env::var("TRAMADO_SPEECH_HOURS")
        .ok()
        .and_then(|h| h.parse::<f64>().ok())
        .unwrap_or(3.0);
    let n = (hours * 3600.0 * 16_000.0) as usize;
    let t0 = Instant::now();
    let webm = {
        let mut enc = tramado_speech::encode::FrameEncoder::new(1, 24_000).unwrap();
        let head = tramado_speech::encode::opus_head(1, enc.preskip48());
        let mut packets = Vec::new();
        let mut done = 0;
        while done < n {
            let take = clip.len().min(n - done);
            packets.extend(enc.push(&clip[..take]).unwrap().into_iter().map(|(p, _)| p));
            done += take;
        }
        let (rest, end) = enc.finish().unwrap();
        packets.extend(rest.into_iter().map(|(p, _)| p));
        tramado_speech::webm::mux(&head, &packets, end).unwrap()
    };
    drop(clip);
    println!(
        "{hours} h of audio: {} MB of WebM, encoded in {:.0} s; peak RSS so far {:?} MB",
        webm.len() / 1_000_000,
        t0.elapsed().as_secs_f64(),
        peak_rss_mb()
    );
    std::fs::create_dir_all(e.root.join("Aulas/Longa")).unwrap();
    std::fs::write(e.root.join("Aulas/Longa/audio.webm"), &webm).unwrap();
    let sha = ids::sha256_hex(&webm);
    drop(webm);
    let lecture = "01JBX4Q7Z5W8M2E3C9R6T0YH2K";
    let partial = e
        .paths
        .transcribe_dir()
        .join(format!("{lecture}.partial.json"));
    let until = || -> Option<(u64, usize)> {
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&partial).ok()?).ok()?;
        let t = &v["tracks"][0];
        Some((t["until"].as_u64()?, t["segments"].as_array()?.len()))
    };
    let run = |job: &str, resume: bool, past: u64| -> (u64, usize) {
        let mut req = request(
            "Aulas/Longa/audio.webm",
            &sha,
            job,
            lecture,
            "pt-PT",
            ChannelMode::Mix,
        );
        req.resume = resume;
        let sink = Collect::<TranscribeEvent>::new();
        let started = Instant::now();
        e.speech.transcribe_start(req, sink.clone()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3600);
        loop {
            if let Some((u, n)) = until() {
                if u > past {
                    println!(
                        "{job}: a window done at {:.0} s ({} segments) after {:.0} s; peak RSS {:?} MB",
                        u as f64 / 16_000.0,
                        n,
                        started.elapsed().as_secs_f64(),
                        peak_rss_mb()
                    );
                    e.speech.transcribe_cancel(job, true);
                    sink.wait(Duration::from_secs(120), |ev| {
                        matches!(ev, TranscribeEvent::Cancelled)
                    })
                    .expect("cancelled");
                    return (u, n);
                }
            }
            assert!(Instant::now() < deadline, "no window in an hour");
            assert!(
                !sink
                    .all()
                    .iter()
                    .any(|ev| matches!(ev, TranscribeEvent::Failed { .. })),
                "{:?}",
                sink.all()
            );
            std::thread::sleep(Duration::from_secs(2));
        }
    };
    let (u1, n1) = run("job-long-1", false, 0);
    assert!(e.speech.jobs().iter().all(|j| j.state != JobState::Running));
    let (u2, n2) = run("job-long-2", true, u1);
    assert!(u2 > u1 && n2 > n1, "resume continued from the partial file");
    let peak = peak_rss_mb().unwrap_or(0.0);
    println!("peak RSS {peak:.0} MB");
    assert!(peak < 1536.0, "{peak} MB");
}
