// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The tray icon (architecture §5.5): present while `app_set_background_mode` says
//! `trayOnClose && sharedClasses > 0`; menu Open Tramado, Pause/Resume sharing, Quit; clicks emit
//! `app:tray`. **Stub (M0)**: R-SHELL implements it.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tramado_base::error::AppResult;

use crate::state::Shared;

/// TS `TrayAction`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrayAction {
    Open,
    PauseSharing,
    ResumeSharing,
    Quit,
}

/// Payload of `app:tray`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayEvent {
    pub action: TrayAction,
}

pub fn init(_app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    Ok(())
}
