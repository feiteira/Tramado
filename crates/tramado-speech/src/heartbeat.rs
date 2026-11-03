// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The claim heartbeat thread: rewrites the running claim every 60 s preserving unknown fields; writes
//! `lastHeartbeatWallMs` to `data/transcribe/<lectureId>.json` (sync spec §14.5). Empty in M0: R-SPEECH.
