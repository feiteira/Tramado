// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The person key (folder spec §8.3.1, architecture §5.2 `person`): an Ed25519 key created at
//! onboarding and kept in `Secrets` (internal name `person`). It signs only bindings of **this**
//! device to the person, so a webview script cannot bind a foreign device.
//! **Stub (M0)**: R-SHELL implements `init` (seed from getrandom on first call) and `prove`
//! (signs `"tramado-member-v1|" + classId + "|" + deviceId + "|" + memberId`).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult};

use crate::secrets::Secrets;

/// TS `PersonInfo`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonInfo {
    pub member_id: String,
    /// base64url public key
    #[serde(rename = "pub")]
    pub pub_b64url: String,
}

/// TS `PersonProof`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonProof {
    /// base64url public key
    #[serde(rename = "pub")]
    pub pub_b64url: String,
    /// base64url Ed25519 signature
    pub sig: String,
}

pub struct Person {
    _secrets: Arc<Secrets>,
}

impl Person {
    pub fn new(secrets: Arc<Secrets>) -> Self {
        Person { _secrets: secrets }
    }

    /// Creates the person key on the first call; returns its member ID and public key. **Stub.**
    pub fn init(&self) -> AppResult<PersonInfo> {
        Err(AppError::not_implemented("person_init"))
    }

    /// Proves that `device_id` (this device) belongs to the person, for `class_id`. **Stub.**
    pub fn prove(&self, _class_id: &str, _device_id: &str) -> AppResult<PersonProof> {
        Err(AppError::not_implemented("person_prove"))
    }
}
