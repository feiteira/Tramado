// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `tramado-base`: errors, paths, the class registry, the confined class file system, pick
//! tokens, app files, identifiers and time (architecture §5.1). Light: no async runtime, no
//! network; the desktop crate wraps blocking calls in `spawn_blocking`.

pub mod appfiles;
pub mod applog;
pub mod classfs;
pub mod confine;
pub mod error;
pub mod files;
pub mod ids;
pub mod media;
pub mod paths;
pub mod picks;
pub mod power;
pub mod registry;
pub mod time;
pub mod watch;

pub use error::{AppError, AppResult, Code};

/// Marker for readers: every function of this crate blocks (disk), so callers in an async
/// context run them through `util::blocking` (desktop) or a named thread.
pub fn blocking_hint() {}
