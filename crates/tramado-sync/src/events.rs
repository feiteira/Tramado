// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The two event loops (sync spec §5). Loop A long-polls `/rest/events` with mask A, loop B
//! `/rest/events/disk`; each keeps its own `since` (event IDs are per subscription). Both are
//! primed by the start-up routine of each Syncthing generation (while every class folder is
//! still paused), detect gaps (`id > since + 1` → re-read state, emit `gap`) and dispatch.

use std::sync::Weak;
use std::time::{Duration, Instant};

use serde_json::Value;
use tramado_base::ids;

use crate::client::{to_class_path, Client, Event};
use crate::engine::Inner;
use crate::scan::Task;
use crate::types::{FolderError, RemoteAction, RemoteState, SyncEvent};

pub const MASK_A: &str = "PendingDevicesChanged,PendingFoldersChanged,DeviceConnected,DeviceDisconnected,DevicePaused,DeviceResumed,ClusterConfigReceived,FolderCompletion,FolderSummary,FolderErrors,StateChanged,FolderPaused,FolderResumed,LocalIndexUpdated,RemoteIndexUpdated,ListenAddressesChanged,ConfigSaved,StartupComplete";

/// Long-poll timeout in seconds.
pub const POLL_S: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Loop {
    A,
    B,
}

/// Priming (§5 start-up step 1): the greatest ID each subscription returns now (or 0).
pub fn prime(c: &Client) -> (u64, u64) {
    let a = c
        .events(MASK_A, 0, 0)
        .ok()
        .and_then(|v| v.iter().map(|e| e.id).max())
        .unwrap_or(0);
    let b = c
        .disk_events(0, 0)
        .ok()
        .and_then(|v| v.iter().map(|e| e.id).max())
        .unwrap_or(0);
    (a, b)
}

/// True when events were dropped between `since` and the first event of a response.
pub fn is_gap(since: u64, events: &[Event]) -> bool {
    events.first().is_some_and(|e| e.id > since + 1)
}

/// The body of `tramado-sync-events-a` / `-b`.
pub(crate) fn run(weak: Weak<Inner>, which: Loop) {
    loop {
        let Some(inner) = weak.upgrade() else {
            return;
        };
        let Some((client, gen, since)) = inner.events_cursor(which) else {
            let stopping = inner.is_shutdown();
            drop(inner);
            if stopping {
                return;
            }
            std::thread::sleep(Duration::from_millis(300));
            continue;
        };
        drop(inner);
        let res = match which {
            Loop::A => client.events(MASK_A, since, POLL_S),
            Loop::B => client.disk_events(since, POLL_S),
        };
        let Some(inner) = weak.upgrade() else {
            return;
        };
        match res {
            Ok(events) => {
                if !inner.advance_cursor(which, gen, since, &events) {
                    continue; // another generation started meanwhile
                }
                if is_gap(since, &events) {
                    log::warn!("sync: events were dropped (loop {which:?}); re-reading state");
                    inner.emit(SyncEvent::Gap);
                    inner.work_after_gap();
                }
                for e in &events {
                    match which {
                        Loop::A => dispatch_a(&inner, e),
                        Loop::B => dispatch_b(&inner, e),
                    }
                }
            }
            Err(_) => {
                drop(inner);
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    }
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn remote_state(v: &Value) -> RemoteState {
    match v.as_str() {
        Some("valid") => RemoteState::Valid,
        Some("notSharing") => RemoteState::NotSharing,
        Some("paused") => RemoteState::Paused,
        _ => RemoteState::Unknown,
    }
}

fn is_class(id: &str) -> bool {
    ids::is_class_id(id)
}

/// Loop A dispatch (§5 table).
pub(crate) fn dispatch_a(inner: &Inner, e: &Event) {
    let d = &e.data;
    match e.kind.as_str() {
        "PendingDevicesChanged" => {
            if d["added"].as_array().is_some_and(|a| !a.is_empty()) {
                inner.with_admission(|adm, ctx| adm.handle_pending_devices(ctx));
            }
        }
        "PendingFoldersChanged" => {
            if d["added"].as_array().is_some_and(|a| !a.is_empty()) {
                inner.with_admission(|adm, ctx| adm.handle_pending_folders(ctx));
            }
        }
        "DeviceConnected" => {
            let dev = s(&d["id"]);
            inner.note_connected(&dev);
            inner.emit(SyncEvent::Connection {
                device_id: dev,
                connected: true,
                relay: s(&d["type"]).contains("relay"),
                address: d["addr"].as_str().map(str::to_string),
            });
        }
        "DeviceDisconnected" => {
            inner.emit(SyncEvent::Connection {
                device_id: s(&d["id"]),
                connected: false,
                relay: false,
                address: None,
            });
        }
        "ClusterConfigReceived" => {
            let dev = s(&d["device"]);
            inner.with_admission(|adm, _| {
                adm.on_cluster_config(&dev, Instant::now());
                Ok(())
            });
        }
        "FolderCompletion" => {
            let class = s(&d["folder"]);
            if !is_class(&class) {
                return;
            }
            let dev = s(&d["device"]);
            let rs = remote_state(&d["remoteState"]);
            inner.note_completion(&class, &dev, d);
            inner.emit(SyncEvent::Completion {
                class_id: class.clone(),
                device_id: dev.clone(),
                completion: d["completion"].as_f64().unwrap_or(0.0),
                need_items: d["needItems"].as_u64().unwrap_or(0),
                remote_state: rs,
            });
            if rs == RemoteState::Valid {
                inner.maybe_admitted_me(&class, &dev);
            }
            inner.leaving_nudge(&class);
        }
        "FolderSummary" => {
            let class = s(&d["folder"]);
            if !is_class(&class) {
                return;
            }
            let summary = &d["summary"];
            inner.emit_folder(&class, Some(summary));
            if summary["pullErrors"].as_u64().unwrap_or(0) > 0 {
                inner.emit_folder_errors(&class);
            }
            if summary["state"] == "error"
                && summary["error"]
                    .as_str()
                    .is_some_and(|x| x.contains("marker"))
            {
                inner.emit(SyncEvent::MarkerMissing { class_id: class });
            }
        }
        "StateChanged" => {
            let class = s(&d["folder"]);
            if is_class(&class) {
                inner.emit_folder(&class, None);
            }
        }
        "FolderPaused" | "FolderResumed" => {
            let class = s(&d["id"]);
            if is_class(&class) {
                inner.emit_folder(&class, None);
            }
        }
        "FolderErrors" => {
            let class = s(&d["folder"]);
            if !is_class(&class) {
                return;
            }
            let errors = d["errors"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|x| FolderError {
                    path: to_class_path(x["path"].as_str().unwrap_or_default()),
                    error: s(&x["error"]),
                })
                .collect();
            inner.emit(SyncEvent::FolderErrors {
                class_id: class,
                errors,
            });
        }
        "LocalIndexUpdated" | "RemoteIndexUpdated" => {
            let class = s(&d["folder"]);
            if !is_class(&class) {
                return;
            }
            let remote = e.kind == "RemoteIndexUpdated";
            inner.emit(SyncEvent::IndexUpdated {
                class_id: class.clone(),
                remote,
            });
            if remote {
                inner.leaving_nudge(&class);
            }
        }
        "ListenAddressesChanged" => inner.emit_listen_addresses(),
        _ => {}
    }
}

/// Loop B dispatch: files only, paths as class paths (§3.6, §12.2).
pub(crate) fn dispatch_b(inner: &Inner, e: &Event) {
    let d = &e.data;
    if d["type"] != "file" {
        return;
    }
    let class = {
        let f = s(&d["folderID"]);
        if f.is_empty() {
            s(&d["folder"])
        } else {
            f
        }
    };
    if !is_class(&class) {
        return;
    }
    let path = to_class_path(d["path"].as_str().unwrap_or_default());
    if path.is_empty() {
        return;
    }
    let deleted = d["action"] == "deleted";
    let by = s(&d["modifiedBy"]);
    match e.kind.as_str() {
        "RemoteChangeDetected" => {
            inner.remote_guard(&class, &by, &path, deleted);
            inner.self_heal(&class, &path, &by, true);
            inner.emit(SyncEvent::RemoteChange {
                class_id: class,
                path,
                action: if deleted {
                    RemoteAction::Deleted
                } else {
                    RemoteAction::Modified
                },
                modified_by: by,
            });
        }
        "LocalChangeDetected" => {
            let own = inner.is_own_change(&class, &path);
            inner.local_guard(&class, &path, deleted);
            if !own {
                inner.self_heal(&class, &path, &by, false);
            }
        }
        _ => {}
    }
}

/// Work queued after gap detection: admission and every class's reconciliation (§5).
pub fn gap_tasks(classes: &[String]) -> Vec<Task> {
    classes.iter().map(|c| Task::Reconcile(c.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev(id: u64) -> Event {
        Event {
            id,
            kind: "X".into(),
            time: String::new(),
            data: json!({}),
        }
    }

    #[test]
    fn gaps_are_detected_from_the_first_id() {
        assert!(!is_gap(5, &[ev(6), ev(7)]));
        assert!(is_gap(5, &[ev(9)]));
        assert!(!is_gap(5, &[]));
        assert!(!is_gap(0, &[ev(1)]));
    }

    #[test]
    fn mask_names_only_real_events() {
        for name in MASK_A.split(',') {
            assert!(name.chars().all(|c| c.is_ascii_alphabetic()), "{name}");
        }
        assert!(!MASK_A.contains("DevicePendingDetected"));
        assert_eq!(MASK_A.split(',').count(), 18);
    }
}
