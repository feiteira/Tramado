// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Sync (architecture §6.7 → `tramado-sync`). **Stubs (M0)**: R-SYNC builds the `SyncEngine`
//! here with a `SyncSink` that emits `sync:event`, registers the `WriteObserver`, calls
//! `ClassFs::set_device` after `identity()` and starts Syncthing in the background when a class
//! is shared; `on_exit` stops it (5 s deadline) off the main thread.

use std::collections::BTreeMap;

use tauri::ipc::Request;
use tauri::AppHandle;
use tramado_base::error::AppResult;
use tramado_base::registry::ClassEntryView;
use tramado_sync::{
    AcceptFolderRequest, CaughtUp, ClassPolicy, CopiedIdentityAction, DeviceStat,
    ExistingSyncthing, FileSyncInfo, FolderError, FolderView, JoinRequest, LeaveOptions,
    MassDeleteAction, RestoreItem, Sig, SyncDiagnostics, SyncIdentity, SyncSettings, SyncSnapshot,
    SyncStatus, VersionEntry,
};

use crate::state::Shared;
use crate::util::not_implemented;

pub struct SyncState;

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    use tauri::Manager;
    app.manage(SyncState);
    Ok(())
}

pub fn on_exit(_app: &AppHandle) {}

#[tauri::command]
pub async fn sync_identity() -> AppResult<SyncIdentity> {
    Err(not_implemented("sync_identity"))
}

#[tauri::command]
pub async fn sync_identity_resolve(action: CopiedIdentityAction) -> AppResult<SyncIdentity> {
    let _ = action;
    Err(not_implemented("sync_identity_resolve"))
}

#[tauri::command]
pub async fn sync_start() -> AppResult<SyncStatus> {
    Err(not_implemented("sync_start"))
}

#[tauri::command]
pub async fn sync_restart() -> AppResult<SyncStatus> {
    Err(not_implemented("sync_restart"))
}

#[tauri::command]
pub async fn sync_status() -> AppResult<SyncStatus> {
    Err(not_implemented("sync_status"))
}

#[tauri::command]
pub async fn sync_snapshot() -> AppResult<SyncSnapshot> {
    Err(not_implemented("sync_snapshot"))
}

#[tauri::command]
pub async fn sync_settings_apply(settings: SyncSettings) -> AppResult<()> {
    let _ = settings;
    Err(not_implemented("sync_settings_apply"))
}

#[tauri::command]
pub async fn sync_policy_set(policy: ClassPolicy) -> AppResult<()> {
    let _ = policy;
    Err(not_implemented("sync_policy_set"))
}

/// Raw body (RFC 8785 canonical JSON of the record without `sig`); headers `x-class`, `x-path`.
#[tauri::command]
pub async fn sync_sign(request: Request<'_>) -> AppResult<Sig> {
    let _ = request;
    Err(not_implemented("sync_sign"))
}

#[tauri::command]
pub async fn sync_share_class(class_id: String, label: String) -> AppResult<ClassEntryView> {
    let _ = (class_id, label);
    Err(not_implemented("sync_share_class"))
}

#[tauri::command]
pub async fn sync_join_class(req: JoinRequest) -> AppResult<ClassEntryView> {
    let _ = req;
    Err(not_implemented("sync_join_class"))
}

#[tauri::command]
pub async fn sync_cancel_join(class_id: String) -> AppResult<()> {
    let _ = class_id;
    Err(not_implemented("sync_cancel_join"))
}

#[tauri::command]
pub async fn sync_accept_folder(req: AcceptFolderRequest) -> AppResult<ClassEntryView> {
    let _ = req;
    Err(not_implemented("sync_accept_folder"))
}

#[tauri::command]
pub async fn sync_leave_class(class_id: String, opts: LeaveOptions) -> AppResult<()> {
    let _ = (class_id, opts);
    Err(not_implemented("sync_leave_class"))
}

#[tauri::command]
pub async fn sync_admit(class_id: String, device_id: String) -> AppResult<()> {
    let _ = (class_id, device_id);
    Err(not_implemented("sync_admit"))
}

#[tauri::command]
pub async fn sync_decline(class_id: String, device_id: String) -> AppResult<()> {
    let _ = (class_id, device_id);
    Err(not_implemented("sync_decline"))
}

#[tauri::command]
pub async fn sync_normalize_ids(ids: Vec<String>) -> AppResult<Vec<Option<String>>> {
    let _ = ids;
    Err(not_implemented("sync_normalize_ids"))
}

#[tauri::command]
pub async fn sync_own_addresses() -> AppResult<Vec<String>> {
    Err(not_implemented("sync_own_addresses"))
}

/// `paths` ≤ 500.
#[tauri::command]
pub async fn sync_file_info(class_id: String, paths: Vec<String>) -> AppResult<Vec<FileSyncInfo>> {
    let _ = (class_id, paths);
    Err(not_implemented("sync_file_info"))
}

#[tauri::command]
pub async fn sync_wait_available(
    class_id: String,
    path: String,
    min_devices: u32,
    timeout_ms: u64,
) -> AppResult<bool> {
    let _ = (class_id, path, min_devices, timeout_ms);
    Err(not_implemented("sync_wait_available"))
}

#[tauri::command]
pub async fn sync_wait_caught_up(class_id: String, timeout_ms: u64) -> AppResult<CaughtUp> {
    let _ = (class_id, timeout_ms);
    Err(not_implemented("sync_wait_caught_up"))
}

#[tauri::command]
pub async fn sync_device_stats() -> AppResult<BTreeMap<String, DeviceStat>> {
    Err(not_implemented("sync_device_stats"))
}

#[tauri::command]
pub async fn sync_folder_status(class_id: String) -> AppResult<FolderView> {
    let _ = class_id;
    Err(not_implemented("sync_folder_status"))
}

#[tauri::command]
pub async fn sync_versions(class_id: String) -> AppResult<Vec<VersionEntry>> {
    let _ = class_id;
    Err(not_implemented("sync_versions"))
}

#[tauri::command]
pub async fn sync_restore(class_id: String, items: Vec<RestoreItem>) -> AppResult<()> {
    let _ = (class_id, items);
    Err(not_implemented("sync_restore"))
}

#[tauri::command]
pub async fn sync_folder_errors(class_id: String) -> AppResult<Vec<FolderError>> {
    let _ = class_id;
    Err(not_implemented("sync_folder_errors"))
}

#[tauri::command]
pub async fn sync_pause_class(class_id: String, paused: bool) -> AppResult<()> {
    let _ = (class_id, paused);
    Err(not_implemented("sync_pause_class"))
}

#[tauri::command]
pub async fn sync_mass_delete_resolve(class_id: String, action: MassDeleteAction) -> AppResult<()> {
    let _ = (class_id, action);
    Err(not_implemented("sync_mass_delete_resolve"))
}

#[tauri::command]
pub async fn sync_scan(class_id: String, path: Option<String>) -> AppResult<()> {
    let _ = (class_id, path);
    Err(not_implemented("sync_scan"))
}

#[tauri::command]
pub async fn sync_diagnostics() -> AppResult<SyncDiagnostics> {
    Err(not_implemented("sync_diagnostics"))
}

#[tauri::command]
pub async fn sync_existing() -> AppResult<ExistingSyncthing> {
    Err(not_implemented("sync_existing"))
}
