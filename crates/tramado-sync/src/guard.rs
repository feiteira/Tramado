// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Mass-change guard — sync spec §22.2 (own-deletion log from the WriteObserver; local guard with pause and
//! `massDelete`, receiving guard with `massDeleteRemote`). Empty in M0: R-SYNC implements it.
