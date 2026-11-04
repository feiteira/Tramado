// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The recording pipeline end to end, without sound devices: Ogg journal → recovery → WebM →
//! publish into a class → decode; imports; peaks; a cloud transcription job with its claim
//! heartbeat (through a test double of `SttTransport`).

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::{ids, time};
use tramado_net::ai::AiBody;
use tramado_speech::decode::{self, Channels};
use tramado_speech::journal::{self, Journal, JournalKind, JournalPaths, JournalState, OggWriter};
use tramado_speech::{
    encode, import, webm, AudioSource, ChannelMode, ClaimRef, FinishedState, ImportAudioRequest,
    ImportEvent, JobState, PublishRequest, RecordMode, ShareMode, Speaker, SpeakerTrack,
    SttTransport, TranscribeEngine, TranscribeEvent, TranscribeRequest,
};

use common::*;

/// Ebml element IDs looked for below.
const CUES: [u8; 4] = [0x1C, 0x53, 0xBB, 0x6B];
const CUE_POINT: u8 = 0xBB;

#[test]
fn webm_roundtrip_symphonia() {
    // Five minutes of speech-like sound, as the self-test file has.
    let pcm = speechlike(300.0, 7);
    let w = webm::encode_pcm(&pcm, 1, 24_000).unwrap();
    // About 11 MB per hour at 24 kbps.
    assert!(w.len() > 300_000 && w.len() < 1_400_000, "{}", w.len());
    let (t, info) = decode::decode(
        decode::bytes_source(w.clone()),
        Some("webm"),
        Channels::Mix,
        &|| false,
    )
    .unwrap();
    assert_eq!(info.codec, "opus");
    // Duration 300.000 s, to the sample (± 1 ms allowed by the plan).
    assert!(
        (t[0].len() as i64 - 300 * 16_000).abs() <= 16,
        "{}",
        t[0].len()
    );
    // CodecDelay honoured: the decoded audio lines up with the source (no 6.5 ms shift).
    let corr = |lag: usize| -> f64 {
        (0..32_000)
            .map(|i| pcm[48_000 + i] as f64 * t[0][48_000 + i + lag] as f64)
            .sum()
    };
    assert!(corr(0) > corr(104) * 1.5, "{} {}", corr(0), corr(104));
    // Cues present, one point per ~5 s cluster.
    let at = w.windows(4).position(|x| x == CUES).expect("no Cues");
    let points = w[at..].iter().filter(|b| **b == CUE_POINT).count();
    assert!(points >= 59, "{points} cue points");
    // ffprobe agrees, when it is installed.
    if let Ok(out) = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            "-i",
            "-",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut c| {
            use std::io::Write;
            c.stdin.take().map(|mut s| s.write_all(&w));
            c.wait_with_output()
        })
    {
        let d = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !d.is_empty() {
            assert_eq!(d, "300.000000");
        }
    }
}

/// Writes a journal as the recorder does and returns its JSON.
fn write_recording(j: &JournalPaths, id: &str, pcm: &[f32], channels: u8, torn: bool) -> Journal {
    let (head, packets, _end) = journal::encode_to_packets(pcm, channels as usize, 24_000).unwrap();
    let mut w = OggWriter::create(&j.ogg(id).unwrap(), head, encode::opus_tags(&[])).unwrap();
    let n = packets.len();
    let mut last = Vec::new();
    for (i, (p, g)) in packets.into_iter().enumerate() {
        if i + 2 >= n {
            last.push((p, g));
        } else {
            w.write(p, g).unwrap();
        }
    }
    w.finish(last).unwrap();
    let ms = pcm.len() as u64 / channels as u64 * 1000 / 16_000;
    let now = time::now_ms();
    let journal = Journal {
        format: journal::JOURNAL_FORMAT.into(),
        version: 1,
        kind: JournalKind::Recording,
        recording_id: id.into(),
        class_id: CLASS.into(),
        title: "Aula 7 — Responsabilidade civil".into(),
        mode: RecordMode::Room,
        language: "pt-PT".into(),
        started_at: time::instant(now),
        started_at_ms: now,
        channels,
        bitrate: 24_000,
        preskip: 312,
        marker_offset_ms: 3000,
        speakers: vec![SpeakerTrack {
            index: 0,
            speaker: Speaker::Lecture,
        }],
        pauses: Vec::new(),
        markers: Vec::new(),
        state: if torn {
            JournalState::Recording
        } else {
            JournalState::Stopped
        },
        ms: if torn { ms } else { 0 },
        duration_ms: (!torn).then_some(ms),
        recovered_lost_ms: None,
        lecture_dir: None,
        audio: None,
        import: None,
    };
    j.write(&journal).unwrap();
    if torn {
        let p = j.ogg(id).unwrap();
        let b = std::fs::read(&p).unwrap();
        std::fs::write(&p, &b[..b.len() * 3 / 4 + 11]).unwrap();
    }
    journal
}

#[test]
fn a_torn_recording_is_recovered_published_and_cleared() {
    let e = env(None, Arc::new(NoCloud));
    let j = JournalPaths::new(e.paths.recordings_dir());
    std::fs::create_dir_all(&j.dir).unwrap();
    let id = ids::new_ulid(time::now_ms());
    write_recording(&j, &id, &speechlike(40.0, 3), 1, true);
    // The app restarts: the journal is recovered and offered again.
    let pending = e.speech.pending_recordings().unwrap();
    assert_eq!(pending.len(), 1);
    let p = &pending[0];
    assert_eq!(p.state, FinishedState::Recovered);
    assert!(
        p.duration_ms > 25_000 && p.duration_ms < 32_000,
        "{}",
        p.duration_ms
    );
    assert!(p.recovered_lost_ms.unwrap() > 5_000);
    // "Nothing yet": a private WebM to play; still pending.
    let none = e
        .speech
        .publish(PublishRequest {
            recording_id: id.clone(),
            class_id: CLASS.into(),
            lecture_dir: "Aulas/2026-11-03 Aula 7".into(),
            share: ShareMode::None,
        })
        .unwrap();
    assert!(matches!(none.source, AudioSource::Private { .. }));
    assert_eq!(e.speech.pending_recordings().unwrap().len(), 1);
    // Shared with the class.
    let a = e
        .speech
        .publish(PublishRequest {
            recording_id: id.clone(),
            class_id: CLASS.into(),
            lecture_dir: "Aulas/2026-11-03 Aula 7".into(),
            share: ShareMode::AudioAndTranscript,
        })
        .unwrap();
    let file = e.root.join("Aulas/2026-11-03 Aula 7/audio.webm");
    let bytes = std::fs::read(&file).unwrap();
    assert_eq!(a.size, bytes.len() as u64);
    assert_eq!(a.sha256, ids::sha256_hex(&bytes));
    assert_eq!(a.duration_ms, p.duration_ms);
    assert_eq!((a.channels, a.bitrate, a.sample_rate), (1, 24_000, 16_000));
    let (t, _) = decode::decode(
        decode::bytes_source(bytes),
        Some("webm"),
        Channels::Mix,
        &|| false,
    )
    .unwrap();
    assert!((t[0].len() as i64 - a.duration_ms as i64 * 16).abs() <= 16);
    // Published twice is refused; the audio is never replaced.
    let again = e.speech.publish(PublishRequest {
        recording_id: id.clone(),
        class_id: CLASS.into(),
        lecture_dir: "Aulas/x".into(),
        share: ShareMode::AudioAndTranscript,
    });
    assert_eq!(again.unwrap_err().code(), Code::Conflict);
    // Until lecture.json exists the published audio is still reported (with its audio).
    let pending = e.speech.pending_recordings().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].audio.as_ref().unwrap().sha256, a.sha256);
    std::fs::write(e.root.join("Aulas/2026-11-03 Aula 7/lecture.json"), "{}").unwrap();
    assert!(e.speech.pending_recordings().unwrap().is_empty());
    assert!(!j.json(&id).unwrap().exists() && !j.ogg(&id).unwrap().exists());
    // Peaks of the published audio, cached by hash.
    let src = AudioSource::Class {
        class_id: CLASS.into(),
        path: "Aulas/2026-11-03 Aula 7/audio.webm".into(),
    };
    let peaks = e.speech.peaks(&src, 400).unwrap();
    assert_eq!(peaks.len(), 400);
    assert!(peaks.contains(&255));
    assert!(e
        .paths
        .cache
        .join("peaks")
        .join(format!("{}-400.json", a.sha256))
        .is_file());
    assert_eq!(e.speech.peaks(&src, 400).unwrap(), peaks);
    assert_eq!(e.speech.peaks(&src, 50).unwrap_err().code(), Code::Invalid);
}

#[test]
fn transcript_only_keeps_the_audio_on_this_computer() {
    let e = env(None, Arc::new(NoCloud));
    let j = JournalPaths::new(e.paths.recordings_dir());
    std::fs::create_dir_all(&j.dir).unwrap();
    let id = ids::new_ulid(time::now_ms());
    write_recording(&j, &id, &speechlike(5.0, 9), 1, false);
    let a = e
        .speech
        .publish(PublishRequest {
            recording_id: id.clone(),
            class_id: CLASS.into(),
            lecture_dir: "Aulas/Aula 8".into(),
            share: ShareMode::TranscriptOnly,
        })
        .unwrap();
    assert_eq!(
        a.source,
        AudioSource::Private {
            recording_id: id.clone()
        }
    );
    assert!(!e.root.join("Aulas/Aula 8/audio.webm").exists());
    assert!(j.webm(&id).unwrap().is_file());
    std::fs::create_dir_all(e.root.join("Aulas/Aula 8")).unwrap();
    std::fs::write(e.root.join("Aulas/Aula 8/lecture.json"), "{}").unwrap();
    assert!(e.speech.pending_recordings().unwrap().is_empty());
    // The private WebM is the lecture's audio: it stays.
    assert!(j.webm(&id).unwrap().is_file());
    let peaks = e
        .speech
        .peaks(
            &AudioSource::Private {
                recording_id: id.clone(),
            },
            100,
        )
        .unwrap();
    assert_eq!(peaks.len(), 100);
    // Discarding a pending recording removes its files.
    let id2 = ids::new_ulid(time::now_ms() + 1);
    write_recording(&j, &id2, &speechlike(2.0, 2), 1, false);
    assert_eq!(e.speech.pending_recordings().unwrap().len(), 1);
    e.speech.discard(&id2).unwrap();
    assert!(e.speech.pending_recordings().unwrap().is_empty());
    assert!(!j.ogg(&id2).unwrap().exists());
}

#[test]
fn import_mp3_to_webm() {
    let im = import::to_webm(&fixture("speech-en.mp3"), &|| false, &|_| {}).unwrap();
    // The source WAV is 9.312 s; symphonia drops the MP3 encoder's delay and padding.
    assert!(
        (im.duration_ms as i64 - 9_312).abs() < 30,
        "{}",
        im.duration_ms
    );
    assert_eq!(im.codec, "mp3");
    let (t, info) = decode::decode(
        decode::bytes_source(im.webm.clone()),
        Some("webm"),
        Channels::Mix,
        &|| false,
    )
    .unwrap();
    assert_eq!(info.codec, "opus");
    assert!((t[0].len() as i64 - im.duration_ms as i64 * 16).abs() <= 16);
    // Through the handle: placed in the class, reported until lecture.json exists.
    let e = env(None, Arc::new(NoCloud));
    let id = ids::new_ulid(time::now_ms());
    let sink = Collect::<ImportEvent>::new();
    e.speech
        .import_audio(
            ImportAudioRequest {
                recording_id: id.clone(),
                pick: "token".into(),
                class_id: CLASS.into(),
                lecture_dir: "Aulas/Gravação importada".into(),
                keep_video: false,
            },
            &fixture("speech-en.mp3"),
            sink.clone(),
        )
        .unwrap();
    let done = sink
        .wait(Duration::from_secs(60), |e| {
            matches!(e, ImportEvent::Done { .. })
        })
        .expect("import done");
    let ImportEvent::Done { audio } = done else {
        unreachable!()
    };
    let placed = std::fs::read(e.root.join("Aulas/Gravação importada/audio.webm")).unwrap();
    assert_eq!(audio.sha256, ids::sha256_hex(&placed));
    assert!(sink
        .all()
        .iter()
        .any(|e| matches!(e, ImportEvent::Progress { .. })));
    let pending = e.speech.pending_recordings().unwrap();
    assert_eq!(pending.len(), 1);
    let imp = pending[0].import.as_ref().unwrap();
    assert_eq!(imp.file_name, "speech-en.mp3");
    assert_eq!(imp.mime, "audio/mpeg");
    assert!(!imp.had_video);
    assert_eq!(pending[0].title, "speech-en");
}

#[test]
fn he_aac_refused() {
    let e = decode::probe(
        decode::file_source(&fixture("he-aac.m4a")).unwrap(),
        Some("m4a"),
    )
    .unwrap_err();
    assert_eq!(e.code(), Code::SpeechUnsupportedAudio);
    assert!(e.to_string().contains("HE-AAC"));
    let env = env(None, Arc::new(NoCloud));
    let r = env.speech.import_audio(
        ImportAudioRequest {
            recording_id: ids::new_ulid(time::now_ms()),
            pick: "t".into(),
            class_id: CLASS.into(),
            lecture_dir: "Aulas/x".into(),
            keep_video: false,
        },
        &fixture("he-aac.m4a"),
        Collect::<ImportEvent>::new(),
    );
    assert_eq!(r.unwrap_err().code(), Code::SpeechUnsupportedAudio);
    // Not a media file at all.
    let p = env.dir.path().join("notes.txt");
    std::fs::write(&p, "Aula 7: apontamentos").unwrap();
    assert_eq!(
        decode::probe(decode::file_source(&p).unwrap(), Some("txt"))
            .unwrap_err()
            .code(),
        Code::UnsupportedFile
    );
}

/// A cloud double: answers each piece with its number and remembers the request bodies.
struct Pieces {
    n: Mutex<u32>,
    seen: Mutex<Vec<Value>>,
    delay: Duration,
}

impl SttTransport for Pieces {
    fn post(&self, path: &str, body: AiBody, _t: Duration) -> AppResult<(u16, Vec<u8>)> {
        assert_eq!(path, "audio/transcriptions");
        let AiBody::Json(v) = body else {
            return Err(AppError::invalid("expected JSON"));
        };
        std::thread::sleep(self.delay);
        let len = v["input_audio"]["data"].as_str().map(str::len).unwrap_or(0);
        self.seen.lock().unwrap().push(v);
        let mut n = self.n.lock().unwrap();
        *n += 1;
        // A WAV of the piece: 4/3 base64 chars per byte, 2 bytes per sample.
        let secs = (len as f64 * 3.0 / 4.0 - 44.0) / 32_000.0;
        let answer = json!({
            "text": format!("parte {}", *n),
            "language": "portuguese",
            "segments": [{"start": 0.3, "end": secs.max(0.4), "text": format!("parte {}", *n)}]
        });
        Ok((200, serde_json::to_vec(&answer).unwrap()))
    }
}

fn place_audio(e: &Env, pcm: &[f32]) -> (String, String) {
    let w = webm::encode_pcm(pcm, 1, 24_000).unwrap();
    let path = "Aulas/Aula 9/audio.webm".to_string();
    std::fs::create_dir_all(e.root.join("Aulas/Aula 9")).unwrap();
    std::fs::write(e.root.join(&path), &w).unwrap();
    (path, ids::sha256_hex(&w))
}

fn cloud_job(path: &str, sha: &str, claim: Option<ClaimRef>, job: &str) -> TranscribeRequest {
    TranscribeRequest {
        job_id: job.into(),
        lecture_id: "01JBX4Q7Z5W8M2E3C9R6T0YH2K".into(),
        source: AudioSource::Class {
            class_id: CLASS.into(),
            path: path.into(),
        },
        expect_sha256: sha.into(),
        engine: TranscribeEngine::Cloud {
            model: "openai/whisper-large-v3-turbo".into(),
        },
        language: "auto".into(),
        channels: ChannelMode::Mix,
        initial_prompt: Some("Código Civil, artigo 483.º".into()),
        claim,
        resume: false,
    }
}

#[test]
fn a_cloud_job_runs_to_a_result_and_its_claim_is_kept_alive() {
    let stt = Arc::new(Pieces {
        n: Mutex::new(0),
        seen: Mutex::new(Vec::new()),
        delay: Duration::from_millis(20),
    });
    let e = env(None, stt.clone());
    let (path, sha) = place_audio(&e, &speechlike(75.0, 11));
    // A wrong hash is refused before anything starts.
    let wrong = cloud_job(&path, &"0".repeat(64), None, "job-0");
    assert_eq!(
        e.speech
            .transcribe_start(wrong, Collect::<TranscribeEvent>::new())
            .unwrap_err()
            .code(),
        Code::Conflict
    );
    let claim_path = format!(".tramado/claims/01JBX4Q7Z5W8M2E3C9R6T0YH2K/{ME}.json");
    let claim = json!({"format": "tramado.claim", "version": 1, "kind": "transcribe",
        "lectureId": "01JBX4Q7Z5W8M2E3C9R6T0YH2K", "round": 1, "deviceId": ME,
        "status": "working", "heartbeat": 1, "aNewerField": true});
    e.fs.write(
        CLASS,
        &claim_path,
        &serde_json::to_vec(&claim).unwrap(),
        true,
    )
    .unwrap();
    let sink = Collect::<TranscribeEvent>::new();
    let id = e
        .speech
        .transcribe_start(
            cloud_job(
                &path,
                &sha,
                Some(ClaimRef {
                    class_id: CLASS.into(),
                    path: claim_path.clone(),
                    file: claim,
                }),
                "job-1",
            ),
            sink.clone(),
        )
        .unwrap();
    assert_eq!(id, "job-1");
    // One job at a time.
    let busy = e
        .speech
        .transcribe_start(cloud_job(&path, &sha, None, "job-2"), Collect::new());
    assert_eq!(busy.unwrap_err().code(), Code::JobBusy);
    // A reloaded webview re-attaches with a new channel.
    let sink2 = Collect::<TranscribeEvent>::new();
    let s = e.speech.transcribe_attach("job-1", sink2.clone()).unwrap();
    assert_eq!(s.job_id, "job-1");
    sink2
        .wait(Duration::from_secs(60), |ev| {
            matches!(ev, TranscribeEvent::Done { .. })
        })
        .expect("done");
    let jobs = e.speech.jobs();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].state, JobState::Done);
    assert!(jobs[0].result_ready);
    let r = e.speech.take_result("job-1").unwrap();
    assert_eq!(r.engine.name, "openrouter");
    assert_eq!(
        r.engine.model.as_deref(),
        Some("openai/whisper-large-v3-turbo")
    );
    assert_eq!(r.language, "pt");
    assert!((r.duration_ms as i64 - 75_000).abs() <= 1);
    assert_eq!(r.tracks.len(), 1);
    assert_eq!(r.tracks[0].speaker, Speaker::Lecture);
    let segs = &r.tracks[0].segments;
    assert!(segs.len() >= 3, "{segs:?}");
    assert!(segs.windows(2).all(|w| w[0].start_ms <= w[1].start_ms));
    assert!(segs
        .iter()
        .all(|s| s.end_ms <= 75_000 && s.end_ms >= s.start_ms));
    // Only speech was sent, in pieces of at most 30 s, with the class vocabulary as prompt.
    let seen = stt.seen.lock().unwrap();
    assert!(seen
        .iter()
        .all(|b| b["prompt"] == "Código Civil, artigo 483.º" && b.get("provider").is_none()));
    // Taken once; the result file stays (7 days) and the state says when it was taken.
    assert_eq!(
        e.speech.take_result("job-1").unwrap_err().code(),
        Code::NotFound
    );
    let dir = e.paths.transcribe_dir();
    assert!(dir.join("01JBX4Q7Z5W8M2E3C9R6T0YH2K.result.json").is_file());
    let st: Value = serde_json::from_slice(
        &std::fs::read(dir.join("01JBX4Q7Z5W8M2E3C9R6T0YH2K.json")).unwrap(),
    )
    .unwrap();
    assert!(st["takenAtMs"].as_u64().is_some());
    // The claim file still carries what Rust did not own.
    let c: Value = serde_json::from_slice(&e.fs.read(CLASS, &claim_path).unwrap()).unwrap();
    assert_eq!(c["aNewerField"], true);
}

#[test]
fn a_cancelled_job_keeps_or_drops_its_partial_result() {
    let stt = Arc::new(Pieces {
        n: Mutex::new(0),
        seen: Mutex::new(Vec::new()),
        delay: Duration::from_millis(400),
    });
    let e = env(None, stt);
    let (path, sha) = place_audio(&e, &speechlike(200.0, 5));
    let sink = Collect::<TranscribeEvent>::new();
    e.speech
        .transcribe_start(cloud_job(&path, &sha, None, "job-c"), sink.clone())
        .unwrap();
    sink.wait(Duration::from_secs(30), |ev| {
        matches!(
            ev,
            TranscribeEvent::Phase {
                phase: tramado_speech::TranscribePhase::Uploading
            }
        )
    })
    .expect("uploading");
    e.speech.transcribe_cancel("job-c", false);
    sink.wait(Duration::from_secs(30), |ev| {
        matches!(ev, TranscribeEvent::Cancelled)
    })
    .expect("cancelled");
    assert_eq!(e.speech.jobs()[0].state, JobState::Cancelled);
    assert_eq!(
        e.speech.take_result("job-c").unwrap_err().code(),
        Code::NotFound
    );
    // A new job may start now.
    let sink = Collect::<TranscribeEvent>::new();
    e.speech
        .transcribe_start(cloud_job(&path, &sha, None, "job-d"), sink.clone())
        .unwrap();
    e.speech.shutdown();
    assert!(sink
        .wait(Duration::from_secs(30), |ev| matches!(
            ev,
            TranscribeEvent::Cancelled
        ))
        .is_some());
}

#[test]
fn local_jobs_need_a_downloaded_model() {
    let e = env(
        Some(&std::env::temp_dir().join("no-models-here")),
        Arc::new(NoCloud),
    );
    let (path, sha) = place_audio(&e, &speechlike(3.0, 1));
    let mut req = cloud_job(&path, &sha, None, "job-l");
    req.engine = TranscribeEngine::Local {
        model: tramado_speech::ModelId::Small,
    };
    let code = e
        .speech
        .transcribe_start(req, Collect::new())
        .unwrap_err()
        .code();
    assert!(
        code == Code::ModelNotDownloaded || code == Code::SpeechUnsupportedCpu,
        "{code:?}"
    );
    let m = e.speech.models();
    assert_eq!(m.len(), 3);
    assert!(m
        .iter()
        .all(|m| m.state == tramado_speech::ModelStatus::Absent));
    assert!(m
        .iter()
        .any(|m| m.recommended && m.id == tramado_speech::ModelId::Turbo));
    let info = e.speech.info();
    assert_eq!(info.default_model, tramado_speech::ModelId::Turbo);
    assert!(info.recorder.is_none());
}

/// The cloud path on a real recording with the voice model, through a test double of the
/// transport (`SttTransport`): `TRAMADO_SPEECH_DIR` (the VAD; else the loudness cut) and
/// `TRAMADO_SPEECH_SAMPLE` (else the PT fixture). Only the speech is sent.
#[test]
#[ignore]
fn transcribes_through_cloud_mock() {
    let sample =
        env_path("TRAMADO_SPEECH_SAMPLE").unwrap_or_else(|| fixture_audio("speech-pt.webm"));
    let dir = env_path("TRAMADO_SPEECH_DIR");
    let stt = Arc::new(Pieces {
        n: Mutex::new(0),
        seen: Mutex::new(Vec::new()),
        delay: Duration::ZERO,
    });
    let e = env(dir.as_deref(), stt.clone());
    let bytes = std::fs::read(&sample).unwrap();
    std::fs::create_dir_all(e.root.join("Aulas/Aula 9")).unwrap();
    std::fs::write(e.root.join("Aulas/Aula 9/audio.webm"), &bytes).unwrap();
    let sha = ids::sha256_hex(&bytes);
    let sink = Collect::<TranscribeEvent>::new();
    e.speech
        .transcribe_start(
            cloud_job("Aulas/Aula 9/audio.webm", &sha, None, "job-mock"),
            sink.clone(),
        )
        .unwrap();
    sink.wait(Duration::from_secs(120), |ev| {
        matches!(
            ev,
            TranscribeEvent::Done { .. } | TranscribeEvent::Failed { .. }
        )
    })
    .expect("finished");
    let r = e.speech.take_result("job-mock").unwrap();
    println!(
        "vad: {:?}, {} pieces sent",
        r.engine.vad,
        stt.seen.lock().unwrap().len()
    );
    for s in &r.tracks[0].segments {
        println!("  [{:>6} – {:>6}] {}", s.start_ms, s.end_ms, s.text);
    }
    assert!(!r.tracks[0].segments.is_empty());
}
