// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The AI pipe (architecture §5.2 `ai`, critique C1, C34, C35, D5, D-10, D-12): the only way
//! anything reaches OpenRouter or a custom AI host. It enforces the seven rules of §5.2, none of
//! which the webview can bypass:
//!
//! 1. a path allow-list (`audio/transcriptions` and the transcription catalogue only for Rust
//!    callers, `internal`), with the method each path takes;
//! 2. a host allow-list (OpenRouter, or a host the person allowed);
//! 3. the key comes from `Secrets`, never from the request;
//! 4. `Authorization`, `Content-Type`, `Accept` and OpenRouter's attribution headers are set here;
//! 5. `provider` is overwritten from the privacy level and `user` removed (both removed on
//!    custom hosts); relaxing privacy for one request needs a native confirmation (`confirm`) or
//!    the busy-only relaxation;
//! 6. the response goes back as `head`, then SSE lines verbatim (streams) or one body with a
//!    top-level `user_id` removed, then `end` — or `fail`;
//! 7. one activity line per request, metadata only.
//!
//! At most six requests are in flight; Rust callers (`request_blocking`) wait in a FIFO and
//! never hold more than four, so interactive requests always find two.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tramado_base::error::{AppError, AppResult, Code};

use crate::activity::{ActivityLog, ActivityPrivacy, AiActivityEntry};
use crate::hosts::{self, Endpoint, HostList};
use crate::privacy::{PrivacyLevel, PrivacyStore};
use crate::secrets::Secrets;

/// OpenRouter's API base.
pub const OPENROUTER_BASE: &str = "https://openrouter.ai/api/v1";
/// At most this many requests in flight; blocking (Rust) callers never take the last two.
pub const MAX_IN_FLIGHT: usize = 6;
pub const MAX_BLOCKING: usize = 4;
/// Response bodies are capped at 32 MiB.
pub const MAX_BODY_BYTES: u64 = 32 << 20;

/// TS `AiBase`: `{"type":"openrouter"}` | `{"type":"host","hostId":"…"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiBase {
    #[serde(rename = "openrouter")]
    OpenRouter,
    Host {
        host_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Method {
    Get,
    Post,
}

/// TS `AiAction` (what a request was for, in the activity log).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiAction {
    Ask,
    Chat,
    Explain,
    Summary,
    Terms,
    Annotate,
    StudyNotes,
    ExamExtract,
    ExamOcr,
    ExamAnswer,
    Hint,
    Deep,
    Title,
    Describe,
    DocOcr,
    CloudSpeech,
    KeyCheck,
    Catalog,
}

/// TS `ConfirmText`: the texts of a native confirmation (`message` may contain `{host}`,
/// filled in by Rust).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmText {
    pub title: String,
    pub message: String,
    pub confirm: String,
    pub cancel: String,
}

/// Activity-log metadata of a request (no content).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityTag {
    pub class_id: Option<String>,
    pub action: AiAction,
    pub passages: u32,
}

/// TS `AiPipeRequest` (the argument of `ai_send`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPipeRequest {
    pub request_id: String,
    pub base: AiBase,
    pub method: Method,
    /// `chat/completions` | `embeddings` | `key` | `models` | `models/<id>/endpoints`
    pub path: String,
    /// JSON; `provider` and `user` are rewritten by Rust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<serde_json::Value>,
    pub stream: bool,
    /// Only `standard` (a per-request relaxation, native confirmation, D-10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub privacy_override: Option<PrivacyLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub override_text: Option<ConfirmText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub busy_fallback: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<ActivityTag>,
}

/// One part of a multipart body (custom OpenAI-compatible STT hosts only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Part {
    pub name: String,
    pub file_name: Option<String>,
    pub mime: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AiBody {
    Json(serde_json::Value),
    Multipart(Vec<Part>),
}

/// A request as the pipe sees it (from `ai_send`, or from Rust callers with `internal`).
#[derive(Debug, Clone, PartialEq)]
pub struct AiRequest {
    pub request_id: String,
    pub base: AiBase,
    pub method: Method,
    pub path: String,
    pub body: Option<AiBody>,
    pub stream: bool,
    pub privacy_override: Option<PrivacyLevel>,
    pub busy_fallback: bool,
    pub activity: Option<ActivityTag>,
    /// Rust callers only (`ai_send` always sets false): allows `audio/transcriptions` (D-12).
    pub internal: bool,
}

impl AiRequest {
    /// The pipe request for an IPC `AiPipeRequest` (never internal).
    pub fn from_ipc(r: AiPipeRequest) -> Self {
        AiRequest {
            request_id: r.request_id,
            base: r.base,
            method: r.method,
            path: r.path,
            body: r.body.map(AiBody::Json),
            stream: r.stream,
            privacy_override: r.privacy_override,
            busy_fallback: r.busy_fallback.unwrap_or(false),
            activity: r.activity,
            internal: false,
        }
    }
}

/// TS `AiWireEvent` (the `ai_send` channel).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiWireEvent {
    /// Allow-listed headers only.
    Head {
        status: u16,
        headers: BTreeMap<String, String>,
    },
    /// One SSE line verbatim; blank lines dropped.
    Line {
        line: String,
    },
    /// The whole body when not streaming or status ≥ 300; top-level `user_id` removed.
    Body {
        text: String,
    },
    End,
    Fail {
        code: Code,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
    },
}

/// The response headers passed to the webview (rule 6).
pub const FORWARDED_HEADERS: [&str; 6] = [
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-openrouter-error-origin",
    "content-type",
];
/// OpenRouter attribution (critique C34).
pub const REFERER: &str = "https://github.com/feiteira/Tramado";
pub const TITLE: &str = "Tramado";
/// Paths only Rust callers may use (D-12).
pub const STT_PATH: &str = "audio/transcriptions";
pub const STT_CATALOG_PATH: &str = "models?output_modalities=transcription";

/// The method a path takes, or `INVALID` (rule 1).
pub fn check_path(path: &str, internal: bool) -> AppResult<Method> {
    match path {
        "chat/completions" | "embeddings" => return Ok(Method::Post),
        "key" | "models" => return Ok(Method::Get),
        STT_PATH if internal => return Ok(Method::Post),
        STT_CATALOG_PATH if internal => return Ok(Method::Get),
        _ => {}
    }
    if let Some(id) = path
        .strip_prefix("models/")
        .and_then(|r| r.strip_suffix("/endpoints"))
    {
        let chars_ok = !id.is_empty()
            && id.chars().count() <= 120
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_.:/-".contains(c));
        // `^[\w.:/-]{1,120}$`, and no empty, `.` or `..` segment (a model ID never has one).
        let segments_ok = id
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..");
        if chars_ok && segments_ok {
            return Ok(Method::Get);
        }
    }
    Err(AppError::invalid("this AI path is not allowed"))
}

/// Removes a top-level `user_id` from a JSON object body; other bodies are returned unchanged.
pub fn strip_user_id(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(mut m)) if m.contains_key("user_id") => {
            m.remove("user_id");
            Value::Object(m).to_string()
        }
        _ => text.to_string(),
    }
}

/// A coarse error code for the activity log and diagnostics (the TS classifier gives the
/// student-facing one).
fn code_for_status(status: u16, body: &str) -> Option<Code> {
    let policy = body.contains("data policy");
    Some(match status {
        0..=399 => return None,
        401 => Code::AiAuth,
        402 => Code::AiNoCredit,
        403 => Code::AiModelGated,
        404 if policy => Code::AiPrivacyBlocks,
        404 => Code::AiModelUnknown,
        408 | 504 => Code::AiTimeout,
        413 => Code::AiTooLong,
        429 => Code::AiBusy,
        400 | 422 => Code::AiBadRequest,
        503 => Code::AiUnavailable,
        _ => Code::AiUpstream,
    })
}

/// A transport failure: timeouts → `AI_TIMEOUT`, everything else (DNS, connect, reset) →
/// `AI_OFFLINE`.
fn transport_code(e: &ureq::Error) -> Code {
    match e {
        ureq::Error::Timeout(_) => Code::AiTimeout,
        ureq::Error::Io(io) if io.kind() == std::io::ErrorKind::TimedOut => Code::AiTimeout,
        _ => Code::AiOffline,
    }
}

fn read_error(e: std::io::Error) -> (Code, String) {
    let u = ureq::Error::from(e);
    (transport_code(&u), u.to_string())
}

/// Builds a multipart/form-data body (Trama's `Multipart`, with a random boundary).
pub fn multipart(parts: &[Part]) -> (String, Vec<u8>) {
    let boundary = format!("tramado-{}", tramado_base::ids::random_token_hex(16));
    let mut body = Vec::new();
    for p in parts {
        let name = p.name.replace(['"', '\r', '\n'], "_");
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"").as_bytes(),
        );
        if let Some(f) = &p.file_name {
            let f = f.replace(['"', '\r', '\n'], "_");
            body.extend_from_slice(format!("; filename=\"{f}\"").as_bytes());
        }
        body.extend_from_slice(b"\r\n");
        if let Some(m) = &p.mime {
            let m = m.replace(['\r', '\n'], "");
            body.extend_from_slice(format!("Content-Type: {m}\r\n").as_bytes());
        }
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(&p.bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

/// A request ready to go: everything rule 1–5 decided.
struct Prepared {
    request_id: String,
    method: Method,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
    stream: bool,
    host: String,
    path: String,
    model: Option<String>,
    privacy: ActivityPrivacy,
    activity: Option<ActivityTag>,
    stt: bool,
}

/// What `prepare` decided.
enum Plan {
    Go(Box<Prepared>),
    /// The person declined the native confirmation (D-10).
    Declined,
}

#[derive(Default)]
struct Slots {
    total: usize,
    blocking: usize,
    next_ticket: u64,
    serving: u64,
}

/// Where a request's events go (the `ai_send` channel).
pub type WireSink = Box<dyn Fn(AiWireEvent) + Send>;

/// One request's channel: once `end`/`fail` went out (or it was cancelled), nothing more goes.
struct Channel {
    sink: Mutex<Option<WireSink>>,
    cancelled: AtomicBool,
}

impl Channel {
    fn emit(&self, e: AiWireEvent) {
        let last = matches!(e, AiWireEvent::End | AiWireEvent::Fail { .. });
        let mut g = self.sink.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(sink) = g.as_ref() {
            sink(e);
        }
        if last {
            *g = None;
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.emit(AiWireEvent::Fail {
            code: Code::Cancelled,
            message: "cancelled".into(),
            data: None,
        });
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// How one exchange ended (for the activity line).
struct Outcome {
    status: Option<u16>,
    code: Option<Code>,
    bytes_in: u64,
}

struct Inner {
    secrets: Arc<Secrets>,
    hosts: Arc<HostList>,
    privacy: Arc<PrivacyStore>,
    activity: Arc<ActivityLog>,
    agent: ureq::Agent,
    openrouter_base: Mutex<String>,
    slots: Mutex<Slots>,
    slots_cv: Condvar,
    channels: Mutex<HashMap<String, Arc<Channel>>>,
    blocking_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    seq: AtomicU64,
}

pub struct AiPipe {
    inner: Arc<Inner>,
}

/// Gives a slot back when dropped.
struct SlotGuard {
    inner: Arc<Inner>,
    blocking: bool,
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        let mut s = self.inner.slots.lock().unwrap_or_else(|e| e.into_inner());
        s.total = s.total.saturating_sub(1);
        if self.blocking {
            s.blocking = s.blocking.saturating_sub(1);
        }
        self.inner.slots_cv.notify_all();
    }
}

impl AiPipe {
    pub fn new(
        secrets: Arc<Secrets>,
        hosts: Arc<HostList>,
        privacy: Arc<PrivacyStore>,
        activity: Arc<ActivityLog>,
        version: String,
    ) -> Self {
        AiPipe {
            inner: Arc::new(Inner {
                secrets,
                hosts,
                privacy,
                activity,
                agent: crate::http::ai_agent(&version),
                openrouter_base: Mutex::new(OPENROUTER_BASE.to_string()),
                slots: Mutex::new(Slots::default()),
                slots_cv: Condvar::new(),
                channels: Mutex::new(HashMap::new()),
                blocking_cancels: Mutex::new(HashMap::new()),
                seq: AtomicU64::new(0),
            }),
        }
    }

    /// Points "OpenRouter" at another base URL (tests with a `MockServer`; never reachable
    /// from IPC).
    #[doc(hidden)]
    pub fn set_openrouter_base_for_tests(&self, base: &str) {
        *self
            .inner
            .openrouter_base
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = base.trim_end_matches('/').to_string();
    }

    /// The stored privacy level (for callers that label their requests).
    pub fn privacy(&self) -> PrivacyLevel {
        self.inner.privacy.get()
    }

    /// Validates synchronously, asks `confirm(host)` when the request relaxes privacy, then
    /// runs on a `tramado-ai-<n>` thread; `JOB_BUSY` when the six slots are taken. A declined
    /// confirmation is reported on the channel (`fail{AI_PRIVACY_BLOCKS, data.declined}`), not
    /// as an error.
    pub fn send(
        &self,
        req: AiRequest,
        confirm: &dyn Fn(&str) -> bool,
        sink: WireSink,
    ) -> AppResult<()> {
        let prepared = match self.inner.prepare(&req, confirm)? {
            Plan::Go(p) => p,
            Plan::Declined => {
                sink(declined_event());
                return Ok(());
            }
        };
        let slot = self.inner.try_slot()?;
        let channel = Arc::new(Channel {
            sink: Mutex::new(Some(sink)),
            cancelled: AtomicBool::new(false),
        });
        {
            let mut ch = self
                .inner
                .channels
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(old) = ch.insert(prepared.request_id.clone(), channel.clone()) {
                // A reused request ID: the older request is cancelled.
                old.cancel();
            }
        }
        let n = self.inner.seq.fetch_add(1, Ordering::Relaxed);
        let inner = self.inner.clone();
        let ch = channel.clone();
        let spawned = std::thread::Builder::new()
            .name(format!("tramado-ai-{n}"))
            .spawn(move || {
                let id = prepared.request_id.clone();
                inner.run_streaming(*prepared, &ch, slot);
                let mut chans = inner.channels.lock().unwrap_or_else(|e| e.into_inner());
                if chans.get(&id).is_some_and(|c| Arc::ptr_eq(c, &ch)) {
                    chans.remove(&id);
                }
            });
        if let Err(e) = spawned {
            self.inner
                .channels
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&req.request_id);
            return Err(AppError::new(
                Code::IoError,
                format!("cannot start the AI request: {e}"),
            ));
        }
        Ok(())
    }

    /// For Rust callers (`speech::remote`): waits in a FIFO for a free slot (never more than
    /// four of the six), then returns the status and the body (`user_id` removed). `timeout`
    /// bounds the HTTP exchange. A 404 "data policy" on `audio/transcriptions` is
    /// `AI_PRIVACY_BLOCKS {stt: true}`. Relaxing privacy is not possible here (no dialog).
    pub fn request_blocking(&self, req: AiRequest, timeout: Duration) -> AppResult<(u16, Vec<u8>)> {
        let prepared = match self.inner.prepare(&req, &|_| false)? {
            Plan::Go(p) => p,
            Plan::Declined => {
                return Err(AppError::new(
                    Code::AiPrivacyBlocks,
                    "relaxing privacy needs a confirmation",
                )
                .with_data(serde_json::json!({"declined": true})))
            }
        };
        let cancelled = Arc::new(AtomicBool::new(false));
        self.inner
            .blocking_cancels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(prepared.request_id.clone(), cancelled.clone());
        let id = prepared.request_id.clone();
        let result = (|| {
            let _slot = self.inner.wait_slot(&cancelled)?;
            self.inner.run_blocking(*prepared, timeout, &cancelled)
        })();
        self.inner
            .blocking_cancels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        result
    }

    /// Cancels a request: an interactive one gets `fail{CANCELLED}` at once and nothing after
    /// it; a blocking one returns `CANCELLED` as soon as it can.
    pub fn cancel(&self, request_id: &str) {
        let ch = self
            .inner
            .channels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(request_id);
        if let Some(ch) = ch {
            ch.cancel();
        }
        if let Some(flag) = self
            .inner
            .blocking_cancels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(request_id)
        {
            flag.store(true, Ordering::SeqCst);
            self.inner.slots_cv.notify_all();
        }
    }

    /// Empties the activity log (`ai_activity_clear`).
    pub fn clear_activity(&self) -> AppResult<()> {
        self.inner.activity.clear()
    }

    /// Requests in flight now (diagnostics, tests).
    pub fn in_flight(&self) -> (usize, usize) {
        let s = self.inner.slots.lock().unwrap_or_else(|e| e.into_inner());
        (s.total, s.blocking)
    }
}

fn declined_event() -> AiWireEvent {
    AiWireEvent::Fail {
        code: Code::AiPrivacyBlocks,
        message: "the person kept the stricter privacy level".into(),
        data: Some(serde_json::json!({"declined": true})),
    }
}

impl Inner {
    /// Rules 1–5.
    fn prepare(&self, req: &AiRequest, confirm: &dyn Fn(&str) -> bool) -> AppResult<Plan> {
        if req.request_id.is_empty() || req.request_id.len() > 128 {
            return Err(AppError::invalid("bad request id"));
        }
        // Rule 1.
        let method = check_path(&req.path, req.internal)?;
        if method != req.method {
            return Err(AppError::invalid("wrong method for this AI path"));
        }
        // Rules 2 and 3.
        let (endpoint, key, openrouter) = match &req.base {
            AiBase::OpenRouter => {
                let base = self
                    .openrouter_base
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let host = Endpoint::parse(&base)
                    .map(|e| e.host)
                    .unwrap_or_else(|_| "openrouter.ai".into());
                let key = self
                    .secrets
                    .get("openrouter")?
                    .ok_or_else(|| AppError::new(Code::AiNoKey, "no OpenRouter key is set"))?;
                (Endpoint { host, base }, Some(key), true)
            }
            AiBase::Host { host_id } => {
                let h = self
                    .hosts
                    .get(host_id)
                    .ok_or_else(|| hosts::not_allowed(host_id))?;
                let e = Endpoint::parse(&h.base).map_err(|_| hosts::not_allowed(host_id))?;
                let key = self.secrets.get(&format!("host:{host_id}"))?;
                (e, key, false)
            }
        };
        // Rule 5: the effective privacy level.
        let stored = self.privacy.get();
        let mut level = stored;
        if openrouter {
            if let Some(wanted) = req.privacy_override {
                if stored.relaxes_to(wanted) {
                    let busy = wanted == PrivacyLevel::Standard
                        && req.busy_fallback
                        && self.privacy.busy_relax();
                    if busy || confirm(&endpoint.host) {
                        level = wanted;
                    } else {
                        return Ok(Plan::Declined);
                    }
                } else {
                    // Stricter than stored: always allowed.
                    level = wanted;
                }
            }
        }
        let mut model = None;
        let (body, content_type) = match (&req.body, method) {
            (_, Method::Get) => (None, None),
            (None, Method::Post) => return Err(AppError::invalid("this AI path needs a body")),
            (Some(AiBody::Json(v)), Method::Post) => {
                let Value::Object(mut m) = v.clone() else {
                    return Err(AppError::invalid(
                        "the AI request body must be a JSON object",
                    ));
                };
                m.remove("user");
                m.remove("provider");
                if openrouter {
                    if let Some(p) = level.provider() {
                        m.insert("provider".into(), p);
                    }
                }
                model = m
                    .get("model")
                    .and_then(Value::as_str)
                    .or_else(|| {
                        m.get("models")
                            .and_then(Value::as_array)
                            .and_then(|a| a.first())
                            .and_then(Value::as_str)
                    })
                    .map(|s| s.chars().take(200).collect());
                (
                    Some(serde_json::to_vec(&Value::Object(m))?),
                    Some("application/json".to_string()),
                )
            }
            (Some(AiBody::Multipart(parts)), Method::Post) => {
                if openrouter || !req.internal {
                    return Err(AppError::invalid(
                        "multipart bodies are for custom speech hosts only",
                    ));
                }
                model = parts
                    .iter()
                    .find(|p| p.name == "model" && p.file_name.is_none())
                    .map(|p| {
                        String::from_utf8_lossy(&p.bytes)
                            .chars()
                            .take(200)
                            .collect()
                    });
                let (ct, bytes) = multipart(parts);
                (Some(bytes), Some(ct))
            }
        };
        // Rule 4.
        let mut headers = Vec::new();
        if let Some(k) = key.filter(|k| !k.trim().is_empty()) {
            headers.push(("Authorization".to_string(), format!("Bearer {}", k.trim())));
        }
        if let Some(ct) = content_type {
            headers.push(("Content-Type".to_string(), ct));
        }
        if req.stream {
            headers.push(("Accept".to_string(), "text/event-stream".to_string()));
        }
        if openrouter {
            headers.push(("HTTP-Referer".to_string(), REFERER.to_string()));
            headers.push(("X-OpenRouter-Title".to_string(), TITLE.to_string()));
        }
        let privacy = if openrouter {
            match level {
                PrivacyLevel::Standard => ActivityPrivacy::Standard,
                PrivacyLevel::NoTraining => ActivityPrivacy::NoTraining,
                PrivacyLevel::Zdr => ActivityPrivacy::Zdr,
            }
        } else {
            ActivityPrivacy::CustomHost
        };
        Ok(Plan::Go(Box::new(Prepared {
            request_id: req.request_id.clone(),
            method,
            url: endpoint.url(&req.path),
            headers,
            body,
            stream: req.stream,
            host: endpoint.host,
            path: req.path.clone(),
            model,
            privacy,
            activity: req.activity.clone(),
            stt: req.path == STT_PATH,
        })))
    }

    fn try_slot(self: &Arc<Self>) -> AppResult<SlotGuard> {
        let mut s = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        if s.total >= MAX_IN_FLIGHT {
            return Err(AppError::new(Code::JobBusy, "too many AI requests at once"));
        }
        s.total += 1;
        Ok(SlotGuard {
            inner: self.clone(),
            blocking: false,
        })
    }

    /// FIFO: a blocking caller waits for its turn, a free slot and fewer than four blocking
    /// requests in flight.
    fn wait_slot(self: &Arc<Self>, cancelled: &AtomicBool) -> AppResult<SlotGuard> {
        let mut s = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        let ticket = s.next_ticket;
        s.next_ticket += 1;
        loop {
            if cancelled.load(Ordering::SeqCst) {
                // Give the turn away so the queue keeps moving.
                if s.serving == ticket {
                    s.serving += 1;
                } else {
                    // Not our turn yet: wait for it, then pass it on.
                    while s.serving != ticket {
                        s = self
                            .slots_cv
                            .wait_timeout(s, Duration::from_millis(200))
                            .map(|(g, _)| g)
                            .unwrap_or_else(|e| e.into_inner().0);
                    }
                    s.serving += 1;
                }
                self.slots_cv.notify_all();
                return Err(AppError::new(Code::Cancelled, "cancelled"));
            }
            if s.serving == ticket && s.total < MAX_IN_FLIGHT && s.blocking < MAX_BLOCKING {
                s.serving += 1;
                s.total += 1;
                s.blocking += 1;
                self.slots_cv.notify_all();
                return Ok(SlotGuard {
                    inner: self.clone(),
                    blocking: true,
                });
            }
            s = self
                .slots_cv
                .wait_timeout(s, Duration::from_millis(200))
                .map(|(g, _)| g)
                .unwrap_or_else(|e| e.into_inner().0);
        }
    }

    fn call(
        &self,
        p: &Prepared,
        timeout: Option<Duration>,
    ) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
        match p.method {
            Method::Get => {
                let mut rb = self.agent.get(&p.url);
                for (k, v) in &p.headers {
                    rb = rb.header(k, v);
                }
                match timeout {
                    Some(t) => rb.config().timeout_global(Some(t)).build().call(),
                    None => rb.call(),
                }
            }
            Method::Post => {
                let mut rb = self.agent.post(&p.url);
                for (k, v) in &p.headers {
                    rb = rb.header(k, v);
                }
                let body: &[u8] = p.body.as_deref().unwrap_or(&[]);
                match timeout {
                    Some(t) => rb.config().timeout_global(Some(t)).build().send(body),
                    None => rb.send(body),
                }
            }
        }
    }

    fn record(&self, p: &Prepared, started: Instant, o: &Outcome) {
        let tag = p.activity.as_ref();
        let entry = AiActivityEntry {
            at: tramado_base::time::instant(tramado_base::time::now_ms()),
            host: p.host.clone(),
            path: p.path.clone(),
            model: p.model.clone(),
            status: o.status,
            code: o.code,
            ms: started.elapsed().as_millis() as u64,
            bytes_out: p.body.as_ref().map(|b| b.len() as u64).unwrap_or(0),
            bytes_in: o.bytes_in,
            privacy: p.privacy,
            class_id: tag.and_then(|t| t.class_id.clone()),
            action: tag.map(|t| t.action),
            passages: tag.map(|t| t.passages).unwrap_or(0),
        };
        if let Err(e) = self.activity.record(&entry) {
            log::warn!("cannot write the AI activity log: {e}");
        }
    }

    /// Rule 6 for interactive requests: events on the channel. The activity line is written
    /// and the slot given back before the last event, so a caller that reacts to `end` finds
    /// both.
    fn run_streaming(&self, p: Prepared, ch: &Channel, slot: SlotGuard) {
        let started = Instant::now();
        let (outcome, last) = self.exchange_streaming(&p, ch);
        self.record(&p, started, &outcome);
        drop(slot);
        if let Some(e) = last {
            ch.emit(e);
        }
    }

    fn exchange_streaming(&self, p: &Prepared, ch: &Channel) -> (Outcome, Option<AiWireEvent>) {
        let fail = |code: Code, message: String| {
            Some(AiWireEvent::Fail {
                code,
                message,
                data: None,
            })
        };
        let cancelled = |status: Option<u16>, bytes_in: u64| {
            (
                Outcome {
                    status,
                    code: Some(Code::Cancelled),
                    bytes_in,
                },
                None,
            )
        };
        if ch.is_cancelled() {
            return cancelled(None, 0);
        }
        let res = match self.call(p, None) {
            Ok(r) => r,
            Err(e) => {
                let code = transport_code(&e);
                return (
                    Outcome {
                        status: None,
                        code: Some(code),
                        bytes_in: 0,
                    },
                    fail(code, format!("AI request failed: {e}")),
                );
            }
        };
        if ch.is_cancelled() {
            return cancelled(None, 0);
        }
        let status = res.status().as_u16();
        let mut headers = BTreeMap::new();
        for name in FORWARDED_HEADERS {
            if let Some(v) = res.headers().get(name).and_then(|v| v.to_str().ok()) {
                headers.insert(name.to_string(), v.to_string());
            }
        }
        ch.emit(AiWireEvent::Head { status, headers });
        let reader = res
            .into_body()
            .into_with_config()
            .limit(MAX_BODY_BYTES)
            .reader();
        let mut bytes_in = 0u64;
        if p.stream && (200..300).contains(&status) {
            let mut lines = BufReader::new(reader);
            let mut buf = Vec::new();
            loop {
                if ch.is_cancelled() {
                    return cancelled(Some(status), bytes_in);
                }
                buf.clear();
                match lines.read_until(b'\n', &mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        bytes_in += n as u64;
                        let text = String::from_utf8_lossy(&buf);
                        let line = text.trim_end_matches(['\n', '\r']);
                        if !line.is_empty() && !ch.is_cancelled() {
                            ch.emit(AiWireEvent::Line {
                                line: line.to_string(),
                            });
                        }
                    }
                    Err(e) => {
                        if ch.is_cancelled() {
                            return cancelled(Some(status), bytes_in);
                        }
                        let (code, msg) = read_error(e);
                        return (
                            Outcome {
                                status: Some(status),
                                code: Some(code),
                                bytes_in,
                            },
                            fail(code, format!("the AI stream broke: {msg}")),
                        );
                    }
                }
            }
            return (
                Outcome {
                    status: Some(status),
                    code: None,
                    bytes_in,
                },
                Some(AiWireEvent::End),
            );
        }
        let mut body = Vec::new();
        let mut reader = reader;
        if let Err(e) = reader.read_to_end(&mut body) {
            let (code, msg) = read_error(e);
            return (
                Outcome {
                    status: Some(status),
                    code: Some(code),
                    bytes_in: body.len() as u64,
                },
                fail(code, format!("the AI answer broke: {msg}")),
            );
        }
        bytes_in = body.len() as u64;
        let text = strip_user_id(&String::from_utf8_lossy(&body));
        let code = code_for_status(status, &text);
        if ch.is_cancelled() {
            return cancelled(Some(status), bytes_in);
        }
        ch.emit(AiWireEvent::Body { text });
        (
            Outcome {
                status: Some(status),
                code,
                bytes_in,
            },
            Some(AiWireEvent::End),
        )
    }

    /// Rule 6 for Rust callers.
    fn run_blocking(
        &self,
        p: Prepared,
        timeout: Duration,
        cancelled: &AtomicBool,
    ) -> AppResult<(u16, Vec<u8>)> {
        let started = Instant::now();
        let result = (|| {
            if cancelled.load(Ordering::SeqCst) {
                return Err((None, AppError::new(Code::Cancelled, "cancelled")));
            }
            let res = self.call(&p, Some(timeout)).map_err(|e| {
                (
                    None,
                    AppError::new(transport_code(&e), format!("AI request failed: {e}")),
                )
            })?;
            let status = res.status().as_u16();
            let mut body = Vec::new();
            res.into_body()
                .into_with_config()
                .limit(MAX_BODY_BYTES)
                .reader()
                .read_to_end(&mut body)
                .map_err(|e| {
                    let (code, msg) = read_error(e);
                    (
                        Some(status),
                        AppError::new(code, format!("the AI answer broke: {msg}")),
                    )
                })?;
            if cancelled.load(Ordering::SeqCst) {
                return Err((Some(status), AppError::new(Code::Cancelled, "cancelled")));
            }
            let text = String::from_utf8_lossy(&body).into_owned();
            if p.stt && status == 404 && text.contains("data policy") {
                return Err((
                    Some(status),
                    AppError::new(
                        Code::AiPrivacyBlocks,
                        "no cloud transcription provider meets this privacy level",
                    )
                    .with_data(serde_json::json!({"stt": true})),
                ));
            }
            let stripped = strip_user_id(&text);
            let out = if stripped.len() != text.len() {
                stripped.into_bytes()
            } else {
                body
            };
            Ok((status, out))
        })();
        let outcome = match &result {
            Ok((status, body)) => Outcome {
                status: Some(*status),
                code: code_for_status(*status, &String::from_utf8_lossy(body)),
                bytes_in: body.len() as u64,
            },
            Err((status, e)) => Outcome {
                status: *status,
                code: Some(e.code()),
                bytes_in: 0,
            },
        };
        self.record(&p, started, &outcome);
        result.map_err(|(_, e)| e)
    }
}

#[cfg(test)]
#[path = "ai_tests.rs"]
mod tests;
