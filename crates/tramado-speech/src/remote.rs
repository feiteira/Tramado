// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Cloud speech-to-text (Trama `remote.rs`): 30 s pieces, 4 workers, verbose_json → json downgrade, `prompt` =
//! initial prompt; written against `SttTransport` (the desktop crate passes `AiPipe::request_blocking`).
//! Empty in M0: R-SPEECH.
