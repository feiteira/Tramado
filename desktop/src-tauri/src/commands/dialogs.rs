// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Native dialogs, run in Rust; results are pick tokens, never paths the webview chose
//! (architecture §6.3, D-4). With `TRAMADO_DATA_DIR` and `TRAMADO_E2E=1` the answers come from
//! the JSON queue in `TRAMADO_E2E_DIALOGS`. **Stubs (M0)**: R-SHELL implements them.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tramado_base::error::AppResult;
use tramado_base::picks::Picked;

use crate::state::Shared;
use crate::util::not_implemented;

/// TS `FileFilter` (extensions without the dot; empty lists are dropped, Trama gotcha).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickFilesRequest {
    pub title: String,
    pub filters: Vec<FileFilter>,
    pub multiple: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickFolderRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub title: String,
    pub default_name: String,
    pub filters: Vec<FileFilter>,
}

pub struct DialogsState;

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    use tauri::Manager;
    app.manage(DialogsState);
    Ok(())
}

pub fn on_exit(_app: &AppHandle) {}

#[tauri::command]
pub async fn dialog_pick_files(req: PickFilesRequest) -> AppResult<Vec<Picked>> {
    let _ = req;
    Err(not_implemented("dialog_pick_files"))
}

#[tauri::command]
pub async fn dialog_pick_folder(req: PickFolderRequest) -> AppResult<Option<Picked>> {
    let _ = req;
    Err(not_implemented("dialog_pick_folder"))
}

#[tauri::command]
pub async fn dialog_save(req: SaveRequest) -> AppResult<Option<Picked>> {
    let _ = req;
    Err(not_implemented("dialog_save"))
}
