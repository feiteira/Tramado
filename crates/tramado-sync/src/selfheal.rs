// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Self-heal of own files from the ClassFs mirror — sync spec §12.3 (only when SHA-256 differs; never
//! `transcript.*`; `audio.webm` via versions). Empty in M0: R-SYNC implements it.
