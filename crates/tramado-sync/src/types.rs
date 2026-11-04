// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Every IPC type of the sync domain (architecture §6.7, §7.1, §9 `platform/types/sync.ts`),
//! as serde structs whose JSON is exactly the TypeScript shape. `T | null` fields serialise
//! `null`; optional (`?`) fields are omitted when absent.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tramado_base::error::Code;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncState {
    Stopped,
    Starting,
    Running,
    Restarting,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncIdentity {
    pub device_id: String,
    pub short_id: String,
    pub sync_port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: SyncState,
    pub device_id: Option<String>,
    pub version: Option<String>,
    pub sync_port: Option<u16>,
    pub local_only: bool,
    pub paused: bool,
    pub started_at: Option<String>,
    pub restarts: u32,
    pub error: Option<Code>,
}

impl SyncStatus {
    /// Nothing running.
    pub fn stopped() -> Self {
        SyncStatus {
            state: SyncState::Stopped,
            device_id: None,
            version: None,
            sync_port: None,
            local_only: false,
            paused: false,
            started_at: None,
            restarts: 0,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FolderState {
    Idle,
    Scanning,
    Syncing,
    SyncPreparing,
    SyncWaiting,
    ScanWaiting,
    Error,
    Paused,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteState {
    Valid,
    NotSharing,
    Paused,
    Unknown,
}

/// Per-device completion inside `FolderView.completion`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCompletion {
    pub completion: f64,
    pub need_items: u64,
    pub remote_state: RemoteState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderView {
    pub class_id: String,
    pub label: String,
    pub path: String,
    pub paused: bool,
    pub state: FolderState,
    pub global_files: u64,
    pub in_sync_files: u64,
    pub need_files: u64,
    pub need_bytes: u64,
    pub pull_errors: u64,
    pub error: Option<String>,
    pub devices: Vec<String>,
    pub completion: BTreeMap<String, DeviceCompletion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub device_id: String,
    pub name: String,
    pub connected: bool,
    pub relay: bool,
    pub address: Option<String>,
    pub paused: bool,
    pub last_seen: Option<String>,
    pub folders: Vec<String>,
    pub provisional: bool,
    pub ignored: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequestView {
    pub class_id: String,
    pub device_id: String,
    pub name: String,
    pub address: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderOfferView {
    pub folder_id: String,
    pub label: String,
    pub offered_by: String,
    pub offered_by_name: String,
    pub at: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingSyncthing {
    pub running: bool,
    pub config_found: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSnapshot {
    pub status: SyncStatus,
    pub folders: Vec<FolderView>,
    pub devices: Vec<DeviceView>,
    pub join_requests: Vec<JoinRequestView>,
    pub folder_offers: Vec<FolderOfferView>,
    pub existing: ExistingSyncthing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub local_only: bool,
    pub paused: bool,
    pub max_send_kbps: u32,
    pub max_recv_kbps: u32,
    /// "<person> (<computer>)", announced only while a class is joining (sync spec §9.4).
    pub device_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterDevice {
    pub device_id: String,
    pub member_id: String,
    pub name: String,
    pub device_name: String,
    pub addresses: Vec<String>,
}

/// What TS pushes for a class (architecture D-1, sync spec §9.2, §10, §18.1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassPolicy {
    pub class_id: String,
    /// effective meta name (the Syncthing folder label)
    pub label: String,
    pub ask_before_admit: bool,
    pub roster: Vec<RosterDevice>,
    pub known_devices: Vec<String>,
    pub banned_devices: Vec<String>,
    pub updated_at: String,
}

/// Rust state (v1.1 pairing); `{ownDevices: [], pairingOpenUntil: null}` in 0.1.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalPolicy {
    pub own_devices: Vec<String>,
    pub pairing_open_until: Option<u64>,
}

/// A device decoded from an invite (InvitePreview).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSpec {
    pub device_id: String,
    pub name: String,
    pub addresses: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequest {
    /// the invite code text; Rust decodes and validates it (sync spec §8, §9.5)
    pub code: String,
    pub dir_name: String,
    /// pick token of the parent folder (default: the classes root)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub include_audio: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptFolderRequest {
    pub folder_id: String,
    pub offered_by: String,
    pub label: String,
    pub dir_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub include_audio: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LeaveAfterwards {
    /// keep a forked local class
    KeepLocal,
    Trash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveOptions {
    pub afterwards: LeaveAfterwards,
}

/// Folder spec §6.6.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sig {
    pub cert: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MassDeleteAction {
    Restore,
    Confirm,
}

/// Sync spec §2.5 step 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CopiedIdentityAction {
    New,
    Same,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncInfo {
    pub path: String,
    pub local_modified_by: Option<String>,
    pub local_deleted: bool,
    pub local_size: Option<u64>,
    pub local_blocks_hash: Option<String>,
    pub local_modified: Option<String>,
    pub local_version: Vec<String>,
    pub local_sequence: Option<u64>,
    pub global_modified_by: Option<String>,
    pub global_deleted: bool,
    /// entries with fromTemporary == false only; never this device
    pub availability: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaughtUp {
    pub complete: bool,
    pub waited_ms: u64,
    pub pending: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStat {
    pub last_seen: Option<String>,
    pub last_connection_duration_s: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub path: String,
    pub version_time: String,
    pub mod_time: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreItem {
    pub path: String,
    pub version_time: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderError {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagPorts {
    pub sync: Option<u16>,
    pub gui_open: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagError {
    pub when: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDiagnostics {
    pub status: SyncStatus,
    pub ports: DiagPorts,
    pub listeners: BTreeMap<String, Option<String>>,
    pub connections: u32,
    pub relayed: u32,
    pub last_errors: Vec<DiagError>,
    pub log_tail: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteAction {
    Modified,
    Deleted,
}

/// The global `sync:event` (architecture §7.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SyncEvent {
    Status {
        status: SyncStatus,
    },
    /// Events were dropped: re-read `sync_snapshot`.
    Gap,
    /// RemoteChangeDetected, files only (loop B): a trigger to re-judge the path, never a verdict.
    RemoteChange {
        class_id: String,
        path: String,
        action: RemoteAction,
        modified_by: String,
    },
    Folder {
        folder: FolderView,
    },
    Completion {
        class_id: String,
        device_id: String,
        completion: f64,
        need_items: u64,
        remote_state: RemoteState,
    },
    IndexUpdated {
        class_id: String,
        remote: bool,
    },
    Connection {
        device_id: String,
        connected: bool,
        relay: bool,
        address: Option<String>,
    },
    JoinRequest {
        request: JoinRequestView,
    },
    JoinRequestGone {
        class_id: String,
        device_id: String,
    },
    Admitted {
        class_id: String,
        device_id: String,
        name: String,
    },
    AdmittedMe {
        class_id: String,
        by_device: String,
    },
    FolderOffer {
        offer: FolderOfferView,
    },
    ForeignWrite {
        class_id: String,
        path: String,
        modified_by: String,
        healed: bool,
    },
    MassDelete {
        class_id: String,
        count: u64,
        sample: Vec<String>,
    },
    MassDeleteRemote {
        class_id: String,
        by: String,
        count: u64,
        sample: Vec<String>,
    },
    FolderErrors {
        class_id: String,
        errors: Vec<FolderError>,
    },
    MarkerMissing {
        class_id: String,
    },
    ListenAddresses {
        addresses: Vec<String>,
    },
    /// `finish_leaving` ran (§17): the folder is gone; with `KeepLocal` the class waits for the app to fork it,
    /// with `Trash` it left the registry (G2, plan §16 item 3).
    Left {
        class_id: String,
        afterwards: LeaveAfterwards,
    },
}

/// A folder offer, as admission sees it (`decide`, architecture §5.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderOffer {
    pub folder_id: String,
    pub device_id: String,
    pub in_folder: bool,
}

/// The admission decision (`test-vectors/admission.json`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Share,
    Queue,
    Ban,
    /// already in the folder
    Skip,
    /// not one of my classes
    Unknown,
}
