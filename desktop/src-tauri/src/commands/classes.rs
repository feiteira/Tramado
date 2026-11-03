// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The class registry and class files (architecture §6.2). M0 implements `classes_list`;
//! R-SHELL implements the rest on `tramado_base::ClassFs` (and the watcher → `class:changed`).
//! Every command whose TS type is `ClassEntry` returns `ClassEntryView`.

use serde::{Deserialize, Serialize};
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, State};
use tramado_base::classfs::FileStamp;
use tramado_base::error::AppResult;
use tramado_base::files::FileEntry;
use tramado_base::registry::ClassEntryView;

use crate::state::Shared;
use crate::util::{blocking, not_implemented};

/// TS `ClassesRoot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassesRoot {
    pub path: String,
    /// existing child names (TS makes new directory names unique with them)
    pub names: Vec<String>,
}

/// `class_create` argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClassRequest {
    pub class_id: String,
    pub dir_name: String,
    /// pick token of a folder (default: the classes root)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CreateWarning {
    /// the folder is inside OneDrive, Dropbox, iCloud Drive or Google Drive
    CloudFolder,
}

/// TS `CreatedClass`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedClass {
    pub entry: ClassEntryView,
    pub warnings: Vec<CreateWarning>,
}

/// TS `AdoptedClass`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptedClass {
    pub entry: ClassEntryView,
    /// `.tramado/members/` holds files of other devices → TS forks it (sync spec §17)
    pub foreign_members: bool,
}

/// `class_update` patch.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_audio: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_ignores: Option<Vec<String>>,
}

/// `class_list` options.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOpts {
    pub recursive: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_tramado: Option<bool>,
}

/// The classes domain's managed state (R-SHELL adds the watcher).
pub struct ClassesState;

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    use tauri::Manager;
    app.manage(ClassesState);
    Ok(())
}

pub fn on_exit(_app: &AppHandle) {}

#[tauri::command]
pub async fn classes_list(shared: State<'_, Shared>) -> AppResult<Vec<ClassEntryView>> {
    let registry = shared.registry.clone();
    blocking(move || {
        Ok(registry
            .list()
            .into_iter()
            .map(ClassEntryView::of)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn classes_root() -> AppResult<ClassesRoot> {
    Err(not_implemented("classes_root"))
}

#[tauri::command]
pub async fn classes_set_root(pick: String) -> AppResult<ClassesRoot> {
    let _ = pick;
    Err(not_implemented("classes_set_root"))
}

#[tauri::command]
pub async fn class_create(req: CreateClassRequest) -> AppResult<CreatedClass> {
    let _ = req;
    Err(not_implemented("class_create"))
}

#[tauri::command]
pub async fn class_adopt(pick: String) -> AppResult<AdoptedClass> {
    let _ = pick;
    Err(not_implemented("class_adopt"))
}

#[tauri::command]
pub async fn class_fork(class_id: String, new_class_id: String) -> AppResult<ClassEntryView> {
    let _ = (class_id, new_class_id);
    Err(not_implemented("class_fork"))
}

#[tauri::command]
pub async fn class_update(class_id: String, patch: ClassPatch) -> AppResult<ClassEntryView> {
    let _ = (class_id, patch);
    Err(not_implemented("class_update"))
}

#[tauri::command]
pub async fn class_forget(class_id: String) -> AppResult<()> {
    let _ = class_id;
    Err(not_implemented("class_forget"))
}

#[tauri::command]
pub async fn class_trash(class_id: String) -> AppResult<()> {
    let _ = class_id;
    Err(not_implemented("class_trash"))
}

#[tauri::command]
pub async fn class_trash_empty(class_id: String) -> AppResult<()> {
    let _ = class_id;
    Err(not_implemented("class_trash_empty"))
}

#[tauri::command]
pub async fn class_list(
    class_id: String,
    dir: String,
    opts: ListOpts,
) -> AppResult<Vec<FileEntry>> {
    let _ = (class_id, dir, opts);
    Err(not_implemented("class_list"))
}

#[tauri::command]
pub async fn class_stat(class_id: String, path: String) -> AppResult<Option<FileEntry>> {
    let _ = (class_id, path);
    Err(not_implemented("class_stat"))
}

#[tauri::command]
pub async fn class_read(class_id: String, path: String) -> AppResult<Response> {
    let _ = (class_id, path);
    Err(not_implemented("class_read"))
}

#[tauri::command]
pub async fn class_read_range(
    class_id: String,
    path: String,
    offset: u64,
    length: u64,
) -> AppResult<Response> {
    let _ = (class_id, path, offset, length);
    Err(not_implemented("class_read_range"))
}

/// Raw body; headers `x-class`, `x-path`, `x-own`.
#[tauri::command]
pub async fn class_write(request: Request<'_>) -> AppResult<FileStamp> {
    let _ = request;
    Err(not_implemented("class_write"))
}

/// Raw body (one line incl. `\n`); headers `x-class`, `x-path`, `x-own`.
#[tauri::command]
pub async fn class_append(request: Request<'_>) -> AppResult<FileStamp> {
    let _ = request;
    Err(not_implemented("class_append"))
}

#[tauri::command]
pub async fn class_mkdir(class_id: String, path: String) -> AppResult<()> {
    let _ = (class_id, path);
    Err(not_implemented("class_mkdir"))
}

#[tauri::command]
pub async fn class_move(class_id: String, from: String, to: String) -> AppResult<()> {
    let _ = (class_id, from, to);
    Err(not_implemented("class_move"))
}

#[tauri::command]
pub async fn class_remove(class_id: String, path: String, recursive: bool) -> AppResult<()> {
    let _ = (class_id, path, recursive);
    Err(not_implemented("class_remove"))
}

#[tauri::command]
pub async fn class_hash(class_id: String, path: String) -> AppResult<String> {
    let _ = (class_id, path);
    Err(not_implemented("class_hash"))
}

#[tauri::command]
pub async fn class_import(class_id: String, pick: String, dest: String) -> AppResult<FileStamp> {
    let _ = (class_id, pick, dest);
    Err(not_implemented("class_import"))
}

#[tauri::command]
pub async fn class_export(class_id: String, path: String, pick: String) -> AppResult<()> {
    let _ = (class_id, path, pick);
    Err(not_implemented("class_export"))
}

#[tauri::command]
pub async fn class_reveal(class_id: String, path: Option<String>) -> AppResult<()> {
    let _ = (class_id, path);
    Err(not_implemented("class_reveal"))
}

#[tauri::command]
pub async fn class_open(class_id: String, path: String) -> AppResult<()> {
    let _ = (class_id, path);
    Err(not_implemented("class_open"))
}
