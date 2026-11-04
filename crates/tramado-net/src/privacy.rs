// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The AI privacy level and the busy-only relaxation (architecture §5.2 `privacy`, D7, D-10):
//! `config/ai.json` = `{"format":"tramado.ai-settings","version":1,"privacy":"no-training","busyRelax":false}`.
//! Only Rust writes it, and relaxing either setting needs a native confirmation shown by the
//! command layer (`ai_privacy_set`, `ai_busy_policy_set`). Fields of a newer version are kept.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tramado_base::error::AppResult;
use tramado_base::files;

pub const FILE_NAME: &str = "ai.json";
pub const FORMAT: &str = "tramado.ai-settings";

/// TS `PrivacyLevel`: `zdr` ("Keep nothing"), `no-training` (the default), `standard`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PrivacyLevel {
    Standard,
    NoTraining,
    Zdr,
}

impl PrivacyLevel {
    /// How strict a level is: `standard` 0 < `no-training` 1 < `zdr` 2.
    pub fn strictness(self) -> u8 {
        match self {
            PrivacyLevel::Standard => 0,
            PrivacyLevel::NoTraining => 1,
            PrivacyLevel::Zdr => 2,
        }
    }

    /// True when going from `self` to `to` relaxes privacy (needs a native confirmation).
    pub fn relaxes_to(self, to: PrivacyLevel) -> bool {
        to.strictness() < self.strictness()
    }

    /// OpenRouter's `provider` object for this level (architecture §5.2 rule 5); `None` =
    /// no `provider` at all (`standard`).
    pub fn provider(self) -> Option<Value> {
        match self {
            PrivacyLevel::Standard => None,
            PrivacyLevel::NoTraining => Some(serde_json::json!({"data_collection": "deny"})),
            PrivacyLevel::Zdr => Some(serde_json::json!({"data_collection": "deny", "zdr": true})),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsFile {
    #[serde(default = "format_name")]
    format: String,
    #[serde(default = "one")]
    version: u32,
    #[serde(default = "default_level")]
    privacy: PrivacyLevel,
    #[serde(default)]
    busy_relax: bool,
    #[serde(flatten)]
    unknown: Map<String, Value>,
}

fn format_name() -> String {
    FORMAT.to_string()
}
fn one() -> u32 {
    1
}
fn default_level() -> PrivacyLevel {
    PrivacyLevel::NoTraining
}

impl Default for SettingsFile {
    fn default() -> Self {
        SettingsFile {
            format: format_name(),
            version: 1,
            privacy: default_level(),
            busy_relax: false,
            unknown: Map::new(),
        }
    }
}

pub struct PrivacyStore {
    file: PathBuf,
    state: Mutex<Option<SettingsFile>>,
}

impl PrivacyStore {
    pub fn new(config_dir: &Path) -> Self {
        PrivacyStore {
            file: config_dir.join(FILE_NAME),
            state: Mutex::new(None),
        }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    /// Reads the file once; a missing or unreadable file gives the defaults (never an error:
    /// the strict default is the safe answer).
    fn with<T>(&self, f: impl FnOnce(&mut SettingsFile) -> T) -> T {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let s = st.get_or_insert_with(|| {
            std::fs::read(&self.file)
                .ok()
                .and_then(|b| serde_json::from_slice::<SettingsFile>(&b).ok())
                .unwrap_or_default()
        });
        f(s)
    }

    fn update(&self, f: impl FnOnce(&mut SettingsFile)) -> AppResult<()> {
        self.with(|s| {
            let mut next = s.clone();
            f(&mut next);
            next.format = format_name();
            next.version = 1;
            files::write_atomic(&self.file, &serde_json::to_vec_pretty(&next)?)?;
            *s = next;
            Ok(())
        })
    }

    /// The stored level (default `no-training`, D7).
    pub fn get(&self) -> PrivacyLevel {
        self.with(|s| s.privacy)
    }

    /// Stores `level` (the caller asked for the confirmation when relaxing).
    pub fn set(&self, level: PrivacyLevel) -> AppResult<()> {
        self.update(|s| s.privacy = level)
    }

    /// "Use NVIDIA free models when the others are busy" (D-10).
    pub fn busy_relax(&self) -> bool {
        self.with(|s| s.busy_relax)
    }

    pub fn set_busy_relax(&self, relax: bool) -> AppResult<()> {
        self.update(|s| s.busy_relax = relax)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_and_their_order() {
        assert_eq!(
            serde_json::to_value(PrivacyLevel::NoTraining).unwrap(),
            "no-training"
        );
        assert!(PrivacyLevel::Zdr.relaxes_to(PrivacyLevel::NoTraining));
        assert!(!PrivacyLevel::Standard.relaxes_to(PrivacyLevel::Zdr));
        assert_eq!(PrivacyLevel::Standard.provider(), None);
    }

    #[test]
    fn store_round_trip_keeps_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let s = PrivacyStore::new(dir.path());
        assert_eq!(s.get(), PrivacyLevel::NoTraining);
        assert!(!s.busy_relax());
        assert!(!s.file().exists(), "reading writes nothing");
        s.set(PrivacyLevel::Zdr).unwrap();
        s.set_busy_relax(true).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(s.file()).unwrap()).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"format":"tramado.ai-settings","version":1,"privacy":"zdr","busyRelax":true})
        );
        std::fs::write(
            s.file(),
            r#"{"format":"tramado.ai-settings","version":1,"privacy":"standard","busyRelax":false,"future":7}"#,
        )
        .unwrap();
        let again = PrivacyStore::new(dir.path());
        assert_eq!(again.get(), PrivacyLevel::Standard);
        again.set(PrivacyLevel::NoTraining).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(again.file()).unwrap()).unwrap();
        assert_eq!(v["future"], 7);
        std::fs::write(s.file(), "{broken").unwrap();
        assert_eq!(
            PrivacyStore::new(dir.path()).get(),
            PrivacyLevel::NoTraining
        );
    }
}
