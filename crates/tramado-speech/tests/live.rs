// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The live cloud speech-to-text check (ignored; **paid**: about US$0.00003 for the 9 s clip
//! with `openai/whisper-large-v3-turbo`). It runs a real cloud job through `Speech` with a
//! minimal stand-in for the AI pipe (key in the `Authorization` header, `provider` set as the
//! default "no training" level sets it) and reports the cost from `GET /key` before and after.
//!
//! The key is read at run time from `OPENROUTER_API_KEY` or `~/.openrouter.key`; it is never
//! printed or written anywhere.
//!
//! ```text
//! cargo test -p tramado-speech --test live -- --ignored --nocapture
//! ```

mod common;

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::ids;
use tramado_net::ai::AiBody;
use tramado_speech::{
    AudioSource, ChannelMode, SttTransport, TranscribeEngine, TranscribeEvent, TranscribeRequest,
};

use common::*;

const BASE: &str = "https://openrouter.ai/api/v1";

fn key() -> Option<String> {
    if let Some(k) = std::env::var("OPENROUTER_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
    {
        return Some(k.trim().to_string());
    }
    let home = std::env::var_os("HOME")?;
    let k = std::fs::read_to_string(std::path::Path::new(&home).join(".openrouter.key")).ok()?;
    let k: String = k.chars().filter(|c| !c.is_whitespace()).collect();
    (!k.is_empty()).then_some(k)
}

/// What `AiPipe::request_blocking` does for `audio/transcriptions` at the default privacy
/// level (architecture §5.2 rules 3–5), and no more.
struct Live {
    agent: ureq::Agent,
    key: String,
}

impl SttTransport for Live {
    fn post(&self, path: &str, body: AiBody, timeout: Duration) -> AppResult<(u16, Vec<u8>)> {
        let AiBody::Json(mut v) = body else {
            return Err(AppError::invalid("multipart"));
        };
        v["provider"] = serde_json::json!({ "data_collection": "deny" });
        let mut res = self
            .agent
            .post(&format!("{BASE}/{path}"))
            .config()
            .timeout_global(Some(timeout))
            .build()
            .header("Authorization", &format!("Bearer {}", self.key))
            .header("HTTP-Referer", "https://github.com/feiteira/Tramado")
            .header("X-OpenRouter-Title", "Tramado")
            .send_json(&v)
            .map_err(|e| AppError::new(Code::AiOffline, e.to_string()))?;
        let status = res.status().as_u16();
        let bytes = res
            .body_mut()
            .read_to_vec()
            .map_err(|e| AppError::new(Code::AiUpstream, e.to_string()))?;
        Ok((status, bytes))
    }
}

/// `GET /key` → `data.usage` (US$ spent with this key so far).
fn usage(agent: &ureq::Agent, key: &str) -> Option<f64> {
    let mut res = agent
        .get(&format!("{BASE}/key"))
        .header("Authorization", &format!("Bearer {key}"))
        .call()
        .ok()?;
    let v: Value = serde_json::from_slice(&res.body_mut().read_to_vec().ok()?).ok()?;
    v.pointer("/data/usage").and_then(Value::as_f64)
}

#[test]
#[ignore]
fn transcribes_through_openrouter_live() {
    let Some(key) = key() else {
        println!("not run: no OpenRouter key");
        return;
    };
    let agent = tramado_net::http::ai_agent("live-test");
    let before = usage(&agent, &key);
    let model = std::env::var("TRAMADO_STT_MODEL")
        .unwrap_or_else(|_| "openai/whisper-large-v3-turbo".into());
    let e = env(
        env_path("TRAMADO_SPEECH_DIR").as_deref(),
        Arc::new(Live {
            agent: agent.clone(),
            key: key.clone(),
        }),
    );
    let bytes = std::fs::read(fixture_audio("speech-en.webm")).unwrap();
    std::fs::create_dir_all(e.root.join("Lectures/Week 1")).unwrap();
    std::fs::write(e.root.join("Lectures/Week 1/audio.webm"), &bytes).unwrap();
    let sink = Collect::<TranscribeEvent>::new();
    e.speech
        .transcribe_start(
            TranscribeRequest {
                job_id: "job-live".into(),
                lecture_id: ids::new_ulid(tramado_base::time::now_ms()),
                source: AudioSource::Class {
                    class_id: CLASS.into(),
                    path: "Lectures/Week 1/audio.webm".into(),
                },
                expect_sha256: ids::sha256_hex(&bytes),
                engine: TranscribeEngine::Cloud {
                    model: model.clone(),
                },
                language: "en".into(),
                channels: ChannelMode::Mix,
                initial_prompt: Some("separation of powers".into()),
                claim: None,
                resume: false,
            },
            sink.clone(),
        )
        .unwrap();
    let end = sink
        .wait(Duration::from_secs(300), |ev| {
            matches!(
                ev,
                TranscribeEvent::Done { .. } | TranscribeEvent::Failed { .. }
            )
        })
        .expect("finished");
    if let TranscribeEvent::Failed { code, message } = &end {
        if *code == Code::AiNoCredit {
            println!("not run: no credit ({message})");
            return;
        }
        panic!("{code}: {message}");
    }
    let r = e.speech.take_result("job-live").unwrap();
    println!(
        "model {model}, vad {:?}, language {}",
        r.engine.vad, r.language
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
    assert!(text.contains("class") || text.contains("powers"), "{text}");
    // Usage is booked a little later.
    let mut after = None;
    for _ in 0..10 {
        std::thread::sleep(Duration::from_secs(3));
        after = usage(&agent, &key);
        if after != before {
            break;
        }
    }
    match (before, after) {
        (Some(b), Some(a)) => {
            println!("cost: US${:.6} (usage {b:.6} → {a:.6})", a - b);
            assert!(a - b <= 0.25, "over budget");
        }
        _ => println!("cost: usage not readable"),
    }
}
