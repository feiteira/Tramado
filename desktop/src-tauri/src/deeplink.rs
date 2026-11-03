// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Deep links (architecture §5.5, §7.1): `tramado://join/…` (and `tramado://pair/…` in v1.1)
//! from the plugin and from a second instance's argv become `app:deep-link {url}`; an opened
//! `.tramado-invite` file is read in Rust (≤ 64 KiB, UTF-8) and delivered as
//! `{url: 'file:', text}` — the webview never gets the path. Links that arrive before the
//! webview listens wait for `app_take_pending_links`. **Stub (M0)**: a second instance only
//! brings the window forward; R-SHELL implements the rest.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tramado_base::error::AppResult;

use crate::state::Shared;

/// Payload of `app:deep-link`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkEvent {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

pub fn init(_app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    Ok(())
}

/// Called by the single-instance plugin in the first instance with the second one's argv.
pub fn on_second_instance(app: &AppHandle, argv: Vec<String>) {
    let _ = argv;
    crate::window::show_main(app);
}
