// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `data/syncthing/appdata.json` (architecture §5.3): Rust's own memory of admission and
//! reconciliation (sync spec §9.2, §10), of the mass-change guard (§22.2) and of the sharing
//! settings, so they survive restarts. Times are Unix milliseconds. Fields this version does
//! not know are kept on rewrite.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tramado_base::error::AppResult;
use tramado_base::files;

use crate::types::SyncSettings;

pub const FILE_NAME: &str = "appdata.json";
pub const FORMAT: &str = "tramado.sync-appdata";

/// Why a device was put in `remoteIgnoredDevices` (sync spec §9.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IgnoreReason {
    NoProof,
    Banned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoredRec {
    pub at: u64,
    /// `None` = never (bans).
    pub until: Option<u64>,
    pub strikes: u32,
    pub reason: IgnoreReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedRec {
    pub source: String,
    pub at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    #[serde(default)]
    pub ignored: BTreeMap<String, IgnoredRec>,
    #[serde(default)]
    pub failed: Vec<FailedRec>,
    /// class → devices that once had a trusted member file there (sync spec §10 `left()`).
    #[serde(default)]
    pub seen_member: BTreeMap<String, BTreeSet<String>>,
    /// class → device → when it proved the folder ID (§9.2 `share()`).
    #[serde(default)]
    pub proof_at: BTreeMap<String, BTreeMap<String, u64>>,
    /// Classes the mass-change guard paused (§22.2), kept paused across restarts.
    #[serde(default)]
    pub guard_paused: BTreeSet<String>,
    /// Classes the person paused (`sync_pause_class`).
    #[serde(default)]
    pub user_paused: BTreeSet<String>,
    /// The last `sync_settings_apply`, applied at every start before the app pushes again.
    #[serde(default)]
    pub settings: Option<SyncSettings>,
    /// The Syncthing home was lost while classes were shared (sync spec §2.3).
    #[serde(default)]
    pub lost_identity: bool,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

#[derive(Serialize, Deserialize)]
struct AppDataFile {
    format: String,
    version: u32,
    #[serde(flatten)]
    data: AppData,
}

pub const WEEK_MS: u64 = 7 * 24 * 3600 * 1000;
pub const TEN_MIN_MS: u64 = 10 * 60 * 1000;

impl AppData {
    /// Drops what no longer matters (failures older than 10 minutes, strike records older than
    /// 7 days whose ignore expired), so the file does not grow without bound.
    pub fn prune(&mut self, now_ms: u64) {
        self.failed
            .retain(|f| now_ms.saturating_sub(f.at) < TEN_MIN_MS);
        self.ignored.retain(|_, r| {
            let expired = r.until.is_some_and(|u| u <= now_ms);
            !(expired && now_ms.saturating_sub(r.at) >= WEEK_MS)
        });
    }

    pub fn failures_from(&self, source: &str, now_ms: u64) -> usize {
        self.failed
            .iter()
            .filter(|f| f.source == source && now_ms.saturating_sub(f.at) < TEN_MIN_MS)
            .count()
    }

    pub fn has_seen(&self, class: &str, dev: &str) -> bool {
        self.seen_member.get(class).is_some_and(|s| s.contains(dev))
    }
}

/// The store: one `Mutex`, atomic rewrites after each change.
pub struct AppDataStore {
    path: PathBuf,
    data: Mutex<AppData>,
}

impl AppDataStore {
    pub fn load(home: &Path) -> Self {
        let path = home.join(FILE_NAME);
        let data = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<AppDataFile>(&b).ok())
            .map(|f| f.data)
            .unwrap_or_default();
        AppDataStore {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn read<T>(&self, f: impl FnOnce(&AppData) -> T) -> T {
        f(&self.data.lock().unwrap_or_else(|e| e.into_inner()))
    }

    /// Mutates and persists (only when something changed).
    pub fn update<T>(&self, f: impl FnOnce(&mut AppData) -> T) -> AppResult<T> {
        let mut g = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let before = g.clone();
        let out = f(&mut g);
        if *g != before {
            let file = AppDataFile {
                format: FORMAT.to_string(),
                version: 1,
                data: g.clone(),
            };
            if let Some(dir) = self.path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            files::write_atomic(&self.path, &serde_json::to_vec_pretty(&file)?)?;
        }
        Ok(out)
    }

    /// Same as [`update`](Self::update), logging instead of failing (background passes).
    pub fn update_quiet<T>(&self, f: impl FnOnce(&mut AppData) -> T) -> Option<T> {
        match self.update(f) {
            Ok(v) => Some(v),
            Err(e) => {
                log::warn!("sync: could not save appdata.json: {e}");
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_and_keeps_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(FILE_NAME),
            r#"{"format":"tramado.sync-appdata","version":1,"future":[1],"guardPaused":["tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa"]}"#,
        )
        .unwrap();
        let s = AppDataStore::load(dir.path());
        assert!(s.read(|d| d.guard_paused.len() == 1));
        s.update(|d| {
            d.failed.push(FailedRec {
                source: "10.0.0.0/24".into(),
                at: 5,
            })
        })
        .unwrap();
        let text = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(text.contains("\"future\"") && text.contains("10.0.0.0/24"));
        let again = AppDataStore::load(dir.path());
        assert_eq!(again.read(|d| d.failures_from("10.0.0.0/24", 6)), 1);
        assert_eq!(
            again.read(|d| d.failures_from("10.0.0.0/24", 5 + TEN_MIN_MS)),
            0
        );
    }

    #[test]
    fn prune_drops_old_failures_and_expired_strikes() {
        let mut d = AppData::default();
        d.failed.push(FailedRec {
            source: "s".into(),
            at: 0,
        });
        d.ignored.insert(
            "X".into(),
            IgnoredRec {
                at: 0,
                until: Some(1),
                strikes: 1,
                reason: IgnoreReason::NoProof,
            },
        );
        d.ignored.insert(
            "B".into(),
            IgnoredRec {
                at: 0,
                until: None,
                strikes: 1,
                reason: IgnoreReason::Banned,
            },
        );
        d.prune(WEEK_MS + 1);
        assert!(d.failed.is_empty());
        assert!(!d.ignored.contains_key("X") && d.ignored.contains_key("B"));
    }
}
