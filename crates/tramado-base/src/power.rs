// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Power source (architecture §5.1 `power`, §6.5 `system_power`). **Stub (M0)**: always
//! "unknown". R-SHELL reads `/sys/class/power_supply` (Linux), `GetSystemPowerStatus`
//! (Windows) and `pmset -g batt` (macOS).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PowerSource {
    Ac,
    Battery,
    Unknown,
}

/// TS `Power`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Power {
    pub source: PowerSource,
    pub percent: Option<u8>,
}

pub fn system_power() -> Power {
    Power {
        source: PowerSource::Unknown,
        percent: None,
    }
}
