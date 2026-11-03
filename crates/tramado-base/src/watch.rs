// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Class folder watcher (architecture §5.1 `watch`, §7.1 `class:changed`). **Stub (M0)**:
//! R-SHELL implements it with notify-debouncer-full (300 ms): it maps absolute paths back to
//! class paths, skips folder spec §4.5 names, sets `self_write` when
//! `ClassFs::is_recent_self_write(.., 2 s)` and `rescan` when notify reports an overflow.

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// TS `ClassChangedEvent` (payload of the global `class:changed` event).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassChanged {
    pub class_id: String,
    pub paths: Vec<String>,
    pub self_write: bool,
    /// re-list everything
    pub rescan: bool,
}

pub type ChangeSink = Arc<dyn Fn(ClassChanged) + Send + Sync>;

pub struct ClassWatcher {
    _sink: ChangeSink,
}

impl ClassWatcher {
    pub fn new(sink: ChangeSink) -> Self {
        ClassWatcher { _sink: sink }
    }

    pub fn watch(&self, _class_id: &str, _root: &Path) -> AppResult<()> {
        Err(AppError::not_implemented("watch"))
    }

    pub fn unwatch(&self, _class_id: &str) {}
}
