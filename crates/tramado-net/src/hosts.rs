// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Hosts the AI pipe may reach (architecture §5.2 `hosts`): OpenRouter, built in, and custom
//! OpenAI-compatible hosts the person allowed through a native confirmation
//! (`config/service-hosts.json`). **Stub (M0)**: R-SHELL ports Trama's `service/hosts.rs`
//! (`Endpoint::parse`: https, or http only for local/private hosts; no user info, no query;
//! look-alikes are not built in) with its tests.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult};

pub const FILE_NAME: &str = "service-hosts.json";
/// Allowed without asking.
pub const BUILT_IN: &[&str] = &["openrouter.ai"];

/// A checked service address: the host (with its port, if any) and the base URL without a
/// trailing slash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub host: String,
    pub base: String,
}

impl Endpoint {
    /// `AI_BAD_ADDRESS` for anything that is not an allowed address. **Stub.**
    pub fn parse(_base: &str) -> AppResult<Self> {
        Err(AppError::not_implemented("Endpoint::parse"))
    }

    pub fn is_built_in(&self) -> bool {
        BUILT_IN.contains(&self.host.as_str())
    }

    pub fn is_openrouter(&self) -> bool {
        self.host == "openrouter.ai"
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }
}

/// TS `AiHost`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHost {
    pub id: String,
    pub base: String,
    pub label: String,
}

pub struct HostList {
    file: PathBuf,
}

impl HostList {
    /// A missing or unreadable file allows nothing beyond the built-in hosts.
    pub fn load(config_dir: &Path) -> Self {
        HostList {
            file: config_dir.join(FILE_NAME),
        }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    /// The custom hosts. **Stub**: none.
    pub fn list(&self) -> Vec<AiHost> {
        Vec::new()
    }

    pub fn get(&self, _host_id: &str) -> Option<AiHost> {
        None
    }

    pub fn add(&self, _endpoint: &Endpoint, _label: &str) -> AppResult<AiHost> {
        Err(AppError::not_implemented("HostList::add"))
    }

    pub fn remove(&self, _host_id: &str) -> AppResult<()> {
        Err(AppError::not_implemented("HostList::remove"))
    }
}
