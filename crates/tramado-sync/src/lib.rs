// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `tramado-sync`: everything Syncthing (architecture §5.3, sync spec §1 with the D-1 split).
//! Rust runs every Syncthing-facing algorithm (supervisor, REST, events, admission,
//! reconciliation, discovery, self-heal, bans, mass-delete guard, scans, signatures); TS
//! computes the class-folder semantics and pushes them as a `ClassPolicy`.
//!
//! **M0**: the public handle with its exact signatures; every method that can fail returns
//! `NOT_IMPLEMENTED`. R-SYNC implements the modules below.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tramado_base::classfs::ClassFs;
use tramado_base::error::{AppError, AppResult};
use tramado_base::paths::Paths;
use tramado_base::registry::{ClassEntry, ClassRegistry};

pub mod admission;
pub mod appdata;
pub mod bans;
pub mod client;
pub mod config_writer;
pub mod diag;
pub mod discovery;
pub mod events;
pub mod existing;
pub mod folders;
pub mod guard;
pub mod init;
pub mod invite;
pub mod managed;
pub mod policy;
pub mod reconcile;
pub mod scan;
pub mod selfheal;
pub mod sign;
pub mod supervisor;
pub mod types;

pub use types::*;

/// The pinned Syncthing release (architecture §18.1).
pub const SYNCTHING_VERSION: &str = "v2.1.7";

pub struct SyncConfig {
    pub paths: Arc<Paths>,
    pub fs: Arc<ClassFs>,
    pub registry: Arc<ClassRegistry>,
    pub version: String,
    /// Resolved: `TRAMADO_SYNCTHING_BIN`, else the sidecar next to the executable.
    pub sidecar: Option<PathBuf>,
}

/// Receives every `sync:event` (the desktop crate emits them to the webview).
pub trait SyncSink: Send + Sync {
    fn event(&self, e: SyncEvent);
}

/// The public handle. Every method blocks; the desktop layer wraps calls in `blocking`.
pub struct SyncEngine {
    _cfg: SyncConfig,
    _sink: Arc<dyn SyncSink>,
}

fn todo<T>(what: &str) -> AppResult<T> {
    Err(AppError::not_implemented(what))
}

impl SyncEngine {
    pub fn new(cfg: SyncConfig, sink: Arc<dyn SyncSink>) -> Self {
        SyncEngine {
            _cfg: cfg,
            _sink: sink,
        }
    }

    /// `init.rs` identity only: no daemon, no port probe (sync spec §2.3).
    pub fn identity(&self) -> AppResult<SyncIdentity> {
        todo("sync_identity")
    }

    /// Idempotent, lazy start (sync spec §2.9).
    pub fn start(&self) -> AppResult<SyncStatus> {
        todo("sync_start")
    }

    /// API shutdown → 3 s → SIGTERM → kill at 5 s.
    pub fn stop(&self, _deadline: Duration) {}

    pub fn status(&self) -> SyncStatus {
        SyncStatus::stopped()
    }

    pub fn snapshot(&self) -> AppResult<SyncSnapshot> {
        todo("sync_snapshot")
    }

    pub fn apply_settings(&self, _s: SyncSettings) -> AppResult<()> {
        todo("sync_settings_apply")
    }

    /// Persists, then reconciles, applies bans and ignores for that class.
    pub fn set_class_policy(&self, _p: ClassPolicy) -> AppResult<()> {
        todo("sync_policy_set")
    }

    pub fn share_class(&self, _class_id: &str, _label: &str) -> AppResult<ClassEntry> {
        todo("sync_share_class")
    }

    /// Decodes `req.code` itself (sync spec §9.5).
    pub fn join_class(&self, _req: JoinRequest) -> AppResult<ClassEntry> {
        todo("sync_join_class")
    }

    pub fn cancel_join(&self, _class_id: &str) -> AppResult<()> {
        todo("sync_cancel_join")
    }

    /// Devices `[me, offeredBy]`; the offer must be pending.
    pub fn accept_folder(&self, _req: AcceptFolderRequest) -> AppResult<ClassEntry> {
        todo("sync_accept_folder")
    }

    /// Persists `leaving`; `finish_leaving` runs later (sync spec §17).
    pub fn leave_class(&self, _class_id: &str, _opts: LeaveOptions) -> AppResult<()> {
        todo("sync_leave_class")
    }

    /// `PERMISSION_DENIED` unless the offer is pending.
    pub fn admit(&self, _class_id: &str, _device: &str) -> AppResult<()> {
        todo("sync_admit")
    }

    pub fn decline(&self, _class_id: &str, _device: &str) -> AppResult<()> {
        todo("sync_decline")
    }

    /// Sync spec §12.4; works without the daemon.
    pub fn sign(&self, _class_id: &str, _path: &str, _canonical: &[u8]) -> AppResult<Sig> {
        todo("sync_sign")
    }

    /// Stop + start (Settings › Sharing).
    pub fn restart(&self) -> AppResult<SyncStatus> {
        todo("sync_restart")
    }

    /// Sync spec §22.2: restore | confirm.
    pub fn resolve_mass_delete(&self, _class_id: &str, _action: MassDeleteAction) -> AppResult<()> {
        todo("sync_mass_delete_resolve")
    }

    /// Sync spec §2.5 step 0: new | same.
    pub fn resolve_copied_identity(
        &self,
        _action: CopiedIdentityAction,
    ) -> AppResult<SyncIdentity> {
        todo("sync_identity_resolve")
    }

    pub fn normalize_ids(&self, _ids: &[String]) -> AppResult<Vec<Option<String>>> {
        todo("sync_normalize_ids")
    }

    pub fn own_addresses(&self) -> AppResult<Vec<String>> {
        todo("sync_own_addresses")
    }

    pub fn file_info(&self, _class_id: &str, _paths: &[String]) -> AppResult<Vec<FileSyncInfo>> {
        todo("sync_file_info")
    }

    pub fn wait_available(
        &self,
        _class_id: &str,
        _path: &str,
        _min_devices: usize,
        _timeout: Duration,
    ) -> AppResult<bool> {
        todo("sync_wait_available")
    }

    pub fn wait_caught_up(&self, _class_id: &str, _timeout: Duration) -> AppResult<CaughtUp> {
        todo("sync_wait_caught_up")
    }

    pub fn device_stats(&self) -> AppResult<BTreeMap<String, DeviceStat>> {
        todo("sync_device_stats")
    }

    pub fn folder_status(&self, _class_id: &str) -> AppResult<FolderView> {
        todo("sync_folder_status")
    }

    pub fn versions(&self, _class_id: &str) -> AppResult<Vec<VersionEntry>> {
        todo("sync_versions")
    }

    pub fn restore(&self, _class_id: &str, _items: &[RestoreItem]) -> AppResult<()> {
        todo("sync_restore")
    }

    pub fn folder_errors(&self, _class_id: &str) -> AppResult<Vec<FolderError>> {
        todo("sync_folder_errors")
    }

    pub fn pause_class(&self, _class_id: &str, _paused: bool) -> AppResult<()> {
        todo("sync_pause_class")
    }

    pub fn scan(&self, _class_id: &str, _path: Option<&str>) -> AppResult<()> {
        todo("sync_scan")
    }

    pub fn diagnostics(&self) -> AppResult<SyncDiagnostics> {
        todo("sync_diagnostics")
    }

    pub fn existing_syncthing(&self) -> ExistingSyncthing {
        ExistingSyncthing::default()
    }
}
