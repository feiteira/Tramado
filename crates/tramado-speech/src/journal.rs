// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Ogg Opus recording journal (ogg 0.9.2): a page every 50 packets, fsync every 5 s, `journal.json`, crash
//! recovery (CRC scan, EOS). Empty in M0: R-SPEECH.
