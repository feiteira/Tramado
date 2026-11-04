// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The AI activity log, `data/ai-activity.jsonl` (architecture §5.2 rule 7, §6.4): one line per
//! request with metadata only — never content, never `user_id`, never `metadata.raw`. The file
//! is trimmed to its newest [`KEEP`] lines once it grows past [`TRIM_AT`] bytes.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppResult, Code};
use tramado_base::files;

use crate::ai::AiAction;

pub const FILE_NAME: &str = "ai-activity.jsonl";
/// `ai_activity` returns at most this many entries.
pub const MAX_LIST: usize = 500;
/// The file is trimmed when it is larger than this…
pub const TRIM_AT: u64 = 1 << 20;
/// …to this many newest entries.
pub const KEEP: usize = 2000;

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
    lock: Mutex<()>,
    trim_at: u64,
    keep: usize,
}

impl ActivityLog {
    pub fn new(data_dir: &Path) -> Self {
        ActivityLog {
            file: data_dir.join(FILE_NAME),
            lock: Mutex::new(()),
            trim_at: TRIM_AT,
            keep: KEEP,
        }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    fn read_all(&self) -> Vec<AiActivityEntry> {
        let Ok(f) = std::fs::File::open(&self.file) else {
            return Vec::new();
        };
        BufReader::new(f)
            .lines()
            .map_while(Result::ok)
            .filter_map(|l| serde_json::from_str::<AiActivityEntry>(&l).ok())
            .collect()
    }

    /// Appends one entry.
    pub fn record(&self, entry: &AiActivityEntry) -> AppResult<()> {
        let mut line = serde_json::to_vec(entry)?;
        line.push(b'\n');
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let len = files::append_line(&self.file, &line)?;
        if len > self.trim_at {
            let all = self.read_all();
            let keep = &all[all.len().saturating_sub(self.keep)..];
            let mut out = Vec::new();
            for e in keep {
                out.extend(serde_json::to_vec(e)?);
                out.push(b'\n');
            }
            files::write_atomic(&self.file, &out)?;
        }
        Ok(())
    }

    /// The newest `limit` entries (≤ 500), newest first.
    pub fn list(&self, limit: usize) -> AppResult<Vec<AiActivityEntry>> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = self.read_all();
        all.reverse();
        all.truncate(limit.min(MAX_LIST));
        Ok(all)
    }

    /// The codes of the newest `n` failed requests, newest first (diagnostics).
    pub fn last_codes(&self, n: usize) -> Vec<(String, Code)> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = self.read_all();
        all.reverse();
        all.into_iter()
            .filter_map(|e| e.code.map(|c| (e.at, c)))
            .take(n)
            .collect()
    }

    /// Empties the log (`ai_activity_clear`).
    pub fn clear(&self) -> AppResult<()> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        files::remove_file_if_exists(&self.file)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(i: u64, code: Option<Code>) -> AiActivityEntry {
        AiActivityEntry {
            at: tramado_base::time::instant(1_793_721_438_000 + i),
            host: "openrouter.ai".into(),
            path: "chat/completions".into(),
            model: Some("google/gemma-4-31b-it:free".into()),
            status: Some(200),
            code,
            ms: 1200,
            bytes_out: 300,
            bytes_in: 4000,
            privacy: ActivityPrivacy::NoTraining,
            class_id: Some("tramado-mde5jfv46prdf2fjxvmbjr4242".into()),
            action: Some(AiAction::Ask),
            passages: 6,
        }
    }

    #[test]
    fn records_lists_newest_first_and_clears() {
        let dir = tempfile::tempdir().unwrap();
        let log = ActivityLog::new(dir.path());
        assert!(log.list(10).unwrap().is_empty());
        for i in 0..5 {
            log.record(&entry(i, (i == 3).then_some(Code::AiBusy)))
                .unwrap();
        }
        let l = log.list(3).unwrap();
        assert_eq!(l.len(), 3);
        assert_eq!(l[0], entry(4, None));
        assert_eq!(log.last_codes(20), vec![(entry(3, None).at, Code::AiBusy)]);
        let json = serde_json::to_value(&l[0]).unwrap();
        assert_eq!(json["bytesOut"], 300);
        assert_eq!(json["privacy"], "no-training");
        assert_eq!(json["action"], "ask");
        assert!(log.list(10_000).unwrap().len() <= MAX_LIST);
        log.clear().unwrap();
        log.clear().unwrap();
        assert!(log.list(10).unwrap().is_empty());
    }

    #[test]
    fn trims_when_large() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = ActivityLog::new(dir.path());
        let one = serde_json::to_vec(&entry(0, None)).unwrap().len() as u64 + 1;
        (log.trim_at, log.keep) = (one * 20, 10);
        let n = 45;
        for i in 0..n {
            log.record(&entry(i, None)).unwrap();
        }
        let size = std::fs::metadata(log.file()).unwrap().len();
        assert!(size <= one * 20, "{size}");
        assert!(log.list(100).unwrap().len() <= 20);
        let newest = log.list(1).unwrap();
        assert_eq!(newest[0], entry(n - 1, None));
    }
}
