// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Opaque pick tokens (architecture D-4): dialogs run in Rust and the webview only ever holds a
//! token for what the person picked, never a path it could choose itself.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PickKind {
    Open,
    Save,
    Folder,
}

/// TS `Picked`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Picked {
    pub token: String,
    pub name: String,
    /// For display only.
    pub path: String,
    pub size: Option<u64>,
    pub is_dir: bool,
}

/// Tokens live until the app quits (128-bit random hex).
#[derive(Default)]
pub struct PickRegistry {
    picks: Mutex<HashMap<String, (PathBuf, PickKind)>>,
}

impl PickRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, path: &Path, kind: PickKind) -> Picked {
        let token = crate::ids::random_token_hex(16);
        let meta = std::fs::metadata(path).ok();
        let is_dir = kind == PickKind::Folder || meta.as_ref().is_some_and(|m| m.is_dir());
        let size = match (kind, &meta) {
            (PickKind::Open, Some(m)) if m.is_file() => Some(m.len()),
            _ => None,
        };
        self.picks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(token.clone(), (path.to_path_buf(), kind));
        Picked {
            token,
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
            size,
            is_dir,
        }
    }

    /// The path behind `token`; `INVALID` for an unknown token or one of another kind.
    pub fn resolve(&self, token: &str, expect: PickKind) -> AppResult<PathBuf> {
        let picks = self.picks.lock().unwrap_or_else(|e| e.into_inner());
        match picks.get(token) {
            Some((path, kind)) if *kind == expect => Ok(path.clone()),
            Some(_) => Err(AppError::invalid("pick token of another kind")),
            None => Err(AppError::invalid("unknown pick token")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Code;

    #[test]
    fn token_expected_kind() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("Código Civil.pdf");
        std::fs::write(&f, b"%PDF").unwrap();
        let reg = PickRegistry::new();
        let p = reg.register(&f, PickKind::Open);
        assert_eq!(p.token.len(), 32);
        assert_eq!(p.name, "Código Civil.pdf");
        assert_eq!(p.size, Some(4));
        assert!(!p.is_dir);
        assert_eq!(reg.resolve(&p.token, PickKind::Open).unwrap(), f);
        assert_eq!(
            reg.resolve(&p.token, PickKind::Folder).unwrap_err().code(),
            Code::Invalid
        );
        assert_eq!(
            reg.resolve("0".repeat(32).as_str(), PickKind::Open)
                .unwrap_err()
                .code(),
            Code::Invalid
        );
        let d = reg.register(dir.path(), PickKind::Folder);
        assert!(d.is_dir);
        assert_eq!(d.size, None);
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["isDir"], true);
        assert_eq!(json["size"], serde_json::Value::Null);
    }
}
