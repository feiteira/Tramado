// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Secrets and AI (architecture §6.4 → `tramado-net`). Native confirmations (relaxing privacy,
//! allowing a host) are shown by Rust with `{host}` filled in (D-10). **Stubs (M0)**: R-SHELL
//! implements them. `secret_*` refuse the internal name `person`.

use tauri::ipc::Channel;
use tauri::AppHandle;
use tramado_base::error::AppResult;
use tramado_net::activity::AiActivityEntry;
use tramado_net::ai::{AiPipeRequest, AiWireEvent};
use tramado_net::hosts::AiHost;
use tramado_net::privacy::PrivacyLevel;
use tramado_net::secrets::SecretStatus;

use super::ConfirmText;
use crate::state::Shared;
use crate::util::not_implemented;

pub struct AiState;

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    use tauri::Manager;
    app.manage(AiState);
    Ok(())
}

pub fn on_exit(_app: &AppHandle) {}

#[tauri::command]
pub async fn secret_set(name: String, value: String) -> AppResult<SecretStatus> {
    let _ = (name, value);
    Err(not_implemented("secret_set"))
}

#[tauri::command]
pub async fn secret_status(name: String) -> AppResult<SecretStatus> {
    let _ = name;
    Err(not_implemented("secret_status"))
}

#[tauri::command]
pub async fn secret_clear(name: String) -> AppResult<()> {
    let _ = name;
    Err(not_implemented("secret_clear"))
}

/// Resolves once the worker started; the channel gets `head`, `line`*, `body`, `end` | `fail`.
#[tauri::command]
pub async fn ai_send(request: AiPipeRequest, on_event: Channel<AiWireEvent>) -> AppResult<()> {
    let _ = (request, on_event);
    Err(not_implemented("ai_send"))
}

#[tauri::command]
pub async fn ai_cancel(request_id: String) -> AppResult<()> {
    let _ = request_id;
    Err(not_implemented("ai_cancel"))
}

#[tauri::command]
pub async fn ai_hosts() -> AppResult<Vec<AiHost>> {
    Err(not_implemented("ai_hosts"))
}

/// `null` when the person declined the native confirmation.
#[tauri::command]
pub async fn ai_host_allow(base: String, text: ConfirmText) -> AppResult<Option<AiHost>> {
    let _ = (base, text);
    Err(not_implemented("ai_host_allow"))
}

#[tauri::command]
pub async fn ai_host_forget(host_id: String) -> AppResult<()> {
    let _ = host_id;
    Err(not_implemented("ai_host_forget"))
}

#[tauri::command]
pub async fn ai_privacy_get() -> AppResult<PrivacyLevel> {
    Err(not_implemented("ai_privacy_get"))
}

#[tauri::command]
pub async fn ai_privacy_set(level: PrivacyLevel, text: ConfirmText) -> AppResult<bool> {
    let _ = (level, text);
    Err(not_implemented("ai_privacy_set"))
}

/// Newest first; `limit` ≤ 500.
#[tauri::command]
pub async fn ai_activity(limit: u32) -> AppResult<Vec<AiActivityEntry>> {
    let _ = limit;
    Err(not_implemented("ai_activity"))
}

#[tauri::command]
pub async fn ai_activity_clear() -> AppResult<()> {
    Err(not_implemented("ai_activity_clear"))
}

#[tauri::command]
pub async fn ai_busy_policy_get() -> AppResult<bool> {
    Err(not_implemented("ai_busy_policy_get"))
}

/// false = declined.
#[tauri::command]
pub async fn ai_busy_policy_set(relax: bool, text: ConfirmText) -> AppResult<bool> {
    let _ = (relax, text);
    Err(not_implemented("ai_busy_policy_set"))
}
