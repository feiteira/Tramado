// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Syncthing supervisor — sync spec §2.4–§2.8 (spawn, wait, restart with backoff, orphan clean-up, stop;
//! Linux PDEATHSIG from a long-lived thread, Windows Job Object). Empty in M0: R-SYNC implements it.
