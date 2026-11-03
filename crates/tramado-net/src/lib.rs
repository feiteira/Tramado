// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `tramado-net`: every HTTP request of the app process (architecture §5.2). The webview has no
//! network; the OpenRouter key and the hosts allow-list live here.

pub mod activity;
pub mod ai;
pub mod hosts;
pub mod http;
pub mod person;
pub mod privacy;
pub mod secrets;
#[cfg(any(test, feature = "testutil"))]
pub mod testutil;
