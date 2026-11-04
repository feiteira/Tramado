// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Sync (architecture §6.7 → `tramado-sync`). `init` builds the `SyncEngine` with a `SyncSink`
//! that emits `sync:event` (and moves left classes to the OS trash), which registers its
//! `WriteObserver` on `ClassFs`; it resolves pick tokens through the `PickRegistry`, calls
//! `identity()` (which sets `ClassFs::set_device`) when an identity exists, and starts Syncthing
//! in the background when a class is shared (sync spec §2.9). `on_exit` stops it with a 5 s
//! deadline off the main thread.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tauri::ipc::Request;
use tauri::{AppHandle, Emitter, Manager, State};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::picks::PickKind;
use tramado_base::registry::ClassEntryView;
use tramado_sync::{
    AcceptFolderRequest, CaughtUp, ClassPolicy, CopiedIdentityAction, DeviceStat,
    ExistingSyncthing, FileSyncInfo, FolderError, FolderView, JoinRequest, LeaveOptions,
    MassDeleteAction, RestoreItem, Sig, SyncConfig, SyncDiagnostics, SyncEngine, SyncEvent,
    SyncIdentity, SyncSettings, SyncSink, SyncSnapshot, SyncStatus, VersionEntry,
};

use crate::commands::events;
use crate::state::Shared;
use crate::util::{blocking, body_bytes, header};

pub struct SyncState {
    pub engine: Arc<SyncEngine>,
}

struct TauriSink(AppHandle);

impl SyncSink for TauriSink {
    fn event(&self, e: SyncEvent) {
        let _ = self.0.emit(events::SYNC, &e);
    }

    fn trash(&self, path: &Path) -> AppResult<()> {
        trash::delete(path).map_err(|e| AppError::new(Code::IoError, format!("trash: {e}")))
    }
}

/// `TRAMADO_SYNCTHING_BIN` (development and tests), else the sidecar next to the executable.
fn sidecar() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("TRAMADO_SYNCTHING_BIN").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(p));
    }
    let exe = std::env::current_exe().ok()?;
    Some(
        exe.parent()?
            .join(format!("tramado-syncthing{}", std::env::consts::EXE_SUFFIX)),
    )
}

pub fn init(app: &AppHandle, shared: &Shared) -> AppResult<()> {
    let engine = Arc::new(SyncEngine::new(
        SyncConfig {
            paths: shared.paths.clone(),
            fs: shared.fs.clone(),
            registry: shared.registry.clone(),
            version: shared.version.clone(),
            sidecar: sidecar(),
        },
        Arc::new(TauriSink(app.clone())),
    ));
    let picks = shared.picks.clone();
    engine.set_pick_resolver(Arc::new(move |tok: &str| {
        picks.resolve(tok, PickKind::Folder)
    }));
    if shared.paths.syncthing_home().join("config.xml").is_file() {
        if let Err(e) = engine.identity() {
            log::warn!("sync: identity: {e}");
        }
    }
    if engine.has_shared_class() {
        let e = engine.clone();
        let _ = std::thread::Builder::new()
            .name("tramado-sync-boot".into())
            .spawn(move || {
                if let Err(err) = e.start() {
                    log::warn!("sync: start at launch: {err}");
                }
            });
    }
    app.manage(SyncState { engine });
    Ok(())
}

/// Background stop with the §2.8 deadline; the exit path waits at most that long.
pub fn on_exit(app: &AppHandle) {
    let Some(st) = app.try_state::<SyncState>() else {
        return;
    };
    let engine = st.engine.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("tramado-sync-stop".into())
        .spawn(move || {
            engine.stop(Duration::from_secs(5));
            let _ = tx.send(());
        });
    if spawned.is_ok() {
        let _ = rx.recv_timeout(Duration::from_millis(6500));
    }
}

fn engine(st: &State<'_, SyncState>) -> Arc<SyncEngine> {
    st.engine.clone()
}

#[tauri::command]
pub async fn sync_identity(st: State<'_, SyncState>) -> AppResult<SyncIdentity> {
    let e = engine(&st);
    blocking(move || e.identity()).await
}

#[tauri::command]
pub async fn sync_identity_resolve(
    st: State<'_, SyncState>,
    action: CopiedIdentityAction,
) -> AppResult<SyncIdentity> {
    let e = engine(&st);
    blocking(move || e.resolve_copied_identity(action)).await
}

#[tauri::command]
pub async fn sync_start(st: State<'_, SyncState>) -> AppResult<SyncStatus> {
    let e = engine(&st);
    blocking(move || e.start()).await
}

#[tauri::command]
pub async fn sync_restart(st: State<'_, SyncState>) -> AppResult<SyncStatus> {
    let e = engine(&st);
    blocking(move || e.restart()).await
}

#[tauri::command]
pub async fn sync_status(st: State<'_, SyncState>) -> AppResult<SyncStatus> {
    Ok(st.engine.status())
}

#[tauri::command]
pub async fn sync_snapshot(st: State<'_, SyncState>) -> AppResult<SyncSnapshot> {
    let e = engine(&st);
    blocking(move || e.snapshot()).await
}

#[tauri::command]
pub async fn sync_settings_apply(
    st: State<'_, SyncState>,
    settings: SyncSettings,
) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.apply_settings(settings)).await
}

#[tauri::command]
pub async fn sync_policy_set(st: State<'_, SyncState>, policy: ClassPolicy) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.set_class_policy(policy)).await
}

/// Raw body (RFC 8785 canonical JSON of the record without `sig`); headers `x-class`, `x-path`.
#[tauri::command]
pub async fn sync_sign(st: State<'_, SyncState>, request: Request<'_>) -> AppResult<Sig> {
    let canonical = body_bytes(&request)?;
    let class = header(&request, "x-class")?;
    let path = header(&request, "x-path")?;
    let e = engine(&st);
    blocking(move || e.sign(&class, &path, &canonical)).await
}

#[tauri::command]
pub async fn sync_share_class(
    st: State<'_, SyncState>,
    class_id: String,
    label: String,
) -> AppResult<ClassEntryView> {
    let e = engine(&st);
    blocking(move || e.share_class(&class_id, &label).map(ClassEntryView::of)).await
}

#[tauri::command]
pub async fn sync_join_class(
    st: State<'_, SyncState>,
    req: JoinRequest,
) -> AppResult<ClassEntryView> {
    let e = engine(&st);
    blocking(move || e.join_class(req).map(ClassEntryView::of)).await
}

#[tauri::command]
pub async fn sync_cancel_join(st: State<'_, SyncState>, class_id: String) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.cancel_join(&class_id)).await
}

#[tauri::command]
pub async fn sync_accept_folder(
    st: State<'_, SyncState>,
    req: AcceptFolderRequest,
) -> AppResult<ClassEntryView> {
    let e = engine(&st);
    blocking(move || e.accept_folder(req).map(ClassEntryView::of)).await
}

#[tauri::command]
pub async fn sync_leave_class(
    st: State<'_, SyncState>,
    class_id: String,
    opts: LeaveOptions,
) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.leave_class(&class_id, opts)).await
}

#[tauri::command]
pub async fn sync_admit(
    st: State<'_, SyncState>,
    class_id: String,
    device_id: String,
) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.admit(&class_id, &device_id)).await
}

#[tauri::command]
pub async fn sync_decline(
    st: State<'_, SyncState>,
    class_id: String,
    device_id: String,
) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.decline(&class_id, &device_id)).await
}

#[tauri::command]
pub async fn sync_normalize_ids(
    st: State<'_, SyncState>,
    ids: Vec<String>,
) -> AppResult<Vec<Option<String>>> {
    let e = engine(&st);
    blocking(move || e.normalize_ids(&ids)).await
}

#[tauri::command]
pub async fn sync_own_addresses(st: State<'_, SyncState>) -> AppResult<Vec<String>> {
    let e = engine(&st);
    blocking(move || e.own_addresses()).await
}

/// `paths` ≤ 500.
#[tauri::command]
pub async fn sync_file_info(
    st: State<'_, SyncState>,
    class_id: String,
    paths: Vec<String>,
) -> AppResult<Vec<FileSyncInfo>> {
    let e = engine(&st);
    blocking(move || e.file_info(&class_id, &paths)).await
}

#[tauri::command]
pub async fn sync_wait_available(
    st: State<'_, SyncState>,
    class_id: String,
    path: String,
    min_devices: u32,
    timeout_ms: u64,
) -> AppResult<bool> {
    let e = engine(&st);
    blocking(move || {
        e.wait_available(
            &class_id,
            &path,
            min_devices as usize,
            Duration::from_millis(timeout_ms),
        )
    })
    .await
}

#[tauri::command]
pub async fn sync_wait_caught_up(
    st: State<'_, SyncState>,
    class_id: String,
    timeout_ms: u64,
) -> AppResult<CaughtUp> {
    let e = engine(&st);
    blocking(move || e.wait_caught_up(&class_id, Duration::from_millis(timeout_ms))).await
}

#[tauri::command]
pub async fn sync_device_stats(
    st: State<'_, SyncState>,
) -> AppResult<BTreeMap<String, DeviceStat>> {
    let e = engine(&st);
    blocking(move || e.device_stats()).await
}

#[tauri::command]
pub async fn sync_folder_status(
    st: State<'_, SyncState>,
    class_id: String,
) -> AppResult<FolderView> {
    let e = engine(&st);
    blocking(move || e.folder_status(&class_id)).await
}

#[tauri::command]
pub async fn sync_versions(
    st: State<'_, SyncState>,
    class_id: String,
) -> AppResult<Vec<VersionEntry>> {
    let e = engine(&st);
    blocking(move || e.versions(&class_id)).await
}

#[tauri::command]
pub async fn sync_restore(
    st: State<'_, SyncState>,
    class_id: String,
    items: Vec<RestoreItem>,
) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.restore(&class_id, &items)).await
}

#[tauri::command]
pub async fn sync_folder_errors(
    st: State<'_, SyncState>,
    class_id: String,
) -> AppResult<Vec<FolderError>> {
    let e = engine(&st);
    blocking(move || e.folder_errors(&class_id)).await
}

#[tauri::command]
pub async fn sync_pause_class(
    st: State<'_, SyncState>,
    class_id: String,
    paused: bool,
) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.pause_class(&class_id, paused)).await
}

#[tauri::command]
pub async fn sync_mass_delete_resolve(
    st: State<'_, SyncState>,
    class_id: String,
    action: MassDeleteAction,
) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.resolve_mass_delete(&class_id, action)).await
}

#[tauri::command]
pub async fn sync_scan(
    st: State<'_, SyncState>,
    class_id: String,
    path: Option<String>,
) -> AppResult<()> {
    let e = engine(&st);
    blocking(move || e.scan(&class_id, path.as_deref())).await
}

#[tauri::command]
pub async fn sync_diagnostics(st: State<'_, SyncState>) -> AppResult<SyncDiagnostics> {
    let e = engine(&st);
    blocking(move || e.diagnostics()).await
}

#[tauri::command]
pub async fn sync_existing(st: State<'_, SyncState>) -> AppResult<ExistingSyncthing> {
    let e = engine(&st);
    blocking(move || Ok(e.existing_syncthing())).await
}
