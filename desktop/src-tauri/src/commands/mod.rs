// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Every Tauri command of architecture §6, one module per domain. Each module exports
//! `init(app, shared)` (it calls `app.manage(..)` itself) and `on_exit(app)`. Frozen after M0.

pub mod ai;
pub mod app;
pub mod classes;
pub mod dialogs;
pub mod speech;
pub mod sync;
pub mod system;

/// Global event names (architecture §7.1).
pub mod events {
    /// `ClassChangedEvent`
    pub const CLASS_CHANGED: &str = "class:changed";
    /// `SyncEvent`
    pub const SYNC: &str = "sync:event";
    /// `{ url, text? }`
    pub const DEEP_LINK: &str = "app:deep-link";
    /// `{ id: 'marker', kind }`
    pub const SHORTCUT: &str = "app:shortcut";
    /// `{ action }`
    pub const TRAY: &str = "app:tray";
    /// `{ picked, x, y }`
    pub const DROP: &str = "app:drop";
}

/// TS `ConfirmText` (the texts of a native confirmation; `{host}` is filled in by Rust).
pub use tramado_net::ai::ConfirmText;
