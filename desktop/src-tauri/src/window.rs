// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The main window (architecture §4.4, §5.5). It is created hidden and shown here unless the
//! app was started with `--hidden` (autostart). `CloseRequested` is not intercepted in Rust: the
//! webview handles it (Trama pattern). R-SHELL adds drag and drop → pick tokens → `app:drop`.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tramado_base::error::AppResult;
use tramado_base::picks::Picked;

use crate::state::Shared;

/// Payload of `app:drop`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropEvent {
    pub picked: Vec<Picked>,
    pub x: f64,
    pub y: f64,
}

pub const MAIN: &str = "main";

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    if !std::env::args().skip(1).any(|a| a == "--hidden") {
        show_main(app);
    }
    Ok(())
}

/// Shows and focuses the main window (errors are logged, never fatal).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        if let Err(e) = w.show() {
            log::warn!("cannot show the main window: {e}");
        }
        let _ = w.set_focus();
    }
}

pub fn on_window_event(_window: &Window, _event: &WindowEvent) {}
