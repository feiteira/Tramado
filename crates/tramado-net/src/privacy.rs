// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The AI privacy level and the busy-only relaxation (architecture §5.2 `privacy`, D7, D-10):
//! `config/ai.json` = `{"format":"tramado.ai-settings","version":1,"privacy":"no-training","busyRelax":false}`.
//! **Stub (M0)**: reads return the defaults, writes return `NOT_IMPLEMENTED`; R-SHELL
//! implements the store.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult};

pub const FILE_NAME: &str = "ai.json";

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
}

pub struct PrivacyStore {
    file: PathBuf,
}

impl PrivacyStore {
    pub fn new(config_dir: &Path) -> Self {
        PrivacyStore {
            file: config_dir.join(FILE_NAME),
        }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    /// The stored level (default `no-training`, D7). **Stub**: always the default.
    pub fn get(&self) -> PrivacyLevel {
        PrivacyLevel::NoTraining
    }

    pub fn set(&self, _level: PrivacyLevel) -> AppResult<()> {
        Err(AppError::not_implemented("privacy store"))
    }

    /// "Use NVIDIA free models when the others are busy" (D-10). **Stub**: off.
    pub fn busy_relax(&self) -> bool {
        false
    }

    pub fn set_busy_relax(&self, _relax: bool) -> AppResult<()> {
        Err(AppError::not_implemented("privacy store"))
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
    }
}
