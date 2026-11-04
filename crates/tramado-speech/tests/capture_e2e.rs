// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The real path end to end on a machine with a sound server (ignored): a speech clip is
//! played into a PulseAudio null sink while Tramado records that sink's monitor as its
//! microphone; the Ogg Opus journal is closed, remuxed to WebM and published into a class,
//! decoded again, and transcribed by whisper.cpp with timestamps.
//!
//! ```text
//! pulseaudio --start --exit-idle-time=-1
//! pactl load-module module-null-sink sink_name=tramado_test
//! TRAMADO_SPEECH_DIR=<models> cargo test -p tramado-speech --release \
//!   records_and_transcribes_end_to_end -- --ignored --nocapture
//! ```

#![cfg(feature = "local-whisper")]

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use tramado_base::{ids, time};
use tramado_speech::decode::{self, Channels};
use tramado_speech::{
    AudioSource, ChannelMode, MarkerKind, ModelId, PublishRequest, RecordMode, RecorderEvent,
    RecorderStartRequest, ShareMode, TranscribeEngine, TranscribeEvent, TranscribeRequest,
};

use common::*;

fn wav16(samples: &[f32]) -> Vec<u8> {
    tramado_speech::remote::wav(samples)
}

#[test]
#[ignore]
fn records_and_transcribes_end_to_end() {
    let sink_name = std::env::var("TRAMADO_TEST_SINK").unwrap_or_else(|_| "tramado_test".into());
    let models = env_path("TRAMADO_SPEECH_DIR").expect("TRAMADO_SPEECH_DIR");
    let e = env(Some(&models), Arc::new(NoCloud));

    // The clip to play: the PT fixture, decoded to a WAV paplay can read.
    let (clip, _) = decode::decode(
        decode::file_source(&fixture_audio("speech-pt.webm")).unwrap(),
        Some("webm"),
        Channels::Mix,
        &|| false,
    )
    .unwrap();
    let wav = e.dir.path().join("clip.wav");
    std::fs::write(&wav, wav16(&clip[0])).unwrap();

    let id = ids::new_ulid(time::now_ms());
    let events = Collect::<RecorderEvent>::new();
    let status = e
        .speech
        .recorder_start(
            RecorderStartRequest {
                recording_id: id.clone(),
                class_id: CLASS.into(),
                title: "Aula 5 — gravada pelo teste".into(),
                mode: RecordMode::Room,
                include_mic: true,
                input_device_id: Some(format!("pulseaudio:{sink_name}.monitor")),
                language: "pt-PT".into(),
                bitrate: 24_000,
                marker_offset_ms: 3_000,
            },
            events.clone(),
        )
        .unwrap();
    println!("recording: {status:?}");
    std::thread::sleep(Duration::from_millis(700));
    let started = Instant::now();
    let mut play = std::process::Command::new("paplay")
        .arg(format!("--device={sink_name}"))
        .arg(&wav)
        .spawn()
        .expect("paplay");
    std::thread::sleep(Duration::from_secs(6));
    let marker = e
        .speech
        .recorder_mark(MarkerKind::Exam, Some("artigo 18.º".into()))
        .unwrap();
    // A pause while the clip plays on: those seconds are not in the recording.
    let paused = e.speech.recorder_pause().unwrap();
    std::thread::sleep(Duration::from_millis(1500));
    e.speech.recorder_resume().unwrap();
    let _ = play.wait();
    println!("played in {:.1} s", started.elapsed().as_secs_f64());
    std::thread::sleep(Duration::from_millis(800));
    let finished = e.speech.recorder_stop().unwrap();
    println!(
        "finished: {} ms, {} ch, {} kbps, markers {:?}, pauses {:?}",
        finished.duration_ms,
        finished.channels,
        finished.bitrate / 1000,
        finished.markers,
        finished.pauses
    );
    let statuses: Vec<_> = events
        .all()
        .into_iter()
        .filter_map(|ev| match ev {
            RecorderEvent::Status { status } => Some(status),
            _ => None,
        })
        .collect();
    let loudest = statuses
        .iter()
        .filter_map(|s| s.tracks.mic.as_ref().map(|m| m.peak))
        .fold(0.0f32, f32::max);
    println!(
        "{} status events, mic peak {loudest:.2}, device {:?}, {} bytes",
        statuses.len(),
        statuses
            .last()
            .and_then(|s| s.tracks.mic.as_ref())
            .and_then(|m| m.device.clone()),
        statuses.last().map(|s| s.bytes_written).unwrap_or(0)
    );
    assert!(statuses.len() > 50, "10 Hz status");
    assert!(loudest > 0.05, "the monitor heard the clip");
    assert!(events
        .all()
        .iter()
        .any(|ev| matches!(ev, RecorderEvent::Marker { .. })));
    assert_eq!(marker.at_ms, marker.raw_ms.saturating_sub(3000));
    assert!(marker.raw_ms > 5_000 && marker.raw_ms < 8_000, "{marker:?}");
    assert_eq!(paused.state, tramado_speech::RecorderState::Paused);
    assert_eq!(finished.pauses.len(), 1);
    // About 0.7 + 16.8 + 0.8 s of wall time, less the 1.5 s pause.
    assert!(
        finished.duration_ms > 14_000 && finished.duration_ms < 19_000,
        "{}",
        finished.duration_ms
    );

    // The journal is pending until published.
    let pending = e.speech.pending_recordings().unwrap();
    assert_eq!(pending.len(), 1);
    let audio = e
        .speech
        .publish(PublishRequest {
            recording_id: id.clone(),
            class_id: CLASS.into(),
            lecture_dir: "Aulas/Aula 5".into(),
            share: ShareMode::AudioAndTranscript,
        })
        .unwrap();
    println!("published: {audio:?}");
    let webm = std::fs::read(e.root.join("Aulas/Aula 5/audio.webm")).unwrap();
    assert_eq!(audio.sha256, ids::sha256_hex(&webm));
    let (back, info) = decode::decode(
        decode::bytes_source(webm.clone()),
        Some("webm"),
        Channels::Mix,
        &|| false,
    )
    .unwrap();
    assert_eq!(info.codec, "opus");
    assert!((back[0].len() as i64 - audio.duration_ms as i64 * 16).abs() <= 16);
    let rms = (back[0].iter().map(|v| v * v).sum::<f32>() / back[0].len() as f32).sqrt();
    println!("decoded {} samples, RMS {rms:.3}", back[0].len());
    let env: Vec<String> = back[0]
        .chunks(8_000)
        .map(|c| {
            format!(
                "{:.2}",
                (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt()
            )
        })
        .collect();
    println!("RMS per 0.5 s: {}", env.join(" "));
    assert!(rms > 0.01);

    // Transcribed by whisper.cpp, with timestamps on the recording's timeline.
    let sink = Collect::<TranscribeEvent>::new();
    let t0 = Instant::now();
    e.speech
        .transcribe_start(
            TranscribeRequest {
                job_id: "job-e2e".into(),
                lecture_id: id.clone(),
                source: AudioSource::Class {
                    class_id: CLASS.into(),
                    path: "Aulas/Aula 5/audio.webm".into(),
                },
                expect_sha256: audio.sha256.clone(),
                engine: TranscribeEngine::Local {
                    model: std::env::var("TRAMADO_SPEECH_MODEL")
                        .ok()
                        .and_then(|m| ModelId::parse(&m))
                        .unwrap_or(ModelId::Turbo),
                },
                language: "pt-PT".into(),
                channels: ChannelMode::Mix,
                initial_prompt: Some("Direito Constitucional, proporcionalidade".into()),
                claim: None,
                resume: false,
            },
            sink.clone(),
        )
        .unwrap();
    let end = sink
        .wait(Duration::from_secs(1800), |ev| {
            matches!(
                ev,
                TranscribeEvent::Done { .. } | TranscribeEvent::Failed { .. }
            )
        })
        .expect("finished");
    assert!(matches!(end, TranscribeEvent::Done { .. }), "{end:?}");
    let r = e.speech.take_result("job-e2e").unwrap();
    println!(
        "transcribed {} ms in {:.1} s ({} {:?})",
        r.duration_ms,
        t0.elapsed().as_secs_f64(),
        r.engine.model.as_deref().unwrap_or(""),
        r.engine.vad
    );
    for s in &r.tracks[0].segments {
        println!("  [{:>6} – {:>6} ms] {}", s.start_ms, s.end_ms, s.text);
    }
    let text = r.tracks[0]
        .segments
        .iter()
        .map(|s| s.text.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(
        text.contains("constitucional") || text.contains("proporcionalidade"),
        "{text}"
    );
    assert!(r.tracks[0]
        .segments
        .iter()
        .all(|s| s.start_ms <= s.end_ms && s.end_ms <= r.duration_ms + 500));
    // The clip starts about 0.7 s into the recording.
    assert!(
        r.tracks[0].segments[0].start_ms >= 300,
        "{:?}",
        r.tracks[0].segments[0]
    );
}
