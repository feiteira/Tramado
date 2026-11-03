// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Model download: 32 MiB Range chunks, the Hugging Face URL re-resolved per chunk, resume with re-hash,
//! `DISK_FULL` (fs4), `MODEL_INTEGRITY` (architecture §5.4, audio-pipeline §3.3). Empty in M0: R-SPEECH.
