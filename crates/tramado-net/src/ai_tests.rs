// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Tests of the AI pipe (architecture §5.2 rules 1–7) against a local `MockServer`.

use std::sync::mpsc;

use super::*;
use crate::hosts::Endpoint;
use crate::testutil::{MockResponse, MockServer, Seen};

const KEY: &str = "fake-test-key-not-real-wxyz";
const USER_ID: &str = "user_2zFAKEfakeFAKEfake0000";

struct Rig {
    _dir: tempfile::TempDir,
    pipe: AiPipe,
    mock: MockServer,
    secrets: Arc<Secrets>,
    privacy: Arc<PrivacyStore>,
    hosts: Arc<HostList>,
    activity: Arc<ActivityLog>,
}

fn rig_with(mock: MockServer) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let secrets = Arc::new(Secrets::new(dir.path(), true));
    secrets.set("openrouter", KEY).unwrap();
    let hosts = Arc::new(HostList::load(dir.path()));
    let privacy = Arc::new(PrivacyStore::new(dir.path()));
    let activity = Arc::new(ActivityLog::new(dir.path()));
    let pipe = AiPipe::new(
        secrets.clone(),
        hosts.clone(),
        privacy.clone(),
        activity.clone(),
        "0.1.0".into(),
    );
    pipe.set_openrouter_base_for_tests(&mock.url("/api/v1"));
    Rig {
        _dir: dir,
        pipe,
        mock,
        secrets,
        privacy,
        hosts,
        activity,
    }
}

fn rig(responses: Vec<MockResponse>) -> Rig {
    rig_with(MockServer::start(responses))
}

fn chat_body() -> Value {
    serde_json::json!({
        "model": "google/gemma-4-31b-it:free",
        "messages": [{"role": "user", "content": "O que diz o artigo 483.º do Código Civil?"}],
        "user": "someone@example.org",
        "provider": {"data_collection": "allow", "order": ["Nvidia"]},
        "stream": true
    })
}

fn req(path: &str, method: Method, body: Option<Value>, stream: bool) -> AiRequest {
    AiRequest {
        request_id: format!("r-{}", tramado_base::ids::random_token_hex(4)),
        base: AiBase::OpenRouter,
        method,
        path: path.into(),
        body: body.map(AiBody::Json),
        stream,
        privacy_override: None,
        busy_fallback: false,
        activity: Some(ActivityTag {
            class_id: Some("tramado-mde5jfv46prdf2fjxvmbjr4242".into()),
            action: AiAction::Ask,
            passages: 4,
        }),
        internal: false,
    }
}

fn chat(stream: bool) -> AiRequest {
    req("chat/completions", Method::Post, Some(chat_body()), stream)
}

type Rx = mpsc::Receiver<AiWireEvent>;

fn sink() -> (Box<dyn Fn(AiWireEvent) + Send>, Rx) {
    let (tx, rx) = mpsc::channel();
    (
        Box::new(move |e| {
            let _ = tx.send(e);
        }),
        rx,
    )
}

/// Every event until `end` or `fail` (5 s at most).
fn drain(rx: &Rx) -> Vec<AiWireEvent> {
    let mut out = Vec::new();
    while let Ok(e) = rx.recv_timeout(Duration::from_secs(5)) {
        let last = matches!(e, AiWireEvent::End | AiWireEvent::Fail { .. });
        out.push(e);
        if last {
            break;
        }
    }
    out
}

fn send(r: &Rig, req: AiRequest) -> Vec<AiWireEvent> {
    let (s, rx) = sink();
    r.pipe
        .send(req, &|_| panic!("no dialog expected"), s)
        .unwrap();
    drain(&rx)
}

fn sent_json(r: &Rig) -> Value {
    assert!(r.mock.wait_for(1, Duration::from_secs(3)));
    r.mock.seen()[0].json()
}

fn no(_: &str) -> bool {
    false
}

fn last_seen(r: &Rig) -> Seen {
    r.mock.seen().last().cloned().unwrap()
}

#[test]
fn sse_lines_passthrough() {
    let r = rig(vec![MockResponse::sse(vec![
        (Duration::ZERO, ": OPENROUTER PROCESSING\n\n".into()),
        (Duration::from_millis(20), ": OPENROUTER PROCESSING\n\n".into()),
        (
            Duration::from_millis(20),
            "data: {\"choices\":[{\"delta\":{\"content\":\"Olá\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"con".into(),
        ),
        (
            Duration::from_millis(20),
            "tent\":\" mundo\"}}]}\r\n\r\ndata: [DONE]\n\n".into(),
        ),
    ])
    .header("X-RateLimit-Remaining", "17")
    .header("X-Other", "secret-ish")]);
    let events = send(&r, chat(true));
    let AiWireEvent::Head { status, headers } = &events[0] else {
        panic!("{events:?}")
    };
    assert_eq!(*status, 200);
    assert_eq!(
        headers.get("x-ratelimit-remaining").map(String::as_str),
        Some("17")
    );
    assert_eq!(
        headers.get("content-type").map(String::as_str),
        Some("text/event-stream")
    );
    assert!(!headers.contains_key("x-other"), "{headers:?}");
    let lines: Vec<&str> = events
        .iter()
        .filter_map(|e| match e {
            AiWireEvent::Line { line } => Some(line.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        lines,
        vec![
            ": OPENROUTER PROCESSING",
            ": OPENROUTER PROCESSING",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Olá\"}}]}",
            "data: {\"choices\":[{\"delta\":{\"content\":\" mundo\"}}]}",
            "data: [DONE]",
        ]
    );
    assert_eq!(events.last(), Some(&AiWireEvent::End));
    assert_eq!(r.pipe.in_flight(), (0, 0));
}

#[test]
fn injects_auth_and_attribution() {
    let r = rig(vec![
        MockResponse::sse(vec![(Duration::ZERO, "data: [DONE]\n\n".into())]),
        MockResponse::json(
            200,
            r#"{"data":{"free_model_daily_requests":{"used":1,"limit":50}}}"#,
        ),
    ]);
    send(&r, chat(true));
    let seen = r.mock.seen();
    let s = &seen[0];
    assert_eq!(s.line, "POST /api/v1/chat/completions HTTP/1.1");
    assert_eq!(
        s.header("authorization"),
        Some(format!("Bearer {KEY}").as_str())
    );
    assert_eq!(s.header("content-type"), Some("application/json"));
    assert_eq!(s.header("accept"), Some("text/event-stream"));
    assert_eq!(s.header("http-referer"), Some(REFERER));
    assert_eq!(s.header("x-openrouter-title"), Some("Tramado"));
    assert_eq!(s.header("user-agent"), Some("Tramado/0.1.0"));
    let events = send(&r, req("key", Method::Get, None, false));
    let s = last_seen(&r);
    assert_eq!(s.line, "GET /api/v1/key HTTP/1.1");
    assert_ne!(s.header("accept"), Some("text/event-stream"));
    assert!(s.body.is_empty());
    assert!(
        matches!(&events[1], AiWireEvent::Body { text } if text.contains("free_model_daily_requests"))
    );
    // No key, no request.
    r.secrets.clear("openrouter").unwrap();
    let (s2, _rx) = sink();
    let e = r.pipe.send(chat(true), &no, s2).unwrap_err();
    assert_eq!(e.code(), Code::AiNoKey);
    assert_eq!(r.mock.seen().len(), 2);
}

#[test]
fn provider_overwrite_no_training() {
    let r = rig(vec![MockResponse::json(200, "{}")]);
    send(&r, chat(false));
    let body = sent_json(&r);
    assert_eq!(
        body["provider"],
        serde_json::json!({"data_collection": "deny"})
    );
    assert!(body.get("user").is_none());
    assert_eq!(body["model"], "google/gemma-4-31b-it:free");
    assert_eq!(
        body["messages"][0]["content"],
        "O que diz o artigo 483.º do Código Civil?"
    );
}

#[test]
fn provider_overwrite_zdr() {
    let r = rig(vec![
        MockResponse::json(200, "{}"),
        MockResponse::json(200, "{}"),
    ]);
    r.privacy.set(PrivacyLevel::Zdr).unwrap();
    send(&r, chat(false));
    assert_eq!(
        sent_json(&r)["provider"],
        serde_json::json!({"data_collection": "deny", "zdr": true})
    );
    // A stricter per-request level is always allowed, without a dialog.
    r.privacy.set(PrivacyLevel::Standard).unwrap();
    let mut q = chat(false);
    q.privacy_override = Some(PrivacyLevel::Zdr);
    send(&r, q);
    assert_eq!(
        last_seen(&r).json()["provider"],
        serde_json::json!({"data_collection": "deny", "zdr": true})
    );
}

#[test]
fn provider_removed_standard() {
    let r = rig(vec![
        MockResponse::json(200, "{}"),
        MockResponse::json(200, "{}"),
    ]);
    r.privacy.set(PrivacyLevel::Standard).unwrap();
    send(&r, chat(false));
    let body = sent_json(&r);
    assert!(body.get("provider").is_none(), "{body}");
    assert!(body.get("user").is_none(), "{body}");
    // A per-request relaxation with the native confirmation accepted.
    r.privacy.set(PrivacyLevel::NoTraining).unwrap();
    let mut q = chat(false);
    q.privacy_override = Some(PrivacyLevel::Standard);
    let asked = Mutex::new(Vec::new());
    let (s, rx) = sink();
    r.pipe
        .send(
            q,
            &|host| {
                asked.lock().unwrap().push(host.to_string());
                true
            },
            s,
        )
        .unwrap();
    drain(&rx);
    assert_eq!(asked.lock().unwrap().len(), 1);
    assert!(last_seen(&r).json().get("provider").is_none());
    // Declined: nothing is sent and the channel says why.
    let mut q = chat(false);
    q.privacy_override = Some(PrivacyLevel::Standard);
    let (s, rx) = sink();
    r.pipe.send(q, &no, s).unwrap();
    let events = drain(&rx);
    assert_eq!(events, vec![declined_event()]);
    assert_eq!(r.mock.seen().len(), 2);
    assert_eq!(
        serde_json::to_value(&events[0]).unwrap()["data"],
        serde_json::json!({"declined": true})
    );
}

#[test]
fn custom_host_strips_provider_and_user() {
    let r = rig(vec![
        MockResponse::json(200, r#"{"choices":[]}"#),
        MockResponse::json(200, "{}"),
    ]);
    let e = Endpoint::parse(&r.mock.url("/v1")).unwrap();
    let host = r.hosts.add(&e, "Lab").unwrap();
    let mut q = chat(false);
    q.base = AiBase::Host {
        host_id: host.id.clone(),
    };
    q.privacy_override = Some(PrivacyLevel::Standard);
    let events = send(&r, q);
    let s = &r.mock.seen()[0];
    assert_eq!(s.line, "POST /v1/chat/completions HTTP/1.1");
    let body = s.json();
    assert!(
        body.get("provider").is_none() && body.get("user").is_none(),
        "{body}"
    );
    // A custom host may have no key, and never gets OpenRouter's attribution.
    assert_eq!(s.header("authorization"), None);
    assert_eq!(s.header("x-openrouter-title"), None);
    assert_eq!(s.header("http-referer"), None);
    assert!(matches!(events.last(), Some(AiWireEvent::End)));
    r.secrets
        .set(&format!("host:{}", host.id), "local-key-1")
        .unwrap();
    let mut q = req("models", Method::Get, None, false);
    q.base = AiBase::Host { host_id: host.id };
    send(&r, q);
    assert_eq!(
        last_seen(&r).header("authorization"),
        Some("Bearer local-key-1")
    );
    let list = r.activity.list(10).unwrap();
    assert_eq!(list[0].privacy, ActivityPrivacy::CustomHost);
}

#[test]
fn error_body_strips_user_id() {
    let r = rig(vec![
        MockResponse::json(
            429,
            format!(r#"{{"error":{{"message":"Provider returned error","code":429,"metadata":{{"raw":"busy"}}}},"user_id":"{USER_ID}"}}"#),
        )
        .header("x-openrouter-error-origin", "provider"),
        // A stream request answered with an error: the body comes whole, not as lines.
        MockResponse::json(400, format!(r#"{{"error":{{"message":"bad","code":400}},"user_id":"{USER_ID}"}}"#)),
    ]);
    let events = send(&r, chat(false));
    let AiWireEvent::Head { status, headers } = &events[0] else {
        panic!()
    };
    assert_eq!(*status, 429);
    assert_eq!(
        headers.get("x-openrouter-error-origin").map(String::as_str),
        Some("provider")
    );
    let AiWireEvent::Body { text } = &events[1] else {
        panic!("{events:?}")
    };
    assert!(!text.contains(USER_ID), "{text}");
    let v: Value = serde_json::from_str(text).unwrap();
    assert_eq!(v["error"]["code"], 429);
    assert_eq!(events[2], AiWireEvent::End);
    let events = send(&r, chat(true));
    assert!(
        matches!(&events[1], AiWireEvent::Body { text } if !text.contains(USER_ID) && text.contains("bad"))
    );
    let log = std::fs::read_to_string(r.activity.file()).unwrap();
    assert!(!log.contains(USER_ID));
    assert_eq!(
        r.activity.list(1).unwrap()[0].code,
        Some(Code::AiBadRequest)
    );
    assert_eq!(r.activity.list(2).unwrap()[1].code, Some(Code::AiBusy));
}

#[test]
fn path_not_allowed() {
    let r = rig(vec![]);
    for (path, method) in [
        ("chat/completions/../../key", Method::Post),
        ("auth/keys", Method::Get),
        ("credits", Method::Get),
        ("models/../key/endpoints", Method::Get),
        ("models//endpoints", Method::Get),
        ("models/a b/endpoints", Method::Get),
        ("models/x?y=1/endpoints", Method::Get),
        ("", Method::Get),
        (STT_PATH, Method::Post),
        (STT_CATALOG_PATH, Method::Get),
        // A known path with the wrong method.
        ("key", Method::Post),
        ("chat/completions", Method::Get),
    ] {
        let (s, _rx) = sink();
        let e = r
            .pipe
            .send(
                req(path, method, Some(serde_json::json!({})), false),
                &no,
                s,
            )
            .unwrap_err();
        assert_eq!(e.code(), Code::Invalid, "{path}");
    }
    assert_eq!(
        check_path("models/google/gemma-4-31b-it:free/endpoints", false).unwrap(),
        Method::Get
    );
    assert_eq!(
        check_path(&format!("models/{}/endpoints", "a".repeat(121)), false)
            .unwrap_err()
            .code(),
        Code::Invalid
    );
    // A body that is not an object, or a POST without one.
    for body in [
        Some(serde_json::json!([1])),
        Some(serde_json::json!("x")),
        None,
    ] {
        let (s, _rx) = sink();
        let e = r
            .pipe
            .send(req("chat/completions", Method::Post, body, false), &no, s)
            .unwrap_err();
        assert_eq!(e.code(), Code::Invalid);
    }
    assert!(r.mock.seen().is_empty(), "nothing reached the network");
}

#[test]
fn audio_path_internal_only() {
    let r = rig(vec![
        MockResponse::json(200, r#"{"text":"Bom dia"}"#),
        MockResponse::json(200, r#"{"data":[]}"#),
    ]);
    let body = serde_json::json!({"model": "openai/whisper-large-v3-turbo", "input_audio": {"data": "UklGRg==", "format": "wav"}, "user": "x"});
    // Over IPC: refused, whatever the flags of the IPC type say.
    let ipc = AiPipeRequest {
        request_id: "r1".into(),
        base: AiBase::OpenRouter,
        method: Method::Post,
        path: STT_PATH.into(),
        body: Some(body.clone()),
        stream: false,
        privacy_override: None,
        override_text: None,
        busy_fallback: None,
        activity: None,
    };
    let (s, _rx) = sink();
    assert_eq!(
        r.pipe
            .send(AiRequest::from_ipc(ipc), &no, s)
            .unwrap_err()
            .code(),
        Code::Invalid
    );
    // From Rust: allowed, with the same provider rule.
    let mut q = req(STT_PATH, Method::Post, Some(body), false);
    q.internal = true;
    let (status, out) = r.pipe.request_blocking(q, Duration::from_secs(5)).unwrap();
    assert_eq!(status, 200);
    assert_eq!(String::from_utf8(out).unwrap(), r#"{"text":"Bom dia"}"#);
    let sent = r.mock.seen()[0].json();
    assert_eq!(
        sent["provider"],
        serde_json::json!({"data_collection": "deny"})
    );
    assert!(sent.get("user").is_none());
    let mut q = req(STT_CATALOG_PATH, Method::Get, None, false);
    q.internal = true;
    r.pipe.request_blocking(q, Duration::from_secs(5)).unwrap();
    assert_eq!(
        last_seen(&r).line,
        "GET /api/v1/models?output_modalities=transcription HTTP/1.1"
    );
}

#[test]
fn multipart_for_custom_speech_hosts() {
    let r = rig(vec![MockResponse::json(200, r#"{"text":"olá"}"#)]);
    let host = r
        .hosts
        .add(&Endpoint::parse(&r.mock.url("/v1")).unwrap(), "")
        .unwrap();
    let mut q = req(STT_PATH, Method::Post, None, false);
    q.internal = true;
    q.base = AiBase::Host { host_id: host.id };
    q.body = Some(AiBody::Multipart(vec![
        Part {
            name: "model".into(),
            file_name: None,
            mime: None,
            bytes: b"whisper-1".to_vec(),
        },
        Part {
            name: "file".into(),
            file_name: Some("piece.wav".into()),
            mime: Some("audio/wav".into()),
            bytes: b"RIFF1234".to_vec(),
        },
    ]));
    let (status, _) = r.pipe.request_blocking(q, Duration::from_secs(5)).unwrap();
    assert_eq!(status, 200);
    let s = &r.mock.seen()[0];
    let ct = s.header("content-type").unwrap();
    let boundary = ct.split("boundary=").nth(1).unwrap();
    let body = String::from_utf8_lossy(&s.body);
    assert!(
        body.contains("name=\"model\"\r\n\r\nwhisper-1\r\n"),
        "{body}"
    );
    assert!(body.contains("filename=\"piece.wav\"\r\nContent-Type: audio/wav\r\n\r\nRIFF1234\r\n"));
    assert!(body.ends_with(&format!("--{boundary}--\r\n")));
    assert_eq!(
        r.activity.list(1).unwrap()[0].model.as_deref(),
        Some("whisper-1")
    );
    // Never on OpenRouter.
    let mut q = req(STT_PATH, Method::Post, None, false);
    q.internal = true;
    q.body = Some(AiBody::Multipart(vec![]));
    assert_eq!(
        r.pipe
            .request_blocking(q, Duration::from_secs(5))
            .unwrap_err()
            .code(),
        Code::Invalid
    );
}

#[test]
fn host_not_allowed() {
    let r = rig(vec![]);
    let mut q = chat(false);
    q.base = AiBase::Host {
        host_id: "models.example.org".into(),
    };
    let (s, _rx) = sink();
    assert_eq!(
        r.pipe.send(q, &no, s).unwrap_err().code(),
        Code::AiHostNotAllowed
    );
    // A forgotten host is refused again.
    let e = Endpoint::parse(&r.mock.url("/v1")).unwrap();
    let h = r.hosts.add(&e, "").unwrap();
    r.hosts.remove(&h.id).unwrap();
    let mut q = chat(false);
    q.base = AiBase::Host { host_id: h.id };
    let (s, _rx) = sink();
    assert_eq!(
        r.pipe.send(q, &no, s).unwrap_err().code(),
        Code::AiHostNotAllowed
    );
    assert!(r.mock.seen().is_empty());
}

#[test]
fn cancel_mid_stream() {
    let mut chunks = vec![(Duration::ZERO, "data: {\"n\":0}\n\n".to_string())];
    for i in 1..40 {
        chunks.push((
            Duration::from_millis(50),
            format!("data: {{\"n\":{i}}}\n\n"),
        ));
    }
    chunks.push((Duration::from_millis(50), "data: [DONE]\n\n".into()));
    let r = rig(vec![MockResponse::sse(chunks)]);
    let q = chat(true);
    let id = q.request_id.clone();
    let (s, rx) = sink();
    r.pipe.send(q, &no, s).unwrap();
    // Wait for the first line, then cancel.
    loop {
        match rx.recv_timeout(Duration::from_secs(5)).unwrap() {
            AiWireEvent::Line { .. } => break,
            AiWireEvent::Head { .. } => continue,
            other => panic!("{other:?}"),
        }
    }
    r.pipe.cancel(&id);
    let rest = drain(&rx);
    assert_eq!(
        rest.last(),
        Some(&AiWireEvent::Fail {
            code: Code::Cancelled,
            message: "cancelled".into(),
            data: None
        })
    );
    // Nothing after the fail, ever.
    std::thread::sleep(Duration::from_millis(300));
    assert!(rx.try_recv().is_err());
    // The worker gives its slot back soon after.
    let deadline = Instant::now() + Duration::from_secs(3);
    while r.pipe.in_flight().0 > 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(r.pipe.in_flight(), (0, 0));
    assert_eq!(r.activity.list(1).unwrap()[0].code, Some(Code::Cancelled));
}

#[test]
fn transport_failures_map_to_codes() {
    // Nobody listens on this port.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let dead = listener.local_addr().unwrap();
    drop(listener);
    let r = rig(vec![]);
    r.pipe
        .set_openrouter_base_for_tests(&format!("http://{dead}/api/v1"));
    let events = send(&r, chat(false));
    assert!(
        matches!(
            &events[0],
            AiWireEvent::Fail {
                code: Code::AiOffline,
                ..
            }
        ),
        "{events:?}"
    );
    // A timeout of a blocking call.
    let slow = rig(vec![
        MockResponse::json(200, "{}").delayed(Duration::from_millis(1500))
    ]);
    let mut q = req("key", Method::Get, None, false);
    q.internal = true;
    let e = slow
        .pipe
        .request_blocking(q, Duration::from_millis(300))
        .unwrap_err();
    assert_eq!(e.code(), Code::AiTimeout);
}

#[test]
fn activity_has_no_content() {
    let r = rig(vec![MockResponse::sse(vec![(
        Duration::ZERO,
        format!("data: {{\"choices\":[{{\"delta\":{{\"content\":\"responsabilidade civil extracontratual\"}}}}],\"user_id\":\"{USER_ID}\"}}\n\ndata: [DONE]\n\n"),
    )])]);
    send(&r, chat(true));
    let text = std::fs::read_to_string(r.activity.file()).unwrap();
    for secret in [
        "483",
        "Código Civil",
        "responsabilidade",
        USER_ID,
        KEY,
        "someone@example.org",
    ] {
        assert!(!text.contains(secret), "{secret} leaked into {text}");
    }
    let e = &r.activity.list(1).unwrap()[0];
    assert_eq!(
        e.host,
        "127.0.0.1:".to_string() + &r.mock.addr().port().to_string()
    );
    assert_eq!(e.path, "chat/completions");
    assert_eq!(e.model.as_deref(), Some("google/gemma-4-31b-it:free"));
    assert_eq!(e.status, Some(200));
    assert_eq!(e.code, None);
    assert_eq!(e.privacy, ActivityPrivacy::NoTraining);
    assert_eq!(
        e.class_id.as_deref(),
        Some("tramado-mde5jfv46prdf2fjxvmbjr4242")
    );
    assert_eq!(e.action, Some(AiAction::Ask));
    assert_eq!(e.passages, 4);
    assert!(e.bytes_out > 0 && e.bytes_in > 0);
    r.pipe.clear_activity().unwrap();
    assert!(r.activity.list(10).unwrap().is_empty());
}

#[test]
fn blocking_waits_for_slot_and_keeps_two_free() {
    let mock = MockServer::with_handler(|s: &Seen| {
        let d = if s.path.ends_with("/key") { 700 } else { 400 };
        MockResponse::json(200, "{}").delayed(Duration::from_millis(d))
    });
    let r = Arc::new(rig_with(mock));
    let mut workers = Vec::new();
    for i in 0..5 {
        let r = r.clone();
        workers.push(std::thread::spawn(move || {
            // Stagger so the FIFO order is known.
            std::thread::sleep(Duration::from_millis(i * 20));
            let mut q = req("key", Method::Get, None, false);
            q.internal = true;
            let t0 = Instant::now();
            let out = r.pipe.request_blocking(q, Duration::from_secs(10)).unwrap();
            (i, out.0, t0.elapsed())
        }));
    }
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(r.mock.seen().len(), 4, "the fifth blocking caller waits");
    assert_eq!(r.pipe.in_flight(), (4, 4));
    // Interactive requests still find two slots, and only two.
    let (s1, rx1) = sink();
    let (s2, rx2) = sink();
    let (s3, _rx3) = sink();
    r.pipe
        .send(req("models", Method::Get, None, false), &no, s1)
        .unwrap();
    r.pipe
        .send(req("models", Method::Get, None, false), &no, s2)
        .unwrap();
    assert_eq!(
        r.pipe
            .send(req("models", Method::Get, None, false), &no, s3)
            .unwrap_err()
            .code(),
        Code::JobBusy
    );
    drain(&rx1);
    drain(&rx2);
    let mut done: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
    done.sort_by_key(|d| d.0);
    assert!(done.iter().all(|d| d.1 == 200));
    // The fifth waited for a slot: it took about two round trips.
    assert!(done[4].2 >= Duration::from_millis(1200), "{:?}", done[4].2);
    assert_eq!(r.pipe.in_flight(), (0, 0));
}

#[test]
fn blocking_cancel_while_waiting() {
    let mock = MockServer::with_handler(|_| {
        MockResponse::json(200, "{}").delayed(Duration::from_millis(600))
    });
    let r = Arc::new(rig_with(mock));
    let mut hold = Vec::new();
    for _ in 0..4 {
        let r = r.clone();
        hold.push(std::thread::spawn(move || {
            let mut q = req("key", Method::Get, None, false);
            q.internal = true;
            r.pipe
                .request_blocking(q, Duration::from_secs(5))
                .map(|x| x.0)
        }));
    }
    std::thread::sleep(Duration::from_millis(150));
    // Two waiters; the second one is cancelled while the first is still ahead of it.
    let mut first = req("key", Method::Get, None, false);
    first.internal = true;
    let r1 = r.clone();
    let ahead = std::thread::spawn(move || r1.pipe.request_blocking(first, Duration::from_secs(5)));
    std::thread::sleep(Duration::from_millis(50));
    let mut q = req("key", Method::Get, None, false);
    q.internal = true;
    let id = q.request_id.clone();
    let r2 = r.clone();
    let waiter = std::thread::spawn(move || r2.pipe.request_blocking(q, Duration::from_secs(5)));
    std::thread::sleep(Duration::from_millis(100));
    let t0 = Instant::now();
    r.pipe.cancel(&id);
    assert_eq!(waiter.join().unwrap().unwrap_err().code(), Code::Cancelled);
    assert!(
        t0.elapsed() < Duration::from_millis(400),
        "{:?}",
        t0.elapsed()
    );
    assert_eq!(ahead.join().unwrap().unwrap().0, 200);
    for h in hold {
        assert_eq!(h.join().unwrap().unwrap(), 200);
    }
    assert_eq!(
        r.mock.seen().len(),
        5,
        "the four held and the one ahead; never the cancelled"
    );
}

#[test]
fn busy_relax_skips_dialog_only_with_flag() {
    let r = rig((0..4).map(|_| MockResponse::json(200, "{}")).collect());
    let asked = std::sync::atomic::AtomicUsize::new(0);
    let confirm = |_: &str| {
        asked.fetch_add(1, Ordering::SeqCst);
        false
    };
    let busy = |fallback: bool| {
        let mut q = chat(false);
        q.privacy_override = Some(PrivacyLevel::Standard);
        q.busy_fallback = fallback;
        q
    };
    // busyRelax off: the busy fallback still needs the dialog (declined here).
    let (s, rx) = sink();
    r.pipe.send(busy(true), &confirm, s).unwrap();
    assert_eq!(drain(&rx), vec![declined_event()]);
    assert_eq!(asked.load(Ordering::SeqCst), 1);
    // busyRelax on + busyFallback: relaxed without a dialog.
    r.privacy.set_busy_relax(true).unwrap();
    let (s, rx) = sink();
    r.pipe.send(busy(true), &confirm, s).unwrap();
    drain(&rx);
    assert_eq!(asked.load(Ordering::SeqCst), 1);
    assert!(sent_json(&r).get("provider").is_none());
    assert_eq!(
        r.activity.list(1).unwrap()[0].privacy,
        ActivityPrivacy::Standard
    );
    // busyRelax on, but not a busy fallback: the dialog again.
    let (s, rx) = sink();
    r.pipe.send(busy(false), &confirm, s).unwrap();
    assert_eq!(drain(&rx), vec![declined_event()]);
    assert_eq!(asked.load(Ordering::SeqCst), 2);
    // The busy relaxation is only to `standard` from a stricter level, never a blank cheque:
    // from `zdr` a `no-training` override still asks.
    r.privacy.set(PrivacyLevel::Zdr).unwrap();
    let mut q = chat(false);
    q.privacy_override = Some(PrivacyLevel::NoTraining);
    q.busy_fallback = true;
    let (s, rx) = sink();
    r.pipe.send(q, &confirm, s).unwrap();
    assert_eq!(drain(&rx), vec![declined_event()]);
    assert_eq!(asked.load(Ordering::SeqCst), 3);
    assert_eq!(r.mock.seen().len(), 1);
}

#[test]
fn stt_404_maps_privacy_blocks() {
    let r = rig(vec![
        MockResponse::json(
            404,
            format!(
                r#"{{"error":{{"message":"No endpoints found matching your data policy (Zero data retention). Configure: https://openrouter.ai/settings/privacy","code":404}},"user_id":"{USER_ID}"}}"#
            ),
        ),
        MockResponse::json(404, r#"{"error":{"message":"Model not found","code":404}}"#),
    ]);
    r.privacy.set(PrivacyLevel::Zdr).unwrap();
    let mut q = req(
        STT_PATH,
        Method::Post,
        Some(serde_json::json!({"model": "openai/whisper-large-v3"})),
        false,
    );
    q.internal = true;
    let e = r
        .pipe
        .request_blocking(q.clone(), Duration::from_secs(5))
        .unwrap_err();
    assert_eq!(e.code(), Code::AiPrivacyBlocks);
    assert_eq!(e.data(), Some(&serde_json::json!({"stt": true})));
    // Another 404 is just a status for the caller to read.
    q.request_id = "r-other".into();
    let (status, body) = r.pipe.request_blocking(q, Duration::from_secs(5)).unwrap();
    assert_eq!(status, 404);
    assert!(String::from_utf8(body).unwrap().contains("Model not found"));
    assert_eq!(
        r.activity.list(2).unwrap()[1].code,
        Some(Code::AiPrivacyBlocks)
    );
}

#[test]
fn ipc_request_conversion_never_internal() {
    let v = serde_json::json!({
        "requestId": "r", "base": {"type": "host", "hostId": "h"}, "method": "POST", "path": "chat/completions",
        "body": {"model": "m"}, "stream": true, "privacyOverride": "standard", "busyFallback": true,
        "activity": {"classId": null, "action": "examAnswer", "passages": 2}
    });
    let ipc: AiPipeRequest = serde_json::from_value(v).unwrap();
    let r = AiRequest::from_ipc(ipc);
    assert!(!r.internal);
    assert!(r.busy_fallback);
    assert_eq!(r.privacy_override, Some(PrivacyLevel::Standard));
    assert_eq!(r.activity.unwrap().action, AiAction::ExamAnswer);
    assert_eq!(strip_user_id(r#"{"a":1,"user_id":"x"}"#), r#"{"a":1}"#);
    assert_eq!(strip_user_id("not json user_id"), "not json user_id");
    assert_eq!(
        strip_user_id(r#"{"a":{"user_id":"kept"}}"#),
        r#"{"a":{"user_id":"kept"}}"#
    );
}
