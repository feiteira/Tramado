// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The WriteObserver: coalesced `POST /rest/db/scan?sub=` — sync spec §3.4 (one in flight + one queued per
//! sub-path). Empty in M0: R-SYNC implements it.
