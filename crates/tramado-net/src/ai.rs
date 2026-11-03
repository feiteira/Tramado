// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The AI pipe (architecture §5.2 `ai`, critique C1, D5, D-10, D-12): the only way anything
//! reaches OpenRouter or a custom AI host. It enforces the path and host allow-lists, injects
//! the key, overwrites `provider` from the privacy level, strips `user`/`user_id`, and passes
//! SSE lines through verbatim. **Types exact; `AiPipe` stubbed (M0)** — R-SHELL implements the
//! seven rules of architecture §5.2 on `ai_agent` (`http.rs`).

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult, Code};

use crate::activity::ActivityLog;
use crate::hosts::HostList;
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

pub struct AiPipe {
    _secrets: Arc<Secrets>,
    _hosts: Arc<HostList>,
    _privacy: Arc<PrivacyStore>,
    _activity: Arc<ActivityLog>,
    _version: String,
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
            _secrets: secrets,
            _hosts: hosts,
            _privacy: privacy,
            _activity: activity,
            _version: version,
        }
    }

    /// Validates synchronously, then runs on a `tramado-ai-<n>` thread; `JOB_BUSY` when the six
    /// slots are taken. `confirm(host)` shows the native relaxation dialog. **Stub.**
    pub fn send(
        &self,
        _req: AiRequest,
        _confirm: &dyn Fn(&str) -> bool,
        _sink: Box<dyn Fn(AiWireEvent) + Send>,
    ) -> AppResult<()> {
        Err(AppError::not_implemented("ai_send"))
    }

    /// For Rust callers (`speech::remote`): waits in a FIFO for a free slot (at most four of the
    /// six), returns status and body. **Stub.**
    pub fn request_blocking(
        &self,
        _req: AiRequest,
        _timeout: Duration,
    ) -> AppResult<(u16, Vec<u8>)> {
        Err(AppError::not_implemented("AiPipe::request_blocking"))
    }

    pub fn cancel(&self, _request_id: &str) {}

    pub fn clear_activity(&self) -> AppResult<()> {
        Err(AppError::not_implemented("ai_activity_clear"))
    }
}
