// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Secrets and AI (architecture §6.4 → `tramado-net`). Native confirmations (relaxing privacy,
//! allowing a host) are shown by Rust with `{host}` filled in by Rust (D-10), so a script in
//! the webview cannot answer them. `secret_*` refuse the internal name `person`.
//!
//! Besides `AiState`, `init` manages `Arc<AiPipe>` and `Arc<Secrets>` on their own, for the
//! speech domain (`speech::remote` sends cloud transcription through `AiPipe::request_blocking`).

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tramado_base::error::{AppError, AppResult};
use tramado_net::activity::{ActivityLog, AiActivityEntry};
use tramado_net::ai::{AiPipe, AiPipeRequest, AiRequest, AiWireEvent};
use tramado_net::hosts::{AiHost, Endpoint, HostList};
use tramado_net::person::Person;
use tramado_net::privacy::{PrivacyLevel, PrivacyStore};
use tramado_net::secrets::{SecretStatus, Secrets};

use super::ConfirmText;
use crate::commands::dialogs;
use crate::state::Shared;
use crate::util::blocking;

/// The AI domain's managed state.
pub struct AiState {
    pub secrets: Arc<Secrets>,
    pub hosts: Arc<HostList>,
    pub privacy: Arc<PrivacyStore>,
    pub activity: Arc<ActivityLog>,
    pub pipe: Arc<AiPipe>,
    pub person: Arc<Person>,
}

pub fn init(app: &AppHandle, shared: &Shared) -> AppResult<()> {
    let p = &shared.paths;
    let secrets = Arc::new(Secrets::new(&p.config, p.dev_isolated));
    let hosts = Arc::new(HostList::load(&p.config));
    let privacy = Arc::new(PrivacyStore::new(&p.config));
    let activity = Arc::new(ActivityLog::new(&p.data));
    let pipe = Arc::new(AiPipe::new(
        secrets.clone(),
        hosts.clone(),
        privacy.clone(),
        activity.clone(),
        shared.version.clone(),
    ));
    let person = Arc::new(Person::new(secrets.clone()));
    app.manage(pipe.clone());
    app.manage(secrets.clone());
    app.manage(AiState {
        secrets,
        hosts,
        privacy,
        activity,
        pipe,
        person,
    });
    Ok(())
}

pub fn on_exit(_app: &AppHandle) {}

#[tauri::command]
pub async fn secret_set(
    ai: State<'_, AiState>,
    name: String,
    value: String,
) -> AppResult<SecretStatus> {
    let s = ai.secrets.clone();
    blocking(move || s.set(&name, &value)).await
}

#[tauri::command]
pub async fn secret_status(ai: State<'_, AiState>, name: String) -> AppResult<SecretStatus> {
    let s = ai.secrets.clone();
    blocking(move || s.status(&name)).await
}

#[tauri::command]
pub async fn secret_clear(ai: State<'_, AiState>, name: String) -> AppResult<()> {
    let s = ai.secrets.clone();
    blocking(move || s.clear(&name)).await
}

/// Resolves once the worker started; the channel gets `head`, `line`*, `body`, `end` | `fail`.
/// A `privacyOverride` that relaxes privacy shows a native confirmation (with `overrideText`;
/// without it the request is declined), unless `busyFallback` and the busy relaxation is on.
#[tauri::command]
pub async fn ai_send(
    app: AppHandle,
    ai: State<'_, AiState>,
    request: AiPipeRequest,
    on_event: Channel<AiWireEvent>,
) -> AppResult<()> {
    let pipe = ai.pipe.clone();
    let text = request.override_text.clone();
    let req = AiRequest::from_ipc(request);
    blocking(move || {
        let confirm = |host: &str| match &text {
            Some(t) => dialogs::confirm(&app, t, Some(host)),
            None => false,
        };
        pipe.send(
            req,
            &confirm,
            Box::new(move |e| {
                // A channel whose webview went away fails: the request just ends.
                let _ = on_event.send(e);
            }),
        )
    })
    .await
}

#[tauri::command]
pub async fn ai_cancel(ai: State<'_, AiState>, request_id: String) -> AppResult<()> {
    ai.pipe.cancel(&request_id);
    Ok(())
}

#[tauri::command]
pub async fn ai_hosts(ai: State<'_, AiState>) -> AppResult<Vec<AiHost>> {
    Ok(ai.hosts.list())
}

/// `null` when the person declined the native confirmation. A host allowed before is returned
/// at once (its base is updated); OpenRouter is built in (`INVALID`). `text.message` must name
/// the host with `{host}`, which Rust fills from the parsed address.
#[tauri::command]
pub async fn ai_host_allow(
    app: AppHandle,
    ai: State<'_, AiState>,
    base: String,
    text: ConfirmText,
) -> AppResult<Option<AiHost>> {
    let e = Endpoint::parse(&base)?;
    if e.is_built_in() {
        return Err(AppError::invalid("OpenRouter is built in"));
    }
    let hosts = ai.hosts.clone();
    if let Some(existing) = hosts.find(&e) {
        let label = existing.label;
        return blocking(move || hosts.add(&e, &label).map(Some)).await;
    }
    if !text.message.contains("{host}") {
        return Err(AppError::invalid("the message must name the host"));
    }
    blocking(move || {
        if dialogs::confirm(&app, &text, Some(&e.host)) {
            hosts.add(&e, "").map(Some)
        } else {
            Ok(None)
        }
    })
    .await
}

/// Also clears the host's key (`host:<id>`).
#[tauri::command]
pub async fn ai_host_forget(ai: State<'_, AiState>, host_id: String) -> AppResult<()> {
    let (hosts, secrets) = (ai.hosts.clone(), ai.secrets.clone());
    blocking(move || {
        hosts.remove(&host_id)?;
        match secrets.clear(&format!("host:{host_id}")) {
            Ok(()) => Ok(()),
            // An ID that cannot name a secret had no key.
            Err(e) if e.code() == tramado_base::error::Code::Invalid => Ok(()),
            Err(e) => Err(e),
        }
    })
    .await
}

#[tauri::command]
pub async fn ai_privacy_get(ai: State<'_, AiState>) -> AppResult<PrivacyLevel> {
    Ok(ai.privacy.get())
}

/// A native confirmation only when relaxing (`zdr` → `no-training` → `standard`); `false` =
/// declined (nothing changed).
#[tauri::command]
pub async fn ai_privacy_set(
    app: AppHandle,
    ai: State<'_, AiState>,
    level: PrivacyLevel,
    text: ConfirmText,
) -> AppResult<bool> {
    let privacy = ai.privacy.clone();
    blocking(move || {
        if privacy.get().relaxes_to(level) && !dialogs::confirm(&app, &text, Some("openrouter.ai"))
        {
            return Ok(false);
        }
        privacy.set(level)?;
        Ok(true)
    })
    .await
}

/// Newest first; `limit` ≤ 500.
#[tauri::command]
pub async fn ai_activity(ai: State<'_, AiState>, limit: u32) -> AppResult<Vec<AiActivityEntry>> {
    let a = ai.activity.clone();
    blocking(move || a.list(limit as usize)).await
}

#[tauri::command]
pub async fn ai_activity_clear(ai: State<'_, AiState>) -> AppResult<()> {
    let pipe = ai.pipe.clone();
    blocking(move || pipe.clear_activity()).await
}

#[tauri::command]
pub async fn ai_busy_policy_get(ai: State<'_, AiState>) -> AppResult<bool> {
    Ok(ai.privacy.busy_relax())
}

/// Turning it on needs a native confirmation (D-10); `false` = declined.
#[tauri::command]
pub async fn ai_busy_policy_set(
    app: AppHandle,
    ai: State<'_, AiState>,
    relax: bool,
    text: ConfirmText,
) -> AppResult<bool> {
    let privacy = ai.privacy.clone();
    blocking(move || {
        if relax && !privacy.busy_relax() && !dialogs::confirm(&app, &text, Some("openrouter.ai")) {
            return Ok(false);
        }
        privacy.set_busy_relax(relax)?;
        Ok(true)
    })
    .await
}
