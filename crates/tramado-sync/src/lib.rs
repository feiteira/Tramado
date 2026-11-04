// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `tramado-sync`: everything Syncthing (architecture §5.3, sync spec §1 with the D-1 split).
//! Rust runs every Syncthing-facing algorithm (supervisor, REST, events, admission,
//! reconciliation, discovery, self-heal, bans, mass-delete guard, scans, signatures); TS
//! computes the class-folder semantics and pushes them as a `ClassPolicy`.
//!
//! Threads (architecture §4.2): `tramado-syncthing` (supervisor), `tramado-sync-events-a/-b`,
//! `tramado-sync-ticker`, `tramado-sync-work` and a short-lived `tramado-sync-ready` per spawn.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tramado_base::classfs::ClassFs;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::paths::Paths;
use tramado_base::registry::{ClassEntry, ClassRegistry};

pub mod admission;
pub mod appdata;
pub mod bans;
pub mod client;
pub mod config_writer;
pub mod ctx;
pub mod diag;
pub mod discovery;
pub mod engine;
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

#[cfg(test)]
pub(crate) mod fake;

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

    /// Moves a left class's directory to the OS trash (sync spec §17, `afterwards: "trash"`).
    /// The default leaves the files where they are.
    fn trash(&self, path: &Path) -> AppResult<()> {
        let _ = path;
        Err(AppError::new(Code::IoError, "no trash available"))
    }
}

/// The public handle. Every method blocks; the desktop layer wraps calls in `blocking`.
pub struct SyncEngine {
    inner: Arc<engine::Inner>,
}

impl SyncEngine {
    /// Builds the engine, registers its `WriteObserver` on `cfg.fs` (scans after every write,
    /// the own-change log of the mass-change guard) and subscribes to the class registry.
    /// Nothing starts until [`identity`](Self::identity) or [`start`](Self::start).
    pub fn new(cfg: SyncConfig, sink: Arc<dyn SyncSink>) -> Self {
        let inner = engine::Inner::new(cfg, sink);
        inner.cfg.fs.set_observer(Arc::new(scan::ScanObserver {
            inner: Arc::downgrade(&inner),
        }));
        let weak = Arc::downgrade(&inner);
        inner.cfg.registry.subscribe(Box::new(move |before, after| {
            if let Some(i) = weak.upgrade() {
                i.registry_changed(before, after);
            }
        }));
        SyncEngine { inner }
    }

    /// Resolves the opaque pick token of `JoinRequest.parent` / `AcceptFolderRequest.parent`
    /// (architecture D-4); the desktop layer installs the `PickRegistry`.
    pub fn set_pick_resolver(&self, f: engine::PickResolver) {
        *self.inner.picks.write().unwrap_or_else(|e| e.into_inner()) = Some(f);
    }

    /// `init.rs` identity only: no daemon, no port probe (sync spec §2.3).
    pub fn identity(&self) -> AppResult<SyncIdentity> {
        self.inner.identity()
    }

    /// Idempotent, lazy start (sync spec §2.9).
    pub fn start(&self) -> AppResult<SyncStatus> {
        self.inner.start()
    }

    /// API shutdown → 3 s → SIGTERM → kill at 5 s.
    pub fn stop(&self, deadline: Duration) {
        self.inner.stop(deadline)
    }

    pub fn status(&self) -> SyncStatus {
        self.inner.status()
    }

    pub fn snapshot(&self) -> AppResult<SyncSnapshot> {
        self.inner.snapshot()
    }

    pub fn apply_settings(&self, s: SyncSettings) -> AppResult<()> {
        self.inner.apply_settings(s)
    }

    /// Persists, then reconciles, applies bans and ignores for that class.
    pub fn set_class_policy(&self, p: ClassPolicy) -> AppResult<()> {
        self.inner.set_class_policy(p)
    }

    pub fn share_class(&self, class_id: &str, label: &str) -> AppResult<ClassEntry> {
        self.inner.ensure_running()?;
        let unpause = !self.inner.paused_effective(class_id);
        self.inner
            .with_ctx(|ctx| folders::share_class(ctx, class_id, label, unpause))
    }

    /// Decodes `req.code` itself (sync spec §9.5).
    pub fn join_class(&self, req: JoinRequest) -> AppResult<ClassEntry> {
        self.inner.join_class(req)
    }

    pub fn cancel_join(&self, class_id: &str) -> AppResult<()> {
        self.inner.cancel_join(class_id)
    }

    /// Devices `[me, offeredBy]`; the offer must be pending.
    pub fn accept_folder(&self, req: AcceptFolderRequest) -> AppResult<ClassEntry> {
        self.inner.accept_folder(req)
    }

    /// Persists `leaving`; `finish_leaving` runs later (sync spec §17).
    pub fn leave_class(&self, class_id: &str, opts: LeaveOptions) -> AppResult<()> {
        self.inner.leave_class(class_id, opts)
    }

    /// `PERMISSION_DENIED` unless the offer is pending.
    pub fn admit(&self, class_id: &str, device: &str) -> AppResult<()> {
        let dev = invite::normalize_device_id(device)
            .ok_or_else(|| AppError::invalid("not a device ID"))?;
        self.inner.with_ctx(|ctx| {
            let mut adm = self.inner.adm.lock().unwrap_or_else(|e| e.into_inner());
            adm.admit(ctx, class_id, &dev)
        })
    }

    pub fn decline(&self, class_id: &str, device: &str) -> AppResult<()> {
        let dev = invite::normalize_device_id(device)
            .ok_or_else(|| AppError::invalid("not a device ID"))?;
        self.inner.with_ctx(|ctx| {
            let mut adm = self.inner.adm.lock().unwrap_or_else(|e| e.into_inner());
            adm.decline(ctx, class_id, &dev)
        })
    }

    /// Sync spec §12.4; works without the daemon.
    pub fn sign(&self, class_id: &str, path: &str, canonical: &[u8]) -> AppResult<Sig> {
        self.inner.identity()?;
        sign::sign(&self.inner.home, class_id, path, canonical)
    }

    /// Stop + start (Settings › Sharing).
    pub fn restart(&self) -> AppResult<SyncStatus> {
        self.inner.stop(Duration::from_secs(5));
        self.inner.start()
    }

    /// Sync spec §22.2: restore | confirm.
    pub fn resolve_mass_delete(&self, class_id: &str, action: MassDeleteAction) -> AppResult<()> {
        self.inner.resolve_mass_delete(class_id, action)
    }

    /// Sync spec §2.5 step 0: new | same.
    pub fn resolve_copied_identity(&self, action: CopiedIdentityAction) -> AppResult<SyncIdentity> {
        self.inner.resolve_copied_identity(action)
    }

    pub fn normalize_ids(&self, ids: &[String]) -> AppResult<Vec<Option<String>>> {
        self.inner.normalize_ids(ids)
    }

    pub fn own_addresses(&self) -> AppResult<Vec<String>> {
        self.inner.own_addresses()
    }

    pub fn file_info(&self, class_id: &str, paths: &[String]) -> AppResult<Vec<FileSyncInfo>> {
        self.inner.file_info(class_id, paths)
    }

    pub fn wait_available(
        &self,
        class_id: &str,
        path: &str,
        min_devices: usize,
        timeout: Duration,
    ) -> AppResult<bool> {
        self.inner
            .wait_available(class_id, path, min_devices, timeout)
    }

    pub fn wait_caught_up(&self, class_id: &str, timeout: Duration) -> AppResult<CaughtUp> {
        self.inner.wait_caught_up(class_id, timeout)
    }

    pub fn device_stats(&self) -> AppResult<BTreeMap<String, DeviceStat>> {
        self.inner.device_stats()
    }

    pub fn folder_status(&self, class_id: &str) -> AppResult<FolderView> {
        let c = self
            .inner
            .client()
            .ok_or_else(|| AppError::new(Code::SyncUnavailable, "sharing is not running"))?;
        self.inner.folder_view(&c, class_id, None, true)
    }

    pub fn versions(&self, class_id: &str) -> AppResult<Vec<VersionEntry>> {
        self.inner.versions(class_id)
    }

    pub fn restore(&self, class_id: &str, items: &[RestoreItem]) -> AppResult<()> {
        self.inner.restore(class_id, items)
    }

    pub fn folder_errors(&self, class_id: &str) -> AppResult<Vec<FolderError>> {
        let c = self
            .inner
            .client()
            .ok_or_else(|| AppError::new(Code::SyncUnavailable, "sharing is not running"))?;
        Ok(c.folder_errors(class_id)?
            .into_iter()
            .map(|(path, error)| FolderError { path, error })
            .collect())
    }

    pub fn pause_class(&self, class_id: &str, paused: bool) -> AppResult<()> {
        self.inner.pause_class(class_id, paused)
    }

    pub fn scan(&self, class_id: &str, path: Option<&str>) -> AppResult<()> {
        if let Some(p) = path {
            tramado_base::confine::validate_class_path(p)?;
        }
        let c = self
            .inner
            .client()
            .ok_or_else(|| AppError::new(Code::SyncUnavailable, "sharing is not running"))?;
        c.scan(class_id, path)
    }

    pub fn diagnostics(&self) -> AppResult<SyncDiagnostics> {
        self.inner.diagnostics()
    }

    pub fn existing_syncthing(&self) -> ExistingSyncthing {
        existing::detect()
    }

    /// Whether any registered class is shared (the desktop starts Syncthing at launch, §2.9).
    pub fn has_shared_class(&self) -> bool {
        self.inner.cfg.registry.list().iter().any(|e| e.shared)
    }
}

impl Drop for SyncEngine {
    fn drop(&mut self) {
        self.inner.shutdown_threads();
    }
}
