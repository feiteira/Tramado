// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! System (architecture §6.5): links, notifications, the opt-in OS-global marker shortcuts,
//! power. **Stubs (M0)**: R-SHELL implements them.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tramado_base::error::AppResult;
use tramado_base::power::Power;
use tramado_speech::MarkerKind;

use super::ConfirmText;
use crate::state::Shared;
use crate::util::not_implemented;

/// `notify_show` argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyRequest {
    pub title: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// `shortcut_set_markers` argument (`Partial<Record<…, string>>`; default `Ctrl/⌘+Alt+1…4`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkerAccelerators {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub important: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confused: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exam: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub todo: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutId {
    Marker,
}

/// Payload of `app:shortcut`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutEvent {
    pub id: ShortcutId,
    pub kind: MarkerKind,
}

pub struct SystemState;

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    use tauri::Manager;
    app.manage(SystemState);
    Ok(())
}

pub fn on_exit(_app: &AppHandle) {}

/// `https://` only; a native confirmation showing the host, except for the allow-listed
/// prefixes of architecture §6.5.
#[tauri::command]
pub async fn open_external(url: String, text: ConfirmText) -> AppResult<bool> {
    let _ = (url, text);
    Err(not_implemented("open_external"))
}

#[tauri::command]
pub async fn notify_show(n: NotifyRequest) -> AppResult<()> {
    let _ = n;
    Err(not_implemented("notify_show"))
}

/// `null` unregisters.
#[tauri::command]
pub async fn shortcut_set_markers(accelerators: Option<MarkerAccelerators>) -> AppResult<()> {
    let _ = accelerators;
    Err(not_implemented("shortcut_set_markers"))
}

#[tauri::command]
pub async fn system_power() -> AppResult<Power> {
    Err(not_implemented("system_power"))
}
