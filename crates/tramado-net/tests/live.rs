// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Live check of the AI pipe against OpenRouter (architecture §5.2, §17; opt-in):
//!
//! ```sh
//! OPENROUTER_API_KEY=… cargo test -p tramado-net --test live -- --ignored
//! ```
//!
//! The key is read from the environment and kept in memory only (an in-memory credential store
//! stands in for the keychain; nothing is written to disk). Free models only: a streamed chat
//! request at `no-training` with the default chain must get `head{200}`, at least one `data:`
//! line and `[DONE]`; then `GET key` must report `free_model_daily_requests`. Nothing the
//! service returns is printed except the model that answered.

use std::collections::BTreeMap;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use tramado_net::activity::ActivityLog;
use tramado_net::ai::{AiBase, AiBody, AiPipe, AiRequest, AiWireEvent, Method};
use tramado_net::hosts::HostList;
use tramado_net::privacy::{PrivacyLevel, PrivacyStore};
use tramado_net::secrets::{KeyStore, SecretStore, Secrets};

/// `core/ai/ai-defaults.json` → `chains["no-training"]` (architecture §11.1.1).
const CHAIN: [&str; 3] = [
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "dots-studio/dots-3-note-preview:free",
];

#[derive(Default)]
struct MemStore(Mutex<BTreeMap<String, String>>);
impl KeyStore for MemStore {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(name).cloned())
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(name.into(), value.into());
        Ok(())
    }
    fn delete(&self, name: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(name);
        Ok(())
    }
}

fn drain(rx: &mpsc::Receiver<AiWireEvent>) -> Vec<AiWireEvent> {
    let mut out = Vec::new();
    while let Ok(e) = rx.recv_timeout(Duration::from_secs(180)) {
        let last = matches!(e, AiWireEvent::End | AiWireEvent::Fail { .. });
        out.push(e);
        if last {
            break;
        }
    }
    out
}

#[test]
#[ignore = "live: needs OPENROUTER_API_KEY and the network"]
fn live_openrouter_pipe() {
    let key = std::env::var("OPENROUTER_API_KEY").expect("OPENROUTER_API_KEY is not set");
    let dir = tempfile::tempdir().unwrap();
    let secrets = Arc::new(Secrets::with_store(
        dir.path(),
        Arc::new(MemStore::default()),
    ));
    let st = secrets.set("openrouter", key.trim()).unwrap();
    assert_eq!(st.store, SecretStore::Keychain, "the key stays in memory");
    let privacy = Arc::new(PrivacyStore::new(dir.path()));
    assert_eq!(privacy.get(), PrivacyLevel::NoTraining);
    let activity = Arc::new(ActivityLog::new(dir.path()));
    let pipe = AiPipe::new(
        secrets,
        Arc::new(HostList::load(dir.path())),
        privacy,
        activity.clone(),
        "0.1.0".into(),
    );
    let body = serde_json::json!({
        "model": CHAIN[0],
        "models": CHAIN,
        "messages": [{"role": "user", "content": "Responde só com a palavra: olá"}],
        "stream": true,
        "max_tokens": 300,
        "reasoning": {"exclude": true}
    });
    let mut answered = None;
    let mut statuses = Vec::new();
    for attempt in 0..6 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_secs(20));
        }
        let (tx, rx) = mpsc::channel();
        pipe.send(
            AiRequest {
                request_id: format!("live-{attempt}"),
                base: AiBase::OpenRouter,
                method: Method::Post,
                path: "chat/completions".into(),
                body: Some(AiBody::Json(body.clone())),
                stream: true,
                privacy_override: None,
                busy_fallback: false,
                activity: None,
                internal: false,
            },
            &|_| false,
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
        let events = drain(&rx);
        let status = events.iter().find_map(|e| match e {
            AiWireEvent::Head { status, .. } => Some(*status),
            _ => None,
        });
        statuses.push(status);
        if status != Some(200) {
            continue;
        }
        let data: Vec<&str> = events
            .iter()
            .filter_map(|e| match e {
                AiWireEvent::Line { line } if line.starts_with("data:") => Some(line.as_str()),
                _ => None,
            })
            .collect();
        assert!(!data.is_empty(), "no data lines");
        assert!(data.iter().any(|l| l.trim() == "data: [DONE]"), "no [DONE]");
        assert_eq!(events.last(), Some(&AiWireEvent::End));
        let model = data.iter().find_map(|l| {
            serde_json::from_str::<serde_json::Value>(l.trim_start_matches("data:").trim())
                .ok()
                .and_then(|v| v["model"].as_str().map(str::to_string))
        });
        answered = Some(model.unwrap_or_else(|| "?".into()));
        break;
    }
    let model =
        answered.unwrap_or_else(|| panic!("no 200 from the no-training chain: {statuses:?}"));
    eprintln!(
        "live_openrouter_pipe: answered by {model} after {} attempt(s) (statuses {statuses:?})",
        statuses.len()
    );

    let (tx, rx) = mpsc::channel();
    pipe.send(
        AiRequest {
            request_id: "live-key".into(),
            base: AiBase::OpenRouter,
            method: Method::Get,
            path: "key".into(),
            body: None,
            stream: false,
            privacy_override: None,
            busy_fallback: false,
            activity: None,
            internal: false,
        },
        &|_| false,
        Box::new(move |e| {
            let _ = tx.send(e);
        }),
    )
    .unwrap();
    let events = drain(&rx);
    assert!(
        matches!(events[0], AiWireEvent::Head { status: 200, .. }),
        "GET key failed"
    );
    let text = events
        .iter()
        .find_map(|e| match e {
            AiWireEvent::Body { text } => Some(text.clone()),
            _ => None,
        })
        .expect("no body");
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert!(
        v["data"]["free_model_daily_requests"].is_object(),
        "GET key has no free_model_daily_requests"
    );
    // The activity log names the request and holds no content.
    let log = std::fs::read_to_string(activity.file()).unwrap();
    assert!(!log.contains("olá") && !log.contains(key.trim()));
}
