// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The AI activity log, `data/ai-activity.jsonl` (architecture §5.2 rule 7, §6.4): one line per
//! request with metadata only — never content, never `user_id`, never `metadata.raw`.
//! **Stub (M0)**: R-SHELL implements it.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult, Code};

use crate::ai::AiAction;

pub const FILE_NAME: &str = "ai-activity.jsonl";

/// The privacy an entry was sent with (`custom-host` for hosts other than OpenRouter).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActivityPrivacy {
    Standard,
    NoTraining,
    Zdr,
    CustomHost,
}

/// TS `AiActivityEntry`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiActivityEntry {
    pub at: String,
    pub host: String,
    pub path: String,
    pub model: Option<String>,
    pub status: Option<u16>,
    pub code: Option<Code>,
    pub ms: u64,
    pub bytes_out: u64,
    pub bytes_in: u64,
    pub privacy: ActivityPrivacy,
    pub class_id: Option<String>,
    pub action: Option<AiAction>,
    pub passages: u32,
}

pub struct ActivityLog {
    file: PathBuf,
}

impl ActivityLog {
    pub fn new(data_dir: &Path) -> Self {
        ActivityLog {
            file: data_dir.join(FILE_NAME),
        }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    /// Appends one entry. **Stub.**
    pub fn record(&self, _entry: &AiActivityEntry) -> AppResult<()> {
        Err(AppError::not_implemented("ActivityLog::record"))
    }

    /// The newest `limit` entries (≤ 500), newest first. **Stub.**
    pub fn list(&self, _limit: usize) -> AppResult<Vec<AiActivityEntry>> {
        Err(AppError::not_implemented("ActivityLog::list"))
    }

    pub fn clear(&self) -> AppResult<()> {
        Err(AppError::not_implemented("ActivityLog::clear"))
    }
}
